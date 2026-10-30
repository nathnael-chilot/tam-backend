import { IsEnum, IsString, IsOptional, MinLength } from 'class-validator';
import { AttendStatus } from '@prisma/client';

export class EditAttendanceDto {
  @IsEnum(AttendStatus)
  status: AttendStatus;

  @IsString()
  @MinLength(3, { message: 'A reason of at least 3 characters is required for attendance edits.' })
  editReason: string;

  @IsOptional()
  @IsString()
  note?: string;
}
