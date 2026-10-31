import { IsNotEmpty, IsString } from 'class-validator';

export class ImpersonateAcademyDto {
  @IsString()
  @IsNotEmpty()
  reason: string; // Mandatory audit reason e.g. "Customer support investigation for payment slip sync"
}
