import { IsInt, Min, IsOptional, IsString } from 'class-validator';

export class RechargeCreditsDto {
  @IsInt()
  @Min(50, { message: 'Minimum recharge amount is 50 SMS credits.' })
  credits: number;

  @IsOptional()
  @IsString()
  paymentReference?: string;
}
