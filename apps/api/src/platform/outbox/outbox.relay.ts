import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { QueueService } from '../queues/queue.service';
import { OutboxHandlerRegistry } from './outbox-handler.registry';
import { ConfigService } from '../config/config.service';
import { Queue } from 'bullmq';
import { DomainEvent } from '../../shared-kernel/domain-event';

interface OutboxRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: DomainEvent;
  occurred_at: Date;
  attempts: number;
}

@Injectable()
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private running = false;
  private pollTimeout?: NodeJS.Timeout;
  private dispatchQueue!: Queue;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QueueService) private readonly queues: QueueService,
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  private getDispatchQueue(): Queue {
    if (!this.dispatchQueue) {
      this.dispatchQueue = this.queues.getQueue('outbox.dispatch', {
        attempts: 10,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      });
    }
    return this.dispatchQueue;
  }

  onModuleInit() {
    const runMode = this.config.get('RUN_MODE');
    if (runMode === 'api') {
      this.logger.log('OutboxRelay disabled in RUN_MODE=api');
      return;
    }

    this.getDispatchQueue();

    // Create worker to process dispatched outbox events
    this.queues.createWorker<{ event: DomainEvent; handlerName: string }>(
      'outbox.dispatch',
      async (job) => {
        const { event, handlerName } = job.data;
        const handlers = this.registry.handlersFor(event.type);
        const match = handlers.find((h) => h.name === handlerName);
        if (match) {
          await match.handler(event);
        } else {
          throw new Error(`Handler [${handlerName}] not found for event [${event.type}] on this worker`);
        }
      },
      { concurrency: 20 },
    );

    this.running = true;
    this.logger.log('Starting OutboxRelay loop (interval: 250ms)...');
    this.scheduleNextPoll(100);
  }

  private scheduleNextPoll(delayMs = 250) {
    if (!this.running) return;
    this.pollTimeout = setTimeout(async () => {
      await this.pollOnce();
      this.scheduleNextPoll(250);
    }, delayMs);
  }

  async pollOnce(): Promise<number> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<OutboxRow[]>`
          SELECT id, aggregate_type, aggregate_id, event_type, payload, occurred_at, attempts
          FROM outbox
          WHERE dispatched_at IS NULL AND dead_at IS NULL
          ORDER BY occurred_at
          FOR UPDATE SKIP LOCKED
          LIMIT 20
        `;

        if (!rows || rows.length === 0) {
          return 0;
        }

        for (const row of rows) {
          const handlers = this.registry.handlersFor(row.event_type);
          if (handlers.length === 0) {
            this.logger.debug(`No handlers registered for event type [${row.event_type}]. Marking dispatched.`);
          } else {
            for (const handler of handlers) {
              const jobId = `${row.id}__${handler.name}`;
              await this.getDispatchQueue().add(
                handler.name,
                { event: row.payload, handlerName: handler.name },
                { jobId },
              );
            }
          }
        }

        const ids = rows.map((r) => r.id);
        await tx.$executeRaw`
          UPDATE outbox
          SET dispatched_at = now()
          WHERE id = ANY(${ids})
        `;

        return rows.length;
      });
    } catch (err) {
      this.logger.error(`Error in OutboxRelay polling loop: ${(err as Error).message}`, (err as Error).stack);
      return 0;
    }
  }

  onModuleDestroy() {
    this.running = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
    }
    this.logger.log('OutboxRelay stopped.');
  }
}
