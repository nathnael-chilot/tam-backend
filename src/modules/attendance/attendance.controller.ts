import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { BulkMarkAttendanceDto } from './dto/mark-attendance.dto';
import { EditAttendanceDto } from './dto/edit-attendance.dto';
import { QueryRegisterDto } from './dto/query-register.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';

@Controller('v1/attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get('today')
  getTodaySessions(
    @CurrentTenant() tenantId: string,
    @Query('trainerId') trainerId?: string,
  ) {
    return this.attendanceService.getTodaySessions(tenantId, trainerId);
  }

  @Get('sessions/:sessionId')
  getSessionAttendance(
    @CurrentTenant() tenantId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.attendanceService.getSessionAttendance(tenantId, sessionId);
  }

  @Post('sessions/:sessionId/bulk')
  markSessionAttendance(
    @CurrentTenant() tenantId: string,
    @Param('sessionId') sessionId: string,
    @Request() req: any,
    @Body() dto: BulkMarkAttendanceDto,
  ) {
    const userId = req.user?.id || req.user?.userId;
    const userRole = req.user?.role;
    return this.attendanceService.markSessionAttendance(
      tenantId,
      sessionId,
      userId,
      userRole,
      dto,
    );
  }

  @Patch('records/:id')
  editAttendanceRecord(
    @CurrentTenant() tenantId: string,
    @Param('id') recordId: string,
    @Request() req: any,
    @Body() dto: EditAttendanceDto,
  ) {
    const userId = req.user?.id || req.user?.userId;
    const userRole = req.user?.role;
    return this.attendanceService.editAttendanceRecord(
      tenantId,
      recordId,
      userId,
      userRole,
      dto,
    );
  }

  @Get('batches/:batchId/register')
  getBatchRegister(
    @CurrentTenant() tenantId: string,
    @Param('batchId') batchId: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.attendanceService.getBatchRegister(tenantId, {
      batchId,
      fromDate,
      toDate,
    });
  }
}
