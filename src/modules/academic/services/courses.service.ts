import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateCourseDto } from '../dto/create-course.dto';
import { toSantims } from '../../../common/money/money';

@Injectable()
export class CoursesService {
  constructor(private prisma: PrismaService) {}

  // Courses
  async createCourse(tenantId: string, dto: CreateCourseDto) {
    return this.prisma.course.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        nameAm: dto.nameAm?.trim(),
        durationDays: dto.durationDays,
        totalHours: dto.totalHours,
        defaultFeeMinor: toSantims(dto.defaultFee),
        requiredAttendancePct: dto.requiredAttendancePct || 80,
      },
    });
  }

  async findAllCourses(tenantId: string) {
    return this.prisma.course.findMany({
      where: { tenantId, active: true },
      include: {
        batches: {
          select: { id: true, code: true, status: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Rooms
  async createRoom(tenantId: string, name: string, capacity?: number) {
    return this.prisma.room.create({
      data: { tenantId, name: name.trim(), capacity },
    });
  }

  async findAllRooms(tenantId: string) {
    return this.prisma.room.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  // Trainers
  async createTrainer(tenantId: string, name: string, nameAm?: string, phone?: string, userId?: string) {
    return this.prisma.trainer.create({
      data: {
        tenantId,
        name: name.trim(),
        nameAm: nameAm?.trim(),
        phone,
        userId,
      },
    });
  }

  async findAllTrainers(tenantId: string) {
    return this.prisma.trainer.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }
}
