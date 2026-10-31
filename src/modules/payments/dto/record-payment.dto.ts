import {
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  Min,
} from 'class-validator';
import { PayMethod } from '@prisma/client';

export class RecordPaymentDto {
  @IsString()
  studentId: string;

  @IsNumber()
  @Min(0.01, { message: 'Payment amount must be greater than zero.' })
  amount: number; // in ETB

  @IsEnum(PayMethod)
  method: PayMethod;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  enrolmentId?: string;

  @IsOptional()
  @IsString()
  paidOn?: string; // ISO date string

  @IsOptional()
  @IsString()
  notes?: string;
}
