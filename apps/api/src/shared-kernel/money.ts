export type Currency = 'USD' | 'KHR';

export class Money {
  private constructor(
    public readonly amountMinor: number,
    public readonly currency: Currency,
  ) {
    if (!Number.isInteger(amountMinor) || amountMinor < 0) {
      throw new Error(`Amount must be a non-negative integer minor unit. Received: ${amountMinor}`);
    }
  }

  static of(amountMinor: number, currency: Currency): Money {
    return new Money(amountMinor, currency);
  }

  static fromMajor(amountMajor: number, currency: Currency): Money {
    if (currency === 'KHR') {
      return new Money(Math.round(amountMajor), currency);
    }
    return new Money(Math.round(amountMajor * 100), currency);
  }

  toMajorUnits(): number {
    if (this.currency === 'KHR') {
      return this.amountMinor;
    }
    return this.amountMinor / 100;
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountMinor + other.amountMinor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    if (this.amountMinor < other.amountMinor) {
      throw new Error(`Cannot subtract ${other.amountMinor} from ${this.amountMinor}: negative balance`);
    }
    return new Money(this.amountMinor - other.amountMinor, this.currency);
  }

  multiply(factor: number): Money {
    if (factor < 0) {
      throw new Error(`Factor must be non-negative. Received: ${factor}`);
    }
    return new Money(Math.round(this.amountMinor * factor), this.currency);
  }

  equals(other: Money): boolean {
    return this.amountMinor === other.amountMinor && this.currency === other.currency;
  }

  format(): string {
    if (this.currency === 'KHR') {
      return `${this.amountMinor} ៛`;
    }
    return `$${this.toMajorUnits().toFixed(2)}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: cannot operate between ${this.currency} and ${other.currency}`);
    }
  }
}

// Backward-compatibility functions
export function createMoney(amountMinor: number, currency: Currency): Money {
  return Money.of(amountMinor, currency);
}

export function toMajorUnits(money: Money | { amountMinor: number; currency: Currency }): number {
  if (money instanceof Money) {
    return money.toMajorUnits();
  }
  return money.currency === 'KHR' ? money.amountMinor : money.amountMinor / 100;
}
