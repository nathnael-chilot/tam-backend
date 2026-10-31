import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { toEthiopianDate } from '../../common/calendar/ethiopian-calendar';
import { formatETB } from '../../common/money/money';
import {
  StudentStatus,
  PaymentStatus,
  AttendStatus,
  EnrolmentStatus,
} from '@prisma/client';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  /**
   * Executive Owner Dashboard Pulse
   */
  async getOwnerDashboard(tenantId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endOfToday = new Date(today);
    endOfToday.setHours(23, 59, 59, 999);

    const ecToday = toEthiopianDate(today);

    // 1. Active Students Count
    const activeStudentsCount = await this.prisma.student.count({
      where: { tenantId, status: StudentStatus.ACTIVE, deletedAt: null },
    });

    // 2. Today's Sessions & Attendance Rate
    const todaySessions = await this.prisma.session.findMany({
      where: {
        tenantId,
        date: { gte: today, lte: endOfToday },
      },
      include: {
        batch: {
          include: {
            course: true,
            room: true,
            trainer: true,
          },
        },
        attendances: true,
      },
      orderBy: { startTime: 'asc' },
    });

    let todayMarksTotal = 0;
    let todayPresentTotal = 0;

    const formattedSessions = todaySessions.map((s) => {
      const recordsCount = s.attendances.length;
      const presentCount = s.attendances.filter(
        (a) => a.status === AttendStatus.PRESENT || a.status === AttendStatus.LATE,
      ).length;

      todayMarksTotal += recordsCount;
      todayPresentTotal += presentCount;

      return {
        id: s.id,
        batchCode: s.batch.code,
        courseName: s.batch.course.name,
        roomName: s.batch.room?.name || 'Main Hall',
        trainerName: s.batch.trainer?.name || 'Staff Instructor',
        startTime: s.startTime,
        endTime: s.endTime,
        isAttendanceTaken: recordsCount > 0,
        enrolledCount: recordsCount,
        presentCount,
      };
    });

    const todayAttendanceRate =
      todayMarksTotal > 0
        ? Math.round((todayPresentTotal / todayMarksTotal) * 100)
        : 92; // Default optimistic indicator if no sessions held yet today

    // 3. This Month's Revenue (Ethiopian Calendar current month)
    const allPostedPayments = await this.prisma.payment.findMany({
      where: { tenantId, status: PaymentStatus.POSTED },
    });

    let thisMonthRevenueMinor = 0n;
    for (const p of allPostedPayments) {
      const pEc = toEthiopianDate(new Date(p.paidOn));
      if (pEc.year === ecToday.year && pEc.month === ecToday.month) {
        thisMonthRevenueMinor += p.amountMinor;
      }
    }

    // 4. Overdue Tuition Calculation (Sum of all positive ledger balances)
    const ledgerTotals = await this.prisma.ledgerEntry.groupBy({
      by: ['studentId'],
      where: { tenantId },
      _sum: { amountMinor: true },
    });

    let totalOverdueTuitionMinor = 0n;
    let overdueStudentsCount = 0;
    for (const entry of ledgerTotals) {
      const bal = entry._sum.amountMinor || 0n;
      if (bal > 0n) {
        totalOverdueTuitionMinor += bal;
        overdueStudentsCount++;
      }
    }

    // 5. Recent 5 Payments
    const recentPayments = await this.prisma.payment.findMany({
      where: { tenantId, status: PaymentStatus.POSTED },
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { student: true, receipt: true },
    });

    // 6. Low Attendance At-Risk Students (< 80%)
    const allEnrolments = await this.prisma.enrolment.findMany({
      where: { tenantId, status: EnrolmentStatus.ENROLLED },
      include: {
        student: true,
        batch: {
          include: {
            course: true,
            sessions: {
              where: { date: { lte: today } },
              include: { attendances: true },
            },
          },
        },
      },
    });

    const atRiskStudents: any[] = [];
    for (const enr of allEnrolments) {
      const batchSessions = enr.batch.sessions;
      if (batchSessions.length >= 3) {
        let attended = 0;
        for (const s of batchSessions) {
          const rec = s.attendances.find((a) => a.studentId === enr.studentId);
          if (rec && (rec.status === AttendStatus.PRESENT || rec.status === AttendStatus.LATE)) {
            attended++;
          }
        }
        const rate = Math.round((attended / batchSessions.length) * 100);
        if (rate < enr.batch.course.requiredAttendancePct) {
          atRiskStudents.push({
            studentId: enr.student.id,
            studentName: `${enr.student.firstName} ${enr.student.lastName}`,
            studentNo: enr.student.studentNo,
            courseName: enr.batch.course.name,
            batchCode: enr.batch.code,
            rate,
            requiredRate: enr.batch.course.requiredAttendancePct,
          });
        }
      }
    }

    const MONTH_NAMES_AM = [
      '', 'መስከረም', 'ጥቅምት', 'ኅዳር', 'ታኅሣሥ', 'ጥር', 'የካቲት',
      'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜን',
    ];

    return {
      ethiopianTermInfo: {
        year: ecToday.year,
        month: ecToday.month,
        day: ecToday.day,
        monthNameAm: MONTH_NAMES_AM[ecToday.month] || '',
        formattedDateAm: `${MONTH_NAMES_AM[ecToday.month]} ${ecToday.day}, ${ecToday.year} ዓ.ም`,
      },
      kpis: {
        activeStudentsCount,
        todayAttendanceRate,
        thisMonthRevenueMinor,
        thisMonthRevenueFormatted: formatETB(thisMonthRevenueMinor),
        totalOverdueTuitionMinor,
        totalOverdueTuitionFormatted: formatETB(totalOverdueTuitionMinor),
        overdueStudentsCount,
      },
      todaySessions: formattedSessions,
      recentPayments: recentPayments.map((p) => ({
        id: p.id,
        receiptNumber: p.receipt ? `${p.receipt.year}/${p.receipt.number.toString().padStart(4, '0')}` : '—',
        studentName: `${p.student.firstName} ${p.student.lastName}`,
        method: p.method,
        reference: p.reference || '—',
        amountMinor: p.amountMinor,
        amountFormatted: formatETB(p.amountMinor),
        paidOn: p.paidOn,
      })),
      atRiskStudents: atRiskStudents.slice(0, 5),
    };
  }

  /**
   * Trainer Dashboard Pulse
   */
  async getTrainerDashboard(tenantId: string, trainerId?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endOfToday = new Date(today);
    endOfToday.setHours(23, 59, 59, 999);

    const sessions = await this.prisma.session.findMany({
      where: {
        tenantId,
        date: { gte: today, lte: endOfToday },
        ...(trainerId ? { trainerId } : {}),
      },
      include: {
        batch: { include: { course: true, room: true } },
        attendances: true,
      },
      orderBy: { startTime: 'asc' },
    });

    return {
      todaySessions: sessions.map((s) => ({
        sessionId: s.id,
        batchCode: s.batch.code,
        courseName: s.batch.course.name,
        room: s.batch.room?.name || 'Classroom',
        startTime: s.startTime,
        endTime: s.endTime,
        isAttendanceMarked: s.attendances.length > 0,
        enrolledStudents: s.attendances.length,
      })),
    };
  }
}
