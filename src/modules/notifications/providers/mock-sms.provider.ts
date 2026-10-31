import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider, SmsOptions, SmsSendResult } from './sms-provider.interface';
import { calculateSmsSegments } from '../utils/sms-segment-calculator';
import { randomUUID } from 'crypto';

@Injectable()
export class MockSmsProvider implements SmsProvider {
  private readonly logger = new Logger(MockSmsProvider.name);
  public sentMessages: Array<{ to: string; message: string; messageId: string; timestamp: Date }> = [];

  getProviderName(): string {
    return 'MOCK_TELCO';
  }

  async send(to: string, message: string, options?: SmsOptions): Promise<SmsSendResult> {
    const calculation = calculateSmsSegments(message);
    const messageId = `mock_sms_${randomUUID().slice(0, 8)}`;

    this.logger.log(
      `[MOCK SMS DISPATCH] To: ${to} | Sender: ${options?.senderId || 'Tsehafi'} | Segments: ${calculation.segments} (${calculation.isUnicode ? 'Unicode/UCS-2' : 'GSM-7'}) | Message: "${message.slice(0, 60)}..."`,
    );

    this.sentMessages.push({
      to,
      message,
      messageId,
      timestamp: new Date(),
    });

    return {
      success: true,
      messageId,
      segments: calculation.segments,
      provider: this.getProviderName(),
      costMinor: calculation.segments * 100, // 1 Credit per segment
    };
  }

  async getDeliveryStatus(messageId: string): Promise<'DELIVERED' | 'FAILED' | 'PENDING'> {
    return 'DELIVERED';
  }
}
