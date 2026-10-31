import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { toEthiopianDate } from '../../common/calendar/ethiopian-calendar';
import { formatETB, fromSantims } from '../../common/money/money';
import {
  LedgerKind,
  PaymentStatus,
  PayMethod,
  AttendStatus,
  EnrolmentStatus,
} from '@prisma/client';

const ETHIOPIAN_MONTHS = [
  { id: 1, name: 'Meskerem', nameAm: 'መስከረም' },
  { id: 2, name: 'Tikimt', nameAm: 'ጥቅምት' },
  { id: 3, name: 'Hidar', nameAm: 'ኅዳር' },
  { id: 4, name: 'Tahsas', nameAm: 'ታኅሣሥ' },
  { id: 5, name: 'Tir', nameAm: 'ጥር' },
  { id: 6, name: 'Yekatit', nameAm: 'የካቲት' },
  { id: 7, name: 'Megabit', nameAm: 'መጋቢት' },
  { id: 8, name: 'Miyazya', nameAm: 'ሚያዝያ' },
  { id: 9, name: 'Ginbot', nameAm: 'ግንቦት' },
  { id: 10, name: 'Sene', nameAm: 'ሰኔ' },
  { id: 11, name: 'Hamle', nameAm: 'ሐምሌ' },
  { id: 12, name: 'Nehase', nameAm: 'ነሐሴ' },
  { id: 13, name: 'Pagume', nameAm: 'ጳጉሜን' },
];

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Ethiopian Calendar Monthly Revenue & Reconciliation Report
   */
  async getRevenueReport(tenantId: string, year?: number) {
    const currentEc = toEthiopianDate(new Date());
    const ecYear = year || currentEc.year;

    // Fetch all posted payments for this tenant
    const payments = await this.prisma.payment.findMany({
      where: { tenantId, status: PaymentStatus.POSTED },
      orderBy: { paidOn: 'asc' },
    });

    // Fetch all charges from ledger
    const charges = await this.prisma.ledgerEntry.findMany({
      where: { tenantId, kind: LedgerKind.CHARGE },
      orderBy: { occurredOn: 'asc' },
    });

    // Initialize 13 Ethiopian months
    const monthlyStats = ETHIOPIAN_MONTHS.map((m) => ({
      monthNumber: m.id,
      name: m.name,
      nameAm: m.nameAm,
      collectedMinor: 0n,
      expectedMinor: 0n,
      receiptsCount: 0,
      methods: {
        CASH: 0n,
        TELEBIRR: 0n,
        CBE_BIRR: 0n,
        BANK_TRANSFER: 0n,
      },
    }));

    // Distribute payments across EC months
    let totalCollectedMinor = 0n;
    let totalCashMinor = 0n;
    let totalTelebirrMinor = 0n;
    let totalCbeBirrMinor = 0n;
    let totalBankTransferMinor = 0n;

    for (const p of payments) {
      const ec = toEthiopianDate(new Date(p.paidOn));
      if (ec.year === ecYear && ec.month >= 1 && ec.month <= 13) {
        const slot = monthlyStats[ec.month - 1];
        slot.collectedMinor += p.amountMinor;
        slot.receiptsCount++;
        totalCollectedMinor += p.amountMinor;

        if (p.method === PayMethod.CASH) {
          slot.methods.CASH += p.amountMinor;
          totalCashMinor += p.amountMinor;
        } else if (p.method === PayMethod.TELEBIRR) {
          slot.methods.TELEBIRR += p.amountMinor;
          totalTelebirrMinor += p.amountMinor;
        } else if (p.method === PayMethod.CBE_BIRR) {
          slot.methods.CBE_BIRR += p.amountMinor;
          totalCbeBirrMinor += p.amountMinor;
        } else if (p.method === PayMethod.BANK_TRANSFER) {
          slot.methods.BANK_TRANSFER += p.amountMinor;
          totalBankTransferMinor += p.amountMinor;
        }
      }
    }

    // Distribute expected charges across EC months
    let totalExpectedMinor = 0n;
    for (const c of charges) {
      const ec = toEthiopianDate(new Date(c.occurredOn));
      if (ec.year === ecYear && ec.month >= 1 && ec.month <= 13) {
        monthlyStats[ec.month - 1].expectedMinor += c.amountMinor;
        totalExpectedMinor += c.amountMinor;
      }
    }

    return {
      year: ecYear,
      ethiopianYearDisplay: `${ecYear} ዓ.ም`,
      summary: {
        totalCollectedMinor,
        totalCollectedFormatted: formatETB(totalCollectedMinor),
        totalExpectedMinor,
        totalExpectedFormatted: formatETB(totalExpectedMinor),
        collectionRatePct:
          totalExpectedMinor > 0n
            ? Math.round(Number((totalCollectedMinor * 100n) / totalExpectedMinor))
            : 100,
        methods: {
          CASH: { amountMinor: totalCashMinor, formatted: formatETB(totalCashMinor) },
          TELEBIRR: { amountMinor: totalTelebirrMinor, formatted: formatETB(totalTelebirrMinor) },
          CBE_BIRR: { amountMinor: totalCbeBirrMinor, formatted: formatETB(totalCbeBirrMinor) },
          BANK_TRANSFER: { amountMinor: totalBankTransferMinor, formatted: formatETB(totalBankTransferMinor) },
        },
      },
      months: monthlyStats.map((m) => ({
        monthNumber: m.monthNumber,
        name: m.name,
        nameAm: m.nameAm,
        collectedMinor: m.collectedMinor,
        collectedFormatted: formatETB(m.collectedMinor),
        expectedMinor: m.expectedMinor,
        expectedFormatted: formatETB(m.expectedMinor),
        receiptsCount: m.receiptsCount,
        collectionRatePct:
          m.expectedMinor > 0n
            ? Math.round(Number((m.collectedMinor * 100n) / m.expectedMinor))
            : 0,
        methods: {
          CASH: formatETB(m.methods.CASH),
          TELEBIRR: formatETB(m.methods.TELEBIRR),
          CBE_BIRR: formatETB(m.methods.CBE_BIRR),
          BANK_TRANSFER: formatETB(m.methods.BANK_TRANSFER),
        },
      })),
    };
  }

  /**
   * Aging Debtors Report
   * Categorizes outstanding student tuition into: Current, 1-15, 16-30, 31+ days overdue
   */
  async getAgingDebtorsReport(tenantId: string) {
    const students = await this.prisma.student.findMany({
      where: { tenantId, deletedAt: null },
      include: {
        enrolments: {
          where: { status: EnrolmentStatus.ENROLLED },
          include: {
            batch: { include: { course: true } },
            instalments: { orderBy: { dueDate: 'asc' } },
          },
        },
      },
    });

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    let totalOutstandingMinor = 0n;
    let bucketCurrentMinor = 0n;
    let bucket1to15Minor = 0n;
    let bucket16to30Minor = 0n;
    let bucket31PlusMinor = 0n;

    const debtorList: any[] = [];

    for (const student of students) {
      // Calculate true student balance from append-only ledger
      const ledgerSum = await this.prisma.ledgerEntry.aggregate({
        where: { tenantId, studentId: student.id },
        _sum: { amountMinor: true },
      });
      const studentBalanceMinor = ledgerSum._sum.amountMinor || 0n;

      if (studentBalanceMinor > 0n) {
        totalOutstandingMinor += studentBalanceMinor;

        // Determine earliest overdue date across pending instalments
        let maxDaysOverdue = 0;
        for (const enr of student.enrolments) {
          for (const inst of enr.instalments) {
            const due = new Date(inst.dueDate);
            due.setHours(0, 0, 0, 0);
            if (due < now && inst.paidMinor < inst.amountMinor) {
              const diffDays = Math.floor(
                (now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24),
              );
              if (diffDays > maxDaysOverdue) maxDaysOverdue = diffDays;
            }
          }
        }

        // Place into aging bucket
        let bucket = 'CURRENT';
        if (maxDaysOverdue > 30) {
          bucket = '31_PLUS';
          bucket31PlusMinor += studentBalanceMinor;
        } else if (maxDaysOverdue >= 16) {
          bucket = '16_TO_30';
          bucket16to30Minor += studentBalanceMinor;
        } else if (maxDaysOverdue >= 1) {
          bucket = '1_TO_15';
          bucket1to15Minor += studentBalanceMinor;
        } else {
          bucketCurrentMinor += studentBalanceMinor;
        }

        const primaryEnrolment = student.enrolments[0];

        debtorList.push({
          studentId: student.id,
          studentNo: student.studentNo,
          studentName: `${student.firstName} ${student.lastName}`,
          phone: student.phone || '—',
          courseName: primaryEnrolment?.batch?.course?.name || 'General Tuition',
          batchCode: primaryEnrolment?.batch?.code || '—',
          balanceMinor: studentBalanceMinor,
          balanceFormatted: formatETB(studentBalanceMinor),
          daysOverdue: maxDaysOverdue,
          agingBucket: bucket,
        });
      }
    }

    debtorList.sort((a, b) => b.daysOverdue - a.daysOverdue);

    return {
      summary: {
        totalDebtors: debtorList.length,
        totalOutstandingMinor,
        totalOutstandingFormatted: formatETB(totalOutstandingMinor),
        buckets: {
          current: { amountMinor: bucketCurrentMinor, formatted: formatETB(bucketCurrentMinor) },
          oneToFifteen: { amountMinor: bucket1to15Minor, formatted: formatETB(bucket1to15Minor) },
          sixteenToThirty: { amountMinor: bucket16to30Minor, formatted: formatETB(bucket16to30Minor) },
          thirtyOnePlus: { amountMinor: bucket31PlusMinor, formatted: formatETB(bucket31PlusMinor) },
        },
      },
      debtors: debtorList,
    };
  }

  /**
   * Enrolment & Capacity Report
   */
  async getEnrolmentReport(tenantId: string) {
    const courses = await this.prisma.course.findMany({
      where: { tenantId, active: true },
      include: {
        batches: {
          include: {
            enrolments: true,
          },
        },
      },
    });

    const report = courses.map((course) => {
      let totalCapacity = 0;
      let totalEnrolled = 0;
      let activeBatches = 0;

      const batchesData = course.batches.map((batch) => {
        const enrolled = batch.enrolments.filter(
          (e) => e.status === EnrolmentStatus.ENROLLED,
        ).length;
        totalCapacity += batch.capacity;
        totalEnrolled += enrolled;
        activeBatches++;

        return {
          id: batch.id,
          code: batch.code,
          capacity: batch.capacity,
          enrolled,
          fillRatePct:
            batch.capacity > 0 ? Math.round((enrolled / batch.capacity) * 100) : 0,
        };
      });

      return {
        courseId: course.id,
        courseName: course.name,
        courseNameAm: course.nameAm,
        defaultFeeFormatted: formatETB(course.defaultFeeMinor),
        activeBatches,
        totalCapacity,
        totalEnrolled,
        overallFillRatePct:
          totalCapacity > 0 ? Math.round((totalEnrolled / totalCapacity) * 100) : 0,
        batches: batchesData,
      };
    });

    return {
      totalCourses: courses.length,
      courses: report,
    };
  }

  /**
   * Attendance Compliance Report
   */
  async getAttendanceReport(tenantId: string, batchId?: string) {
    const batches = await this.prisma.batch.findMany({
      where: {
        tenantId,
        ...(batchId ? { id: batchId } : {}),
      },
      include: {
        course: true,
        sessions: {
          where: { date: { lte: new Date() } },
          include: { attendances: true },
        },
        enrolments: {
          where: { status: EnrolmentStatus.ENROLLED },
          include: { student: true },
        },
      },
    });

    const batchSummaries = batches.map((batch) => {
      const totalSessionsHeld = batch.sessions.length;
      let totalMarks = 0;
      let totalPresent = 0;

      for (const sess of batch.sessions) {
        for (const rec of sess.attendances) {
          totalMarks++;
          if (rec.status === AttendStatus.PRESENT || rec.status === AttendStatus.LATE) {
            totalPresent++;
          }
        }
      }

      const overallAttendancePct =
        totalMarks > 0 ? Math.round((totalPresent / totalMarks) * 100) : 100;

      // Identify students below course required attendance threshold
      const lowAttendanceStudents = batch.enrolments
        .map((enr) => {
          const studentMarks = batch.sessions.flatMap((s) =>
            s.attendances.filter((a) => a.studentId === enr.studentId),
          );
          const attended = studentMarks.filter(
            (m) => m.status === AttendStatus.PRESENT || m.status === AttendStatus.LATE,
          ).length;
          const rate =
            totalSessionsHeld > 0
              ? Math.round((attended / totalSessionsHeld) * 100)
              : 100;

          return {
            studentId: enr.student.id,
            studentNo: enr.student.studentNo,
            studentName: `${enr.student.firstName} ${enr.student.lastName}`,
            phone: enr.student.phone,
            attendanceRate: rate,
            isAtRisk: rate < batch.course.requiredAttendancePct,
          };
        })
        .filter((s) => s.isAtRisk);

      return {
        batchId: batch.id,
        batchCode: batch.code,
        courseName: batch.course.name,
        requiredThreshold: batch.course.requiredAttendancePct,
        sessionsHeld: totalSessionsHeld,
        overallAttendancePct,
        atRiskStudentsCount: lowAttendanceStudents.length,
        atRiskStudents: lowAttendanceStudents,
      };
    });

    return {
      batches: batchSummaries,
    };
  }

  /**
   * Trainer Workload Report
   */
  async getTrainerLoadReport(tenantId: string) {
    const trainers = await this.prisma.trainer.findMany({
      where: { tenantId },
      include: {
        batches: {
          include: {
            course: true,
            enrolments: { where: { status: EnrolmentStatus.ENROLLED } },
          },
        },
        sessions: {
          where: { date: { lte: new Date() } },
        },
      },
    });

    return trainers.map((t) => {
      const activeBatchesCount = t.batches.length;
      const totalStudentsTaught = t.batches.reduce(
        (sum, b) => sum + b.enrolments.length,
        0,
      );
      const totalSessionsDelivered = t.sessions.length;

      return {
        trainerId: t.id,
        name: t.name,
        nameAm: t.nameAm,
        phone: t.phone || '—',
        activeBatchesCount,
        totalStudentsTaught,
        totalSessionsDelivered,
      };
    });
  }

  /**
   * Export Report to CSV String
   */
  async exportReportCsv(tenantId: string, reportType: string): Promise<string> {
    if (reportType === 'revenue') {
      const data = await this.getRevenueReport(tenantId);
      const header = 'Month Number,Month Name,Month Amharic,Expected (ETB),Collected (ETB),Collection Rate %,Receipts,Cash,Telebirr,CBE Birr,Bank Transfer\n';
      const rows = data.months.map((m) =>
        [
          m.monthNumber,
          m.name,
          m.nameAm,
          fromSantims(m.expectedMinor).toFixed(2),
          fromSantims(m.collectedMinor).toFixed(2),
          `${m.collectionRatePct}%`,
          m.receiptsCount,
          m.methods.CASH,
          m.methods.TELEBIRR,
          m.methods.CBE_BIRR,
          m.methods.BANK_TRANSFER,
        ].join(','),
      );
      return header + rows.join('\n');
    }

    if (reportType === 'aging') {
      const data = await this.getAgingDebtorsReport(tenantId);
      const header = 'Student No,Student Name,Phone,Course,Batch,Outstanding Due (ETB),Days Overdue,Aging Category\n';
      const rows = data.debtors.map((d) =>
        [
          `"${d.studentNo}"`,
          `"${d.studentName}"`,
          `"${d.phone}"`,
          `"${d.courseName}"`,
          `"${d.batchCode}"`,
          fromSantims(d.balanceMinor).toFixed(2),
          d.daysOverdue,
          d.agingBucket,
        ].join(','),
      );
      return header + rows.join('\n');
    }

    throw new BadRequestException(`Unsupported export report type: ${reportType}`);
  }
}
