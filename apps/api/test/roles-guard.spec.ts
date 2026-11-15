import { describe, expect, it } from 'vitest';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../src/platform/security/roles.guard';
import { SessionAuthGuard } from '../src/platform/security/session-auth.guard';
import { ConfigService } from '../src/platform/config/config.service';
import { AuthenticatedUser } from '../src/platform/security/authenticated-user';

function mockExecutionContext(params: {
  user?: AuthenticatedUser;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  requiredRoles?: string[];
  isPublic?: boolean;
}): { context: ExecutionContext; reflector: Reflector } {
  const reflector = {
    getAllAndOverride: (key: string) => {
      if (key === 'roles') return params.requiredRoles;
      if (key === 'isPublic') return params.isPublic;
      return undefined;
    },
  } as unknown as Reflector;

  const request = {
    user: params.user,
    headers: params.headers ?? {},
    cookies: params.cookies ?? {},
  };

  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;

  return { context, reflector };
}

describe('RolesGuard (RBAC Hierarchy)', () => {
  const viewer: AuthenticatedUser = { id: 'u-1', email: 'v@wrm.kh', name: 'Viewer', role: 'viewer', enabled: true };
  const operator: AuthenticatedUser = { id: 'u-2', email: 'o@wrm.kh', name: 'Operator', role: 'operator', enabled: true };
  const admin: AuthenticatedUser = { id: 'u-3', email: 'a@wrm.kh', name: 'Admin', role: 'admin', enabled: true };

  it('allows access when no roles are required on endpoint', () => {
    const { context, reflector } = mockExecutionContext({ user: viewer });
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws UnauthorizedException when user is not authenticated', () => {
    const { context, reflector } = mockExecutionContext({ requiredRoles: ['viewer'] });
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  describe('Endpoint requiring role: viewer', () => {
    it('allows viewer, operator, and admin', () => {
      const guard = (user: AuthenticatedUser) => {
        const { context, reflector } = mockExecutionContext({ user, requiredRoles: ['viewer'] });
        return new RolesGuard(reflector).canActivate(context);
      };

      expect(guard(viewer)).toBe(true);
      expect(guard(operator)).toBe(true);
      expect(guard(admin)).toBe(true);
    });
  });

  describe('Endpoint requiring role: operator', () => {
    it('denies viewer with ForbiddenException', () => {
      const { context, reflector } = mockExecutionContext({ user: viewer, requiredRoles: ['operator'] });
      expect(() => new RolesGuard(reflector).canActivate(context)).toThrow(ForbiddenException);
    });

    it('allows operator and admin', () => {
      const guard = (user: AuthenticatedUser) => {
        const { context, reflector } = mockExecutionContext({ user, requiredRoles: ['operator'] });
        return new RolesGuard(reflector).canActivate(context);
      };

      expect(guard(operator)).toBe(true);
      expect(guard(admin)).toBe(true);
    });
  });

  describe('Endpoint requiring role: admin', () => {
    it('denies viewer with ForbiddenException', () => {
      const { context, reflector } = mockExecutionContext({ user: viewer, requiredRoles: ['admin'] });
      expect(() => new RolesGuard(reflector).canActivate(context)).toThrow(ForbiddenException);
    });

    it('denies operator with ForbiddenException', () => {
      const { context, reflector } = mockExecutionContext({ user: operator, requiredRoles: ['admin'] });
      expect(() => new RolesGuard(reflector).canActivate(context)).toThrow(ForbiddenException);
    });

    it('allows admin', () => {
      const { context, reflector } = mockExecutionContext({ user: admin, requiredRoles: ['admin'] });
      expect(new RolesGuard(reflector).canActivate(context)).toBe(true);
    });
  });
});

describe('SessionAuthGuard', () => {
  const mockConfig = (values: Record<string, unknown> = {}) =>
    ({ get: (k: string) => values[k] }) as unknown as ConfigService;

  const mockAuthService = (sessionResult?: { user: AuthenticatedUser; sessionId: string }) =>
    ({
      validateSession: async () => {
        if (!sessionResult) throw new UnauthorizedException('Invalid or expired session');
        return sessionResult;
      },
    }) as any;

  it('allows public routes marked with @Public()', async () => {
    const { context, reflector } = mockExecutionContext({ isPublic: true });
    const guard = new SessionAuthGuard(reflector, mockConfig({ APP_ENV: 'production' }), mockAuthService());
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('authenticates with valid Bearer token', async () => {
    const user: AuthenticatedUser = { id: 'u-1', email: 'o@wrm.kh', name: 'Op', role: 'operator', enabled: true };
    const { context, reflector } = mockExecutionContext({
      headers: { authorization: 'Bearer session_validtoken123' },
    });
    const guard = new SessionAuthGuard(reflector, mockConfig({ APP_ENV: 'production' }), mockAuthService({ user, sessionId: 's-1' }));
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('authenticates with valid wrm_session cookie', async () => {
    const user: AuthenticatedUser = { id: 'u-1', email: 'o@wrm.kh', name: 'Op', role: 'operator', enabled: true };
    const { context, reflector } = mockExecutionContext({
      cookies: { wrm_session: 'session_validcookie123' },
    });
    const guard = new SessionAuthGuard(reflector, mockConfig({ APP_ENV: 'production' }), mockAuthService({ user, sessionId: 's-1' }));
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('authenticates with valid X-Admin-Key as admin', async () => {
    const adminKey = 'k'.repeat(40);
    const { context, reflector } = mockExecutionContext({
      headers: { 'x-admin-key': adminKey },
    });
    const guard = new SessionAuthGuard(
      reflector,
      mockConfig({ APP_ENV: 'production', ADMIN_API_KEY: adminKey }),
      mockAuthService(),
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects unauthenticated request in production', async () => {
    const { context, reflector } = mockExecutionContext({});
    const guard = new SessionAuthGuard(reflector, mockConfig({ APP_ENV: 'production' }), mockAuthService());
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects unauthenticated request when auth is strictly enforced', async () => {
    const { context, reflector } = mockExecutionContext({
      headers: { 'x-enforce-auth': 'true' },
    });
    const guard = new SessionAuthGuard(reflector, mockConfig({ APP_ENV: 'local' }), mockAuthService());
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
