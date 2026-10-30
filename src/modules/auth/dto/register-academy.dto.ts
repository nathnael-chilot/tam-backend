import { IsNotEmpty, IsString, IsEmail, IsOptional, MinLength, IsEnum } from 'class-validator';
import { Locale, CalendarKind } from '@prisma/client';

export class RegisterAcademyDto {
  // Step 1: Academy Details
  @IsNotEmpty({ message: 'Academy name in English is required' })
  @IsString()
  academyName!: string;

  @IsOptional()
  @IsString()
  academyNameAm?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  subcity?: string;

  @IsNotEmpty({ message: 'Academy phone number is required' })
  @IsString()
  academyPhone!: string;

  // Step 2: Owner Account
  @IsNotEmpty({ message: 'Owner name is required' })
  @IsString()
  ownerName!: string;

  @IsOptional()
  @IsString()
  ownerNameAm?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Invalid email address' })
  ownerEmail?: string;

  @IsNotEmpty({ message: 'Owner mobile phone number is required' })
  @IsString()
  ownerPhone!: string;

  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password!: string;

  // Step 3: Preferences
  @IsOptional()
  @IsEnum(Locale)
  defaultLocale?: Locale;

  @IsOptional()
  @IsEnum(CalendarKind)
  defaultCalendar?: CalendarKind;
}
