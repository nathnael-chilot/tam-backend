import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email?: string;
  phone?: string;
  activeTenantId?: string;
  role?: string;
  isPlatformAdmin?: boolean;
  isImpersonating?: boolean;
  impersonatedBy?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        // 1. Check Bearer token header
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        // 2. Check HTTP-only cookie
        (req: Request) => {
          let token = null;
          if (req && req.cookies) {
            token = req.cookies['access_token'];
          }
          return token;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'super_secret_jwt_key_change_in_production',
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        memberships: {
          include: {
            tenant: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User session invalid or expired');
    }

    // Determine active membership and role
    const activeTenantId = payload.activeTenantId || user.memberships[0]?.tenantId;
    const activeMembership = user.memberships.find((m) => m.tenantId === activeTenantId);

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      nameAm: user.nameAm,
      isPlatformAdmin: user.isPlatformAdmin,
      isImpersonating: payload.isImpersonating || false,
      impersonatedBy: payload.impersonatedBy,
      activeTenantId,
      role: activeMembership?.role,
      activeTenant: activeMembership?.tenant,
      memberships: user.memberships,
    };
  }
}
