import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CertificatesService } from './certificates.service';
import { IssueCertificateDto } from './dto/issue-certificate.dto';
import { BulkIssueCertificatesDto } from './dto/bulk-issue-certificates.dto';
import { RevokeCertificateDto } from './dto/revoke-certificate.dto';
import { QueryCertificatesDto } from './dto/query-certificates.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';

@Controller('v1/certificates')
export class CertificatesController {
  constructor(private readonly certificatesService: CertificatesService) {}

  /**
   * Public verification check - NO AUTH GUARD
   */
  @Get('verify/:token')
  verifyPublicToken(@Param('token') token: string) {
    return this.certificatesService.verifyPublicToken(token);
  }

  @Get('eligibility')
  @UseGuards(JwtAuthGuard)
  checkEligibility(
    @CurrentTenant() tenantId: string,
    @Query('studentId') studentId: string,
    @Query('batchId') batchId: string,
  ) {
    return this.certificatesService.checkEligibility(tenantId, studentId, batchId);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  issueCertificate(
    @CurrentTenant() tenantId: string,
    @Body() dto: IssueCertificateDto,
  ) {
    return this.certificatesService.issueCertificate(tenantId, dto);
  }

  @Post('bulk')
  @UseGuards(JwtAuthGuard)
  bulkIssueCertificates(
    @CurrentTenant() tenantId: string,
    @Body() dto: BulkIssueCertificatesDto,
  ) {
    return this.certificatesService.bulkIssueCertificates(tenantId, dto);
  }

  @Post(':id/revoke')
  @UseGuards(JwtAuthGuard)
  revokeCertificate(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: RevokeCertificateDto,
  ) {
    return this.certificatesService.revokeCertificate(tenantId, id, dto);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findById(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.certificatesService.findById(tenantId, id);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: QueryCertificatesDto,
  ) {
    return this.certificatesService.findAll(tenantId, query);
  }
}
