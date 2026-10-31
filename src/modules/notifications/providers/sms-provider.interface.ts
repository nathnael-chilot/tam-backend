export interface SmsOptions {
  senderId?: string;
  callbackUrl?: string;
  tag?: string;
}

export interface SmsSendResult {
  success: boolean;
  messageId?: string;
  segments: number;
  provider: string;
  costMinor?: number; // In santims or credits
  error?: string;
}

export const SMS_PROVIDER = 'SMS_PROVIDER';

export abstract class SmsProvider {
  abstract send(to: string, message: string, options?: SmsOptions): Promise<SmsSendResult>;
  abstract getProviderName(): string;
  getDeliveryStatus?(messageId: string): Promise<'DELIVERED' | 'FAILED' | 'PENDING'>;
}
