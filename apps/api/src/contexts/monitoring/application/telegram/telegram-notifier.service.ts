import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
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
export class TelegramNotifierService implements OnModuleInit {
  private readonly logger = new Logger(TelegramNotifierService.name);
  private queue!: Queue<TelegramNotificationJob>;

  constructor(
    @Inject(QueueService) private readonly queueService: QueueService,
    @Inject(TELEGRAM_CLIENT) private readonly telegramClient: ITelegramClient,
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

    this.queueService.createWorker<TelegramNotificationJob>(
      'notify.telegram',
      async (job) => {
        await this.processJob(job.data);
      },
      { concurrency: 5 },
    );
  }

  async enqueue(job: TelegramNotificationJob): Promise<void> {
    await this.queue.add('notify', job);
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

