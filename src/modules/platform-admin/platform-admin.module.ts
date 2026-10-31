import { Module } from '@nestjs/common';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { PrismaModule } from '../../prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'super_secret_jwt_key_change_in_production',
      signOptions: { expiresIn: '2h' },
    }),
  ],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService, PlatformAdminGuard],
  exports: [PlatformAdminService, PlatformAdminGuard],
})
export class PlatformAdminModule {}
