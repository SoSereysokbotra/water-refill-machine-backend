import { Inject, Module, OnModuleInit, Optional } from '@nestjs/common';
import { SweepsScheduler } from '../../platform/sweeps/sweeps.scheduler';
import { ReportingSweep } from './application/reporting.sweep';
import { ReportingService } from './application/reporting.service';
import { ReportsController } from './interface/reports.controller';

@Module({
  controllers: [ReportsController],
  providers: [ReportingService, ReportingSweep],
  exports: [ReportingService],
})
export class ReportingModule implements OnModuleInit {
  constructor(
    @Inject(ReportingSweep) private readonly sweep: ReportingSweep,
    @Optional() @Inject(SweepsScheduler) private readonly scheduler?: SweepsScheduler,
  ) {}

  onModuleInit(): void {
    if (this.scheduler) {
      this.scheduler.registerSchedule({
        name: this.sweep.name,
        everyMs: this.sweep.intervalMs,
        processor: async () => {
          await this.sweep.execute();
        },
      });
    }
  }
}
