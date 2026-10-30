import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsInt,
  Min,
  IsArray,
  IsBoolean,
  IsDateString,
  Matches,
} from 'class-validator';

export class CreateBatchDto {
  @IsNotEmpty({ message: 'Batch code is required' })
  @IsString()
  code!: string; // e.g. ENG-2017-B2

  @IsNotEmpty({ message: 'Course is required' })
  @IsString()
  courseId!: string;

  @IsOptional()
  @IsString()
  trainerId?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsNotEmpty({ message: 'Batch seat capacity is required' })
  @IsInt()
  @Min(1)
  capacity!: number;

  @IsNotEmpty({ message: 'Start date is required' })
  @IsDateString()
  startDate!: string;

  @IsNotEmpty({ message: 'End date is required' })
  @IsDateString()
  endDate!: string;

  @IsArray()
  @IsNotEmpty()
  daysOfWeek!: number[]; // 1 = Monday, 2 = Tuesday ... 7 = Sunday

  @IsNotEmpty({ message: 'Start time is required (e.g. 18:00)' })
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'Start time must be in HH:MM 24-hour format',
  })
  startTime!: string;

  @IsNotEmpty({ message: 'End time is required (e.g. 20:00)' })
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'End time must be in HH:MM 24-hour format',
  })
  endTime!: string;

  @IsOptional()
  @IsBoolean()
  skipHolidays?: boolean = true;
}
