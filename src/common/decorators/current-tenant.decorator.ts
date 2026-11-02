import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentTenant = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    // Authenticated user's active tenant MUST take precedence over untrusted headers
    if (request.user?.activeTenantId) {
      if (request.user.isPlatformAdmin && request.headers['x-tenant-id']) {
        return request.headers['x-tenant-id'];
      }
      return request.user.activeTenantId;
    }
    return request.tenantId || request.headers['x-tenant-id'];
  },
);
