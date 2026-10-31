import { IsNotEmpty, IsString } from 'class-validator';

export class RejectPaymentDto {
  @IsString()
  @IsNotEmpty()
  reason: string; // e.g. "Reference number CBE-TX-849201 not found in bank ledger"
}
