import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { ConfigService } from '../../../../platform/config/config.service';
import { QueueService } from '../../../../platform/queues/queue.service';
import { ITelegramClient, TELEGRAM_CLIENT } from './telegram.client';

export interface TelegramNotificationJob {
  action: 'raise' | 'resolve';
  alertId: string;
  type: string;
  severity: string;
  message: string;
  machineId?: string | null;
  count?: number;
}

@Injectable()
export class TelegramNotifierService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramNotifierService.name);
  private queue!: Queue<TelegramNotificationJob>;
  private worker?: Worker<TelegramNotificationJob>;

  constructor(
    @Inject(QueueService) private readonly queueService: QueueService,
    @Inject(TELEGRAM_CLIENT) private readonly telegramClient: ITelegramClient,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.queue = this.queueService.getQueue('notify.telegram', {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    });

    const runMode = this.config.get('RUN_MODE');
    if (runMode === 'api') {
      this.logger.log('TelegramNotifier worker disabled in RUN_MODE=api');
      return;
    }

    this.worker = this.queueService.createWorker<TelegramNotificationJob>(
      'notify.telegram',
      async (job) => {
        await this.processJob(job.data);
      },
      { concurrency: 5 },
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await Promise.race([
        this.worker.close(),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            this.worker?.close(true).catch(() => {});
            resolve();
          }, 1000),
        ),
      ]);
    }
    if (this.queue) {
      await this.queue.close();
    }
  }

  async enqueue(job: TelegramNotificationJob): Promise<void> {
    const jobId = `${job.alertId}__${job.action}`;
    await this.queue.add('notify', job, { jobId });
  }

  async processJob(job: TelegramNotificationJob): Promise<void> {
    const text = this.formatMessage(job);
    await this.telegramClient.sendMessage(text);
  }

  private formatMessage(job: TelegramNotificationJob): string {
    const target = job.machineId ? ` on ${job.machineId}` : '';
    if (job.action === 'resolve') {
      return `[RESOLVED] ${job.type}${target}: ${job.message}`;
    }
    const countInfo = job.count && job.count > 1 ? ` (count: ${job.count})` : '';
    return `[ALERT ${job.severity.toUpperCase()}] ${job.type}${target}: ${job.message}${countInfo}`;
  }
}

