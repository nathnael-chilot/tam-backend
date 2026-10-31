import { IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { SubscriptionTier, BillingCadence, PlatformPayMethod } from '@prisma/client';

export class CreateInvoiceDto {
  @IsEnum(SubscriptionTier)
  @IsNotEmpty()
  tier: SubscriptionTier;

  @IsEnum(BillingCadence)
  @IsOptional()
  cadence?: BillingCadence = BillingCadence.MONTHLY;

  @IsEnum(PlatformPayMethod)
  @IsOptional()
  paymentMethod?: PlatformPayMethod = PlatformPayMethod.BANK_TRANSFER;
}
