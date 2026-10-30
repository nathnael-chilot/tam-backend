import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { EnrolmentsService } from './enrolments.service';
import { CreateEnrolmentDto } from './dto/create-enrolment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';

@Controller('v1/enrolments')
@UseGuards(JwtAuthGuard)
export class EnrolmentsController {
  constructor(private readonly enrolmentsService: EnrolmentsService) {}

  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateEnrolmentDto,
  ) {
    return this.enrolmentsService.create(tenantId, dto);
  }

  @Post(':id/transfer')
  transfer(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body('targetBatchId') targetBatchId: string,
  ) {
    return this.enrolmentsService.transfer(tenantId, id, targetBatchId);
  }

  @Post(':id/drop')
  drop(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.enrolmentsService.drop(tenantId, id);
  }
}
