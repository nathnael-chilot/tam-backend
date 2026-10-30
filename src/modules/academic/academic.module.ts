import { Module } from '@nestjs/common';
import { AcademicController } from './academic.controller';
import { CoursesService } from './services/courses.service';
import { BatchesService } from './services/batches.service';

@Module({
  controllers: [AcademicController],
  providers: [CoursesService, BatchesService],
  exports: [CoursesService, BatchesService],
})
export class AcademicModule {}
