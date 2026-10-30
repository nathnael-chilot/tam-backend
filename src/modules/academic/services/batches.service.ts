import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateBatchDto } from '../dto/create-batch.dto';
import {
  toEthiopianDate,
  ETHIOPIAN_FIXED_HOLIDAYS,
} from '../../../common/calendar/ethiopian-calendar';
import { BatchStatus, SessionStatus } from '@prisma/client';

@Injectable()
export class BatchesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Check room and trainer conflicts for an overlapping time window
   */
  async checkConflict(
    tenantId: string,
    roomId?: string,
    trainerId?: string,
    sessionDate?: Date,
    startTime?: string,
    endTime?: string,
  ) {
    if (!sessionDate || !startTime || !endTime) return;

    if (roomId) {
      const roomConflict = await this.prisma.session.findFirst({
        where: {
          tenantId,
          roomId,
          date: sessionDate,
          status: SessionStatus.SCHEDULED,
          OR: [
            {
              startTime: { lte: startTime },
              endTime: { gt: startTime },
            },
            {
              startTime: { lt: endTime },
              endTime: { gte: endTime },
            },
          ],
        },
        include: { batch: true, room: true },
      });

      if (roomConflict) {
        throw new ConflictException(
          `Room "${roomConflict.room?.name}" is already booked by batch ${roomConflict.batch.code} on ${sessionDate.toISOString().slice(0, 10)} from ${roomConflict.startTime} to ${roomConflict.endTime}.`,
        );
      }
    }

    if (trainerId) {
      const trainerConflict = await this.prisma.session.findFirst({
        where: {
          tenantId,
          trainerId,
          date: sessionDate,
          status: SessionStatus.SCHEDULED,
          OR: [
            {
              startTime: { lte: startTime },
              endTime: { gt: startTime },
            },
            {
              startTime: { lt: endTime },
              endTime: { gte: endTime },
            },
          ],
        },
        include: { batch: true, trainer: true },
      });

      if (trainerConflict) {
        throw new ConflictException(
          `Trainer "${trainerConflict.trainer?.name}" is already assigned to batch ${trainerConflict.batch.code} on ${sessionDate.toISOString().slice(0, 10)} from ${trainerConflict.startTime} to ${trainerConflict.endTime}.`,
        );
      }
    }
  }

  /**
   * Create a new batch and auto-generate class sessions with Ethiopian holiday skipping
   */
  async createBatch(tenantId: string, dto: CreateBatchDto) {
    const course = await this.prisma.course.findFirst({
      where: { id: dto.courseId, tenantId },
    });
    if (!course) throw new NotFoundException('Course not found');

    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end <= start) {
      throw new BadRequestException('End date must be after start date');
    }

    // Check duplicate batch code
    const existingCode = await this.prisma.batch.findFirst({
      where: { tenantId, code: dto.code.trim() },
    });
    if (existingCode) {
      throw new ConflictException(`Batch with code "${dto.code}" already exists in your academy.`);
    }

    // Generate session candidate dates
    const sessionDates: Date[] = [];
    const skippedHolidays: { date: string; name: string }[] = [];

    const curr = new Date(start);
    while (curr <= end) {
      // JS day: 0 = Sun, 1 = Mon ... 6 = Sat
      // Dto days: 1 = Mon, 2 = Tue ... 7 = Sun
      const jsDay = curr.getUTCDay();
      const mappedDay = jsDay === 0 ? 7 : jsDay;

      if (dto.daysOfWeek.includes(mappedDay)) {
        let isHoliday = false;

        if (dto.skipHolidays !== false) {
          const ec = toEthiopianDate(curr);
          const holiday = ETHIOPIAN_FIXED_HOLIDAYS.find(
            (h) => h.ecMonth === ec.month && h.ecDay === ec.day,
          );

          if (holiday) {
            isHoliday = true;
            skippedHolidays.push({
              date: curr.toISOString().slice(0, 10),
              name: `${holiday.nameEn} (${holiday.nameAm})`,
            });
          }
        }

        if (!isHoliday) {
          sessionDates.push(new Date(curr));
        }
      }

      curr.setUTCDate(curr.getUTCDate() + 1);
    }

    if (sessionDates.length === 0) {
      throw new BadRequestException(
        'No valid session dates generated between the start and end date for the selected days of the week.',
      );
    }

    // Check conflicts for the first 5 sessions as a fast pre-flight check
    for (const d of sessionDates.slice(0, 5)) {
      await this.checkConflict(
        tenantId,
        dto.roomId,
        dto.trainerId,
        d,
        dto.startTime,
        dto.endTime,
      );
    }

    // Atomically create batch and all sessions
    const batch = await this.prisma.$transaction(async (tx) => {
      const b = await tx.batch.create({
        data: {
          tenantId,
          code: dto.code.trim(),
          courseId: dto.courseId,
          trainerId: dto.trainerId,
          roomId: dto.roomId,
          capacity: dto.capacity,
          startDate: start,
          endDate: end,
          status: BatchStatus.ENROLLING,
          pattern: {
            days: dto.daysOfWeek,
            startTime: dto.startTime,
            endTime: dto.endTime,
            skipHolidays: dto.skipHolidays !== false,
          },
        },
      });

      // Bulk generate sessions
      await tx.session.createMany({
        data: sessionDates.map((date) => ({
          tenantId,
          batchId: b.id,
          date,
          startTime: dto.startTime,
          endTime: dto.endTime,
          roomId: dto.roomId,
          trainerId: dto.trainerId,
          status: SessionStatus.SCHEDULED,
        })),
      });

      return b;
    });

    return {
      batch,
      generatedSessionsCount: sessionDates.length,
      skippedHolidays,
    };
  }

  async findAll(tenantId: string) {
    const batches = await this.prisma.batch.findMany({
      where: { tenantId },
      include: {
        course: true,
        trainer: true,
        room: true,
        enrolments: {
          select: { id: true },
        },
        sessions: {
          select: { id: true, date: true, status: true },
        },
      },
      orderBy: { startDate: 'desc' },
    });

    return batches.map((b) => ({
      id: b.id,
      code: b.code,
      courseName: b.course.name,
      courseNameAm: b.course.nameAm,
      trainerName: b.trainer?.name || 'Unassigned',
      roomName: b.room?.name || 'Unassigned',
      capacity: b.capacity,
      enrolledCount: b.enrolments.length,
      isFull: b.enrolments.length >= b.capacity,
      totalSessions: b.sessions.length,
      startDate: b.startDate,
      endDate: b.endDate,
      status: b.status,
      pattern: b.pattern,
    }));
  }

  async findOne(tenantId: string, id: string) {
    const batch = await this.prisma.batch.findFirst({
      where: { id, tenantId },
      include: {
        course: true,
        trainer: true,
        room: true,
        enrolments: {
          include: { student: true },
        },
        sessions: {
          orderBy: { date: 'asc' },
          include: {
            attendances: true,
          },
        },
      },
    });

    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }

  /**
   * Weekly timetable query returning sessions grouped by date
   */
  async getTimetable(tenantId: string, startDate: string, endDate: string) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    return this.prisma.session.findMany({
      where: {
        tenantId,
        date: { gte: start, lte: end },
      },
      include: {
        batch: {
          include: { course: true },
        },
        room: true,
        trainer: true,
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });
  }
}
