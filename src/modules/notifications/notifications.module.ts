import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { SMS_PROVIDER } from './providers/sms-provider.interface';
import { MockSmsProvider } from './providers/mock-sms.provider';
import { AfroMessageProvider } from './providers/afromessage.provider';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    MockSmsProvider,
    AfroMessageProvider,
    {
      provide: SMS_PROVIDER,
      useFactory: (afro: AfroMessageProvider, mock: MockSmsProvider) => {
        // If live AfroMessage API key is supplied, use real provider; otherwise use mock
        if (process.env.AFROMESSAGE_API_KEY && process.env.NODE_ENV === 'production') {
          return afro;
        }
        return mock;
      },
      inject: [AfroMessageProvider, MockSmsProvider],
    },
  ],
  exports: [NotificationsService, SMS_PROVIDER],
})
export class NotificationsModule {}
