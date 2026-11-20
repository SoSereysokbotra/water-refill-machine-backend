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

export interface TelegramPaymentSuccessJob {
  tranId: string;
  machineId: string;
  volumeMl: number;
  amountMinor: number;
  currency: string;
  paidAt: Date | string;
  abaApv?: string;
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

    this.worker = this.queueService.createWorker<any>(
      'notify.telegram',
      async (job) => {
        if (job.name === 'notify_payment') {
          await this.processPaymentJob(job.data as TelegramPaymentSuccessJob);
        } else {
          await this.processJob(job.data as TelegramNotificationJob);
        }
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

  /**
   * @param eventId id of the outbox event behind this notification. Part of the BullMQ job id so a redelivered
   *   event is sent once, while a reopened alert (same alertId, new event) is sent again.
   */
  async enqueue(job: TelegramNotificationJob, eventId: string): Promise<void> {
    const jobId = `${job.alertId}__${job.action}__${eventId}`;
    await (this.queue as Queue<any>).add('notify', job, { jobId });
  }

  async enqueuePaymentSuccess(job: TelegramPaymentSuccessJob): Promise<void> {
    const jobId = `payment__${job.tranId}`;
    await (this.queue as Queue<any>).add('notify_payment', job, { jobId });
  }

  async processJob(job: TelegramNotificationJob): Promise<void> {
    const text = this.formatMessage(job);
    await this.telegramClient.sendMessage(text);
  }

  async processPaymentJob(job: TelegramPaymentSuccessJob): Promise<void> {
    const text = this.formatPaymentSuccessMessage(job);
    await this.telegramClient.sendMessage(text);
  }

  private formatPaymentSuccessMessage(job: TelegramPaymentSuccessJob): string {
    const liters = (job.volumeMl / 1000).toString();
    const formattedCost =
      job.currency === 'USD'
        ? `$${(job.amountMinor / 100).toFixed(2)} USD`
        : `${job.amountMinor.toLocaleString()} KHR`;

    const d = new Date(job.paidAt);
    const dateStr = !isNaN(d.getTime())
      ? d.toISOString().replace('T', ' ').substring(0, 19) + ' UTC'
      : String(job.paidAt);

    return [
      '💧 Water Refill Payment Successful!',
      '',
      `🏷 Machine: ${job.machineId}`,
      `🚰 Volume: ${liters} L (${job.volumeMl} mL)`,
      `💵 Cost: ${formattedCost}`,
      `🕒 Date & Time: ${dateStr}`,
      `🆔 Transaction: ${job.tranId}`,
      job.abaApv ? `💳 Approval Code: ${job.abaApv}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private formatMessage(job: TelegramNotificationJob): string {
    const target = job.machineId ? ` on ${job.machineId}` : '';
    if (job.action === 'resolve') {
      return `✅ [RESOLVED] ${job.type}${target}: ${job.message}`;
    }
    const countInfo = job.count && job.count > 1 ? ` (count: ${job.count})` : '';
    const icon = job.severity === 'critical' ? '🚨' : '⚠️';
    return `${icon} [ALERT ${job.severity.toUpperCase()}] ${job.type}${target}: ${job.message}${countInfo}`;
  }
}

