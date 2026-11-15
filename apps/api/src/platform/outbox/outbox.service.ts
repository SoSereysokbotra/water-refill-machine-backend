import { Injectable, Optional } from '@nestjs/common';
import { PrismaTransaction } from '../database/unit-of-work';
import { DomainEvent } from '../../shared-kernel/domain-event';
import { generateUuidV7 } from '../../shared-kernel/uuid';
import { Prisma } from '@prisma/client';
import { TracerService } from '../telemetry/tracer.service';

@Injectable()
export class OutboxService {
  constructor(@Optional() private readonly tracer?: TracerService) {}

  async add(
    events: DomainEvent[],
    tx: PrismaTransaction,
    aggregateType = 'UNKNOWN',
    aggregateId = 'UNKNOWN',
  ): Promise<void> {
    if (events.length === 0) return;

    for (const event of events) {
      const id = event.eventId || generateUuidV7();
      const traceId = event.traceId ?? this.tracer?.getCurrentTraceId();
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
            traceId,
            data: event.data,
          } as unknown as Prisma.InputJsonValue,
          occurredAt: event.occurredAt,
        },
      });
    }
  }
}
