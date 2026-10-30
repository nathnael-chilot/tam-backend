import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsInt,
  Min,
  IsNumber,
} from 'class-validator';

export class CreateCourseDto {
  @IsNotEmpty({ message: 'Course name in English is required' })
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  nameAm?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  totalHours?: number;

  @IsNotEmpty({ message: 'Default course fee in ETB is required' })
  @IsNumber()
  @Min(0)
  defaultFee!: number; // Input in ETB, stored as santims in backend

  @IsOptional()
  @IsInt()
  @Min(1)
  requiredAttendancePct?: number = 80;
}
