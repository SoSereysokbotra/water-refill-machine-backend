import { DomainEvent } from './domain-event';

export abstract class AggregateRoot<TId = string> {
  private pendingEvents: DomainEvent[] = [];

  protected constructor(
    public readonly id: TId,
    protected _version: number = 0,
  ) {}

  get version(): number {
    return this._version;
  }

  protected raise(event: DomainEvent): void {
    this.pendingEvents.push(event);
  }

  pullEvents(): DomainEvent[] {
    const events = [...this.pendingEvents];
    this.pendingEvents = [];
    return events;
  }
}
