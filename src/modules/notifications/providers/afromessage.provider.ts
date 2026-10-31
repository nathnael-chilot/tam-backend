import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider, SmsOptions, SmsSendResult } from './sms-provider.interface';
import { calculateSmsSegments } from '../utils/sms-segment-calculator';

@Injectable()
export class AfroMessageProvider implements SmsProvider {
  private readonly logger = new Logger(AfroMessageProvider.name);
  private readonly apiKey = process.env.AFROMESSAGE_API_KEY;
  private readonly senderId = process.env.AFROMESSAGE_SENDER_ID || 'Tsehafi';
  private readonly apiUrl = process.env.AFROMESSAGE_API_URL || 'https://api.afromessage.com/api/send';

  getProviderName(): string {
    return 'AFROMESSAGE_ETHIOPIA';
  }

  async send(to: string, message: string, options?: SmsOptions): Promise<SmsSendResult> {
    const calculation = calculateSmsSegments(message);

    if (!this.apiKey) {
      this.logger.warn(
        `[AfroMessage] No AFROMESSAGE_API_KEY configured in environment. Simulating send to ${to}.`,
      );
      return {
        success: true,
        messageId: `sim_afro_${Date.now()}`,
        segments: calculation.segments,
        provider: this.getProviderName(),
      };
    }

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          to,
          message,
          sender: options?.senderId || this.senderId,
          callback: options?.callbackUrl,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`[AfroMessage] Dispatch failed: ${response.status} - ${errorText}`);
        return {
          success: false,
          segments: calculation.segments,
          provider: this.getProviderName(),
          error: `HTTP ${response.status}: ${errorText}`,
        };
      }

      const json = await response.json();
      return {
        success: true,
        messageId: json.response?.id || json.id || `afro_${Date.now()}`,
        segments: calculation.segments,
        provider: this.getProviderName(),
      };
    } catch (err: any) {
      this.logger.error(`[AfroMessage] Network exception: ${err.message}`);
      return {
        success: false,
        segments: calculation.segments,
        provider: this.getProviderName(),
        error: err.message || 'Network error calling AfroMessage gateway',
      };
    }
  }
}
