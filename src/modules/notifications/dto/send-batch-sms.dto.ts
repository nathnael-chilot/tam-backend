import {
  IsArray,
  ValidateNested,
  IsEnum,
  IsOptional,
  IsString,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SmsTriggerType } from '@prisma/client';

export class BatchRecipientItem {
  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  amount?: string | number;

  @IsOptional()
  @IsString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  courseName?: string;
}

export class SendBatchSmsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchRecipientItem)
  recipients: BatchRecipientItem[];

  @IsEnum(SmsTriggerType)
  triggerType: SmsTriggerType;

  @IsOptional()
  @IsString()
  messageTemplate?: string;
}
