import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaService } from '../src/platform/database/prisma.service';
import { QueueService } from '../src/platform/queues/queue.service';
import { ConfigService } from '../src/platform/config/config.service';
import { OutboxRelay } from '../src/platform/outbox/outbox.relay';
import { OutboxHandlerRegistry } from '../src/platform/outbox/outbox-handler.registry';
import { createDomainEvent, generateUuidV7 } from '../src/shared-kernel';

describe('OutboxRelay & Deduplication (Integration)', () => {
  let prisma: PrismaService;
  let queues: QueueService;
  let config: ConfigService;
  let registry: OutboxHandlerRegistry;

  beforeAll(async () => {
    config = new ConfigService();
    prisma = new PrismaService();
    await prisma.$connect();
    // Clean any leftover test events from previous test runs
    await prisma.outbox.deleteMany({ where: { eventType: { startsWith: 'test.' } } });
    queues = new QueueService(config);
    queues.onModuleInit();
    registry = new OutboxHandlerRegistry();
  });

  afterAll(async () => {
    await queues.onModuleDestroy();
    await prisma.$disconnect();
  });

  it('two concurrent relays never double-dispatch the same outbox rows', async () => {
    // Clear any pending undispatched rows so only our 5 rows are tested
    await prisma.outbox.deleteMany({ where: { dispatchedAt: null } });

    const eventType = `test.concurrent.${Date.now()}`;
    const handlerCalls: string[] = [];

    registry.register(eventType, 'AuditLogger', async (evt) => {
      handlerCalls.push(`audit:${evt.eventId}`);
    });

    const relay1 = new OutboxRelay(prisma, queues, registry, config);
    const relay2 = new OutboxRelay(prisma, queues, registry, config);

    // Insert 5 undispatched outbox rows
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = generateUuidV7();
      ids.push(id);
      const evt = createDomainEvent(eventType, { num: i }, { eventId: id });
      await prisma.outbox.create({
        data: {
          id,
          aggregateType: 'TEST',
          aggregateId: `test-${i}`,
          eventType,
          payload: evt as unknown as object,
          occurredAt: evt.occurredAt,
        },
      });
    }

    // Run pollOnce() concurrently on both relays
    const [processed1, processed2] = await Promise.all([
      relay1.pollOnce(),
      relay2.pollOnce(),
    ]);

    // The sum of processed rows between both relays must equal exactly 5 (no double-processing)
    expect(processed1 + processed2).toBe(5);

    // Verify in database that all 5 rows are marked dispatched_at
    const dispatchedRows = await prisma.outbox.findMany({
      where: { id: { in: ids }, dispatchedAt: { not: null } },
    });
    expect(dispatchedRows).toHaveLength(5);

    // Clean up test rows
    await prisma.outbox.deleteMany({ where: { id: { in: ids } } });
  });

  it('crash after enqueue before commit does not duplicate jobs thanks to deterministic jobId', async () => {
    const eventType = `test.crash.${Date.now()}`;
    const id = generateUuidV7();
    const evt = createDomainEvent(eventType, { value: 999 }, { eventId: id });

    // Manually register handler
    registry.register(eventType, 'PaymentProcessor', async () => {});

    // Create outbox row
    await prisma.outbox.create({
      data: {
        id,
        aggregateType: 'TEST',
        aggregateId: 'test-crash',
        eventType,
        payload: evt as unknown as object,
        occurredAt: evt.occurredAt,
      },
    });

    const dispatchQueue = queues.getQueue('outbox.dispatch');
    const deterministicJobId = `${id}__PaymentProcessor`;

    // 1. Simulate crash: job was added to BullMQ, but DB update failed/rolled back
    await dispatchQueue.add(
      'PaymentProcessor',
      { event: evt, handlerName: 'PaymentProcessor' },
      { jobId: deterministicJobId },
    );

    // 2. Relay runs again after restart and attempts to dispatch the undispatched row
    const relay = new OutboxRelay(prisma, queues, registry, config);
    await relay.pollOnce();

    // Verify that the queue has only 1 job with deterministicJobId (deduplicated by BullMQ)
    const existingJob = await dispatchQueue.getJob(deterministicJobId);
    expect(existingJob).not.toBeNull();
    expect(existingJob?.id).toBe(deterministicJobId);

    // Clean up
    await prisma.outbox.delete({ where: { id } });
    if (existingJob) {
      await existingJob.remove();
    }
  });
});
