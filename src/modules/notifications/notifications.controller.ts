import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SendSmsDto } from './dto/send-sms.dto';
import { SendBatchSmsDto } from './dto/send-batch-sms.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { RechargeCreditsDto } from './dto/recharge-credits.dto';
import { QuerySmsLogsDto } from './dto/query-sms-logs.dto';
import { SmsTriggerType } from '@prisma/client';

@Controller('v1/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Get tenant notification settings and available SMS credits
   */
  @Get('settings')
  getSettings(@CurrentTenant() tenantId: string) {
    return this.notificationsService.getSettings(tenantId);
  }

  /**
   * Update notification settings
   */
  @Put('settings')
  updateSettings(
    @CurrentTenant() tenantId: string,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.notificationsService.updateSettings(tenantId, dto);
  }

  /**
   * Recharge SMS credit balance
   */
  @Post('credits/recharge')
  rechargeCredits(
    @CurrentTenant() tenantId: string,
    @Body() dto: RechargeCreditsDto,
  ) {
    return this.notificationsService.rechargeCredits(tenantId, dto);
  }

  /**
   * Get active notification message templates
   */
  @Get('templates')
  getTemplates(@CurrentTenant() tenantId: string) {
    return this.notificationsService.getTemplates(tenantId);
  }

  /**
   * Update or customize a specific notification template
   */
  @Put('templates/:triggerType')
  updateTemplate(
    @CurrentTenant() tenantId: string,
    @Param('triggerType') triggerType: SmsTriggerType,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.notificationsService.updateTemplate(tenantId, triggerType, dto);
  }

  /**
   * Send single ad-hoc SMS notification
   */
  @Post('sms/send')
  sendSms(
    @CurrentTenant() tenantId: string,
    @Body() dto: SendSmsDto,
  ) {
    return this.notificationsService.sendSms(tenantId, dto);
  }

  /**
   * Send batch SMS notifications (e.g. overdue reminders to multiple students)
   */
  @Post('sms/batch')
  sendBatchSms(
    @CurrentTenant() tenantId: string,
    @Body() dto: SendBatchSmsDto,
  ) {
    return this.notificationsService.sendBatchSms(tenantId, dto);
  }

  /**
   * Get audit log outbox of sent SMS messages
   */
  @Get('sms/logs')
  getLogs(
    @CurrentTenant() tenantId: string,
    @Query() dto: QuerySmsLogsDto,
  ) {
    return this.notificationsService.getLogs(tenantId, dto);
  }

  /**
   * Get in-app alerts for academy staff
   */
  @Get('in-app')
  getInAppNotifications(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
  ) {
    return this.notificationsService.getInAppNotifications(tenantId, user?.id);
  }

  /**
   * Mark in-app alert as read
   */
  @Patch('in-app/:id/read')
  markNotificationRead(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.notificationsService.markNotificationRead(tenantId, id);
  }
}
