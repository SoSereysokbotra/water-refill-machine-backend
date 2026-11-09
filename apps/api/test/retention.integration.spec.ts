import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaService } from '../src/platform/database/prisma.service';
import { ConfigService } from '../src/platform/config/config.service';
import { RetentionService } from '../src/platform/queues/retention.service';
import { SweepsScheduler } from '../src/platform/sweeps/sweeps.scheduler';
import { QueueService } from '../src/platform/queues/queue.service';
import { generateUuidV7 } from '../src/shared-kernel';

describe('Retention Policy & Sweeper (Integration)', () => {
  let prisma: PrismaService;
  let config: ConfigService;
  let queues: QueueService;
  let sweeps: SweepsScheduler;
  let retentionService: RetentionService;

  beforeAll(async () => {
    config = new ConfigService();
    prisma = new PrismaService();
    await prisma.$connect();
    queues = new QueueService(config);
    sweeps = new SweepsScheduler(queues, config);
    retentionService = new RetentionService(prisma, config, sweeps);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('retention deletes ONLY old dispatched outbox rows and preserves undispatched or recent rows', async () => {
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

    const oldDispatchedId = generateUuidV7();
    const recentDispatchedId = generateUuidV7();
    const oldUndispatchedId = generateUuidV7();

    // 1. Old dispatched row (dispatched 10 days ago) -> MUST BE PURGED
    await prisma.outbox.create({
      data: {
        id: oldDispatchedId,
        aggregateType: 'TEST',
        aggregateId: 'test-retention-1',
        eventType: 'test.retention.old-dispatched',
        payload: { test: true },
        occurredAt: tenDaysAgo,
        dispatchedAt: tenDaysAgo,
      },
    });

    // 2. Recent dispatched row (dispatched 1 day ago) -> MUST BE KEPT
    await prisma.outbox.create({
      data: {
        id: recentDispatchedId,
        aggregateType: 'TEST',
        aggregateId: 'test-retention-2',
        eventType: 'test.retention.recent-dispatched',
        payload: { test: true },
        occurredAt: oneDayAgo,
        dispatchedAt: oneDayAgo,
      },
    });

    // 3. Old UNDISPATCHED row (occurred 10 days ago, never dispatched) -> MUST BE KEPT!
    await prisma.outbox.create({
      data: {
        id: oldUndispatchedId,
        aggregateType: 'TEST',
        aggregateId: 'test-retention-3',
        eventType: 'test.retention.old-undispatched',
        payload: { test: true },
        occurredAt: tenDaysAgo,
        dispatchedAt: null,
      },
    });

    // Run purge with 7-day cutoff
    const cutoff7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    await retentionService.purgeRetention({ outboxCutoff: cutoff7Days });

    // Verify outcomes
    const oldDispatchedRow = await prisma.outbox.findUnique({ where: { id: oldDispatchedId } });
    const recentDispatchedRow = await prisma.outbox.findUnique({ where: { id: recentDispatchedId } });
    const oldUndispatchedRow = await prisma.outbox.findUnique({ where: { id: oldUndispatchedId } });

    expect(oldDispatchedRow).toBeNull(); // deleted!
    expect(recentDispatchedRow).not.toBeNull(); // preserved!
    expect(oldUndispatchedRow).not.toBeNull(); // preserved!

    // Cleanup preserved rows
    await prisma.outbox.deleteMany({
      where: { id: { in: [recentDispatchedId, oldUndispatchedId] } },
    });
  });

  it('retention purges inbox and heartbeat rows older than retention threshold', async () => {
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

    const oldMsgId = `msg-old-${Date.now()}`;
    const recentMsgId = `msg-recent-${Date.now()}`;

    // Inbox rows
    await prisma.inbox.create({
      data: {
        messageId: oldMsgId,
        source: 'mqtt:test',
        receivedAt: tenDaysAgo,
      },
    });

    await prisma.inbox.create({
      data: {
        messageId: recentMsgId,
        source: 'mqtt:test',
        receivedAt: oneDayAgo,
      },
    });

    // Heartbeat rows
    const oldHb = await prisma.heartbeat.create({
      data: {
        machineId: 'm-retention-1',
        data: { status: 'ok' },
        at: tenDaysAgo,
      },
    });

    const recentHb = await prisma.heartbeat.create({
      data: {
        machineId: 'm-retention-1',
        data: { status: 'ok' },
        at: oneDayAgo,
      },
    });

    // Run purge
    const cutoff7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    await retentionService.purgeRetention({
      inboxCutoff: cutoff7Days,
      heartbeatCutoff: cutoff7Days,
    });

    // Check inbox
    const oldInbox = await prisma.inbox.findUnique({ where: { messageId: oldMsgId } });
    const recentInbox = await prisma.inbox.findUnique({ where: { messageId: recentMsgId } });
    expect(oldInbox).toBeNull();
    expect(recentInbox).not.toBeNull();

    // Check heartbeats
    const oldHbRow = await prisma.heartbeat.findUnique({ where: { id: oldHb.id } });
    const recentHbRow = await prisma.heartbeat.findUnique({ where: { id: recentHb.id } });
    expect(oldHbRow).toBeNull();
    expect(recentHbRow).not.toBeNull();

    // Clean up
    await prisma.inbox.delete({ where: { messageId: recentMsgId } });
    await prisma.heartbeat.delete({ where: { id: recentHb.id } });
  });
});
