import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CoursesService } from './services/courses.service';
import { BatchesService } from './services/batches.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { CreateBatchDto } from './dto/create-batch.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';

@Controller('v1')
@UseGuards(JwtAuthGuard)
export class AcademicController {
  constructor(
    private readonly coursesService: CoursesService,
    private readonly batchesService: BatchesService,
  ) {}

  // Courses
  @Post('courses')
  createCourse(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateCourseDto,
  ) {
    return this.coursesService.createCourse(tenantId, dto);
  }

  @Get('courses')
  findAllCourses(@CurrentTenant() tenantId: string) {
    return this.coursesService.findAllCourses(tenantId);
  }

  // Rooms
  @Post('rooms')
  createRoom(
    @CurrentTenant() tenantId: string,
    @Body() body: { name: string; capacity?: number },
  ) {
    return this.coursesService.createRoom(tenantId, body.name, body.capacity);
  }

  @Get('rooms')
  findAllRooms(@CurrentTenant() tenantId: string) {
    return this.coursesService.findAllRooms(tenantId);
  }

  // Trainers
  @Post('trainers')
  createTrainer(
    @CurrentTenant() tenantId: string,
    @Body() body: { name: string; nameAm?: string; phone?: string; userId?: string },
  ) {
    return this.coursesService.createTrainer(
      tenantId,
      body.name,
      body.nameAm,
      body.phone,
      body.userId,
    );
  }

  @Get('trainers')
  findAllTrainers(@CurrentTenant() tenantId: string) {
    return this.coursesService.findAllTrainers(tenantId);
  }

  // Batches
  @Post('batches')
  createBatch(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateBatchDto,
  ) {
    return this.batchesService.createBatch(tenantId, dto);
  }

  @Get('batches')
  findAllBatches(@CurrentTenant() tenantId: string) {
    return this.batchesService.findAll(tenantId);
  }

  @Get('batches/timetable')
  getTimetable(
    @CurrentTenant() tenantId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.batchesService.getTimetable(tenantId, startDate, endDate);
  }

  @Get('batches/:id')
  findOneBatch(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.batchesService.findOne(tenantId, id);
  }
}
