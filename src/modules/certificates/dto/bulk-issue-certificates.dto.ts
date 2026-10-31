import { IsNotEmpty, IsString } from 'class-validator';

export class BulkIssueCertificatesDto {
  @IsNotEmpty({ message: 'Batch ID is required' })
  @IsString()
  batchId!: string;
}
