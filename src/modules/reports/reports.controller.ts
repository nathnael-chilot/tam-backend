import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';

@Controller('v1/reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('revenue')
  getRevenueReport(
    @CurrentTenant() tenantId: string,
    @Query('year') year?: string,
  ) {
    const yearNum = year ? parseInt(year, 10) : undefined;
    return this.reportsService.getRevenueReport(tenantId, yearNum);
  }

  @Get('aging')
  getAgingDebtorsReport(@CurrentTenant() tenantId: string) {
    return this.reportsService.getAgingDebtorsReport(tenantId);
  }

  @Get('enrolments')
  getEnrolmentReport(@CurrentTenant() tenantId: string) {
    return this.reportsService.getEnrolmentReport(tenantId);
  }

  @Get('attendance')
  getAttendanceReport(
    @CurrentTenant() tenantId: string,
    @Query('batchId') batchId?: string,
  ) {
    return this.reportsService.getAttendanceReport(tenantId, batchId);
  }

  @Get('trainer-load')
  getTrainerLoadReport(@CurrentTenant() tenantId: string) {
    return this.reportsService.getTrainerLoadReport(tenantId);
  }

  @Get('export/:type')
  async exportReport(
    @CurrentTenant() tenantId: string,
    @Param('type') type: string,
    @Res() res: Response,
  ) {
    const csvData = await this.reportsService.exportReportCsv(tenantId, type);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="tsehafi-${type}-report.csv"`,
    );
    return res.send(csvData);
  }
}
