import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigAckV1, NormalizedHeartbeat } from '@wrm/contracts';
import { PrismaTransaction, UnitOfWork } from '../../../platform/database/unit-of-work';
import { OutboxService } from '../../../platform/outbox/outbox.service';
import { Clock } from '../../../shared-kernel';
import { configRejectedEvent, machineCameOnlineEvent, machineWentOfflineEvent } from './fleet.events';

/**
 * Machine presence (Phase 4 task 2; minimal version added in Phase 3):
 * - heartbeat: pending_outcomes (refund guards), last_seen_at, firmware, STM32 state
 * - online '1' / '0' (Last Will) and the fleet-offline sweep -> MachineCameOnline / MachineWentOffline
 * - config/ack: error -> fleet.ConfigRejected
 * Unknown machines are never auto-registered.
 */
@Injectable()
export class MachinePresenceService {
  private readonly logger = new Logger(MachinePresenceService.name);

  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject('Clock') private readonly clock: Clock,
  ) {}

  async recordHeartbeat(machineId: string, hb: NormalizedHeartbeat, raw: unknown): Promise<void> {
    const now = this.clock.now();
    await this.uow.run(async (tx) => {
      const known = await this.markSeen(tx, machineId, now);
      if (!known) return;
      await tx.machine.update({
        where: { id: machineId },
        data: {
          pendingOutcomes: hb.pendingOutcomes,
          ...(hb.fw !== undefined ? { firmware: hb.fw } : {}),
          ...(hb.stm32State !== undefined ? { lastStm32State: hb.stm32State } : {}),
        },
      });
      await tx.heartbeat.create({ data: { machineId, data: (raw ?? {}) as object, at: now } });
    });
  }

  async recordOnline(machineId: string, online: boolean): Promise<void> {
    const now = this.clock.now();
    await this.uow.run(async (tx) => {
      if (online) {
        await this.markSeen(tx, machineId, now);
        return;
      }
      const res = await tx.machine.updateMany({ where: { id: machineId, online: true }, data: { online: false } });
      if (res.count === 1) {
        await this.outbox.add([machineWentOfflineEvent({ machineId, at: now }, now)], tx, 'Machine', machineId);
      }
    });
  }

  /** Sweep: online machines silent for MACHINE_OFFLINE_AFTER_SECONDS go offline (Architecture §17). */
  async markSilentMachinesOffline(offlineAfterSeconds: number): Promise<string[]> {
    const now = this.clock.now();
    const cutoff = new Date(now.getTime() - offlineAfterSeconds * 1000);
    return this.uow.run(async (tx) => {
      const silent = await tx.machine.findMany({
        where: { online: true, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }] },
        select: { id: true },
      });
      const wentOffline: string[] = [];
      for (const { id } of silent) {
        // conditional update: a heartbeat that arrived meanwhile wins
        const res = await tx.machine.updateMany({
          where: { id, online: true, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }] },
          data: { online: false },
        });
        if (res.count === 1) {
          wentOffline.push(id);
          await this.outbox.add([machineWentOfflineEvent({ machineId: id, at: now }, now)], tx, 'Machine', id);
        }
      }
      return wentOffline;
    });
  }

  async recordConfigAck(machineId: string, ack: ConfigAckV1): Promise<void> {
    const now = this.clock.now();
    await this.uow.run(async (tx) => {
      const known = await this.markSeen(tx, machineId, now);
      if (!known) return;
      if (ack.status === 'ok') {
        this.logger.log(`Machine ${machineId} applied its config (CFG,OK)`);
        return;
      }
      const fault = ack.fault ?? 'UNKNOWN';
      this.logger.warn(`Machine ${machineId} rejected its config: ${fault}`);
      await this.outbox.add([configRejectedEvent({ machineId, fault }, now)], tx, 'Machine', machineId);
    });
  }

  /** last_seen_at = now, online = true; raises MachineCameOnline on the offline -> online edge. */
  private async markSeen(tx: PrismaTransaction, machineId: string, now: Date): Promise<boolean> {
    const cameOnline = await tx.machine.updateMany({
      where: { id: machineId, online: false },
      data: { online: true, lastSeenAt: now },
    });
    if (cameOnline.count === 1) {
      await this.outbox.add([machineCameOnlineEvent({ machineId, at: now }, now)], tx, 'Machine', machineId);
      return true;
    }
    const seen = await tx.machine.updateMany({ where: { id: machineId }, data: { lastSeenAt: now } });
    if (seen.count === 0) {
      this.logger.warn(`Message from unknown machine ${machineId} ignored (no auto-register)`);
      return false;
    }
    return true;
  }
}
