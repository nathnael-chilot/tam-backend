import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsNumber,
  Min,
} from 'class-validator';

export class CreateEnrolmentDto {
  @IsNotEmpty({ message: 'Student ID is required' })
  @IsString()
  studentId!: string;

  @IsNotEmpty({ message: 'Batch ID is required' })
  @IsString()
  batchId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  customFee?: number; // In ETB (optional override of course default fee)

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number; // In ETB

  @IsOptional()
  @IsString()
  discountReason?: string;
}
