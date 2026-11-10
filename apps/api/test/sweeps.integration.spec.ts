import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QueueService } from '../src/platform/queues/queue.service';
import { ConfigService } from '../src/platform/config/config.service';
import { SweepsScheduler } from '../src/platform/sweeps/sweeps.scheduler';

describe('SweepsScheduler & FLUSHALL Resilience (Integration)', () => {
  let queues: QueueService;
  let config: ConfigService;
  let scheduler: SweepsScheduler;

  beforeAll(async () => {
    config = new ConfigService();
    queues = new QueueService(config);
    queues.onModuleInit();
    scheduler = new SweepsScheduler(queues, config);
  });

  afterAll(async () => {
    try {
      const sweepQueue = queues.getQueue('sweeps.repeatable');
      await sweepQueue.removeJobScheduler('scheduler:sweep.test-resilience');
    } catch {
      // ignore
    }
    await queues.onModuleDestroy();
  });

  it('sweep schedulers are recreated after FLUSHALL on Redis', async () => {
    scheduler.registerSchedule({
      name: 'sweep.test-resilience',
      everyMs: 10000,
      processor: async () => {
        // test processor
      },
    });

    await scheduler.onModuleInit();

    const sweepQueue = queues.getQueue('sweeps.repeatable');

    // 1. Verify scheduler exists in BullMQ
    let schedulers = await sweepQueue.getJobSchedulers();
    expect(schedulers.some((s) => s.key === 'scheduler:sweep.test-resilience' || s.name === 'sweep.test-resilience')).toBe(true);

    // 2. Perform FLUSHALL on Redis
    const redis = queues.getRedisClient();
    await redis.flushall();

    // 3. Verify schedulers were wiped by FLUSHALL
    schedulers = await sweepQueue.getJobSchedulers();
    expect(schedulers).toHaveLength(0);

    // 4. Re-run upsertAllSchedulers (simulating worker restart or periodic sync)
    await scheduler.upsertAllSchedulers();

    // 5. Verify sweep schedulers were recreated in Redis
    schedulers = await sweepQueue.getJobSchedulers();
    expect(schedulers.some((s) => s.key === 'scheduler:sweep.test-resilience' || s.name === 'sweep.test-resilience')).toBe(true);
  });
});
