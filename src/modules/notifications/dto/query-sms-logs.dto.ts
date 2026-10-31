import { IsOptional, IsEnum, IsString } from 'class-validator';
import { SmsTriggerType, SmsStatus } from '@prisma/client';

export class QuerySmsLogsDto {
  @IsOptional()
  @IsEnum(SmsTriggerType)
  triggerType?: SmsTriggerType;

  @IsOptional()
  @IsEnum(SmsStatus)
  status?: SmsStatus;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
