import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantContext } from '../common/tenancy/tenant.context';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super();
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Run operations inside a tenant-isolated transaction
   * Automatically sets local app.tenant_id for PostgreSQL RLS policies
   */
  async withTenant<T>(
    tenantId: string,
    operation: (tx: PrismaClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL app.tenant_id = '${tenantId.replace(/'/g, "''")}';`,
      );
      return operation(tx as unknown as PrismaClient);
    });
  }
}
