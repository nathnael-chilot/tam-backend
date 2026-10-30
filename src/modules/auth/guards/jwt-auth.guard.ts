import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { tenantStorage } from '../../../common/tenancy/tenant.context';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isValid = (await super.canActivate(context)) as boolean;
    if (!isValid) return false;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Populate AsyncLocalStorage TenantStore for request lifespan
    if (user && user.activeTenantId) {
      tenantStorage.enterWith({
        tenantId: user.activeTenantId,
        userId: user.id,
      });
    }

    return true;
  }

  handleRequest(err: any, user: any) {
    if (err || !user) {
      throw err || new UnauthorizedException('Authentication required to access this resource');
    }
    return user;
  }
}
