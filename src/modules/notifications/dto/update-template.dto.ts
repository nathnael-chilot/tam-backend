import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  contentAm?: string;

  @IsOptional()
  @IsString()
  contentEn?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
