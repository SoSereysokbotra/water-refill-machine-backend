import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuthController } from '../src/contexts/identity/interface/auth.controller';
import { UsersController } from '../src/contexts/identity/interface/users.controller';
import { AuditLogsController } from '../src/contexts/identity/interface/audit-logs.controller';
import { AuthenticatedUser } from '../src/platform/security/authenticated-user';
import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

describe('Identity Controllers Unit & Contract Tests', () => {
  let authService: any;
  let usersService: any;
  let auditLogService: any;

  beforeEach(() => {
    authService = {
      login: vi.fn(),
      logout: vi.fn(),
    };
    usersService = {
      createUser: vi.fn(),
      listUsers: vi.fn(),
      getUserById: vi.fn(),
      updateUser: vi.fn(),
      setupTotp: vi.fn(),
      verifyAndEnableTotp: vi.fn(),
    };
    auditLogService = {
      queryLogs: vi.fn(),
    };
  });

  describe('AuthController', () => {
    it('POST /v1/auth/login validates body and sets session cookie', async () => {
      const controller = new AuthController(authService, usersService);
      const expiresAt = new Date(Date.now() + 7 * 86400 * 1000);
      authService.login.mockResolvedValue({
        token: 'session_mock123',
        expiresAt,
        user: { id: 'u-1', email: 'admin@wrm.kh', name: 'Admin', role: 'admin' },
      });

      const setCookie = vi.fn();
      const mockReq: any = { ip: '127.0.0.1', headers: { 'user-agent': 'TestAgent' } };
      const mockReply: any = { setCookie };

      const res = await controller.login(
        { email: 'admin@wrm.kh', password: 'SecretPassword123!' },
        mockReq,
        mockReply,
      );

      expect(authService.login).toHaveBeenCalledWith({
        email: 'admin@wrm.kh',
        password: 'SecretPassword123!',
        totpCode: undefined,
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent',
      });
      expect(setCookie).toHaveBeenCalledWith('wrm_session', 'session_mock123', expect.any(Object));
      expect(res.data.token).toBe('session_mock123');
      expect(res.data.user.email).toBe('admin@wrm.kh');
    });

    it('POST /v1/auth/login throws BadRequestException on invalid email', async () => {
      const controller = new AuthController(authService, usersService);
      await expect(
        controller.login({ email: 'not-an-email', password: 'p' }, {} as any, {} as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('POST /v1/auth/logout clears cookie and invalidates session token', async () => {
      const controller = new AuthController(authService, usersService);
      const clearCookie = vi.fn();
      const mockReq: any = {
        headers: { authorization: 'Bearer session_logout123' },
      };
      const mockReply: any = { clearCookie };

      const res = await controller.logout(mockReq, mockReply);
      expect(authService.logout).toHaveBeenCalledWith('session_logout123');
      expect(clearCookie).toHaveBeenCalledWith('wrm_session', { path: '/' });
      expect(res.data.success).toBe(true);
    });

    it('GET /v1/auth/me returns current authenticated user', () => {
      const controller = new AuthController(authService, usersService);
      const currentUser: AuthenticatedUser = {
        id: 'u-1',
        email: 'op@wrm.kh',
        name: 'Operator',
        role: 'operator',
        enabled: true,
      };

      const res = controller.getMe(currentUser);
      expect(res.data).toEqual(currentUser);
    });
  });

  describe('UsersController', () => {
    const adminUser: AuthenticatedUser = {
      id: 'admin-id',
      email: 'admin@wrm.kh',
      name: 'Admin',
      role: 'admin',
      enabled: true,
    };

    it('POST /v1/users creates user with actorId from current user', async () => {
      const controller = new UsersController(usersService);
      usersService.createUser.mockResolvedValue({
        id: 'new-u',
        email: 'newop@wrm.kh',
        name: 'New Op',
        role: UserRole.operator,
      });

      const res = await controller.createUser(
        { email: 'newop@wrm.kh', password: 'Password123!', name: 'New Op', role: 'operator' },
        adminUser,
      );

      expect(usersService.createUser).toHaveBeenCalledWith({
        email: 'newop@wrm.kh',
        password: 'Password123!',
        name: 'New Op',
        role: UserRole.operator,
        actorId: 'admin-id',
      });
      expect(res.data.email).toBe('newop@wrm.kh');
    });

    it('PATCH /v1/users/:id updates user properties', async () => {
      const controller = new UsersController(usersService);
      usersService.updateUser.mockResolvedValue({
        id: 'u-target',
        name: 'Updated Name',
        role: UserRole.operator,
        enabled: false,
      });

      const res = await controller.updateUser(
        'u-target',
        { name: 'Updated Name', role: 'operator', enabled: false },
        adminUser,
      );

      expect(usersService.updateUser).toHaveBeenCalledWith('u-target', {
        name: 'Updated Name',
        role: UserRole.operator,
        enabled: false,
        actorId: 'admin-id',
      });
      expect(res.data.enabled).toBe(false);
    });
  });

  describe('AuditLogsController', () => {
    it('GET /v1/audit-logs returns query results from audit service', async () => {
      const controller = new AuditLogsController(auditLogService);
      const sampleLogs = [
        { id: 'l-1', action: 'price.update', entityType: 'machine', entityId: 'WRM-001' },
      ];
      auditLogService.queryLogs.mockResolvedValue(sampleLogs);

      const res = await controller.getAuditLogs('machine', 'WRM-001', undefined, '10');
      expect(auditLogService.queryLogs).toHaveBeenCalledWith({
        entityType: 'machine',
        entityId: 'WRM-001',
        actorId: undefined,
        limit: 10,
      });
      expect(res.data).toEqual(sampleLogs);
    });
  });
});
