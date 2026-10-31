import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class UploadSlipDto {
  @IsString()
  @IsNotEmpty()
  referenceNumber: string; // e.g. "CBE-TX-849201", "Telebirr-920184"

  @IsString()
  @IsOptional()
  slipBase64?: string; // Optional direct base64 image payload if not using multipart upload
}
