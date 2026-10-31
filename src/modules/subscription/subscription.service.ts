import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SubscriptionTier,
  BillingCadence,
  SubscriptionStatus,
  PlatformPaymentStatus,
  PlatformPayMethod,
} from '@prisma/client';
import {
  PLAN_CONFIGS,
  getPriceSantims,
  getCadenceMonths,
} from './subscription.constants';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UploadSlipDto } from './dto/upload-slip.dto';
import { ChapaWebhookDto } from './dto/chapa-webhook.dto';
import { toEthiopianDate, ETHIOPIAN_MONTHS } from '../../common/calendar/ethiopian-calendar';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Format date into Ethiopian Academic presentation e.g. "Hidar 1, 2017 E.C."
   */
  formatEthiopianDateString(date: Date): { en: string; am: string } {
    const ec = toEthiopianDate(date);
    const m = ETHIOPIAN_MONTHS[ec.month - 1] || ETHIOPIAN_MONTHS[0];
    return {
      en: `${m.nameEn} ${ec.day}, ${ec.year} E.C.`,
      am: `${ec.day} ${m.nameAm} ${ec.year} ዓ.ም`,
    };
  }

  /**
   * Get or create current tenant subscription with resource usage metrics
   */
  async getTenantSubscription(tenantId: string) {
    let subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
      include: {
        tenant: true,
      },
    });

    if (!subscription) {
      const now = new Date();
      const trialEnds = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      subscription = await this.prisma.subscription.create({
        data: {
          tenantId,
          tier: SubscriptionTier.STARTER,
          cadence: BillingCadence.MONTHLY,
          status: SubscriptionStatus.TRIAL,
          trialEndsAt: trialEnds,
          currentPeriodStart: now,
          currentPeriodEnd: trialEnds,
          gracePeriodEndsAt: new Date(trialEnds.getTime() + 3 * 24 * 60 * 60 * 1000),
        },
        include: {
          tenant: true,
        },
      });
    }

    const plan = PLAN_CONFIGS[subscription.tier] || PLAN_CONFIGS.STARTER;

    // Active students count
    const activeStudents = await this.prisma.student.count({
      where: {
        tenantId,
        status: 'ACTIVE',
        deletedAt: null,
      },
    });

    // Active staff seats count
    const activeStaff = await this.prisma.membership.count({
      where: {
        tenantId,
        status: 'ACTIVE',
      },
    });

    // SMS sent in current billing period
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const smsSentThisMonth = await this.prisma.smsLog.count({
      where: {
        tenantId,
        createdAt: { gte: startOfMonth },
        status: 'SENT',
      },
    });

    const renewalEc = this.formatEthiopianDateString(subscription.currentPeriodEnd);
    const renewalGc = subscription.currentPeriodEnd.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    const invoices = await this.prisma.subscriptionInvoice.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return {
      subscription: {
        id: subscription.id,
        tenantId: subscription.tenantId,
        tenantName: subscription.tenant.name,
        tenantNameAm: subscription.tenant.nameAm,
        tier: subscription.tier,
        planName: plan.name,
        planNameAm: plan.nameAm,
        cadence: subscription.cadence,
        status: subscription.status,
        monthlyPriceSantims: plan.monthlyPriceSantims.toString(),
        monthlyPriceEtb: (Number(plan.monthlyPriceSantims) / 100).toFixed(2),
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        trialEndsAt: subscription.trialEndsAt,
        gracePeriodEndsAt: subscription.gracePeriodEndsAt,
        renewalEc,
        renewalGc,
        registryRefId: `TSE-${toEthiopianDate(subscription.tenant.createdAt).year}-${subscription.tenant.id.slice(0, 4).toUpperCase()}`,
      },
      usage: {
        students: {
          current: activeStudents,
          max: plan.maxActiveStudents,
          percentage: Math.min(100, Math.round((activeStudents / plan.maxActiveStudents) * 100)),
        },
        staff: {
          current: activeStaff,
          max: plan.maxStaffSeats,
          percentage: Math.min(100, Math.round((activeStaff / plan.maxStaffSeats) * 100)),
        },
        sms: {
          current: smsSentThisMonth,
          max: plan.monthlySmsQuota,
          percentage: Math.min(100, Math.round((smsSentThisMonth / plan.monthlySmsQuota) * 100)),
        },
      },
      planConfig: {
        tier: plan.tier,
        name: plan.name,
        nameAm: plan.nameAm,
        features: plan.features,
        featuresAm: plan.featuresAm,
      },
      recentInvoices: invoices.map((inv) => ({
        id: inv.id,
        invoiceNo: inv.invoiceNo,
        tier: inv.tier,
        cadence: inv.cadence,
        amountSantims: inv.amountSantims.toString(),
        amountEtb: (Number(inv.amountSantims) / 100).toFixed(2),
        status: inv.status,
        paymentMethod: inv.paymentMethod,
        referenceNumber: inv.referenceNumber,
        slipUrl: inv.slipUrl,
        paidAt: inv.paidAt,
        createdAt: inv.createdAt,
        dateEc: this.formatEthiopianDateString(inv.createdAt),
      })),
    };
  }

  /**
   * Create an invoice for upgrade or renewal
   */
  async createInvoice(tenantId: string, dto: CreateInvoiceDto) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription record not found for tenant');
    }

    const tier = dto.tier;
    const cadence = dto.cadence || BillingCadence.MONTHLY;
    const amountSantims = getPriceSantims(tier, cadence);

    const ecYear = toEthiopianDate(new Date()).year;
    const count = await this.prisma.subscriptionInvoice.count();
    const invoiceNo = `INV-${ecYear}-${(count + 1).toString().padStart(4, '0')}`;

    const now = new Date();
    const months = getCadenceMonths(cadence);
    const periodEnd = new Date(now.getTime() + months * 30 * 24 * 60 * 60 * 1000);

    const invoice = await this.prisma.subscriptionInvoice.create({
      data: {
        subscriptionId: subscription.id,
        tenantId,
        invoiceNo,
        tier,
        cadence,
        amountSantims,
        status: PlatformPaymentStatus.PENDING,
        paymentMethod: dto.paymentMethod || PlatformPayMethod.BANK_TRANSFER,
        periodStart: now,
        periodEnd,
      },
    });

    return {
      id: invoice.id,
      invoiceNo: invoice.invoiceNo,
      tier: invoice.tier,
      cadence: invoice.cadence,
      amountSantims: invoice.amountSantims.toString(),
      amountEtb: (Number(invoice.amountSantims) / 100).toFixed(2),
      status: invoice.status,
      paymentMethod: invoice.paymentMethod,
      createdAt: invoice.createdAt,
    };
  }

  /**
   * Upload bank transfer receipt slip
   */
  async uploadSlip(
    tenantId: string,
    invoiceId: string,
    dto: UploadSlipDto,
    file?: Express.Multer.File,
  ) {
    const invoice = await this.prisma.subscriptionInvoice.findFirst({
      where: { id: invoiceId, tenantId },
    });

    if (!invoice) {
      throw new NotFoundException('Subscription invoice not found');
    }

    let slipUrl = dto.slipBase64 || null;
    let slipFileName = null;

    if (file) {
      const uploadDir = path.join(process.cwd(), 'uploads', 'slips');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      slipFileName = `${invoice.invoiceNo}-${Date.now()}-${file.originalname}`;
      const filePath = path.join(uploadDir, slipFileName);
      fs.writeFileSync(filePath, file.buffer);
      slipUrl = `/uploads/slips/${slipFileName}`;
    }

    const updated = await this.prisma.subscriptionInvoice.update({
      where: { id: invoiceId },
      data: {
        referenceNumber: dto.referenceNumber,
        slipUrl: slipUrl || invoice.slipUrl,
        slipFileName: slipFileName || invoice.slipFileName,
        status: PlatformPaymentStatus.PENDING,
      },
    });

    return {
      id: updated.id,
      invoiceNo: updated.invoiceNo,
      status: updated.status,
      referenceNumber: updated.referenceNumber,
      slipUrl: updated.slipUrl,
      message: 'Deposit slip submitted for platform admin verification.',
    };
  }

  /**
   * Initialize Chapa online checkout session
   */
  async initializeChapaCheckout(tenantId: string, invoiceId: string) {
    const invoice = await this.prisma.subscriptionInvoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: {
        tenant: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Subscription invoice not found');
    }

    const txRef = `TSE-${invoice.invoiceNo}-${Date.now()}`;
    const amountEtb = (Number(invoice.amountSantims) / 100).toFixed(2);

    await this.prisma.subscriptionInvoice.update({
      where: { id: invoiceId },
      data: {
        chapaTxRef: txRef,
        paymentMethod: PlatformPayMethod.CHAPA,
      },
    });

    const chapaSecret = process.env.CHAPA_SECRET_KEY;
    const callbackUrl = process.env.CHAPA_CALLBACK_URL || 'http://localhost:3000/settings/subscription?payment=success';

    // If sandbox / live API key configured
    if (chapaSecret && chapaSecret.startsWith('CHASECK')) {
      try {
        const response = await fetch('https://api.chapa.co/v1/transaction/initialize', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${chapaSecret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: amountEtb,
            currency: 'ETB',
            email: invoice.tenant.phone ? `${invoice.tenant.phone}@tsehafi.et` : 'billing@tsehafi.et',
            first_name: invoice.tenant.name.split(' ')[0] || 'Academy',
            last_name: 'Academy',
            tx_ref: txRef,
            callback_url: callbackUrl,
            return_url: callbackUrl,
            customization: {
              title: 'Tsehafi Subscription',
              description: `${invoice.tier} Plan (${invoice.cadence}) Renewal`,
            },
          }),
        });

        const data = await response.json();
        if (data.status === 'success' && data.data?.checkout_url) {
          return {
            checkoutUrl: data.data.checkout_url,
            txRef,
            amountEtb,
          };
        }
      } catch (err) {
        this.logger.error('Chapa API call failed, falling back to sandbox simulator', err);
      }
    }

    // Default Sandbox checkout simulator URL
    return {
      checkoutUrl: `/settings/subscription?checkout_simulated=true&tx_ref=${txRef}&amount=${amountEtb}`,
      txRef,
      amountEtb,
      mode: 'sandbox',
    };
  }

  /**
   * Process and verify Chapa webhook with HMAC-SHA256 signature
   */
  async processChapaWebhook(rawBody: string, signature: string, payload: ChapaWebhookDto) {
    const webhookSecret = process.env.CHAPA_WEBHOOK_SECRET || 'chapa_webhook_secret';

    // Verify HMAC-SHA256 signature if signature header is provided
    if (signature) {
      const hmacRaw = crypto.createHmac('sha256', webhookSecret).update(rawBody || '').digest('hex');
      const hmacPayload = crypto.createHmac('sha256', webhookSecret).update(JSON.stringify(payload)).digest('hex');

      if (signature !== hmacRaw && signature !== hmacPayload) {
        this.logger.warn(`Chapa webhook signature mismatch. Received: ${signature}`);
        throw new UnauthorizedException('Invalid Chapa webhook signature');
      }
    }

    const { tx_ref, status } = payload;
    if (!tx_ref) {
      throw new BadRequestException('tx_ref is required in webhook payload');
    }

    const invoice = await this.prisma.subscriptionInvoice.findUnique({
      where: { chapaTxRef: tx_ref },
      include: { subscription: true, tenant: true },
    });

    if (!invoice) {
      this.logger.warn(`Invoice not found for Chapa tx_ref: ${tx_ref}`);
      return { received: true, processed: false, reason: 'Invoice not found' };
    }

    // Idempotent check
    if (invoice.status === PlatformPaymentStatus.APPROVED) {
      return { received: true, processed: true, message: 'Already approved' };
    }

    if (status === 'success') {
      const now = new Date();
      const months = getCadenceMonths(invoice.cadence);
      const currentEnd = invoice.subscription.currentPeriodEnd > now ? invoice.subscription.currentPeriodEnd : now;
      const newPeriodEnd = new Date(currentEnd.getTime() + months * 30 * 24 * 60 * 60 * 1000);
      const newGraceEnd = new Date(newPeriodEnd.getTime() + 3 * 24 * 60 * 60 * 1000);

      const plan = PLAN_CONFIGS[invoice.tier] || PLAN_CONFIGS.STARTER;

      await this.prisma.$transaction([
        this.prisma.subscriptionInvoice.update({
          where: { id: invoice.id },
          data: {
            status: PlatformPaymentStatus.APPROVED,
            paidAt: now,
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
            status: 'ACTIVE',
            smsCredits: { increment: plan.monthlySmsQuota },
          },
        }),
      ]);

      this.logger.log(`Chapa subscription activated for tenant ${invoice.tenantId} (${invoice.tier})`);
      return { received: true, processed: true, status: 'APPROVED' };
    } else {
      await this.prisma.subscriptionInvoice.update({
        where: { id: invoice.id },
        data: {
          status: PlatformPaymentStatus.REJECTED,
          rejectionReason: `Chapa payment status: ${status}`,
        },
      });
      return { received: true, processed: true, status: 'REJECTED' };
    }
  }

  /**
   * Get all subscription invoices for a tenant
   */
  async getTenantInvoices(tenantId: string) {
    const invoices = await this.prisma.subscriptionInvoice.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    return invoices.map((inv) => ({
      id: inv.id,
      invoiceNo: inv.invoiceNo,
      tier: inv.tier,
      cadence: inv.cadence,
      amountSantims: inv.amountSantims.toString(),
      amountEtb: (Number(inv.amountSantims) / 100).toFixed(2),
      status: inv.status,
      paymentMethod: inv.paymentMethod,
      referenceNumber: inv.referenceNumber,
      slipUrl: inv.slipUrl,
      paidAt: inv.paidAt,
      createdAt: inv.createdAt,
      dateEc: this.formatEthiopianDateString(inv.createdAt),
    }));
  }
}
