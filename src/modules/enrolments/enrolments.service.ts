import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEnrolmentDto } from './dto/create-enrolment.dto';
import { toSantims } from '../../common/money/money';
import { EnrolmentStatus } from '@prisma/client';

@Injectable()
export class EnrolmentsService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateEnrolmentDto) {
    // 1. Verify student exists in this tenant
    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, tenantId, deletedAt: null },
    });
    if (!student) throw new NotFoundException('Student not found');

    // 2. Verify batch exists and check seat capacity
    const batch = await this.prisma.batch.findFirst({
      where: { id: dto.batchId, tenantId },
      include: {
        course: true,
        enrolments: {
          where: { status: EnrolmentStatus.ENROLLED },
        },
      },
    });
    if (!batch) throw new NotFoundException('Batch not found');

    if (batch.enrolments.length >= batch.capacity) {
      throw new BadRequestException(
        `Batch ${batch.code} has reached its maximum seat capacity (${batch.capacity} seats).`,
      );
    }

    // 3. Check duplicate enrolment
    const existing = await this.prisma.enrolment.findFirst({
      where: {
        tenantId,
        studentId: dto.studentId,
        batchId: dto.batchId,
      },
    });
    if (existing) {
      throw new ConflictException(
        `Student ${student.firstName} is already enrolled in batch ${batch.code}.`,
      );
    }

    // Determine fee and discount
    const feeMinor =
      dto.customFee !== undefined
        ? toSantims(dto.customFee)
        : batch.course.defaultFeeMinor;

    const discountMinor =
      dto.discount !== undefined ? toSantims(dto.discount) : 0n;

    return this.prisma.enrolment.create({
      data: {
        tenantId,
        studentId: dto.studentId,
        batchId: dto.batchId,
        enrolledOn: new Date(),
        status: EnrolmentStatus.ENROLLED,
        feeMinor,
        discountMinor,
        discountReason: dto.discountReason?.trim(),
      },
      include: {
        student: true,
        batch: {
          include: { course: true },
        },
      },
    });
  }

  async transfer(tenantId: string, enrolmentId: string, targetBatchId: string) {
    const enrolment = await this.prisma.enrolment.findFirst({
      where: { id: enrolmentId, tenantId },
      include: { batch: true },
    });
    if (!enrolment) throw new NotFoundException('Enrolment not found');

    const targetBatch = await this.prisma.batch.findFirst({
      where: { id: targetBatchId, tenantId },
      include: {
        course: true,
        enrolments: { where: { status: EnrolmentStatus.ENROLLED } },
      },
    });
    if (!targetBatch) throw new NotFoundException('Target batch not found');

    if (targetBatch.enrolments.length >= targetBatch.capacity) {
      throw new BadRequestException(
        `Target batch ${targetBatch.code} is full (${targetBatch.capacity} seats).`,
      );
    }

    return this.prisma.enrolment.update({
      where: { id: enrolmentId },
      data: {
        batchId: targetBatchId,
        status: EnrolmentStatus.TRANSFERRED,
      },
    });
  }

  async drop(tenantId: string, enrolmentId: string) {
    return this.prisma.enrolment.update({
      where: { id: enrolmentId },
      data: {
        status: EnrolmentStatus.DROPPED,
        droppedOn: new Date(),
      },
    });
  }
}
