import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterAcademyDto } from './dto/register-academy.dto';
import { LoginDto } from './dto/login.dto';
import { normalizeEthiopianPhone } from '../../common/phone/phone';
import { Role, MemberStatus, TenantStatus, Locale, CalendarKind } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  /**
   * Register a new academy and its owner account atomically
   */
  async registerAcademy(dto: RegisterAcademyDto) {
    const phoneNorm = normalizeEthiopianPhone(dto.ownerPhone);
    if (!phoneNorm.isValid || !phoneNorm.normalized) {
      throw new BadRequestException(phoneNorm.error || 'Invalid owner phone number');
    }

    // Check if user already exists
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [
          ...(dto.ownerEmail ? [{ email: dto.ownerEmail.toLowerCase() }] : []),
          { phone: phoneNorm.normalized },
        ],
      },
    });

    if (existing) {
      throw new ConflictException(
        'An account with this phone number or email already exists. Please sign in.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    // Atomically create Tenant, User, and Owner Membership
    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.academyName,
          nameAm: dto.academyNameAm,
          city: dto.city || 'Addis Ababa',
          subcity: dto.subcity,
          phone: dto.academyPhone,
          defaultLocale: dto.defaultLocale || Locale.am,
          defaultCalendar: dto.defaultCalendar || CalendarKind.ETHIOPIAN,
          status: TenantStatus.ACTIVE,
        },
      });

      const user = await tx.user.create({
        data: {
          name: dto.ownerName,
          nameAm: dto.ownerNameAm,
          email: dto.ownerEmail ? dto.ownerEmail.toLowerCase() : null,
          phone: phoneNorm.normalized,
          passwordHash,
          locale: dto.defaultLocale || Locale.am,
        },
      });

      const membership = await tx.membership.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          role: Role.OWNER,
          status: MemberStatus.ACTIVE,
        },
      });

      const now = new Date();
      const trialEnds = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      const gracePeriodEnds = new Date(trialEnds.getTime() + 3 * 24 * 60 * 60 * 1000);

      await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          tier: 'STARTER',
          cadence: 'MONTHLY',
          status: 'TRIAL',
          trialEndsAt: trialEnds,
          currentPeriodStart: now,
          currentPeriodEnd: trialEnds,
          gracePeriodEndsAt: gracePeriodEnds,
        },
      });

      return { tenant, user, membership };
    });

    const tokens = this.generateTokens({
      sub: result.user.id,
      email: result.user.email || undefined,
      phone: result.user.phone || undefined,
      activeTenantId: result.tenant.id,
      role: Role.OWNER,
      isPlatformAdmin: result.user.isPlatformAdmin,
    });

    return {
      user: {
        id: result.user.id,
        name: result.user.name,
        nameAm: result.user.nameAm,
        email: result.user.email,
        phone: result.user.phone,
        isPlatformAdmin: result.user.isPlatformAdmin,
      },
      tenant: {
        id: result.tenant.id,
        name: result.tenant.name,
        nameAm: result.tenant.nameAm,
        role: Role.OWNER,
      },
      ...tokens,
    };
  }

  /**
   * Log in an existing user via email or phone
   */
  async login(dto: LoginDto) {
    const identifier = dto.identifier.trim();
    const phoneRes = normalizeEthiopianPhone(identifier);
    const normalizedPhone = phoneRes.isValid ? phoneRes.normalized : null;

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier.toLowerCase() },
          ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
          { phone: identifier },
        ],
      },
      include: {
        memberships: {
          include: {
            tenant: true,
          },
        },
      },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials. Check your email/phone and password.');
    }

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials. Check your email/phone and password.');
    }

    if (user.memberships.length === 0 && !user.isPlatformAdmin) {
      throw new UnauthorizedException('No academy memberships found for this account.');
    }

    // Default to first active membership if available
    const activeMembership = user.memberships[0];

    const tokens = this.generateTokens({
      sub: user.id,
      email: user.email || undefined,
      phone: user.phone || undefined,
      activeTenantId: activeMembership?.tenantId,
      role: activeMembership?.role,
      isPlatformAdmin: user.isPlatformAdmin,
    });

    return {
      user: {
        id: user.id,
        name: user.name,
        nameAm: user.nameAm,
        email: user.email,
        phone: user.phone,
        isPlatformAdmin: user.isPlatformAdmin,
      },
      activeTenant: activeMembership
        ? {
            id: activeMembership.tenant.id,
            name: activeMembership.tenant.name,
            nameAm: activeMembership.tenant.nameAm,
            role: activeMembership.role,
          }
        : null,
      memberships: user.memberships.map((m) => ({
        tenantId: m.tenantId,
        tenantName: m.tenant.name,
        tenantNameAm: m.tenant.nameAm,
        role: m.role,
      })),
      ...tokens,
    };
  }

  /**
   * Get current authenticated user profile and memberships
   */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          include: {
            tenant: true,
          },
        },
      },
    });

    if (!user) throw new UnauthorizedException('User not found');

    return {
      id: user.id,
      name: user.name,
      nameAm: user.nameAm,
      email: user.email,
      phone: user.phone,
      locale: user.locale,
      theme: user.theme,
      calendar: user.calendar,
      isPlatformAdmin: user.isPlatformAdmin,
      memberships: user.memberships.map((m) => ({
        tenantId: m.tenantId,
        tenantName: m.tenant.name,
        tenantNameAm: m.tenant.nameAm,
        role: m.role,
      })),
    };
  }

  private generateTokens(payload: {
    sub: string;
    email?: string;
    phone?: string;
    activeTenantId?: string;
    role?: string;
    isPlatformAdmin?: boolean;
    isImpersonating?: boolean;
    impersonatedBy?: string;
  }) {
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: (process.env.JWT_EXPIRATION as any) || '15m',
    });

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: (process.env.JWT_REFRESH_EXPIRATION as any) || '7d',
    });

    return { accessToken, refreshToken };
  }
}
