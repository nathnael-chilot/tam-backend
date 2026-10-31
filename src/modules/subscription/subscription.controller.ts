import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Headers,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SubscriptionService } from './subscription.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UploadSlipDto } from './dto/upload-slip.dto';
import { ChapaWebhookDto } from './dto/chapa-webhook.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { Request } from 'express';

@Controller('v1/subscription')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get('current')
  @UseGuards(JwtAuthGuard)
  getCurrentSubscription(@CurrentTenant() tenantId: string) {
    return this.subscriptionService.getTenantSubscription(tenantId);
  }

  @Post('invoices')
  @UseGuards(JwtAuthGuard)
  createInvoice(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.subscriptionService.createInvoice(tenantId, dto);
  }

  @Post('invoices/:id/slip')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('slip'))
  uploadSlip(
    @CurrentTenant() tenantId: string,
    @Param('id') invoiceId: string,
    @Body() dto: UploadSlipDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.subscriptionService.uploadSlip(tenantId, invoiceId, dto, file);
  }

  @Post('invoices/:id/chapa-checkout')
  @UseGuards(JwtAuthGuard)
  initializeChapaCheckout(
    @CurrentTenant() tenantId: string,
    @Param('id') invoiceId: string,
  ) {
    return this.subscriptionService.initializeChapaCheckout(tenantId, invoiceId);
  }

  @Post('chapa-webhook')
  async handleChapaWebhook(
    @Headers('x-chapa-signature') signature: string,
    @Body() payload: ChapaWebhookDto,
    @Req() req: Request,
  ) {
    const rawBody = (req as any).rawBody
      ? (req as any).rawBody.toString('utf8')
      : JSON.stringify(payload);
    return this.subscriptionService.processChapaWebhook(rawBody, signature, payload);
  }

  @Get('invoices')
  @UseGuards(JwtAuthGuard)
  getInvoices(@CurrentTenant() tenantId: string) {
    return this.subscriptionService.getTenantInvoices(tenantId);
  }
}
