import { Inject, Injectable, Logger } from '@nestjs/common';
import { NormalizedHeartbeat } from '@wrm/contracts';
import { PrismaService } from '../../../platform/database/prisma.service';
import { Clock } from '../../../shared-kernel';

/**
 * Minimal machine presence (pulled forward from Phase 4 so the Phase 3 refund guards work):
 * records heartbeats and the online flag on `machines`.
 * - pending_outcomes: results the ESP32 still holds in NVS -> blocks refunds (Plan §C1)
 * - last_seen_at: proves the machine was online after a payment -> required for DISPENSE_UNKNOWN escalation
 * Provisioning, config and the offline sweep stay in Phase 4.
 */
@Injectable()
export class MachinePresenceService {
  private readonly logger = new Logger(MachinePresenceService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject('Clock') private readonly clock: Clock,
  ) {}

  async recordHeartbeat(machineId: string, hb: NormalizedHeartbeat, raw: unknown): Promise<void> {
    const now = this.clock.now();
    const updated = await this.prisma.machine.updateMany({
      where: { id: machineId },
      data: {
        lastSeenAt: now,
        online: true,
        pendingOutcomes: hb.pendingOutcomes,
        ...(hb.fw !== undefined ? { firmware: hb.fw } : {}),
        ...(hb.stm32State !== undefined ? { lastStm32State: hb.stm32State } : {}),
      },
    });
    if (updated.count === 0) {
      // Phase 4 rule: never auto-register unknown machines
      this.logger.warn(`Heartbeat from unknown machine ${machineId} ignored`);
      return;
    }
    await this.prisma.heartbeat.create({ data: { machineId, data: (raw ?? {}) as object, at: now } });
  }

  async recordOnline(machineId: string, online: boolean): Promise<void> {
    const now = this.clock.now();
    const updated = await this.prisma.machine.updateMany({
      where: { id: machineId },
      data: online ? { online: true, lastSeenAt: now } : { online: false },
    });
    if (updated.count === 0) {
      this.logger.warn(`Online status from unknown machine ${machineId} ignored`);
    }
  }
}
