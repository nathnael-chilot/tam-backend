import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class IssueCertificateDto {
  @IsNotEmpty({ message: 'Student ID is required' })
  @IsString()
  studentId!: string;

  @IsNotEmpty({ message: 'Batch ID is required' })
  @IsString()
  batchId!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
