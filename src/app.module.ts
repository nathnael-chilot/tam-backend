import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { StudentsModule } from './modules/students/students.module';
import { AcademicModule } from './modules/academic/academic.module';
import { EnrolmentsModule } from './modules/enrolments/enrolments.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    StudentsModule,
    AcademicModule,
    EnrolmentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
