import { describe, it, expect } from 'vitest';

export interface Money {
  amountMinor: number;
  currency: 'USD' | 'KHR';
}

export function createMoney(amountMinor: number, currency: 'USD' | 'KHR'): Money {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new Error('Amount must be a non-negative integer');
  }
  return { amountMinor, currency };
}

export function toMajorUnits(money: Money): number {
  if (money.currency === 'KHR') {
    return money.amountMinor;
  }
  return money.amountMinor / 100;
}

describe('Money Value Object', () => {
  it('handles KHR scale 0 correctly', () => {
    const khr = createMoney(500, 'KHR');
    expect(khr.amountMinor).toBe(500);
    expect(toMajorUnits(khr)).toBe(500);
  });

  it('handles USD scale 2 correctly', () => {
    const usd = createMoney(15, 'USD'); // $0.15
    expect(usd.amountMinor).toBe(15);
    expect(toMajorUnits(usd)).toBe(0.15);
  });

  it('rejects negative or non-integer minor amounts', () => {
    expect(() => createMoney(-10, 'USD')).toThrow();
    expect(() => createMoney(10.5, 'USD')).toThrow();
  });
});
