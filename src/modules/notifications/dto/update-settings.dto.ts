import { IsOptional, IsBoolean, IsInt, IsString, Min } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  remindBeforeDueDays?: number;

  @IsOptional()
  @IsBoolean()
  remindOnDueDate?: boolean;

  @IsOptional()
  @IsBoolean()
  remindWhenOverdue?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  remindOverdueDays?: number;

  @IsOptional()
  @IsBoolean()
  notifyAbsence?: boolean;

  @IsOptional()
  @IsBoolean()
  quietHoursEnabled?: boolean;

  @IsOptional()
  @IsString()
  quietHoursStart?: string;

  @IsOptional()
  @IsString()
  quietHoursEnd?: string;
}
