import { IsString, IsOptional } from 'class-validator';

export class QueryRegisterDto {
  @IsString()
  batchId: string;

  @IsOptional()
  @IsString()
  fromDate?: string;

  @IsOptional()
  @IsString()
  toDate?: string;
}
