import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
} from 'class-validator';
import { Sex, StudentStatus } from '@prisma/client';

export class CreateStudentDto {
  @IsNotEmpty({ message: 'First name is required' })
  @IsString()
  firstName!: string;

  @IsNotEmpty({ message: 'Last name is required' })
  @IsString()
  lastName!: string;

  @IsOptional()
  @IsString()
  firstNameAm?: string;

  @IsOptional()
  @IsString()
  lastNameAm?: string;

  @IsOptional()
  @IsEnum(Sex)
  sex?: Sex;

  @IsOptional()
  @IsDateString()
  dob?: string;

  @IsNotEmpty({ message: 'Mobile phone number is required' })
  @IsString()
  phone!: string;

  @IsOptional()
  @IsString()
  guardianName?: string;

  @IsOptional()
  @IsString()
  guardianPhone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsEnum(StudentStatus)
  status?: StudentStatus;

  @IsOptional()
  @IsString()
  batchId?: string; // Optional auto-enrolment into batch
}
