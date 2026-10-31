import { Module } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { PlanLimitsGuard } from './guards/plan-limits.guard';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, PlanLimitsGuard],
  exports: [SubscriptionService, PlanLimitsGuard],
})
export class SubscriptionModule {}
