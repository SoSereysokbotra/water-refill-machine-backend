import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { SweepsScheduler } from '../../platform/sweeps/sweeps.scheduler';
import { SystemClock } from '../../shared-kernel';
import {
  AlertService,
  MonitoringSweep,
  TELEGRAM_CLIENT,
  TelegramClient,
  TelegramNotifierService,
} from './application';
import { AlertsController, MonitoringOutboxHandlers } from './interface';

@Module({
  controllers: [AlertsController],
  providers: [
    { provide: 'Clock', useClass: SystemClock },
    AlertService,
    MonitoringSweep,
    TelegramNotifierService,
    MonitoringOutboxHandlers,
    { provide: TELEGRAM_CLIENT, useClass: TelegramClient },
  ],
  exports: [AlertService, TELEGRAM_CLIENT],
})
export class MonitoringModule implements OnModuleInit {
  constructor(
    @Inject(SweepsScheduler) private readonly sweepsScheduler: SweepsScheduler,
    @Inject(MonitoringSweep) private readonly monitoringSweep: MonitoringSweep,
  ) {}

  onModuleInit(): void {
    this.sweepsScheduler.registerSchedule({
      name: this.monitoringSweep.name,
      everyMs: 60000,
      processor: async () => {
        await this.monitoringSweep.execute();
      },
    });
  }
}
