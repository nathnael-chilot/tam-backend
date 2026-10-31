import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { VoidPaymentDto } from './dto/void-payment.dto';
import { QueryPaymentsDto } from './dto/query-payments.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';

@Controller('v1/payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  recordPayment(
    @CurrentTenant() tenantId: string,
    @Request() req: any,
    @Body() dto: RecordPaymentDto,
  ) {
    const receivedById = req.user?.id || req.user?.userId;
    return this.paymentsService.recordPayment(tenantId, receivedById, dto);
  }

  @Post(':id/void')
  voidPayment(
    @CurrentTenant() tenantId: string,
    @Param('id') paymentId: string,
    @Request() req: any,
    @Body() dto: VoidPaymentDto,
  ) {
    const voidedById = req.user?.id || req.user?.userId;
    return this.paymentsService.voidPayment(tenantId, paymentId, voidedById, dto);
  }

  @Get('cash-up')
  getCashUpReport(
    @CurrentTenant() tenantId: string,
    @Query('date') dateStr?: string,
    @Query('cashierId') cashierId?: string,
  ) {
    return this.paymentsService.getCashUpReport(tenantId, dateStr, cashierId);
  }

  @Get('students/:studentId/statement')
  getStudentStatement(
    @CurrentTenant() tenantId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.paymentsService.getStudentStatement(tenantId, studentId);
  }

  @Get(':id/receipt')
  getReceiptById(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.paymentsService.getReceiptById(tenantId, id);
  }

  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: QueryPaymentsDto,
  ) {
    return this.paymentsService.findAll(tenantId, query);
  }
}
