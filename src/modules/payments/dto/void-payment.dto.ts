import { IsString, MinLength } from 'class-validator';

export class VoidPaymentDto {
  @IsString()
  @MinLength(5, { message: 'A detailed reason of at least 5 characters is required to void a payment.' })
  voidReason: string;
}
