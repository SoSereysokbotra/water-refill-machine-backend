import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaService } from '../src/platform/database/prisma.service';
import { UnitOfWork } from '../src/platform/database/unit-of-work';
import { OutboxService } from '../src/platform/outbox/outbox.service';
import { InboxService } from '../src/platform/inbox/inbox.service';
import { createDomainEvent, generateUuidV7, ConflictError } from '../src/shared-kernel';

describe('UnitOfWork & Transaction Isolation (Integration)', () => {
  let prisma: PrismaService;
  let uow: UnitOfWork;
  let outboxService: OutboxService;
  let inboxService: InboxService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    uow = new UnitOfWork(prisma);
    outboxService = new OutboxService();
    inboxService = new InboxService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('UoW rollback removes outbox and inbox rows on transaction failure', async () => {
    const eventId = generateUuidV7();
    const messageId = `msg-rollback-${Date.now()}`;
    const testEvent = createDomainEvent('test.failed', { value: 123 }, { eventId });

    await expect(
      uow.execute(async (tx) => {
        await outboxService.add([testEvent], tx);
        await inboxService.record(messageId, 'mqtt:test', tx);
        throw new Error('Simulated business error inside transaction');
      }),
    ).rejects.toThrow('Simulated business error inside transaction');

    // Verify neither outbox nor inbox row was committed
    const outboxRow = await prisma.outbox.findUnique({ where: { id: eventId } });
    const inboxRow = await prisma.inbox.findUnique({ where: { messageId } });

    expect(outboxRow).toBeNull();
    expect(inboxRow).toBeNull();
  });

  it('UoW commit successfully persists both outbox and inbox rows atomically', async () => {
    const eventId = generateUuidV7();
    const messageId = `msg-commit-${Date.now()}`;
    const testEvent = createDomainEvent('test.committed', { amount: 5000 }, { eventId });

    await uow.execute(async (tx) => {
      await outboxService.add([testEvent], tx);
      await inboxService.record(messageId, 'mqtt:test', tx);
    });

    // Verify both rows exist in database
    const outboxRow = await prisma.outbox.findUnique({ where: { id: eventId } });
    const inboxRow = await prisma.inbox.findUnique({ where: { messageId } });

    expect(outboxRow).not.toBeNull();
    expect(outboxRow?.eventType).toBe('test.committed');
    expect(inboxRow).not.toBeNull();
    expect(inboxRow?.source).toBe('mqtt:test');

    // Clean up
    await prisma.outbox.delete({ where: { id: eventId } });
    await prisma.inbox.delete({ where: { messageId } });
  });

  it('UoW retries on concurrency conflict', async () => {
    let attempts = 0;
    const result = await uow.execute(async () => {
      attempts++;
      if (attempts < 2) {
        throw new ConflictError();
      }
      return 'success-after-retry';
    });

    expect(result).toBe('success-after-retry');
    expect(attempts).toBe(2);
  });
});
