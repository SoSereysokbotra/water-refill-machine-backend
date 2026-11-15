export interface DomainEvent<T = unknown> {
  readonly eventId: string;
  readonly type: string;
  readonly version: number;
  readonly occurredAt: Date;
  readonly traceId?: string;
  readonly data: T;
}

export function createDomainEvent<T>(
  type: string,
  data: T,
  options?: { eventId?: string; version?: number; occurredAt?: Date; traceId?: string },
): DomainEvent<T> {
  return {
    eventId: options?.eventId ?? crypto.randomUUID(),
    type,
    version: options?.version ?? 1,
    occurredAt: options?.occurredAt ?? new Date(),
    traceId: options?.traceId,
    data,
  };
}
