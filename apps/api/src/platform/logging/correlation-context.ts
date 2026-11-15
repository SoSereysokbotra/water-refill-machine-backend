import { AsyncLocalStorage } from 'async_hooks';

export interface CorrelationContext {
  traceId?: string;
  spanId?: string;
  tranId?: string;
  machineId?: string;
  requestId?: string;
  jobId?: string;
  eventType?: string;
  errorCode?: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

export function getCorrelationContext(): CorrelationContext | undefined {
  return storage.getStore();
}

export function runWithCorrelation<T>(
  context: CorrelationContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  const current = storage.getStore();
  const merged = current ? { ...current, ...context } : { ...context };
  return storage.run(merged, fn);
}

export function updateCorrelationContext(partial: Partial<CorrelationContext>): void {
  const current = storage.getStore();
  if (current) {
    Object.assign(current, partial);
  }
}
