import { Injectable, OnModuleInit, OnApplicationBootstrap, Logger, Inject } from '@nestjs/common';
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
export class SweepsScheduler implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(SweepsScheduler.name);
  private sweepQueue!: Queue;
  private readonly registeredSchedules: RepeatableScheduleDef[] = [];

  constructor(
    @Inject(QueueService) private readonly queues: QueueService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  registerSchedule(schedule: RepeatableScheduleDef): void {
    const existingIndex = this.registeredSchedules.findIndex((s) => s.name === schedule.name);
    if (existingIndex >= 0) {
      this.registeredSchedules[existingIndex] = schedule;
    } else {
      this.registeredSchedules.push(schedule);
    }

    if (this.sweepQueue) {
      this.upsertSchedule(schedule).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to upsert schedule [${schedule.name}]: ${msg}`);
      });
    }
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
          this.logger.warn(`No schedule handler found for repeatable job [${job.name}], removing from Redis`);
          try {
            await this.sweepQueue.removeJobScheduler(`scheduler:${job.name}`);
            await this.sweepQueue.removeJobScheduler(job.name);
          } catch {
            // ignore
          }
        }
      },
      { concurrency: 5 },
    );

    await this.upsertAllSchedulers();
  }

  async onApplicationBootstrap() {
    const runMode = this.config.get('RUN_MODE');
    if (runMode === 'api') {
      return;
    }
    await this.upsertAllSchedulers();
  }

  async upsertAllSchedulers(): Promise<void> {
    if (!this.sweepQueue) {
      return;
    }

    this.logger.log(`Upserting ${this.registeredSchedules.length} repeatable sweep schedules into Redis...`);
    for (const schedule of this.registeredSchedules) {
      await this.upsertSchedule(schedule);
    }
    this.logger.log('All sweep schedules registered.');
  }

  private async upsertSchedule(schedule: RepeatableScheduleDef): Promise<void> {
    if (!this.sweepQueue) return;
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
}
