import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import { ConfigService } from '../config/config.service';
import { AuthService } from '../../contexts/identity/application/auth.service';
import { AuthenticatedUser } from './authenticated-user';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ADMIN_KEY_HEADER } from './access.guards';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      cookies?: Record<string, string | undefined>;
      user?: AuthenticatedUser;
      sessionId?: string;
    }>();

    // 1. Try Bearer token or HTTP-only cookie
    const token = this.extractToken(request);
    if (token) {
      const { user, sessionId } = await this.authService.validateSession(token);
      request.user = user;
      request.sessionId = sessionId;
      return true;
    }

    // 2. Try X-Admin-Key (service/migration key)
    const adminKey = request.headers[ADMIN_KEY_HEADER];
    const expectedKey = this.config.get('ADMIN_API_KEY');
    if (typeof adminKey === 'string' && expectedKey && this.safeEqual(adminKey, expectedKey)) {
      request.user = {
        id: 'usr-admin-key',
        email: 'admin-key@system',
        name: 'Service Admin',
        role: 'admin',
        enabled: true,
      };
      return true;
    }

    // 3. Check local environment dev fallback
    const isLocal = this.config.get('APP_ENV') === 'local';
    const enforceAuth =
      this.config.get('AUTH_ENFORCE_IN_LOCAL') ||
      request.headers['x-enforce-auth'] === 'true';

    if (isLocal && !enforceAuth) {
      request.user = {
        id: 'usr-dev-admin',
        email: 'dev@wrm.local',
        name: 'Local Dev Admin',
        role: 'admin',
        enabled: true,
      };
      return true;
    }

    throw new UnauthorizedException('Authentication required');
  }

  private extractToken(request: {
    headers: Record<string, string | string[] | undefined>;
    cookies?: Record<string, string | undefined>;
  }): string | null {
    const authHeader = request.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7).trim();
    }

    if (request.cookies?.wrm_session) {
      return request.cookies.wrm_session;
    }

    return null;
  }

  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
