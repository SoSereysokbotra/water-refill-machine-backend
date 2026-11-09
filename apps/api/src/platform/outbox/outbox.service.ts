import { Injectable } from '@nestjs/common';
import { PrismaTransaction } from '../database/unit-of-work';
import { DomainEvent } from '../../shared-kernel/domain-event';
import { generateUuidV7 } from '../../shared-kernel/uuid';
import { Prisma } from '@prisma/client';

@Injectable()
export class OutboxService {
  async add(
    events: DomainEvent[],
    tx: PrismaTransaction,
    aggregateType = 'UNKNOWN',
    aggregateId = 'UNKNOWN',
  ): Promise<void> {
    if (events.length === 0) return;

    for (const event of events) {
      const id = event.eventId || generateUuidV7();
      await tx.outbox.create({
        data: {
          id,
          aggregateType,
          aggregateId,
          eventType: event.type,
          payload: {
            eventId: id,
            type: event.type,
            version: event.version,
            occurredAt: event.occurredAt.toISOString(),
            data: event.data,
          } as unknown as Prisma.InputJsonValue,
          occurredAt: event.occurredAt,
        },
      });
    }
  }
}
