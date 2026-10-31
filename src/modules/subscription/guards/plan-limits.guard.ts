import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../prisma/prisma.service';
import { PLAN_CONFIGS } from '../subscription.constants';
import { SubscriptionTier, SubscriptionStatus } from '@prisma/client';

export type LimitResource = 'STUDENTS' | 'STAFF' | 'MUTATION_ALLOWED';

export const CHECK_LIMIT_KEY = 'check_plan_limit';
export const CheckLimit = (resource: LimitResource) => SetMetadata(CHECK_LIMIT_KEY, resource);

@Injectable()
export class PlanLimitsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const resource = this.reflector.getAllAndOverride<LimitResource>(CHECK_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!resource) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const tenantId = request.user?.activeTenantId || request.headers['x-tenant-id'];

    if (!tenantId) {
      return true; // Let tenant guards handle missing tenant
    }

    // 1. Fetch or initialize subscription
    let subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      const now = new Date();
      const trialEnds = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      subscription = await this.prisma.subscription.create({
        data: {
          tenantId,
          tier: SubscriptionTier.STARTER,
          status: SubscriptionStatus.TRIAL,
          trialEndsAt: trialEnds,
          currentPeriodStart: now,
          currentPeriodEnd: trialEnds,
          gracePeriodEndsAt: new Date(trialEnds.getTime() + 3 * 24 * 60 * 60 * 1000),
        },
      });
    }

    // 2. Check if tenant subscription has lapsed beyond grace period
    const now = new Date();
    if (
      subscription.status === SubscriptionStatus.PAST_DUE &&
      subscription.gracePeriodEndsAt &&
      subscription.gracePeriodEndsAt < now
    ) {
      throw new ForbiddenException({
        message: 'Your subscription has lapsed and the grace period has expired. The workspace is in read-only mode until renewed.',
        code: 'SUBSCRIPTION_EXPIRED_READ_ONLY',
      });
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true },
    });

    if (tenant?.status === 'SUSPENDED') {
      throw new ForbiddenException({
        message: 'This academy workspace has been suspended by the platform administrator.',
        code: 'ACADEMY_SUSPENDED',
      });
    }

    const plan = PLAN_CONFIGS[subscription.tier] || PLAN_CONFIGS.STARTER;

    // 3. Resource checks
    if (resource === 'STUDENTS') {
      const currentCount = await this.prisma.student.count({
        where: {
          tenantId,
          status: 'ACTIVE',
          deletedAt: null,
        },
      });

      if (currentCount >= plan.maxActiveStudents) {
        throw new ForbiddenException({
          message: `Active student limit (${plan.maxActiveStudents}) reached for the ${plan.name} plan. Please upgrade to enroll more students.`,
          code: 'PLAN_LIMIT_EXCEEDED_STUDENTS',
          tier: subscription.tier,
          limit: plan.maxActiveStudents,
          current: currentCount,
        });
      }
    }

    if (resource === 'STAFF') {
      const currentCount = await this.prisma.membership.count({
        where: {
          tenantId,
          status: 'ACTIVE',
        },
      });

      if (currentCount >= plan.maxStaffSeats) {
        throw new ForbiddenException({
          message: `Staff seat limit (${plan.maxStaffSeats}) reached for the ${plan.name} plan. Please upgrade to invite additional team members.`,
          code: 'PLAN_LIMIT_EXCEEDED_STAFF',
          tier: subscription.tier,
          limit: plan.maxStaffSeats,
          current: currentCount,
        });
      }
    }

    return true;
  }
}
