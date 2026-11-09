export interface DomainEvent<T = unknown> {
  readonly eventId: string;
  readonly type: string;
  readonly version: number;
  readonly occurredAt: Date;
  readonly data: T;
}

export function createDomainEvent<T>(
  type: string,
  data: T,
  options?: { eventId?: string; version?: number; occurredAt?: Date },
): DomainEvent<T> {
  return {
    eventId: options?.eventId ?? crypto.randomUUID(),
    type,
    version: options?.version ?? 1,
    occurredAt: options?.occurredAt ?? new Date(),
    data,
  };
}
