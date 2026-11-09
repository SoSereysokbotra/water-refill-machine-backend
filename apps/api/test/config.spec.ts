import { describe, it, expect } from 'vitest';
import { configSchema } from '../src/platform/config/config.schema';

describe('Config Schema Validation', () => {
  it('applies defaults correctly when minimal environment is provided', () => {
    const parsed = configSchema.parse({});
    expect(parsed.PORT).toBe(3000);
    expect(parsed.RUN_MODE).toBe('all');
    expect(parsed.PAYMENT_TTL_MINUTES).toBe(3);
    expect(parsed.PAYMENT_GRACE_SECONDS).toBe(60);
    expect(parsed.REFUND_MODE).toBe('manual');
    expect(parsed.LOG_LEVEL).toBe('info');
  });

  it('fails fast when PAYMENT_TTL_MINUTES is less than 3 (ABA minimum rule)', () => {
    expect(() => {
      configSchema.parse({ PAYMENT_TTL_MINUTES: 2 });
    }).toThrow();
  });

  it('parses valid environment variables with coercion', () => {
    const parsed = configSchema.parse({
      PORT: '8080',
      PAYMENT_TTL_MINUTES: '5',
      RUN_MODE: 'worker',
      REFUND_MODE: 'auto',
    });
    expect(parsed.PORT).toBe(8080);
    expect(parsed.PAYMENT_TTL_MINUTES).toBe(5);
    expect(parsed.RUN_MODE).toBe('worker');
    expect(parsed.REFUND_MODE).toBe('auto');
  });
});
