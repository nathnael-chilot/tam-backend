import { IsEnum, IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { TenantStatus } from '@prisma/client';

export class UpdateAcademyStatusDto {
  @IsEnum(TenantStatus)
  @IsNotEmpty()
  status: TenantStatus;

  @IsString()
  @IsOptional()
  reason?: string;
}
