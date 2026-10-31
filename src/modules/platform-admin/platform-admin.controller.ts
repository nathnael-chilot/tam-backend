import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Ip,
} from '@nestjs/common';
import { PlatformAdminService } from './platform-admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { UpdateAcademyStatusDto } from './dto/update-academy-status.dto';
import { ChangeAcademyPlanDto } from './dto/change-academy-plan.dto';
import { ImpersonateAcademyDto } from './dto/impersonate-academy.dto';
import { RejectPaymentDto } from './dto/reject-payment.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('v1/admin')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformAdminController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  @Get('academies')
  getAcademies(
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.platformAdminService.getAcademies(search, status);
  }

  @Get('academies/:id')
  getAcademyDetail(@Param('id') id: string) {
    return this.platformAdminService.getAcademyDetail(id);
  }

  @Post('academies/:id/status')
  updateAcademyStatus(
    @Param('id') id: string,
    @Body() dto: UpdateAcademyStatusDto,
    @CurrentUser('id') adminUserId: string,
    @Ip() ipAddress: string,
  ) {
    return this.platformAdminService.updateAcademyStatus(
      id,
      dto.status,
      dto.reason,
      adminUserId,
      ipAddress,
    );
  }

  @Post('academies/:id/plan')
  changeAcademyPlan(
    @Param('id') id: string,
    @Body() dto: ChangeAcademyPlanDto,
    @CurrentUser('id') adminUserId: string,
    @Ip() ipAddress: string,
  ) {
    return this.platformAdminService.changeAcademyPlan(
      id,
      dto.tier,
      dto.reason,
      adminUserId,
      ipAddress,
    );
  }

  @Post('academies/:id/impersonate')
  impersonateTenant(
    @Param('id') id: string,
    @Body() dto: ImpersonateAcademyDto,
    @CurrentUser() adminUser: any,
    @Ip() ipAddress: string,
  ) {
    return this.platformAdminService.impersonateTenant(
      id,
      dto.reason,
      adminUser,
      ipAddress,
    );
  }

  @Get('payments/pending')
  getPendingPayments() {
    return this.platformAdminService.getPendingPayments();
  }

  @Post('payments/:id/approve')
  approvePayment(
    @Param('id') id: string,
    @CurrentUser('id') adminUserId: string,
    @Ip() ipAddress: string,
  ) {
    return this.platformAdminService.approvePayment(id, adminUserId, ipAddress);
  }

  @Post('payments/:id/reject')
  rejectPayment(
    @Param('id') id: string,
    @Body() dto: RejectPaymentDto,
    @CurrentUser('id') adminUserId: string,
    @Ip() ipAddress: string,
  ) {
    return this.platformAdminService.rejectPayment(
      id,
      dto.reason,
      adminUserId,
      ipAddress,
    );
  }

  @Get('audit-logs')
  getAuditLogs(@Query('limit') limit?: string) {
    const lim = limit ? parseInt(limit, 10) : 50;
    return this.platformAdminService.getAuditLogs(lim);
  }
}
