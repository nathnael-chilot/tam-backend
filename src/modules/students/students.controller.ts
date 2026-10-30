import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { QueryStudentsDto } from './dto/query-students.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';

@Controller('v1/students')
@UseGuards(JwtAuthGuard)
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async importStudents(
    @CurrentTenant() tenantId: string,
    @UploadedFile() file?: Express.Multer.File,
    @Body() body?: { rows?: Record<string, any>[]; commit?: boolean | string },
    @Query('commit') queryCommit?: string,
  ) {
    const isCommit =
      queryCommit === 'true' ||
      body?.commit === true ||
      body?.commit === 'true';

    return this.studentsService.importStudents(tenantId, {
      fileBuffer: file?.buffer,
      rawRows: body?.rows,
      commit: isCommit,
    });
  }

  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @Body() createStudentDto: CreateStudentDto,
  ) {
    return this.studentsService.create(tenantId, createStudentDto);
  }

  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: QueryStudentsDto,
  ) {
    return this.studentsService.findAll(tenantId, query);
  }

  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.studentsService.findOne(tenantId, id);
  }

  @Patch(':id')
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() updateStudentDto: UpdateStudentDto,
  ) {
    return this.studentsService.update(tenantId, id, updateStudentDto);
  }

  @Delete(':id')
  remove(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.studentsService.remove(tenantId, id);
  }
}
