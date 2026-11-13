import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Inject } from '@nestjs/common';
import { Queue, Worker, QueueOptions, WorkerOptions, Processor, JobsOptions } from 'bullmq';
import { ConfigService } from '../config/config.service';
import IORedis from 'ioredis';

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private connection?: IORedis;
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Map<string, Worker>();

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  onModuleInit() {
    this.getConnection();
  }

  getConnection(): IORedis {
    if (!this.connection) {
      const redisUrl = this.config.get('REDIS_URL');
      this.logger.log(`Connecting to Redis for BullMQ queues at ${redisUrl}...`);
      this.connection = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });
    }
    return this.connection;
  }

  getRedisClient(): IORedis {
    return this.getConnection();
  }

  getQueue(name: string, defaultJobOptions?: JobsOptions): Queue {
    const existing = this.queues.get(name);
    if (existing) return existing;

    const opts: QueueOptions = {
      connection: this.getConnection(),
      defaultJobOptions: defaultJobOptions ?? {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    };

    const queue = new Queue(name, opts);
    this.queues.set(name, queue);
    return queue;
  }

  createWorker<T = unknown>(
    queueName: string,
    processor: Processor<T>,
    workerOptions?: Partial<WorkerOptions>,
  ): Worker<T> {
    const opts: WorkerOptions = {
      connection: this.getConnection(),
      concurrency: workerOptions?.concurrency ?? 5,
      ...workerOptions,
    };

    const worker = new Worker<T>(queueName, processor, opts);

    worker.on('failed', (job, err) => {
      this.logger.error(`Job [${job?.id}] on queue [${queueName}] failed: ${err.message}`, err.stack);
    });

    worker.on('error', (err) => {
      this.logger.error(`Worker error on queue [${queueName}]: ${err.message}`, err.stack);
    });

    this.workers.set(queueName, worker as Worker);
    return worker;
  }

  async onModuleDestroy() {
    this.logger.log('Closing all BullMQ workers and queues...');
    for (const [name, worker] of this.workers.entries()) {
      this.logger.log(`Closing worker [${name}]...`);
      await Promise.race([
        worker.close(),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            worker.close(true).catch(() => {});
            resolve();
          }, 1500),
        ),
      ]);
    }
    for (const queue of this.queues.values()) {
      await queue.close();
    }
    if (this.connection) {
      try {
        await Promise.race([
          this.connection.quit(),
          new Promise<void>((resolve) => setTimeout(resolve, 1000)),
        ]);
      } catch {
        // ignore
      }
      try {
        this.connection.disconnect();
      } catch {
        // ignore
      }
      this.connection = undefined;
    }
    this.logger.log('All queues and workers closed.');
  }
}
