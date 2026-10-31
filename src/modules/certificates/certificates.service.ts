import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IssueCertificateDto } from './dto/issue-certificate.dto';
import { BulkIssueCertificatesDto } from './dto/bulk-issue-certificates.dto';
import { RevokeCertificateDto } from './dto/revoke-certificate.dto';
import { QueryCertificatesDto } from './dto/query-certificates.dto';
import { toEthiopianDate } from '../../common/calendar/ethiopian-calendar';
import { formatETB, fromSantims } from '../../common/money/money';
import { CertStatus, AttendStatus, EnrolmentStatus, Prisma } from '@prisma/client';
import crypto from 'crypto';

@Injectable()
export class CertificatesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Evaluate student eligibility for certificate graduation
   * Criteria: Attendance >= Course threshold & Ledger balance <= 0 santims
   */
  async checkEligibility(tenantId: string, studentId: string, batchId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, tenantId, deletedAt: null },
    });
    if (!student) throw new NotFoundException('Student not found');

    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, tenantId },
      include: {
        course: true,
        sessions: {
          where: { date: { lte: new Date() } },
        },
      },
    });
    if (!batch) throw new NotFoundException('Batch not found');

    const enrolment = await this.prisma.enrolment.findFirst({
      where: { tenantId, studentId, batchId, status: EnrolmentStatus.ENROLLED },
    });
    if (!enrolment) {
      throw new BadRequestException('Student is not actively enrolled in this batch.');
    }

    // 1. Attendance Rate Calculation
    const sessionIds = batch.sessions.map((s) => s.id);
    const totalSessionsHeld = sessionIds.length;

    let attendedCount = 0;
    if (totalSessionsHeld > 0) {
      const records = await this.prisma.attendanceRecord.findMany({
        where: {
          tenantId,
          sessionId: { in: sessionIds },
          studentId,
        },
      });

      attendedCount = records.filter(
        (r) => r.status === AttendStatus.PRESENT || r.status === AttendStatus.LATE,
      ).length;
    }

    const attendancePct =
      totalSessionsHeld > 0
        ? Math.round((attendedCount / totalSessionsHeld) * 100)
        : 100;

    const requiredAttendancePct = batch.course.requiredAttendancePct;
    const meetsAttendance = attendancePct >= requiredAttendancePct;

    // 2. Financial Balance Calculation via append-only ledger
    const ledgerSum = await this.prisma.ledgerEntry.aggregate({
      where: { tenantId, studentId },
      _sum: { amountMinor: true },
    });
    const balanceMinor = ledgerSum._sum.amountMinor || 0n;
    const feesCleared = balanceMinor <= 0n;

    // 3. Compile eligibility result
    const reasons: string[] = [];
    if (!meetsAttendance) {
      reasons.push(
        `Attendance is ${attendancePct}%, below the required threshold of ${requiredAttendancePct}%.`,
      );
    }
    if (!feesCleared) {
      reasons.push(
        `Outstanding tuition balance of ${formatETB(balanceMinor)} must be fully paid before certificate issuance.`,
      );
    }

    const existingCert = await this.prisma.certificate.findFirst({
      where: { tenantId, studentId, batchId, status: CertStatus.ISSUED },
    });

    return {
      eligible: meetsAttendance && feesCleared && !existingCert,
      alreadyIssued: !!existingCert,
      existingCertificateId: existingCert?.id,
      criteria: {
        meetsAttendance,
        attendancePct,
        requiredAttendancePct,
        attendedSessions: attendedCount,
        totalSessionsHeld,
        feesCleared,
        balanceMinor,
        balanceFormatted: formatETB(balanceMinor),
      },
      reasons,
    };
  }

  /**
   * Issue an individual certificate with gapless sequential number and cryptographic token
   */
  async issueCertificate(tenantId: string, dto: IssueCertificateDto) {
    const eligibility = await this.checkEligibility(tenantId, dto.studentId, dto.batchId);
    if (!eligibility.eligible) {
      if (eligibility.alreadyIssued) {
        throw new ConflictException(
          'An active certificate of completion has already been issued for this student in this batch.',
        );
      }
      throw new BadRequestException(
        `Student is not eligible for certificate: ${eligibility.reasons.join(' ')}`,
      );
    }

    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, tenantId },
    });
    const batch = await this.prisma.batch.findFirst({
      where: { id: dto.batchId, tenantId },
      include: { course: true },
    });

    const issuedDate = new Date();
    const ecYear = toEthiopianDate(issuedDate).year;

    return this.prisma.$transaction(async (tx) => {
      // 1. Allocate sequential certificate number using SELECT ... FOR UPDATE
      const counterRow = await tx.$queryRaw<Array<{ next: number }>>`
        SELECT "next" FROM "CertificateCounter"
        WHERE "tenantId" = ${tenantId} AND "year" = ${ecYear}
        FOR UPDATE
      `;

      let certNumber = 1;
      if (counterRow.length > 0) {
        certNumber = counterRow[0].next;
        await tx.$executeRaw`
          UPDATE "CertificateCounter"
          SET "next" = "next" + 1
          WHERE "tenantId" = ${tenantId} AND "year" = ${ecYear}
        `;
      } else {
        await tx.$executeRaw`
          INSERT INTO "CertificateCounter" ("tenantId", "year", "next")
          VALUES (${tenantId}, ${ecYear}, 2)
        `;
      }

      const formattedNumber = `CERT-${ecYear}-${certNumber.toString().padStart(4, '0')}`;
      const verifyToken = crypto.randomUUID();

      const certificate = await tx.certificate.create({
        data: {
          tenantId,
          studentId: dto.studentId,
          batchId: dto.batchId,
          number: formattedNumber,
          issuedOn: issuedDate,
          status: CertStatus.ISSUED,
          verifyToken,
        },
        include: {
          student: true,
          batch: { include: { course: true } },
          tenant: true,
        },
      });

      return {
        certificate,
        formattedNumber,
        verifyToken,
        verificationUrl: `https://tsehafi.et/verify/cert/${verifyToken}`,
      };
    });
  }

  /**
   * Bulk issue certificates for all eligible students in a batch
   */
  async bulkIssueCertificates(tenantId: string, dto: BulkIssueCertificatesDto) {
    const enrolments = await this.prisma.enrolment.findMany({
      where: { tenantId, batchId: dto.batchId, status: EnrolmentStatus.ENROLLED },
      include: { student: true },
    });

    const issued: any[] = [];
    const skipped: any[] = [];

    for (const enr of enrolments) {
      try {
        const eligibility = await this.checkEligibility(tenantId, enr.studentId, dto.batchId);
        if (eligibility.eligible) {
          const cert = await this.issueCertificate(tenantId, {
            studentId: enr.studentId,
            batchId: dto.batchId,
          });
          issued.push({
            studentId: enr.studentId,
            studentName: `${enr.student.firstName} ${enr.student.lastName}`,
            certificateNumber: cert.formattedNumber,
            verifyToken: cert.verifyToken,
          });
        } else {
          skipped.push({
            studentId: enr.studentId,
            studentName: `${enr.student.firstName} ${enr.student.lastName}`,
            reasons: eligibility.reasons,
          });
        }
      } catch (err: any) {
        skipped.push({
          studentId: enr.studentId,
          studentName: `${enr.student.firstName} ${enr.student.lastName}`,
          reasons: [err.message || 'Issuance failed'],
        });
      }
    }

    return {
      batchId: dto.batchId,
      totalEnrolled: enrolments.length,
      issuedCount: issued.length,
      skippedCount: skipped.length,
      issued,
      skipped,
    };
  }

  /**
   * Revoke an issued certificate with mandatory audit reason
   */
  async revokeCertificate(tenantId: string, id: string, dto: RevokeCertificateDto) {
    const certificate = await this.prisma.certificate.findFirst({
      where: { id, tenantId },
    });
    if (!certificate) throw new NotFoundException('Certificate record not found.');

    if (certificate.status === CertStatus.REVOKED) {
      throw new BadRequestException('Certificate has already been revoked.');
    }

    return this.prisma.certificate.update({
      where: { id },
      data: {
        status: CertStatus.REVOKED,
        revokedReason: dto.revokedReason.trim(),
      },
      include: {
        student: true,
        batch: { include: { course: true } },
      },
    });
  }

  /**
   * List certificates with filters
   */
  async findAll(tenantId: string, query: QueryCertificatesDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.CertificateWhereInput = {
      tenantId,
      ...(query.batchId ? { batchId: query.batchId } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { number: { contains: query.search, mode: 'insensitive' } },
              { student: { firstName: { contains: query.search, mode: 'insensitive' } } },
              { student: { lastName: { contains: query.search, mode: 'insensitive' } } },
              { student: { studentNo: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.certificate.count({ where }),
      this.prisma.certificate.findMany({
        where,
        skip,
        take: limit,
        include: {
          student: true,
          batch: { include: { course: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      data: data.map((c) => {
        const ec = toEthiopianDate(new Date(c.issuedOn));
        return {
          id: c.id,
          number: c.number,
          issuedOn: c.issuedOn,
          ethiopianDateString: `መስከረም ${ec.day}, ${ec.year} ዓ.ም`,
          status: c.status,
          verifyToken: c.verifyToken,
          revokedReason: c.revokedReason,
          student: {
            id: c.student.id,
            studentNo: c.student.studentNo,
            name: `${c.student.firstName} ${c.student.lastName}`,
            nameAm: c.student.firstNameAm ? `${c.student.firstNameAm} ${c.student.lastNameAm}` : null,
            phone: c.student.phone,
          },
          course: {
            id: c.batch.course.id,
            name: c.batch.course.name,
            nameAm: c.batch.course.nameAm,
          },
          batch: {
            id: c.batch.id,
            code: c.batch.code,
          },
        };
      }),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get single certificate details for A4 landscape rendering
   */
  async findById(tenantId: string, id: string) {
    const cert = await this.prisma.certificate.findFirst({
      where: { id, tenantId },
      include: {
        student: true,
        batch: {
          include: {
            course: true,
            trainer: true,
          },
        },
        tenant: true,
      },
    });

    if (!cert) throw new NotFoundException('Certificate record not found.');

    const ec = toEthiopianDate(new Date(cert.issuedOn));

    return {
      certificate: {
        id: cert.id,
        number: cert.number,
        issuedOn: cert.issuedOn,
        ethiopianDateString: `መስከረም ${ec.day}, ${ec.year} ዓ.ም`,
        status: cert.status,
        verifyToken: cert.verifyToken,
        revokedReason: cert.revokedReason,
        verificationUrl: `https://tsehafi.et/verify/cert/${cert.verifyToken}`,
        academy: {
          name: cert.tenant.name,
          nameAm: cert.tenant.nameAm,
          tin: cert.tenant.tin || '0012345678',
          phone: cert.tenant.phone || '+251 11 618 0000',
          city: cert.tenant.city || 'Addis Ababa, Ethiopia',
        },
        student: {
          id: cert.student.id,
          studentNo: cert.student.studentNo,
          name: `${cert.student.firstName} ${cert.student.lastName}`,
          nameAm: cert.student.firstNameAm ? `${cert.student.firstNameAm} ${cert.student.lastNameAm}` : null,
          photoKey: cert.student.photoKey,
        },
        course: {
          id: cert.batch.course.id,
          name: cert.batch.course.name,
          nameAm: cert.batch.course.nameAm,
          totalHours: cert.batch.course.totalHours || 40,
        },
        batch: {
          id: cert.batch.id,
          code: cert.batch.code,
          startDate: cert.batch.startDate,
          endDate: cert.batch.endDate,
          trainerName: cert.batch.trainer?.name || 'Lead Instructor',
        },
      },
    };
  }

  /**
   * Public verification check by cryptographic verifyToken (No auth required)
   */
  async verifyPublicToken(token: string) {
    const cert = await this.prisma.certificate.findFirst({
      where: { verifyToken: token },
      include: {
        student: true,
        batch: {
          include: {
            course: true,
            trainer: true,
          },
        },
        tenant: true,
      },
    });

    if (!cert) {
      return {
        valid: false,
        status: 'NOT_FOUND',
        message: 'This certificate token does not correspond to any official credential issued by Tsehafi SaaS.',
      };
    }

    const ec = toEthiopianDate(new Date(cert.issuedOn));
    const isRevoked = cert.status === CertStatus.REVOKED;

    return {
      valid: !isRevoked,
      status: cert.status,
      certificateNumber: cert.number,
      issuedOn: cert.issuedOn,
      ethiopianDateString: `መስከረም ${ec.day}, ${ec.year} ዓ.ም`,
      revokedReason: cert.revokedReason,
      academy: {
        name: cert.tenant.name,
        nameAm: cert.tenant.nameAm,
        tin: cert.tenant.tin || '0012345678',
        city: cert.tenant.city || 'Addis Ababa, Ethiopia',
      },
      student: {
        name: `${cert.student.firstName} ${cert.student.lastName}`,
        nameAm: cert.student.firstNameAm ? `${cert.student.firstNameAm} ${cert.student.lastNameAm}` : null,
        studentNo: cert.student.studentNo,
      },
      course: {
        name: cert.batch.course.name,
        nameAm: cert.batch.course.nameAm,
        batchCode: cert.batch.code,
        durationDays: cert.batch.course.durationDays,
        totalHours: cert.batch.course.totalHours || 40,
      },
    };
  }
}
