import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BulkMarkAttendanceDto } from './dto/mark-attendance.dto';
import { EditAttendanceDto } from './dto/edit-attendance.dto';
import { QueryRegisterDto } from './dto/query-register.dto';
import { toEthiopianDate } from '../../common/calendar/ethiopian-calendar';
import { AttendStatus, SessionStatus, EnrolmentStatus } from '@prisma/client';

const DEFAULT_ATTENDANCE_LOCK_DAYS = 7;

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService) {}

  /**
   * Helper: check if a session date is locked for non-admins
   */
  private isSessionLocked(sessionDate: Date, userRole?: string): boolean {
    if (userRole === 'OWNER' || userRole === 'ADMIN' || userRole === 'ACADEMY_OWNER') {
      return false; // Admins and Owners can always edit historical sessions
    }

    const now = new Date();
    const diffTime = now.getTime() - new Date(sessionDate).getTime();
    const diffDays = diffTime / (1000 * 60 * 60 * 24);

    return diffDays > DEFAULT_ATTENDANCE_LOCK_DAYS;
  }

  /**
   * Mark or bulk-upsert attendance for a class session
   */
  async markSessionAttendance(
    tenantId: string,
    sessionId: string,
    userId: string,
    userRole: string,
    dto: BulkMarkAttendanceDto,
  ) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, tenantId },
      include: { batch: true },
    });

    if (!session) {
      throw new NotFoundException('Class session not found');
    }

    if (this.isSessionLocked(session.date, userRole)) {
      throw new ForbiddenException(
        `Attendance for this session is locked because it took place more than ${DEFAULT_ATTENDANCE_LOCK_DAYS} days ago. Contact your academy administrator to unlock.`,
      );
    }

    // Upsert each attendance record in a transaction
    await this.prisma.$transaction(
      dto.records.map((item) =>
        this.prisma.attendanceRecord.upsert({
          where: {
            tenantId_sessionId_studentId: {
              tenantId,
              sessionId,
              studentId: item.studentId,
            },
          },
          create: {
            tenantId,
            sessionId,
            studentId: item.studentId,
            status: item.status,
            note: item.note?.trim() || null,
            markedById: userId,
            clientId: item.clientId || null,
          },
          update: {
            status: item.status,
            note: item.note !== undefined ? item.note.trim() : undefined,
            markedById: userId,
            clientId: item.clientId || undefined,
          },
        }),
      ),
    );

    // Update session status to COMPLETED
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { status: SessionStatus.COMPLETED },
    });

    return {
      success: true,
      sessionId,
      markedCount: dto.records.length,
      status: SessionStatus.COMPLETED,
    };
  }

  /**
   * Retroactive edit of a single student attendance record with audit reason
   */
  async editAttendanceRecord(
    tenantId: string,
    recordId: string,
    userId: string,
    userRole: string,
    dto: EditAttendanceDto,
  ) {
    const record = await this.prisma.attendanceRecord.findFirst({
      where: { id: recordId, tenantId },
      include: { session: true },
    });

    if (!record) {
      throw new NotFoundException('Attendance record not found');
    }

    if (this.isSessionLocked(record.session.date, userRole)) {
      throw new ForbiddenException(
        `This attendance record is locked (> ${DEFAULT_ATTENDANCE_LOCK_DAYS} days old). Only academy administrators can modify historical attendance.`,
      );
    }

    return this.prisma.attendanceRecord.update({
      where: { id: recordId },
      data: {
        status: dto.status,
        note: dto.note !== undefined ? dto.note.trim() : record.note,
        editedAt: new Date(),
        editReason: dto.editReason.trim(),
        markedById: userId,
      },
    });
  }

  /**
   * Get attendance for a single session (for mobile trainer UI)
   */
  async getSessionAttendance(tenantId: string, sessionId: string) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, tenantId },
      include: {
        batch: {
          include: {
            course: true,
            room: true,
            trainer: true,
          },
        },
        room: true,
        trainer: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    // Get active students enrolled in this batch
    const enrolments = await this.prisma.enrolment.findMany({
      where: {
        tenantId,
        batchId: session.batchId,
        status: EnrolmentStatus.ENROLLED,
      },
      include: {
        student: true,
      },
      orderBy: {
        student: { firstName: 'asc' },
      },
    });

    // Get any existing attendance records
    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        tenantId,
        sessionId,
      },
    });

    const recordMap = new Map(records.map((r) => [r.studentId, r]));

    const ecDate = toEthiopianDate(new Date(session.date));

    const roster = enrolments.map((e) => {
      const record = recordMap.get(e.studentId);
      return {
        studentId: e.student.id,
        studentNo: e.student.studentNo,
        firstName: e.student.firstName,
        lastName: e.student.lastName,
        firstNameAm: e.student.firstNameAm,
        lastNameAm: e.student.lastNameAm,
        phone: e.student.phone,
        attendanceRecordId: record?.id || null,
        status: record?.status || null, // null means unmarked yet
        note: record?.note || null,
      };
    });

    const markedCount = records.length;
    const totalCount = enrolments.length;

    return {
      session: {
        id: session.id,
        date: session.date,
        ethiopianDate: ecDate,
        startTime: session.startTime,
        endTime: session.endTime,
        status: session.status,
        courseName: session.batch.course.name,
        courseNameAm: session.batch.course.nameAm,
        batchCode: session.batch.code,
        roomName: session.room?.name || session.batch.room?.name || 'Unassigned Room',
        trainerName: session.trainer?.name || session.batch.trainer?.name || 'Unassigned Trainer',
      },
      stats: {
        totalStudents: totalCount,
        markedCount,
        progressPct: totalCount > 0 ? Math.round((markedCount / totalCount) * 100) : 0,
      },
      roster,
    };
  }

  /**
   * Get broadsheet attendance register matrix for a batch
   */
  async getBatchRegister(tenantId: string, query: QueryRegisterDto) {
    const batch = await this.prisma.batch.findFirst({
      where: { id: query.batchId, tenantId },
      include: {
        course: true,
        trainer: true,
        room: true,
      },
    });

    if (!batch) {
      throw new NotFoundException('Batch not found');
    }

    // Sessions for this batch
    const sessions = await this.prisma.session.findMany({
      where: {
        tenantId,
        batchId: query.batchId,
        ...(query.fromDate ? { date: { gte: new Date(query.fromDate) } } : {}),
        ...(query.toDate ? { date: { lte: new Date(query.toDate) } } : {}),
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });

    // Enrolled students
    const enrolments = await this.prisma.enrolment.findMany({
      where: {
        tenantId,
        batchId: query.batchId,
        status: EnrolmentStatus.ENROLLED,
      },
      include: {
        student: true,
      },
      orderBy: {
        student: { studentNo: 'asc' },
      },
    });

    // Attendance records for all sessions in this batch
    const sessionIds = sessions.map((s) => s.id);
    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        tenantId,
        sessionId: { in: sessionIds },
      },
    });

    // Matrix lookup: matrix[studentId][sessionId] = record
    const matrix: Record<string, Record<string, any>> = {};
    for (const rec of records) {
      if (!matrix[rec.studentId]) matrix[rec.studentId] = {};
      matrix[rec.studentId][rec.sessionId] = {
        id: rec.id,
        status: rec.status,
        note: rec.note,
        editedAt: rec.editedAt,
        editReason: rec.editReason,
      };
    }

    // Compute stats per student
    const studentSummaries = enrolments.map((enr) => {
      const student = enr.student;
      const studentRecords = matrix[student.id] || {};

      let presentCount = 0;
      let lateCount = 0;
      let absentCount = 0;
      let excusedCount = 0;

      for (const sess of sessions) {
        const item = studentRecords[sess.id];
        if (item) {
          if (item.status === AttendStatus.PRESENT) presentCount++;
          else if (item.status === AttendStatus.LATE) lateCount++;
          else if (item.status === AttendStatus.ABSENT) absentCount++;
          else if (item.status === AttendStatus.EXCUSED) excusedCount++;
        }
      }

      // Count sessions that have already occurred or been completed
      const heldSessions = sessions.filter(
        (s) => s.status === SessionStatus.COMPLETED || new Date(s.date) <= new Date(),
      ).length;

      // Rate: (Present + Late) / total held sessions (or 100% if 0 sessions held yet)
      const denominator = heldSessions > 0 ? heldSessions : 1;
      const effectivePresent = presentCount + lateCount;
      const ratePct = heldSessions > 0 ? Math.round((effectivePresent / denominator) * 100) : 100;

      const requiredPct = batch.course.requiredAttendancePct || 80;
      const isLowAttendance = heldSessions >= 3 && ratePct < requiredPct;

      return {
        studentId: student.id,
        studentNo: student.studentNo,
        firstName: student.firstName,
        lastName: student.lastName,
        firstNameAm: student.firstNameAm,
        lastNameAm: student.lastNameAm,
        phone: student.phone,
        stats: {
          totalHeld: heldSessions,
          presentCount,
          lateCount,
          absentCount,
          excusedCount,
          ratePct,
          isLowAttendance,
          requiredPct,
        },
      };
    });

    const formattedSessions = sessions.map((s) => ({
      id: s.id,
      date: s.date,
      ethiopianDate: toEthiopianDate(new Date(s.date)),
      startTime: s.startTime,
      endTime: s.endTime,
      status: s.status,
    }));

    return {
      batch: {
        id: batch.id,
        code: batch.code,
        courseName: batch.course.name,
        courseNameAm: batch.course.nameAm,
        requiredPct: batch.course.requiredAttendancePct || 80,
        trainerName: batch.trainer?.name || 'Unassigned',
        roomName: batch.room?.name || 'Unassigned',
      },
      sessions: formattedSessions,
      students: studentSummaries,
      matrix,
    };
  }

  /**
   * Get active classes scheduled for today or upcoming (for trainer portal dashboard)
   */
  async getTodaySessions(tenantId: string, trainerId?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const sessions = await this.prisma.session.findMany({
      where: {
        tenantId,
        date: {
          gte: today,
          lte: endOfDay,
        },
        ...(trainerId ? { trainerId } : {}),
      },
      include: {
        batch: {
          include: {
            course: true,
            room: true,
            trainer: true,
          },
        },
        room: true,
        trainer: true,
      },
      orderBy: { startTime: 'asc' },
    });

    return sessions.map((s) => ({
      id: s.id,
      batchId: s.batchId,
      batchCode: s.batch.code,
      courseName: s.batch.course.name,
      courseNameAm: s.batch.course.nameAm,
      startTime: s.startTime,
      endTime: s.endTime,
      roomName: s.room?.name || s.batch.room?.name || 'Unassigned Room',
      trainerName: s.trainer?.name || s.batch.trainer?.name || 'Unassigned Trainer',
      status: s.status,
      date: s.date,
      ethiopianDate: toEthiopianDate(new Date(s.date)),
    }));
  }
}
