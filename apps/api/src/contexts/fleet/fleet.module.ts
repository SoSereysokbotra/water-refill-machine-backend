import { Global, Inject, Module, OnModuleInit } from '@nestjs/common';
import { SweepsScheduler } from '../../platform/sweeps/sweeps.scheduler';
import { SystemClock } from '../../shared-kernel';
import { FLEET_MACHINE_PRICING, FleetOfflineSweep, MachinePresenceService, MachinesService } from './application';
import { FleetMqttConsumer, FleetOutboxHandlers, MachinesController } from './interface';

// Global so other contexts get the public port (FLEET_MACHINE_PRICING) without importing Fleet's module file
@Global()
@Module({
  controllers: [MachinesController],
  providers: [
    { provide: 'Clock', useClass: SystemClock },
    MachinesService,
    MachinePresenceService,
    FleetOfflineSweep,
    FleetMqttConsumer,
    FleetOutboxHandlers,
    // Public port for other contexts (Payments prices a payment through it)
    { provide: FLEET_MACHINE_PRICING, useExisting: MachinesService },
  ],
  exports: [FLEET_MACHINE_PRICING],
})
export class FleetModule implements OnModuleInit {
  constructor(
    @Inject(SweepsScheduler) private readonly scheduler: SweepsScheduler,
    @Inject(FleetOfflineSweep) private readonly offlineSweep: FleetOfflineSweep,
  ) {}

  onModuleInit(): void {
    this.scheduler.registerSchedule({
      name: this.offlineSweep.name,
      everyMs: 30000,
      processor: async () => {
        await this.offlineSweep.execute();
      },
    });
  }
}
