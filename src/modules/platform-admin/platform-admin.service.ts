import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import {
  TenantStatus,
  SubscriptionTier,
  SubscriptionStatus,
  PlatformPaymentStatus,
  AdminActionType,
} from '@prisma/client';
import {
  PLAN_CONFIGS,
  getCadenceMonths,
} from '../subscription/subscription.constants';
import { toEthiopianDate, ETHIOPIAN_MONTHS } from '../../common/calendar/ethiopian-calendar';

@Injectable()
export class PlatformAdminService {
  private readonly logger = new Logger(PlatformAdminService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  private formatEthiopianDateString(date: Date): { en: string; am: string } {
    const ec = toEthiopianDate(date);
    const m = ETHIOPIAN_MONTHS[ec.month - 1] || ETHIOPIAN_MONTHS[0];
    return {
      en: `${m.nameEn} ${ec.day}, ${ec.year} E.C.`,
      am: `${ec.day} ${m.nameAm} ${ec.year} ዓ.ም`,
    };
  }

  /**
   * Get all registered academies with subscription summary matching Stitch platform_admin_academies
   */
  async getAcademies(search?: string, statusFilter?: string) {
    const where: any = {};

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { nameAm: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (statusFilter && statusFilter !== 'ALL') {
      where.status = statusFilter;
    }

    const academies = await this.prisma.tenant.findMany({
      where,
      include: {
        subscription: true,
        _count: {
          select: {
            students: { where: { status: 'ACTIVE', deletedAt: null } },
            memberships: { where: { status: 'ACTIVE' } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return academies.map((acad) => {
      const planTier = acad.subscription?.tier || SubscriptionTier.STARTER;
      const plan = PLAN_CONFIGS[planTier];
      const ecCreated = this.formatEthiopianDateString(acad.createdAt);

      return {
        id: acad.id,
        name: acad.name,
        nameAm: acad.nameAm,
        city: acad.city,
        phone: acad.phone,
        status: acad.status,
        plan: plan.name,
        planTier,
        studentsCount: acad._count.students,
        staffCount: acad._count.memberships,
        monthlySubscriptionEtb: (Number(plan.monthlyPriceSantims) / 100).toFixed(2),
        createdAt: acad.createdAt,
        createdAtEc: ecCreated,
      };
    });
  }

  /**
   * Get 360 academy detail view matching Stitch platform_admin_academy_detail
   */
  async getAcademyDetail(tenantId: string) {
    const academy = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        subscription: true,
        memberships: {
          where: { role: 'OWNER' },
          include: { user: true },
          take: 1,
        },
        _count: {
          select: {
            students: { where: { status: 'ACTIVE', deletedAt: null } },
            memberships: { where: { status: 'ACTIVE' } },
          },
        },
      },
    });

    if (!academy) {
      throw new NotFoundException(`Academy tenant ${tenantId} not found`);
    }

    const owner = academy.memberships[0]?.user;
    const planTier = academy.subscription?.tier || SubscriptionTier.STARTER;
    const plan = PLAN_CONFIGS[planTier];

    // Find last activity (e.g. latest student, attendance, payment or log)
    const latestPayment = await this.prisma.payment.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const latestStudent = await this.prisma.student.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    const dates = [academy.updatedAt, latestPayment?.createdAt, latestStudent?.createdAt].filter(
      Boolean,
    ) as Date[];
    const lastActive = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : academy.updatedAt;

    // Recent invoices
    const invoices = await this.prisma.subscriptionInvoice.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const ecJoined = this.formatEthiopianDateString(academy.createdAt);
    const gcJoinedMonth = academy.createdAt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

    return {
      academy: {
        id: academy.id,
        name: academy.name,
        nameAm: academy.nameAm,
        city: academy.city,
        phone: academy.phone,
        status: academy.status,
        ownerName: owner?.name || 'Administrator',
        ownerEmail: owner?.email,
        ownerPhone: owner?.phone,
        joinedEc: `${ETHIOPIAN_MONTHS[toEthiopianDate(academy.createdAt).month - 1]?.nameEn} ${toEthiopianDate(academy.createdAt).year} E.C. (${gcJoinedMonth})`,
      },
      stats: {
        activeStudents: academy._count.students,
        monthlySubscriptionEtb: `${(Number(plan.monthlyPriceSantims) / 100).toFixed(2)} Br`,
        planTier,
        planName: plan.name,
        lastActiveDate: lastActive,
        lastActiveText: 'Today, 10:45 AM',
      },
      invoices: invoices.map((inv) => ({
        id: inv.id,
        dateEc: this.formatEthiopianDateString(inv.createdAt),
        dateGc: inv.createdAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        planName: `${PLAN_CONFIGS[inv.tier]?.name || inv.tier} Plan`,
        amountEtb: `${(Number(inv.amountSantims) / 100).toFixed(2)} Br`,
        status: inv.status,
        paymentMethod: inv.paymentMethod,
        referenceNumber: inv.referenceNumber,
      })),
    };
  }

  /**
   * Suspend or Activate an academy tenant with audit log
   */
  async updateAcademyStatus(
    tenantId: string,
    status: TenantStatus,
    reason: string | undefined,
    adminUserId: string,
    ipAddress?: string,
  ) {
    const academy = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!academy) {
      throw new NotFoundException(`Academy ${tenantId} not found`);
    }

    const action = status === TenantStatus.SUSPENDED ? AdminActionType.SUSPEND_TENANT : AdminActionType.ACTIVATE_TENANT;

    const [updatedTenant] = await this.prisma.$transaction([
      this.prisma.tenant.update({
        where: { id: tenantId },
        data: { status },
      }),
      this.prisma.adminAuditLog.create({
        data: {
          adminUserId,
          action,
          targetTenantId: tenantId,
          reason: reason || `Status changed from ${academy.status} to ${status}`,
          ipAddress,
        },
      }),
    ]);

    return {
      id: updatedTenant.id,
      name: updatedTenant.name,
      status: updatedTenant.status,
      message: `Academy status successfully updated to ${status}.`,
    };
  }

  /**
   * Override academy subscription plan from platform admin console with audit log
   */
  async changeAcademyPlan(
    tenantId: string,
    tier: SubscriptionTier,
    reason: string | undefined,
    adminUserId: string,
    ipAddress?: string,
  ) {
    let subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });

    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const plan = PLAN_CONFIGS[tier];

    if (!subscription) {
      subscription = await this.prisma.subscription.create({
        data: {
          tenantId,
          tier,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
      });
    } else {
      subscription = await this.prisma.subscription.update({
        where: { tenantId },
        data: {
          tier,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: periodEnd,
        },
      });
    }

    // Adjust SMS credits quota
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        smsCredits: { increment: plan.monthlySmsQuota },
      },
    });

    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId,
        action: AdminActionType.CHANGE_PLAN,
        targetTenantId: tenantId,
        reason: reason || `Subscription tier set to ${tier}`,
        ipAddress,
      },
    });

    return {
      tenantId,
      tier: subscription.tier,
      planName: plan.name,
      message: `Academy subscription plan changed to ${plan.name}.`,
    };
  }

  /**
   * Generate scoped impersonation token for platform admin with mandatory audit reason
   */
  async impersonateTenant(
    tenantId: string,
    reason: string,
    adminUser: { id: string; email?: string; phone?: string; name: string },
    ipAddress?: string,
  ) {
    const academy = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!academy) {
      throw new NotFoundException(`Academy ${tenantId} not found`);
    }

    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId: adminUser.id,
        action: AdminActionType.IMPERSONATE_TENANT,
        targetTenantId: tenantId,
        reason,
        ipAddress,
      },
    });

    const impersonationPayload = {
      sub: adminUser.id,
      email: adminUser.email,
      phone: adminUser.phone,
      activeTenantId: tenantId,
      role: 'OWNER',
      isPlatformAdmin: true,
      isImpersonating: true,
      impersonatedBy: adminUser.id,
      impersonatedTenantName: academy.name,
    };

    const token = this.jwtService.sign(impersonationPayload, {
      expiresIn: '2h',
    });

    return {
      accessToken: token,
      activeTenantId: tenantId,
      tenantName: academy.name,
      tenantNameAm: academy.nameAm,
      message: `Impersonation session established for ${academy.name}.`,
    };
  }

  /**
   * Get pending subscription payments awaiting manual slip review matching Stitch platform_admin_payments_to_approve
   */
  async getPendingPayments() {
    const pendingInvoices = await this.prisma.subscriptionInvoice.findMany({
      where: {
        status: PlatformPaymentStatus.PENDING,
      },
      include: {
        tenant: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return pendingInvoices.map((inv) => {
      const plan = PLAN_CONFIGS[inv.tier] || PLAN_CONFIGS.STARTER;
      const ecDate = this.formatEthiopianDateString(inv.createdAt);

      return {
        id: inv.id,
        tenantId: inv.tenantId,
        institutionName: inv.tenant.name,
        planTitle: `${plan.name} Plan · ${ecDate.en}`,
        slipUrl: inv.slipUrl || null,
        slipFileName: inv.slipFileName || null,
        referenceNumber: inv.referenceNumber || 'N/A',
        settlementEtb: `${(Number(inv.amountSantims) / 100).toFixed(2)} Br`,
        amountSantims: inv.amountSantims.toString(),
        paymentMethod: inv.paymentMethod,
        createdAt: inv.createdAt,
      };
    });
  }

  /**
   * Approve manual payment slip
   */
  async approvePayment(invoiceId: string, adminUserId: string, ipAddress?: string) {
    const invoice = await this.prisma.subscriptionInvoice.findUnique({
      where: { id: invoiceId },
      include: { subscription: true, tenant: true },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }

    if (invoice.status === PlatformPaymentStatus.APPROVED) {
      return { message: 'Payment already approved' };
    }

    const now = new Date();
    const months = getCadenceMonths(invoice.cadence);
    const currentEnd = invoice.subscription.currentPeriodEnd > now ? invoice.subscription.currentPeriodEnd : now;
    const newPeriodEnd = new Date(currentEnd.getTime() + months * 30 * 24 * 60 * 60 * 1000);
    const newGraceEnd = new Date(newPeriodEnd.getTime() + 3 * 24 * 60 * 60 * 1000);
    const plan = PLAN_CONFIGS[invoice.tier] || PLAN_CONFIGS.STARTER;

    await this.prisma.$transaction([
      this.prisma.subscriptionInvoice.update({
        where: { id: invoiceId },
        data: {
          status: PlatformPaymentStatus.APPROVED,
          paidAt: now,
          reviewedByUserId: adminUserId,
          reviewedAt: now,
        },
      }),
      this.prisma.subscription.update({
        where: { id: invoice.subscriptionId },
        data: {
          tier: invoice.tier,
          cadence: invoice.cadence,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: now,
          currentPeriodEnd: newPeriodEnd,
          gracePeriodEndsAt: newGraceEnd,
        },
      }),
      this.prisma.tenant.update({
        where: { id: invoice.tenantId },
        data: {
          status: TenantStatus.ACTIVE,
          smsCredits: { increment: plan.monthlySmsQuota },
        },
      }),
      this.prisma.adminAuditLog.create({
        data: {
          adminUserId,
          action: AdminActionType.APPROVE_PAYMENT,
          targetTenantId: invoice.tenantId,
          reason: `Approved subscription payment slip for ${invoice.invoiceNo} (${(Number(invoice.amountSantims) / 100).toFixed(2)} ETB)`,
          ipAddress,
        },
      }),
    ]);

    return {
      id: invoice.id,
      invoiceNo: invoice.invoiceNo,
      status: 'APPROVED',
      message: 'Payment approved. Subscription updated and SMS quota credited.',
    };
  }

  /**
   * Reject manual payment slip with reason
   */
  async rejectPayment(invoiceId: string, reason: string, adminUserId: string, ipAddress?: string) {
    const invoice = await this.prisma.subscriptionInvoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }

    await this.prisma.$transaction([
      this.prisma.subscriptionInvoice.update({
        where: { id: invoiceId },
        data: {
          status: PlatformPaymentStatus.REJECTED,
          rejectionReason: reason,
          reviewedByUserId: adminUserId,
          reviewedAt: new Date(),
        },
      }),
      this.prisma.adminAuditLog.create({
        data: {
          adminUserId,
          action: AdminActionType.REJECT_PAYMENT,
          targetTenantId: invoice.tenantId,
          reason: `Rejected payment slip for ${invoice.invoiceNo}: ${reason}`,
          ipAddress,
        },
      }),
    ]);

    return {
      id: invoice.id,
      invoiceNo: invoice.invoiceNo,
      status: 'REJECTED',
      rejectionReason: reason,
      message: 'Payment rejected.',
    };
  }

  /**
   * Get platform admin audit log trail
   */
  async getAuditLogs(limit = 50) {
    const logs = await this.prisma.adminAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        adminUser: { select: { id: true, name: true, email: true } },
        targetTenant: { select: { id: true, name: true } },
      },
    });

    return logs.map((log) => ({
      id: log.id,
      action: log.action,
      adminUserName: log.adminUser.name,
      adminUserEmail: log.adminUser.email,
      targetTenantName: log.targetTenant?.name || null,
      reason: log.reason,
      ipAddress: log.ipAddress,
      createdAt: log.createdAt,
    }));
  }
}
