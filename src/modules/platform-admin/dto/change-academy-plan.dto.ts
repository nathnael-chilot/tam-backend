import { IsEnum, IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { SubscriptionTier } from '@prisma/client';

export class ChangeAcademyPlanDto {
  @IsEnum(SubscriptionTier)
  @IsNotEmpty()
  tier: SubscriptionTier;

  @IsString()
  @IsOptional()
  reason?: string;
}
