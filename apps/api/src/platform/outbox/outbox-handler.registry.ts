import { Injectable, Logger } from '@nestjs/common';
import { DomainEvent } from '../../shared-kernel/domain-event';

export type EventHandlerFn<T = unknown> = (event: DomainEvent<T>) => Promise<void>;

export interface RegisteredHandler {
  name: string;
  eventType: string;
  handler: EventHandlerFn;
}

@Injectable()
export class OutboxHandlerRegistry {
  private readonly logger = new Logger(OutboxHandlerRegistry.name);
  private readonly handlers = new Map<string, RegisteredHandler[]>();

  register<T>(eventType: string, handlerName: string, handler: EventHandlerFn<T>): void {
    const list = this.handlers.get(eventType) ?? [];
    list.push({
      name: handlerName,
      eventType,
      handler: handler as EventHandlerFn,
    });
    this.handlers.set(eventType, list);
    this.logger.debug(`Registered handler [${handlerName}] for event type [${eventType}]`);
  }

  handlersFor(eventType: string): RegisteredHandler[] {
    return this.handlers.get(eventType) ?? [];
  }

  allEventTypes(): string[] {
    return Array.from(this.handlers.keys());
  }
}
