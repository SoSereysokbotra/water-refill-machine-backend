import {
  Injectable,
  Logger,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { verify } from '@node-rs/argon2';
import { PrismaService } from '../../../platform/database/prisma.service';
import { ConfigService } from '../../../platform/config/config.service';
import { RateLimiterService } from '../../../platform/rate-limit/rate-limiter.service';
import { verifyTotp } from './totp.util';
import { AuditLogService } from './audit-log.service';

export interface LoginParams {
  email: string;
  password: string;
  totpCode?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'operator' | 'viewer';
  enabled: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(RateLimiterService) private readonly rateLimiter: RateLimiterService,
    @Inject(AuditLogService) private readonly auditLogService: AuditLogService,
  ) {}

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async login(params: LoginParams) {
    const email = params.email.trim().toLowerCase();
    const rateLimitKey = `auth_login:${params.ipAddress ?? 'unknown'}:${email}`;

    // Rate limiting: 5 attempts per 15 minutes (900 seconds)
    await this.rateLimiter.consume(rateLimitKey, 1, {
      points: 5,
      duration: 900,
      keyPrefix: 'rl_login',
    });

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      this.logger.warn(`Failed login attempt for unknown user: ${email} from ${params.ipAddress}`);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.enabled) {
      throw new UnauthorizedException('Account is disabled. Contact your administrator.');
    }

    const passwordValid = await verify(user.passwordHash, params.password);
    if (!passwordValid) {
      this.logger.warn(`Invalid password for user: ${email} from ${params.ipAddress}`);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Check TOTP if enabled on user
    if (user.totpEnabled) {
      if (!params.totpCode) {
        throw new UnauthorizedException('Two-factor authentication code is required');
      }
      if (!user.totpSecret || !verifyTotp(user.totpSecret, params.totpCode)) {
        throw new UnauthorizedException('Invalid two-factor authentication code');
      }
    }

    // Create session
    const rawToken = `session_${randomBytes(32).toString('hex')}`;
    const tokenHash = this.hashToken(rawToken);

    const ttlDays = this.config.get('SESSION_TTL_DAYS') ?? 7;
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
      },
    });

    await this.auditLogService.record({
      actorId: user.id,
      action: 'user.login',
      entityType: 'session',
      entityId: session.id,
      after: { ip: params.ipAddress, userAgent: params.userAgent },
    });

    return {
      token: rawToken,
      expiresAt,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async logout(token: string) {
    if (!token) return;
    const tokenHash = this.hashToken(token);
    try {
      const session = await this.prisma.session.delete({
        where: { tokenHash },
      });
      await this.auditLogService.record({
        actorId: session.userId,
        action: 'user.logout',
        entityType: 'session',
        entityId: session.id,
      });
    } catch {
      // Ignore if session not found
    }
  }

  async validateSession(token: string): Promise<{ user: AuthenticatedUser; sessionId: string }> {
    if (!token) {
      throw new UnauthorizedException('Missing authentication token');
    }

    const tokenHash = this.hashToken(token);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!session) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    if (session.expiresAt.getTime() < Date.now()) {
      try {
        await this.prisma.session.delete({ where: { id: session.id } });
      } catch {
        // ignore
      }
      throw new UnauthorizedException('Session expired');
    }

    if (!session.user.enabled) {
      throw new UnauthorizedException('Account disabled');
    }

    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        role: session.user.role as 'admin' | 'operator' | 'viewer',
        enabled: session.user.enabled,
      },
      sessionId: session.id,
    };
  }
}
