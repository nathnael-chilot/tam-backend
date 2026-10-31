import {
  Controller,
  Get,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';

@Controller('v1/dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('owner')
  getOwnerDashboard(@CurrentTenant() tenantId: string) {
    return this.dashboardService.getOwnerDashboard(tenantId);
  }

  @Get('trainer')
  getTrainerDashboard(
    @CurrentTenant() tenantId: string,
    @Request() req: any,
    @Query('trainerId') trainerId?: string,
  ) {
    const effectiveTrainerId = trainerId || req.user?.id || req.user?.userId;
    return this.dashboardService.getTrainerDashboard(tenantId, effectiveTrainerId);
  }
}
