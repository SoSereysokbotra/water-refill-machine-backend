import { Injectable, Logger, Inject, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { PrismaService } from '../../../platform/database/prisma.service';
import { UserRole } from '@prisma/client';
import { AuditLogService } from './audit-log.service';
import { generateBase32Secret, getTotpUri, verifyTotp } from './totp.util';

export interface CreateUserInput {
  email: string;
  password: string;
  name: string;
  role?: UserRole;
  actorId?: string;
}

export interface UpdateUserInput {
  name?: string;
  role?: UserRole;
  enabled?: boolean;
  actorId?: string;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly auditLogService: AuditLogService,
  ) {}

  async createUser(input: CreateUserInput) {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException(`User with email ${email} already exists`);
    }

    if (!input.password || input.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long');
    }

    const passwordHash = await hash(input.password);
    const role = input.role ?? UserRole.viewer;

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        name: input.name.trim(),
        role,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        enabled: true,
        totpEnabled: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.auditLogService.record({
      actorId: input.actorId ?? 'system',
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      after: { email: user.email, name: user.name, role: user.role },
    });

    return user;
  }

  async listUsers(limit = 50) {
    return this.prisma.user.findMany({
      take: Math.min(limit, 100),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        enabled: true,
        totpEnabled: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        enabled: true,
        totpEnabled: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  async updateUser(id: string, input: UpdateUserInput) {
    const existing = await this.getUserById(id);

    const data: { name?: string; role?: UserRole; enabled?: boolean } = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.role !== undefined) data.role = input.role;
    if (input.enabled !== undefined) data.enabled = input.enabled;

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        enabled: true,
        totpEnabled: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.auditLogService.record({
      actorId: input.actorId ?? 'system',
      action: 'user.update',
      entityType: 'user',
      entityId: id,
      before: existing,
      after: updated,
    });

    return updated;
  }

  async setupTotp(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    const secret = generateBase32Secret(20);
    const uri = getTotpUri('WRM Water Machine', user.email, secret);

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: secret, totpEnabled: false },
    });

    return { secret, uri };
  }

  async verifyAndEnableTotp(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.totpSecret) {
      throw new BadRequestException('TOTP setup has not been initiated for this user');
    }

    const valid = verifyTotp(user.totpSecret, code);
    if (!valid) {
      throw new BadRequestException('Invalid TOTP verification code');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: true },
    });

    await this.auditLogService.record({
      actorId: userId,
      action: 'user.totp_enabled',
      entityType: 'user',
      entityId: userId,
    });

    return { success: true };
  }
}
