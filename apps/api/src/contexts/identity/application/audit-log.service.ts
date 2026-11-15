import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { AuditLogEntry, AuditLoggerPort } from './public/audit-logger.port';
import { Prisma } from '@prisma/client';

export interface QueryAuditLogsParams {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  limit?: number;
}

@Injectable()
export class AuditLogService implements AuditLoggerPort {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(entry: AuditLogEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          before: entry.before !== undefined ? (entry.before as Prisma.InputJsonValue) : Prisma.JsonNull,
          after: entry.after !== undefined ? (entry.after as Prisma.InputJsonValue) : Prisma.JsonNull,
          reason: entry.reason ?? null,
        },
      });
      this.logger.log(`Audit: [${entry.action}] on ${entry.entityType}:${entry.entityId} by ${entry.actorId}`);
    } catch (err: unknown) {
      this.logger.error(`Failed to record audit log: ${(err as Error).message}`, (err as Error).stack);
      // Audit failure shouldn't silently corrupt business transactions, but we rethrow if strict
      throw err;
    }
  }

  async queryLogs(params: QueryAuditLogsParams = {}) {
    const limit = Math.min(params.limit ?? 50, 100);
    const where: Prisma.AuditLogWhereInput = {};

    if (params.entityType) where.entityType = params.entityType;
    if (params.entityId) where.entityId = params.entityId;
    if (params.actorId) where.actorId = params.actorId;

    return this.prisma.auditLog.findMany({
      where,
      orderBy: { at: 'desc' },
      take: limit,
    });
  }
}
