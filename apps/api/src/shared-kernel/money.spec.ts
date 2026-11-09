import { describe, it, expect } from 'vitest';
import { Money, createMoney, toMajorUnits } from './money';
import { TranIdGenerator } from './tran-id-generator';
import { FakeClock } from './clock';

describe('Shared Kernel: Money Value Object', () => {
  it('handles KHR scale 0 correctly', () => {
    const khr = createMoney(500, 'KHR');
    expect(khr.amountMinor).toBe(500);
    expect(toMajorUnits(khr)).toBe(500);
    expect(khr.format()).toBe('500 ៛');
  });

  it('handles USD scale 2 correctly', () => {
    const usd = createMoney(15, 'USD'); // $0.15
    expect(usd.amountMinor).toBe(15);
    expect(toMajorUnits(usd)).toBe(0.15);
    expect(usd.format()).toBe('$0.15');
  });

  it('converts from major units accurately', () => {
    const usd = Money.fromMajor(0.25, 'USD');
    expect(usd.amountMinor).toBe(25);

    const khr = Money.fromMajor(1000, 'KHR');
    expect(khr.amountMinor).toBe(1000);
  });

  it('performs arithmetic operations safely within same currency', () => {
    const m1 = Money.of(15, 'USD');
    const m2 = Money.of(20, 'USD');
    const sum = m1.add(m2);
    expect(sum.amountMinor).toBe(35);

    const diff = m2.subtract(m1);
    expect(diff.amountMinor).toBe(5);

    const doubled = m1.multiply(2);
    expect(doubled.amountMinor).toBe(30);
  });

  it('rejects cross-currency arithmetic', () => {
    const usd = Money.of(100, 'USD');
    const khr = Money.of(100, 'KHR');
    expect(() => usd.add(khr)).toThrow(/Currency mismatch/);
    expect(() => usd.subtract(khr)).toThrow(/Currency mismatch/);
  });

  it('rejects negative or non-integer minor amounts', () => {
    expect(() => Money.of(-10, 'USD')).toThrow();
    expect(() => Money.of(10.5, 'USD')).toThrow();
  });
});

describe('Shared Kernel: TranIdGenerator', () => {
  it('generates unique transaction IDs with length <= 20 chars', () => {
    const generator = new TranIdGenerator();
    const ids = new Set<string>();

    for (let i = 0; i < 1000; i++) {
      const id = generator.next();
      expect(id.length).toBeLessThanOrEqual(20);
      expect(id.length).toBeGreaterThan(10);
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }
  });
});

describe('Shared Kernel: FakeClock', () => {
  it('allows advancing time deterministically', () => {
    const initial = new Date('2026-11-09T12:00:00.000Z');
    const clock = new FakeClock(initial);
    expect(clock.now().toISOString()).toBe('2026-11-09T12:00:00.000Z');

    clock.advance(5000); // 5 seconds
    expect(clock.now().toISOString()).toBe('2026-11-09T12:00:05.000Z');
  });
});
