import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '../../../platform/config/config.service';
import { BaseSweep } from '../../../platform/sweeps/sweep.base';
import { MachinePresenceService } from './machine-presence.service';

/** `sweep.fleet-offline` (Plan §C5): every 30 s, machines silent for MACHINE_OFFLINE_AFTER_SECONDS go offline. */
@Injectable()
export class FleetOfflineSweep extends BaseSweep<number> {
  constructor(
    @Inject(MachinePresenceService) private readonly presence: MachinePresenceService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {
    super('fleet-offline', 30000);
  }

  // One batch item: the whole check runs as a single conditional update per machine
  async findDueItems(): Promise<number[]> {
    return [this.config.get('MACHINE_OFFLINE_AFTER_SECONDS')];
  }

  async processItem(offlineAfterSeconds: number): Promise<void> {
    const ids = await this.presence.markSilentMachinesOffline(offlineAfterSeconds);
    if (ids.length > 0) this.logger.warn(`Machines went offline: ${ids.join(', ')}`);
  }
}
