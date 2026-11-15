import { describe, expect, it, vi, beforeEach } from 'vitest';
import { hash } from '@node-rs/argon2';
import { UsersService } from '../src/contexts/identity/application/users.service';
import { AuthService } from '../src/contexts/identity/application/auth.service';
import { AuditLogService } from '../src/contexts/identity/application/audit-log.service';
import { UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

describe('Identity Services Unit Tests', () => {
  let mockPrisma: any;
  let mockAudit: any;
  let mockConfig: any;
  let mockRateLimiter: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      session: {
        create: vi.fn(),
        findUnique: vi.fn(),
        delete: vi.fn().mockResolvedValue({}),
      },
      auditLog: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
    };

    mockAudit = {
      record: vi.fn().mockResolvedValue(undefined),
      queryLogs: vi.fn().mockResolvedValue([]),
    };

    mockConfig = {
      get: vi.fn((k: string) => {
        if (k === 'SESSION_TTL_DAYS') return 7;
        return undefined;
      }),
    };

    mockRateLimiter = {
      consume: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe('UsersService', () => {
    it('creates user with hashed password and logs audit action', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockImplementation((args: any) => ({
        id: 'u-123',
        ...args.data,
      }));

      const service = new UsersService(mockPrisma, mockAudit);
      const user = await service.createUser({
        email: 'operator@wrm.kh',
        password: 'Password123!',
        name: 'Sokha Operator',
        role: UserRole.operator,
        actorId: 'admin-1',
      });

      expect(user.id).toBe('u-123');
      expect(user.email).toBe('operator@wrm.kh');
      expect(mockPrisma.user.create).toHaveBeenCalledOnce();
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'user.create',
          entityType: 'user',
          actorId: 'admin-1',
        }),
      );
    });

    it('rejects duplicate email with ConflictException', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-existing' });
      const service = new UsersService(mockPrisma, mockAudit);

      await expect(
        service.createUser({
          email: 'dup@wrm.kh',
          password: 'Password123!',
          name: 'Dup User',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects short passwords (<8 chars)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const service = new UsersService(mockPrisma, mockAudit);

      await expect(
        service.createUser({
          email: 'short@wrm.kh',
          password: '123',
          name: 'Short Pass',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('AuthService', () => {
    it('authenticates valid email and password, creating a session', async () => {
      const passwordHash = await hash('ValidPassword123!');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        email: 'admin@wrm.kh',
        name: 'Admin User',
        passwordHash,
        role: 'admin',
        enabled: true,
        totpEnabled: false,
      });

      mockPrisma.session.create.mockImplementation((args: any) => ({
        id: 'sess-1',
        ...args.data,
      }));

      const authService = new AuthService(mockPrisma, mockConfig, mockRateLimiter, mockAudit);

      const result = await authService.login({
        email: 'admin@wrm.kh',
        password: 'ValidPassword123!',
        ipAddress: '127.0.0.1',
      });

      expect(result.token).toMatch(/^session_[a-f0-9]{64}$/);
      expect(result.user.email).toBe('admin@wrm.kh');
      expect(result.user.role).toBe('admin');
      expect(mockPrisma.session.create).toHaveBeenCalledOnce();
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'user.login',
          entityType: 'session',
        }),
      );
    });

    it('rejects incorrect password with UnauthorizedException', async () => {
      const passwordHash = await hash('CorrectPassword!');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        email: 'user@wrm.kh',
        passwordHash,
        enabled: true,
      });

      const authService = new AuthService(mockPrisma, mockConfig, mockRateLimiter, mockAudit);

      await expect(
        authService.login({
          email: 'user@wrm.kh',
          password: 'WrongPassword!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects disabled accounts with UnauthorizedException', async () => {
      const passwordHash = await hash('ValidPass123!');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-disabled',
        email: 'disabled@wrm.kh',
        passwordHash,
        enabled: false,
      });

      const authService = new AuthService(mockPrisma, mockConfig, mockRateLimiter, mockAudit);

      await expect(
        authService.login({
          email: 'disabled@wrm.kh',
          password: 'ValidPass123!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('validates active session and rejects expired session', async () => {
      const authService = new AuthService(mockPrisma, mockConfig, mockRateLimiter, mockAudit);
      const rawToken = 'session_test123';
      const tokenHash = authService.hashToken(rawToken);

      // Active session
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 's-active',
        tokenHash,
        expiresAt: new Date(Date.now() + 100_000),
        user: { id: 'u-1', email: 'a@w.kh', name: 'A', role: 'admin', enabled: true },
      });

      const validRes = await authService.validateSession(rawToken);
      expect(validRes.user.email).toBe('a@w.kh');

      // Expired session
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 's-expired',
        tokenHash,
        expiresAt: new Date(Date.now() - 1000),
        user: { id: 'u-1', email: 'a@w.kh', enabled: true },
      });

      await expect(authService.validateSession(rawToken)).rejects.toThrow('Session expired');
    });
  });

  describe('AuditLogService', () => {
    it('records immutable audit row in database', async () => {
      const auditService = new AuditLogService(mockPrisma);
      await auditService.record({
        actorId: 'operator-1',
        action: 'refund.claim',
        entityType: 'refund_case',
        entityId: 'tran-123',
        reason: 'Customer requested',
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: 'operator-1',
          action: 'refund.claim',
          entityType: 'refund_case',
          entityId: 'tran-123',
          reason: 'Customer requested',
        }),
      });
    });
  });
});
