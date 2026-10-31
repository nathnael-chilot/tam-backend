import { IsOptional, IsString } from 'class-validator';

export class ChapaWebhookDto {
  @IsOptional()
  @IsString()
  event?: string; // e.g. "charge.complete"

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  tx_ref!: string; // e.g. "TSE-INV-2017-001-..."

  @IsOptional()
  status!: 'success' | 'failed' | 'pending';

  @IsOptional()
  amount?: number | string;

  @IsOptional()
  @IsString()
  currency?: string; // "ETB"

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  first_name?: string;

  @IsOptional()
  @IsString()
  last_name?: string;

  @IsOptional()
  @IsString()
  payment_method?: string; // "telebirr" | "cbebirr" | "card"

  @IsOptional()
  @IsString()
  reference?: string;
}
