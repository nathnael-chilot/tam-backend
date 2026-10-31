import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { SmsTriggerType } from '@prisma/client';

export class SendSmsDto {
  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsEnum(SmsTriggerType)
  triggerType?: SmsTriggerType;
}
