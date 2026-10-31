import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SMS_PROVIDER,
  SmsProvider,
} from './providers/sms-provider.interface';
import { calculateSmsSegments } from './utils/sms-segment-calculator';
import {
  interpolateTemplate,
  TemplateVariables,
} from './utils/template-interpolator';
import { isWithinQuietHours } from './utils/quiet-hours';
import {
  SendSmsDto,
} from './dto/send-sms.dto';
import {
  SendBatchSmsDto,
} from './dto/send-batch-sms.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { RechargeCreditsDto } from './dto/recharge-credits.dto';
import { QuerySmsLogsDto } from './dto/query-sms-logs.dto';
import {
  SmsTriggerType,
  SmsStatus,
  NotificationType,
} from '@prisma/client';

const DEFAULT_TEMPLATES: Array<{
  triggerType: SmsTriggerType;
  name: string;
  contentAm: string;
  contentEn: string;
}> = [
  {
    triggerType: SmsTriggerType.PAYMENT_REMINDER_DUE,
    name: 'Upcoming Instalment Reminder',
    contentAm:
      'ሰላም [የተማሪ ስም]፣ የ[የአካዳሚ ስም] የትምህርት ክፍያ [መጠን] ብር በ [ቀን] ይጠበቅቦታል። እናመሰግናለን።',
    contentEn:
      'Dear {{student_name}}, your instalment of {{amount}} Br for {{course_name}} at {{academy_name}} is due on {{due_date}}. Thank you.',
  },
  {
    triggerType: SmsTriggerType.PAYMENT_OVERDUE,
    name: 'Overdue Tuition Alert',
    contentAm:
      'ሰላም [የተማሪ ስም]፣ የ[የአካዳሚ ስም] የትምህርት ክፍያ [መጠን] ብር ክፍያ ቀን አልፏል። እባክዎ በአፋጣኝ በቴሌብር ወይም በባንክ ይክፈሉ። እናመሰግናለን።',
    contentEn:
      'Notice: {{student_name}}, your payment of {{amount}} Br for {{course_name}} at {{academy_name}} is overdue. Please settle promptly via Telebirr or bank.',
  },
  {
    triggerType: SmsTriggerType.ABSENCE_ALERT,
    name: 'Student Absence Notice',
    contentAm:
      'ውድ ወላጅ/አሳዳጊ፣ ተማሪ [የተማሪ ስም] ዛሬ በ[ቀን] በ[የትምህርት አይነት] ስልጠና ላይ አልተገኘም/ችም። [የአካዳሚ ስም]',
    contentEn:
      'Dear Guardian, {{student_name}} was marked absent today ({{due_date}}) for {{course_name}}. {{academy_name}}.',
  },
  {
    triggerType: SmsTriggerType.PAYMENT_CONFIRMATION,
    name: 'Payment Receipt Confirmation',
    contentAm:
      'ክፍያዎ ደርሶናል! ተማሪ [የተማሪ ስም] [መጠን] ብር ገቢ ተደርጓል። [የአካዳሚ ስም]',
    contentEn:
      'Payment confirmed! Received {{amount}} Br for {{student_name}}. {{academy_name}}.',
  },
];

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
  ) {}

  /**
   * Get notification settings and available SMS credits
   */
  async getSettings(tenantId: string) {
    let settings = await this.prisma.notificationSettings.findUnique({
      where: { tenantId },
    });

    if (!settings) {
      settings = await this.prisma.notificationSettings.create({
        data: {
          tenantId,
        },
      });
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { smsCredits: true, name: true, phone: true },
    });

    return {
      settings,
      credits: tenant?.smsCredits || 0,
      academyName: tenant?.name || 'Academy',
      provider: this.smsProvider.getProviderName(),
    };
  }

  /**
   * Update notification settings
   */
  async updateSettings(tenantId: string, dto: UpdateSettingsDto) {
    await this.getSettings(tenantId); // Ensure exists

    const updated = await this.prisma.notificationSettings.update({
      where: { tenantId },
      data: {
        ...(dto.remindBeforeDueDays !== undefined && {
          remindBeforeDueDays: dto.remindBeforeDueDays,
        }),
        ...(dto.remindOnDueDate !== undefined && {
          remindOnDueDate: dto.remindOnDueDate,
        }),
        ...(dto.remindWhenOverdue !== undefined && {
          remindWhenOverdue: dto.remindWhenOverdue,
        }),
        ...(dto.remindOverdueDays !== undefined && {
          remindOverdueDays: dto.remindOverdueDays,
        }),
        ...(dto.notifyAbsence !== undefined && {
          notifyAbsence: dto.notifyAbsence,
        }),
        ...(dto.quietHoursEnabled !== undefined && {
          quietHoursEnabled: dto.quietHoursEnabled,
        }),
        ...(dto.quietHoursStart && { quietHoursStart: dto.quietHoursStart }),
        ...(dto.quietHoursEnd && { quietHoursEnd: dto.quietHoursEnd }),
      },
    });

    return updated;
  }

  /**
   * Recharge SMS Credits
   */
  async rechargeCredits(tenantId: string, dto: RechargeCreditsDto) {
    const updatedTenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        smsCredits: {
          increment: dto.credits,
        },
      },
      select: { id: true, name: true, smsCredits: true },
    });

    // Create in-app notification confirming recharge
    await this.prisma.inAppNotification.create({
      data: {
        tenantId,
        title: 'SMS Credits Recharged',
        message: `Successfully added ${dto.credits} SMS credits. New balance: ${updatedTenant.smsCredits} credits.`,
        type: NotificationType.SYSTEM,
      },
    });

    return {
      success: true,
      creditsAdded: dto.credits,
      currentBalance: updatedTenant.smsCredits,
    };
  }

  /**
   * Get or seed templates
   */
  async getTemplates(tenantId: string) {
    let templates = await this.prisma.smsTemplate.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });

    if (templates.length === 0) {
      // Seed default templates
      for (const t of DEFAULT_TEMPLATES) {
        await this.prisma.smsTemplate.create({
          data: {
            tenantId,
            triggerType: t.triggerType,
            name: t.name,
            contentAm: t.contentAm,
            contentEn: t.contentEn,
          },
        });
      }

      templates = await this.prisma.smsTemplate.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
      });
    }

    return templates;
  }

  /**
   * Update template
   */
  async updateTemplate(
    tenantId: string,
    triggerType: SmsTriggerType,
    dto: UpdateTemplateDto,
  ) {
    await this.getTemplates(tenantId); // ensure seeded

    const template = await this.prisma.smsTemplate.update({
      where: {
        tenantId_triggerType: {
          tenantId,
          triggerType,
        },
      },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.contentAm && { contentAm: dto.contentAm }),
        ...(dto.contentEn && { contentEn: dto.contentEn }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    return template;
  }

  /**
   * Send single SMS with credit metering and quiet hours check
   */
  async sendSms(
    tenantId: string,
    dto: SendSmsDto,
    options?: { isAutomated?: boolean; studentName?: string },
  ) {
    const triggerType = dto.triggerType || SmsTriggerType.GENERAL_ANNOUNCEMENT;

    // Check student consent if studentId provided
    if (dto.studentId) {
      const student = await this.prisma.student.findUnique({
        where: { id: dto.studentId },
        select: { smsConsent: true, firstName: true, lastName: true },
      });
      if (student && !student.smsConsent) {
        throw new BadRequestException(
          'Student has revoked consent for SMS notifications (Proclamation 1321/2024).',
        );
      }
    }

    // Check quiet hours for automated messages
    const settings = await this.prisma.notificationSettings.findUnique({
      where: { tenantId },
    });

    if (options?.isAutomated && settings?.quietHoursEnabled) {
      const inQuietHours = isWithinQuietHours(
        new Date(),
        settings.quietHoursStart,
        settings.quietHoursEnd,
      );

      if (inQuietHours) {
        this.logger.warn(
          `[Quiet Hours] Automated SMS suppressed for ${dto.phone} between ${settings.quietHoursStart} and ${settings.quietHoursEnd}.`,
        );

        const log = await this.prisma.smsLog.create({
          data: {
            tenantId,
            studentId: dto.studentId,
            recipientPhone: dto.phone,
            recipientName: options?.studentName,
            message: dto.message,
            segments: 0,
            creditsUsed: 0,
            triggerType,
            status: SmsStatus.SUPPRESSED_QUIET_HOURS,
            errorMessage: 'Suppressed due to Ethiopian quiet hours window policy.',
          },
        });

        return {
          status: SmsStatus.SUPPRESSED_QUIET_HOURS,
          message: 'Suppressed by quiet hours policy.',
          logId: log.id,
        };
      }
    }

    // Calculate segments
    const calculation = calculateSmsSegments(dto.message);
    const requiredCredits = Math.max(1, calculation.segments);

    // Atomically verify and deduct credits
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { smsCredits: true, name: true },
    });

    if (!tenant || tenant.smsCredits < requiredCredits) {
      throw new BadRequestException(
        `Insufficient SMS credits. Required: ${requiredCredits}, Available: ${tenant?.smsCredits || 0}. Please recharge.`,
      );
    }

    // Dispatch via Provider
    const result = await this.smsProvider.send(dto.phone, dto.message, {
      senderId: tenant.name || 'Tsehafi',
    });

    // Decrement credits
    const updatedTenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        smsCredits: {
          decrement: requiredCredits,
        },
      },
      select: { smsCredits: true },
    });

    // Record Log
    const log = await this.prisma.smsLog.create({
      data: {
        tenantId,
        studentId: dto.studentId,
        recipientPhone: dto.phone,
        recipientName: options?.studentName,
        message: dto.message,
        segments: calculation.segments,
        creditsUsed: requiredCredits,
        triggerType,
        status: result.success ? SmsStatus.SENT : SmsStatus.FAILED,
        providerRef: result.messageId,
        errorMessage: result.error,
      },
    });

    // Trigger low credit alert if balance dropped below 30
    if (updatedTenant.smsCredits <= 30) {
      await this.prisma.inAppNotification.create({
        data: {
          tenantId,
          title: 'Low SMS Credit Alert',
          message: `Your SMS credit balance is low (${updatedTenant.smsCredits} credits remaining). Recharge to ensure uninterrupted reminders.`,
          type: NotificationType.CREDIT_LOW,
        },
      });
    }

    return {
      status: result.success ? SmsStatus.SENT : SmsStatus.FAILED,
      messageId: result.messageId,
      segments: calculation.segments,
      creditsDeducted: requiredCredits,
      remainingCredits: updatedTenant.smsCredits,
      logId: log.id,
    };
  }

  /**
   * Send Batch SMS with total credit pre-verification
   */
  async sendBatchSms(
    tenantId: string,
    dto: SendBatchSmsDto,
    options?: { isAutomated?: boolean },
  ) {
    if (!dto.recipients || dto.recipients.length === 0) {
      throw new BadRequestException('No recipients provided for batch dispatch.');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { smsCredits: true, name: true, phone: true },
    });

    if (!tenant) throw new NotFoundException('Tenant not found');

    // Get active template if custom messageTemplate not supplied
    let templateText = dto.messageTemplate;
    if (!templateText) {
      const templates = await this.getTemplates(tenantId);
      const active = templates.find((t) => t.triggerType === dto.triggerType && t.isActive);
      templateText = active?.contentAm || active?.contentEn || 'Tsehafi Notification';
    }

    // Pre-calculate messages and segments
    const preparedItems = dto.recipients.map((rec) => {
      const vars: TemplateVariables = {
        studentName: rec.name || 'Student',
        amount: rec.amount !== undefined ? rec.amount : '',
        dueDate: rec.dueDate || '',
        courseName: rec.courseName || '',
        academyName: tenant.name,
        academyPhone: tenant.phone || '',
      };

      const finalMessage = interpolateTemplate(templateText!, vars);
      const calc = calculateSmsSegments(finalMessage);

      return {
        recipient: rec,
        message: finalMessage,
        segments: Math.max(1, calc.segments),
      };
    });

    const totalRequiredCredits = preparedItems.reduce((acc, curr) => acc + curr.segments, 0);

    if (tenant.smsCredits < totalRequiredCredits) {
      throw new BadRequestException(
        `Insufficient SMS credits for batch dispatch. Required: ${totalRequiredCredits}, Available: ${tenant.smsCredits}. Please top up.`,
      );
    }

    // Execute dispatches
    let successful = 0;
    let failed = 0;
    let suppressed = 0;
    let totalDeducted = 0;

    for (const item of preparedItems) {
      try {
        const res = await this.sendSms(
          tenantId,
          {
            phone: item.recipient.phone,
            message: item.message,
            studentId: item.recipient.studentId,
            triggerType: dto.triggerType,
          },
          {
            isAutomated: options?.isAutomated,
            studentName: item.recipient.name,
          },
        );

        if (res.status === SmsStatus.SENT) {
          successful++;
          totalDeducted += res.creditsDeducted;
        } else if (res.status === SmsStatus.SUPPRESSED_QUIET_HOURS) {
          suppressed++;
        } else {
          failed++;
        }
      } catch (err: any) {
        failed++;
        this.logger.error(`Error sending batch item to ${item.recipient.phone}: ${err.message}`);
      }
    }

    // Record in-app notification for the batch action
    await this.prisma.inAppNotification.create({
      data: {
        tenantId,
        title: 'Batch SMS Dispatched',
        message: `Dispatched ${successful} messages (${totalDeducted} credits used). ${failed} failed, ${suppressed} suppressed.`,
        type: NotificationType.SYSTEM,
      },
    });

    return {
      totalRecipients: dto.recipients.length,
      successful,
      failed,
      suppressed,
      totalCreditsDeducted: totalDeducted,
      remainingCredits: tenant.smsCredits - totalDeducted,
    };
  }

  /**
   * Query SMS Logs
   */
  async getLogs(tenantId: string, dto: QuerySmsLogsDto) {
    const page = parseInt(dto.page || '1', 10);
    const limit = parseInt(dto.limit || '20', 10);
    const skip = (page - 1) * limit;

    const where: any = {
      tenantId,
      ...(dto.triggerType && { triggerType: dto.triggerType }),
      ...(dto.status && { status: dto.status }),
      ...(dto.search && {
        OR: [
          { recipientPhone: { contains: dto.search, mode: 'insensitive' } },
          { recipientName: { contains: dto.search, mode: 'insensitive' } },
          { message: { contains: dto.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [total, items] = await Promise.all([
      this.prisma.smsLog.count({ where }),
      this.prisma.smsLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          student: {
            select: { id: true, studentNo: true, firstName: true, lastName: true },
          },
        },
      }),
    ]);

    return {
      data: items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get In-App Notifications
   */
  async getInAppNotifications(tenantId: string, userId?: string) {
    const [unreadCount, notifications] = await Promise.all([
      this.prisma.inAppNotification.count({
        where: {
          tenantId,
          isRead: false,
          ...(userId && { OR: [{ userId }, { userId: null }] }),
        },
      }),
      this.prisma.inAppNotification.findMany({
        where: {
          tenantId,
          ...(userId && { OR: [{ userId }, { userId: null }] }),
        },
        take: 20,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      unreadCount,
      notifications,
    };
  }

  /**
   * Mark In-App Notification as Read
   */
  async markNotificationRead(tenantId: string, id: string) {
    return this.prisma.inAppNotification.update({
      where: { id },
      data: { isRead: true },
    });
  }
}
