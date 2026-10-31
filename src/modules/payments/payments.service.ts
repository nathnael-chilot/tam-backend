import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { VoidPaymentDto } from './dto/void-payment.dto';
import { QueryPaymentsDto } from './dto/query-payments.dto';
import { toEthiopianDate } from '../../common/calendar/ethiopian-calendar';
import {
  toSantims,
  fromSantims,
  formatETB,
  amountInWordsEnglish,
  amountInWordsAmharic,
} from '../../common/money/money';
import {
  PaymentStatus,
  LedgerKind,
  InstalmentStatus,
  PayMethod,
  Prisma,
} from '@prisma/client';

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Record a student fee payment with gapless receipt numbering and append-only ledger entry
   */
  async recordPayment(tenantId: string, receivedById: string, dto: RecordPaymentDto) {
    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, tenantId, deletedAt: null },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    const amountMinor = toSantims(dto.amount);
    if (amountMinor <= 0n) {
      throw new BadRequestException('Payment amount must be greater than zero.');
    }

    // Check duplicate reference within same payment method
    if (dto.reference?.trim()) {
      const existingRef = await this.prisma.payment.findFirst({
        where: {
          tenantId,
          method: dto.method,
          reference: dto.reference.trim(),
          status: PaymentStatus.POSTED,
        },
      });

      if (existingRef) {
        throw new ConflictException(
          `Transaction reference "${dto.reference}" has already been recorded for ${dto.method}.`,
        );
      }
    }

    const paidDate = dto.paidOn ? new Date(dto.paidOn) : new Date();
    const ecYear = toEthiopianDate(paidDate).year;

    // Atomic execution with row-level lock on ReceiptCounter
    return this.prisma.$transaction(async (tx) => {
      // 1. Allocate gapless receipt number using SELECT ... FOR UPDATE
      const counterRow = await tx.$queryRaw<Array<{ next: number }>>`
        SELECT "next" FROM "ReceiptCounter"
        WHERE "tenantId" = ${tenantId} AND "year" = ${ecYear}
        FOR UPDATE
      `;

      let receiptNumber = 1;
      if (counterRow.length > 0) {
        receiptNumber = counterRow[0].next;
        await tx.$executeRaw`
          UPDATE "ReceiptCounter"
          SET "next" = "next" + 1
          WHERE "tenantId" = ${tenantId} AND "year" = ${ecYear}
        `;
      } else {
        await tx.$executeRaw`
          INSERT INTO "ReceiptCounter" ("tenantId", "year", "next")
          VALUES (${tenantId}, ${ecYear}, 2)
        `;
      }

      // 2. Create Payment record
      const payment = await tx.payment.create({
        data: {
          tenantId,
          studentId: dto.studentId,
          amountMinor,
          method: dto.method,
          reference: dto.reference?.trim() || null,
          paidOn: paidDate,
          receivedById,
          status: PaymentStatus.POSTED,
        },
      });

      // 3. Create Receipt voucher
      const receipt = await tx.receipt.create({
        data: {
          tenantId,
          paymentId: payment.id,
          number: receiptNumber,
          year: ecYear,
          printedAt: new Date(),
        },
      });

      // 4. Post negative LedgerEntry (-amountMinor reduces student balance due)
      await tx.ledgerEntry.create({
        data: {
          tenantId,
          studentId: dto.studentId,
          enrolmentId: dto.enrolmentId || null,
          kind: LedgerKind.PAYMENT,
          amountMinor: -amountMinor,
          refType: 'PAYMENT',
          refId: payment.id,
          occurredOn: paidDate,
        },
      });

      // 5. Allocate payment against oldest unpaid/partial instalments
      const pendingInstalments = await tx.instalment.findMany({
        where: {
          tenantId,
          enrolment: {
            studentId: dto.studentId,
            ...(dto.enrolmentId ? { id: dto.enrolmentId } : {}),
          },
          status: { in: [InstalmentStatus.PENDING, InstalmentStatus.PARTIAL, InstalmentStatus.OVERDUE] },
        },
        orderBy: [{ dueDate: 'asc' }, { seq: 'asc' }],
      });

      let unallocated = amountMinor;
      const createdAllocations: any[] = [];

      for (const inst of pendingInstalments) {
        if (unallocated <= 0n) break;

        const remainingOnInstalment = inst.amountMinor - inst.paidMinor;
        const allocationAmount = unallocated >= remainingOnInstalment ? remainingOnInstalment : unallocated;

        const alloc = await tx.paymentAllocation.create({
          data: {
            tenantId,
            paymentId: payment.id,
            instalmentId: inst.id,
            amountMinor: allocationAmount,
          },
        });
        createdAllocations.push(alloc);

        const newPaidMinor = inst.paidMinor + allocationAmount;
        const newStatus = newPaidMinor >= inst.amountMinor ? InstalmentStatus.PAID : InstalmentStatus.PARTIAL;

        await tx.instalment.update({
          where: { id: inst.id },
          data: {
            paidMinor: newPaidMinor,
            status: newStatus,
          },
        });

        unallocated -= allocationAmount;
      }

      // 6. Compute student's new total remaining balance across all ledger entries
      const ledgerSum = await tx.ledgerEntry.aggregate({
        where: { tenantId, studentId: dto.studentId },
        _sum: { amountMinor: true },
      });
      const newBalanceMinor = ledgerSum._sum.amountMinor || 0n;

      const formattedNumber = `${ecYear}/${receiptNumber.toString().padStart(4, '0')}`;
      const wordsEn = amountInWordsEnglish(amountMinor);
      const wordsAm = amountInWordsAmharic(amountMinor);

      return {
        payment: {
          ...payment,
          amountEtb: fromSantims(payment.amountMinor),
        },
        receipt: {
          ...receipt,
          receiptNumber: formattedNumber,
          formattedNumber,
          number: receipt.number,
        },
        allocations: createdAllocations,
        allocationsCount: createdAllocations.length,
        excessCreditMinor: unallocated,
        amountInWords: {
          english: wordsEn,
          amharic: wordsAm,
          en: wordsEn,
          am: wordsAm,
        },
        newBalanceMinor,
        newBalanceEtb: fromSantims(newBalanceMinor),
      };
    });
  }

  /**
   * Void a payment with mandatory audit reason and compensating ledger entry
   */
  async voidPayment(tenantId: string, paymentId: string, voidedById: string, dto: VoidPaymentDto) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId },
      include: {
        allocations: { include: { instalment: true } },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.status === PaymentStatus.VOIDED) {
      throw new BadRequestException('This payment has already been voided.');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Mark payment as VOIDED
      const updatedPayment = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.VOIDED,
          voidReason: dto.voidReason.trim(),
        },
      });

      // 2. Post positive compensating LedgerEntry (+amountMinor restores debt)
      await tx.ledgerEntry.create({
        data: {
          tenantId,
          studentId: payment.studentId,
          kind: LedgerKind.VOID,
          amountMinor: payment.amountMinor,
          refType: 'VOID',
          refId: payment.id,
          occurredOn: new Date(),
        },
      });

      // 3. Re-open affected instalments
      for (const alloc of payment.allocations) {
        const inst = alloc.instalment;
        const newPaidMinor = inst.paidMinor > alloc.amountMinor ? inst.paidMinor - alloc.amountMinor : 0n;
        const newStatus = newPaidMinor === 0n ? InstalmentStatus.PENDING : InstalmentStatus.PARTIAL;

        await tx.instalment.update({
          where: { id: inst.id },
          data: {
            paidMinor: newPaidMinor,
            status: newStatus,
          },
        });
      }

      return {
        success: true,
        paymentId,
        status: PaymentStatus.VOIDED,
        voidReason: dto.voidReason.trim(),
      };
    });
  }

  /**
   * List all payments with search, filters, and cashier details
   */
  async findAll(tenantId: string, query: QueryPaymentsDto) {
    const page = Math.max(1, parseInt(query.page || '1', 10));
    const limit = Math.max(1, Math.min(100, parseInt(query.limit || '20', 10)));
    const skip = (page - 1) * limit;

    const where: Prisma.PaymentWhereInput = {
      tenantId,
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.method ? { method: query.method } : {}),
      ...(query.fromDate ? { paidOn: { gte: new Date(query.fromDate) } } : {}),
      ...(query.toDate ? { paidOn: { lte: new Date(query.toDate) } } : {}),
      ...(query.search
        ? {
            OR: [
              { reference: { contains: query.search, mode: 'insensitive' } },
              {
                student: {
                  OR: [
                    { firstName: { contains: query.search, mode: 'insensitive' } },
                    { lastName: { contains: query.search, mode: 'insensitive' } },
                    { phone: { contains: query.search, mode: 'insensitive' } },
                    { studentNo: { contains: query.search, mode: 'insensitive' } },
                  ],
                },
              },
            ],
          }
        : {}),
    };

    const [total, items, revenueAgg] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          student: {
            select: {
              id: true,
              studentNo: true,
              firstName: true,
              lastName: true,
              firstNameAm: true,
              lastNameAm: true,
              phone: true,
            },
          },
          receipt: true,
        },
      }),
      this.prisma.payment.aggregate({
        where: { tenantId, status: PaymentStatus.POSTED },
        _sum: { amountMinor: true },
      }),
    ]);

    const formattedItems = items.map((p) => {
      const ec = toEthiopianDate(new Date(p.paidOn));
      return {
        id: p.id,
        receiptNumber: p.receipt
          ? `${p.receipt.year}/${p.receipt.number.toString().padStart(4, '0')}`
          : '—',
        amountMinor: p.amountMinor,
        amountFormatted: formatETB(p.amountMinor),
        method: p.method,
        reference: p.reference,
        status: p.status,
        voidReason: p.voidReason,
        paidOn: p.paidOn,
        ethiopianDate: ec,
        student: p.student,
        createdAt: p.createdAt,
      };
    });

    return {
      items: formattedItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      totalRevenueMinor: revenueAgg._sum.amountMinor || 0n,
      totalRevenueFormatted: formatETB(revenueAgg._sum.amountMinor || 0n),
    };
  }

  /**
   * Get full receipt voucher details for A5 / 80mm thermal printing
   */
  async getReceiptById(tenantId: string, id: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, tenantId },
      include: {
        student: {
          include: {
            enrolments: {
              include: { batch: { include: { course: true } } },
              take: 1,
            },
          },
        },
        receipt: true,
        tenant: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment record not found');
    }

    // Compute remaining student balance
    const ledgerSum = await this.prisma.ledgerEntry.aggregate({
      where: { tenantId, studentId: payment.studentId },
      _sum: { amountMinor: true },
    });
    const remainingBalanceMinor = ledgerSum._sum.amountMinor || 0n;

    const ecDate = toEthiopianDate(new Date(payment.paidOn));
    const receiptNum = payment.receipt?.number || 1;
    const year = payment.receipt?.year || ecDate.year;
    const formattedReceiptNo = `${year}/${receiptNum.toString().padStart(4, '0')}`;

    const courseName = payment.student.enrolments[0]?.batch?.course?.name || 'General Tuition';

    // Increment reprint count if already printed
    if (payment.receipt) {
      await this.prisma.receipt.update({
        where: { id: payment.receipt.id },
        data: { reprintCount: { increment: 1 } },
      });
    }

    const isCopy = (payment.receipt?.reprintCount || 0) > 0;

    return {
      voucher: {
        receiptNumber: formattedReceiptNo,
        isCopy,
        paymentId: payment.id,
        status: payment.status,
        paidDate: payment.paidOn,
        ethiopianDateString: `መስከረም ${ecDate.day}, ${ecDate.year} ዓ.ም`,
        academy: {
          name: payment.tenant.name,
          nameAm: payment.tenant.nameAm,
          tin: payment.tenant.tin || '0012345678',
          phone: payment.tenant.phone || '+251 11 618 0000',
          city: payment.tenant.city || 'Addis Ababa, Ethiopia',
        },
        student: {
          id: payment.student.id,
          studentNo: payment.student.studentNo,
          name: `${payment.student.firstName} ${payment.student.lastName}`,
          nameAm: payment.student.firstNameAm ? `${payment.student.firstNameAm} ${payment.student.lastNameAm}` : null,
          phone: payment.student.phone,
          courseName,
        },
        payment: {
          amountMinor: payment.amountMinor,
          amountFormatted: formatETB(payment.amountMinor),
          amountInWordsEn: amountInWordsEnglish(payment.amountMinor),
          amountInWordsAm: amountInWordsAmharic(payment.amountMinor),
          method: payment.method,
          reference: payment.reference,
          remainingBalanceFormatted: formatETB(remainingBalanceMinor),
        },
        verificationUrl: `https://tsehafi.et/verify/receipt/${payment.id}`,
      },
      receipt: {
        receiptNumber: formattedReceiptNo,
        number: receiptNum,
        year,
        isReprint: isCopy,
        reprintCount: (payment.receipt?.reprintCount || 0) + 1,
      },
      student: {
        id: payment.student.id,
        studentNo: payment.student.studentNo,
        fullName: `${payment.student.firstName} ${payment.student.lastName}`,
        name: `${payment.student.firstName} ${payment.student.lastName}`,
        phone: payment.student.phone,
      },
      payment: {
        id: payment.id,
        amountMinor: payment.amountMinor,
        amountEtb: fromSantims(payment.amountMinor),
        method: payment.method,
        reference: payment.reference,
        status: payment.status,
      },
      remainingBalanceMinor,
      remainingBalanceEtb: fromSantims(remainingBalanceMinor),
    };
  }

  /**
   * Cashier Closing / End-of-Day Cash-Up Report
   */
  async getCashUpReport(tenantId: string, dateStr?: string, cashierId?: string) {
    const targetDate = dateStr ? new Date(dateStr) : new Date();
    targetDate.setHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const payments = await this.prisma.payment.findMany({
      where: {
        tenantId,
        paidOn: { gte: targetDate, lte: endOfDay },
        ...(cashierId ? { receivedById: cashierId } : {}),
      },
      include: { receipt: true, student: true },
      orderBy: { createdAt: 'asc' },
    });

    let cashMinor = 0n;
    let telebirrMinor = 0n;
    let cbeBirrMinor = 0n;
    let bankTransferMinor = 0n;
    let voidedCount = 0;
    let postedCount = 0;

    for (const p of payments) {
      if (p.status === PaymentStatus.VOIDED) {
        voidedCount++;
        continue;
      }

      postedCount++;
      if (p.method === PayMethod.CASH) cashMinor += p.amountMinor;
      else if (p.method === PayMethod.TELEBIRR) telebirrMinor += p.amountMinor;
      else if (p.method === PayMethod.CBE_BIRR) cbeBirrMinor += p.amountMinor;
      else if (p.method === PayMethod.BANK_TRANSFER) bankTransferMinor += p.amountMinor;
    }

    const netTotalMinor = cashMinor + telebirrMinor + cbeBirrMinor + bankTransferMinor;

    return {
      date: targetDate,
      ethiopianDate: toEthiopianDate(targetDate),
      methods: {
        CASH: { postedMinor: Number(cashMinor), formatted: formatETB(cashMinor) },
        TELEBIRR: { postedMinor: Number(telebirrMinor), formatted: formatETB(telebirrMinor) },
        CBE_BIRR: { postedMinor: Number(cbeBirrMinor), formatted: formatETB(cbeBirrMinor) },
        BANK_TRANSFER: { postedMinor: Number(bankTransferMinor), formatted: formatETB(bankTransferMinor) },
      },
      totals: {
        postedCount,
        voidedCount,
        totalReceipts: payments.length,
        netIntakeMinor: Number(netTotalMinor),
        netIntakeFormatted: formatETB(netTotalMinor),
      },
      summary: {
        postedCount,
        voidedCount,
        totalReceipts: payments.length,
        cashTotalFormatted: formatETB(cashMinor),
        telebirrTotalFormatted: formatETB(telebirrMinor),
        cbeBirrTotalFormatted: formatETB(cbeBirrMinor),
        bankTransferTotalFormatted: formatETB(bankTransferMinor),
        netTotalFormatted: formatETB(netTotalMinor),
        netTotalMinor,
      },
      transactions: payments.map((p) => ({
        id: p.id,
        receiptNo: p.receipt ? `${p.receipt.year}/${p.receipt.number.toString().padStart(4, '0')}` : '—',
        studentName: `${p.student.firstName} ${p.student.lastName}`,
        method: p.method,
        reference: p.reference,
        amountFormatted: formatETB(p.amountMinor),
        status: p.status,
      })),
    };
  }

  /**
   * Student Statement and transaction ledger
   */
  async getStudentStatement(tenantId: string, studentId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, tenantId },
      include: {
        enrolments: {
          include: {
            instalments: { orderBy: { seq: 'asc' } },
            batch: { include: { course: true } },
          },
        },
      },
    });

    if (!student) throw new NotFoundException('Student not found');

    const entries = await this.prisma.ledgerEntry.findMany({
      where: { tenantId, studentId },
      orderBy: { occurredOn: 'asc' },
    });

    let runningBalance = 0n;
    let totalChargesMinor = 0n;
    let totalDiscountsMinor = 0n;
    let totalPaidMinor = 0n;

    const history = entries.map((e) => {
      runningBalance += e.amountMinor;
      if (e.kind === LedgerKind.CHARGE) totalChargesMinor += e.amountMinor;
      else if (e.kind === LedgerKind.DISCOUNT) totalDiscountsMinor += (-e.amountMinor);
      else if (e.kind === LedgerKind.PAYMENT) totalPaidMinor += (-e.amountMinor);
      else if (e.kind === LedgerKind.VOID) totalPaidMinor -= e.amountMinor;

      return {
        id: e.id,
        date: e.occurredOn,
        ethiopianDate: toEthiopianDate(new Date(e.occurredOn)),
        kind: e.kind,
        refType: e.refType,
        amountMinor: e.amountMinor,
        amountFormatted: formatETB(e.amountMinor),
        runningBalanceMinor: runningBalance,
        runningBalanceFormatted: formatETB(runningBalance),
      };
    });

    const allInstalments = student.enrolments.flatMap((enr) => enr.instalments);

    return {
      student: {
        id: student.id,
        studentNo: student.studentNo,
        name: `${student.firstName} ${student.lastName}`,
        firstNameAm: student.firstNameAm,
        lastNameAm: student.lastNameAm,
        phone: student.phone,
      },
      summary: {
        totalChargesMinor,
        totalChargesEtb: fromSantims(totalChargesMinor),
        totalDiscountsMinor,
        totalDiscountsEtb: fromSantims(totalDiscountsMinor),
        totalPaidMinor,
        totalPaidEtb: fromSantims(totalPaidMinor),
        balanceMinor: runningBalance,
        balanceEtb: fromSantims(runningBalance),
      },
      instalments: allInstalments.map((inst) => ({
        id: inst.id,
        seq: inst.seq,
        dueDate: inst.dueDate,
        amountMinor: inst.amountMinor,
        amountEtb: fromSantims(inst.amountMinor),
        paidMinor: inst.paidMinor,
        paidEtb: fromSantims(inst.paidMinor),
        status: inst.status,
      })),
      ledgerEntries: entries,
      currentBalanceMinor: runningBalance,
      currentBalanceFormatted: formatETB(runningBalance),
      statement: history,
    };
  }
}
