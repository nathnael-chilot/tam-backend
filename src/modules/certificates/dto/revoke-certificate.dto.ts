import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class RevokeCertificateDto {
  @IsNotEmpty({ message: 'Revocation reason is required' })
  @IsString()
  @MinLength(5, { message: 'Revocation reason must be at least 5 characters long.' })
  revokedReason!: string;
}
