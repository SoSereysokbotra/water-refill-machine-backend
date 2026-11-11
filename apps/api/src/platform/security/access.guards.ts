import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { ConfigService } from '../config/config.service';

export const ADMIN_KEY_HEADER = 'x-admin-key';

/**
 * Dev-only routes (simulate payment, create test payment, dev dispense, /dev page).
 * Outside APP_ENV=local the route behaves as if it does not exist (404).
 * Invariant: no water without a confirmed ABA payment — simulate must never be reachable in staging/production.
 */
@Injectable()
export class LocalOnlyGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  canActivate(): boolean {
    if (this.config.get('APP_ENV') !== 'local') {
      throw new NotFoundException();
    }
    return true;
  }
}

/**
 * Operator/admin routes until Phase 6 (Identity) replaces this with sessions + roles.
 * - APP_ENV=local: open (development).
 * - staging/production: header X-Admin-Key must equal ADMIN_API_KEY.
 *   If ADMIN_API_KEY is not configured, the routes are disabled (403).
 */
@Injectable()
export class AdminKeyGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.config.get('APP_ENV') === 'local') return true;

    const expected = this.config.get('ADMIN_API_KEY');
    if (!expected) {
      throw new ForbiddenException('Admin API is disabled: ADMIN_API_KEY is not configured');
    }

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const provided = request.headers[ADMIN_KEY_HEADER];
    if (typeof provided !== 'string' || !safeEqual(provided, expected)) {
      throw new UnauthorizedException('Missing or invalid X-Admin-Key header');
    }
    return true;
  }
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual requires equal length; compare lengths without leaking the key
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
