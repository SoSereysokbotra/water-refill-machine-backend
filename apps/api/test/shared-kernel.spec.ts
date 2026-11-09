import { describe, it, expect } from 'vitest';
import { AggregateRoot, createDomainEvent, generateUuidV7, SystemClock } from '../src/shared-kernel';

class SampleAggregate extends AggregateRoot<string> {
  constructor(id: string) {
    super(id);
  }

  doSomething() {
    this.raise(
      createDomainEvent('sample.happened', {
        foo: 'bar',
      }),
    );
  }
}

describe('Shared Kernel Unit Tests', () => {
  it('AggregateRoot tracks domain events and clears them', () => {
    const agg = new SampleAggregate('agg-1');
    expect(agg.pullEvents()).toHaveLength(0);

    agg.doSomething();
    const events = agg.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('sample.happened');
    expect(events[0]!.data).toEqual({ foo: 'bar' });

    expect(agg.pullEvents()).toHaveLength(0);
  });

  it('generateUuidV7 produces valid time-ordered UUIDv7 strings', () => {
    const id1 = generateUuidV7();
    const id2 = generateUuidV7();

    expect(id1).toHaveLength(36);
    expect(id2).toHaveLength(36);
    // UUIDv7 has '7' at version nibble
    expect(id1.charAt(14)).toBe('7');
    expect(id2.charAt(14)).toBe('7');
    expect(id1 <= id2).toBe(true);
  });

  it('SystemClock returns real system time', () => {
    const clock = new SystemClock();
    const before = Date.now();
    const now = clock.now().getTime();
    const after = Date.now();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});
