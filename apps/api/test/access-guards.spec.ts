import { describe, expect, it } from 'vitest';
import { ExecutionContext, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AdminKeyGuard, LocalOnlyGuard } from '../src/platform/security/access.guards';
import { ConfigService } from '../src/platform/config/config.service';
import { configSchema } from '../src/platform/config/config.schema';

const KEY = 'k'.repeat(40);

function config(values: Record<string, unknown>): ConfigService {
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

function ctx(headers: Record<string, string> = {}): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ headers }) }) } as unknown as ExecutionContext;
}

describe('LocalOnlyGuard (Plan §C7: dev endpoints local only)', () => {
  it('allows in local', () => {
    expect(new LocalOnlyGuard(config({ APP_ENV: 'local' })).canActivate()).toBe(true);
  });

  it.each(['staging', 'production'])('hides the route (404) in %s', (env) => {
    expect(() => new LocalOnlyGuard(config({ APP_ENV: env })).canActivate()).toThrow(NotFoundException);
  });
});

describe('AdminKeyGuard (operator endpoints until Phase 6)', () => {
  it('allows without key in local', () => {
    expect(new AdminKeyGuard(config({ APP_ENV: 'local' })).canActivate(ctx())).toBe(true);
  });

  it('refuses (403) when ADMIN_API_KEY is not configured outside local', () => {
    const guard = new AdminKeyGuard(config({ APP_ENV: 'production' }));
    expect(() => guard.canActivate(ctx({ 'x-admin-key': KEY }))).toThrow(ForbiddenException);
  });

  it('refuses (401) a missing or wrong key', () => {
    const guard = new AdminKeyGuard(config({ APP_ENV: 'production', ADMIN_API_KEY: KEY }));
    expect(() => guard.canActivate(ctx())).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx({ 'x-admin-key': 'wrong' }))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx({ 'x-admin-key': 'k'.repeat(39) + 'x' }))).toThrow(UnauthorizedException);
  });

  it('allows the correct key', () => {
    const guard = new AdminKeyGuard(config({ APP_ENV: 'staging', ADMIN_API_KEY: KEY }));
    expect(guard.canActivate(ctx({ 'x-admin-key': KEY }))).toBe(true);
  });
});

describe('Config safety', () => {
  it('rejects PAYWAY_MODE=mock in production', () => {
    expect(() => configSchema.parse({ APP_ENV: 'production', PAYWAY_MODE: 'mock' })).toThrow();
  });

  it('rejects an ADMIN_API_KEY shorter than 32 chars', () => {
    expect(() => configSchema.parse({ ADMIN_API_KEY: 'short' })).toThrow();
  });
});
