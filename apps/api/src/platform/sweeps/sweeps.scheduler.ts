import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { QueueService } from '../queues/queue.service';
import { ConfigService } from '../config/config.service';
import { Queue } from 'bullmq';

export interface RepeatableScheduleDef {
  name: string;
  everyMs?: number;
  cronPattern?: string;
  processor: () => Promise<void>;
}

@Injectable()
export class SweepsScheduler implements OnModuleInit {
  private readonly logger = new Logger(SweepsScheduler.name);
  private sweepQueue!: Queue;
  private readonly registeredSchedules: RepeatableScheduleDef[] = [];

  constructor(
    private readonly queues: QueueService,
    private readonly config: ConfigService,
  ) {}

  registerSchedule(schedule: RepeatableScheduleDef): void {
    this.registeredSchedules.push(schedule);
  }

  async onModuleInit() {
    const runMode = this.config.get('RUN_MODE');
    if (runMode === 'api') {
      this.logger.log('SweepsScheduler disabled in RUN_MODE=api');
      return;
    }

    this.sweepQueue = this.queues.getQueue('sweeps.repeatable');

    this.queues.createWorker(
      'sweeps.repeatable',
      async (job) => {
        const schedule = this.registeredSchedules.find((s) => s.name === job.name);
        if (schedule) {
          await schedule.processor();
        } else {
          this.logger.warn(`No schedule handler found for repeatable job [${job.name}]`);
        }
      },
      { concurrency: 5 },
    );

    await this.upsertAllSchedulers();
  }

  async upsertAllSchedulers(): Promise<void> {
    this.logger.log(`Upserting ${this.registeredSchedules.length} repeatable sweep schedules into Redis...`);
    for (const schedule of this.registeredSchedules) {
      if (schedule.everyMs) {
        await this.sweepQueue.upsertJobScheduler(
          `scheduler:${schedule.name}`,
          { every: schedule.everyMs },
          { name: schedule.name },
        );
      } else if (schedule.cronPattern) {
        await this.sweepQueue.upsertJobScheduler(
          `scheduler:${schedule.name}`,
          { pattern: schedule.cronPattern },
          { name: schedule.name },
        );
      }
    }
    this.logger.log('All sweep schedules registered.');
  }
}
