import { Inject, Injectable, Logger } from '@nestjs/common';
import { Alert, AlertStatus } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { PrismaTransaction, UnitOfWork } from '../../../platform/database/unit-of-work';
import { OutboxService } from '../../../platform/outbox/outbox.service';
import { Clock, createDomainEvent, NotFoundError } from '../../../shared-kernel';
import { AlertDefinition, MERGE_WINDOW_MS, shouldMergeAlert } from './rules/monitoring.rules';

export interface AlertRaisedPayload {
  alertId: string;
  type: string;
  severity: string;
  message: string;
  machineId?: string | null;
  count: number;
}

export interface AlertResolvedPayload {
  alertId: string;
  type: string;
  severity: string;
  message: string;
  machineId?: string | null;
  resolvedBy: string;
}

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject('Clock') private readonly clock: Clock,
  ) {}

  /**
   * Raises an alert within a transaction.
   * - Active/acknowledged alert with the same dedupeKey: merge (count + 1, lastSeenAt), no new notification.
   * - Alert resolved < 10 min ago: the problem is back, so the SAME alert is reopened (count + 1, status active)
   *   and AlertRaised is emitted again. Merging silently into a resolved alert would leave e.g. an offline
   *   machine with a closed alert and nobody told.
   * - Otherwise: a new alert + AlertRaised.
   */
  async raiseAlert(tx: PrismaTransaction, def: AlertDefinition): Promise<Alert> {
    const now = this.clock.now();
    const tenMinAgo = new Date(now.getTime() - MERGE_WINDOW_MS);

    // Look for active/acknowledged or recently resolved alert with the same dedupeKey
    const existing = await tx.alert.findFirst({
      where: {
        dedupeKey: def.dedupeKey,
        OR: [
          { status: { in: ['active', 'acknowledged'] } },
          { status: 'resolved', resolvedAt: { gte: tenMinAgo } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing && shouldMergeAlert(existing, now)) {
      if (existing.status !== 'resolved') {
        this.logger.log(`Merging alert for dedupeKey [${def.dedupeKey}] (existing alert ${existing.id}, count ${existing.count + 1})`);
        return tx.alert.update({
          where: { id: existing.id },
          data: {
            count: { increment: 1 },
            lastSeenAt: now,
          },
        });
      }

      const reopened = await tx.alert.update({
        where: { id: existing.id },
        data: {
          status: 'active',
          resolvedAt: null,
          resolvedBy: null,
          acknowledgedAt: null,
          acknowledgedBy: null,
          message: def.message,
          count: { increment: 1 },
          lastSeenAt: now,
        },
      });
      await this.emitRaised(tx, reopened, now);
      this.logger.warn(`Alert reopened: [${reopened.severity}] ${reopened.type} (${reopened.id}) on ${reopened.machineId ?? 'system'}, count ${reopened.count}`);
      return reopened;
    }

    const created = await tx.alert.create({
      data: {
        type: def.type,
        severity: def.severity,
        message: def.message,
        machineId: def.machineId ?? null,
        dedupeKey: def.dedupeKey,
        status: 'active',
        count: 1,
        lastSeenAt: now,
        createdAt: now,
      },
    });

    await this.emitRaised(tx, created, now);
    this.logger.warn(`Alert raised: [${created.severity}] ${created.type} (${created.id}) on ${created.machineId ?? 'system'}`);
    return created;
  }

  private async emitRaised(tx: PrismaTransaction, alert: Alert, now: Date): Promise<void> {
    await this.outbox.add(
      [
        createDomainEvent<AlertRaisedPayload>(
          'monitoring.AlertRaised',
          {
            alertId: alert.id,
            type: alert.type,
            severity: alert.severity,
            message: alert.message,
            machineId: alert.machineId,
            count: alert.count,
          },
          { occurredAt: now },
        ),
      ],
      tx,
      'Alert',
      alert.id,
    );
  }

  /**
   * Resolves alerts matching dedupeKey within a transaction.
   * Emits monitoring.AlertResolved for each resolved alert.
   */
  async resolveAlert(
    tx: PrismaTransaction,
    params: { dedupeKey: string; resolvedBy?: string },
  ): Promise<number> {
    const now = this.clock.now();
    const resolvedBy = params.resolvedBy ?? 'system';

    const activeAlerts = await tx.alert.findMany({
      where: {
        dedupeKey: params.dedupeKey,
        status: { in: ['active', 'acknowledged'] },
      },
    });

    if (activeAlerts.length === 0) {
      return 0;
    }

    for (const alert of activeAlerts) {
      await tx.alert.update({
        where: { id: alert.id },
        data: {
          status: 'resolved',
          resolvedBy,
          resolvedAt: now,
        },
      });

      await this.outbox.add(
        [
          createDomainEvent<AlertResolvedPayload>(
            'monitoring.AlertResolved',
            {
              alertId: alert.id,
              type: alert.type,
              severity: alert.severity,
              message: alert.message,
              machineId: alert.machineId,
              resolvedBy,
            },
            { occurredAt: now },
          ),
        ],
        tx,
        'Alert',
        alert.id,
      );
      this.logger.log(`Alert resolved: [${alert.type}] (${alert.id}) by ${resolvedBy}`);
    }

    return activeAlerts.length;
  }

  /**
   * Resolves multiple dedupeKeys in a single transaction.
   */
  async resolveAlerts(
    tx: PrismaTransaction,
    params: { dedupeKeys: string[]; resolvedBy?: string },
  ): Promise<number> {
    let count = 0;
    for (const key of params.dedupeKeys) {
      count += await this.resolveAlert(tx, { dedupeKey: key, resolvedBy: params.resolvedBy });
    }
    return count;
  }

  /**
   * REST: Acknowledge an alert by ID.
   */
  async acknowledgeAlert(id: string, actorId: string): Promise<Alert> {
    const now = this.clock.now();
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) {
      throw new NotFoundError(undefined, `Alert ${id} not found`);
    }

    return this.prisma.alert.update({
      where: { id },
      data: {
        status: 'acknowledged',
        acknowledgedBy: actorId,
        acknowledgedAt: now,
      },
    });
  }

  /**
   * REST: Resolve an alert by ID.
   */
  async resolveAlertById(id: string, actorId: string): Promise<Alert> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const alert = await tx.alert.findUnique({ where: { id } });
      if (!alert) {
        throw new NotFoundError(undefined, `Alert ${id} not found`);
      }

      if (alert.status === 'resolved') {
        return alert;
      }

      const updated = await tx.alert.update({
        where: { id },
        data: {
          status: 'resolved',
          resolvedBy: actorId,
          resolvedAt: now,
        },
      });

      await this.outbox.add(
        [
          createDomainEvent<AlertResolvedPayload>(
            'monitoring.AlertResolved',
            {
              alertId: updated.id,
              type: updated.type,
              severity: updated.severity,
              message: updated.message,
              machineId: updated.machineId,
              resolvedBy: actorId,
            },
            { occurredAt: now },
          ),
        ],
        tx,
        'Alert',
        updated.id,
      );

      return updated;
    });
  }

  /**
   * REST: List alerts with optional status filter.
   */
  async listAlerts(status?: AlertStatus): Promise<Alert[]> {
    return this.prisma.alert.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
    });
  }
}
