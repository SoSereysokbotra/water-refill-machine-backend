import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/shared-kernel';
import { Payment, RECONCILE_PROBE_OFFSETS_MS } from '../src/contexts/payments/domain/payment.aggregate';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function pendingPayment(clock: FakeClock): Payment {
  return Payment.create({
    machineId: 'WRM-001',
    requestId: 'a1b2c3d4e5f60718',
    volumeMl: 500,
    amountMinor: 15,
    currency: 'USD',
    tranId: 'reconcile-test-01',
    clock,
    ttlMinutes: 3,
  });
}

describe('Reconcile schedule (Plan B4.8)', () => {
  it.each(['expire', 'cancel', 'fail'] as const)('%s starts the schedule at +5 min with reconcileCount 0', (action) => {
    const clock = new FakeClock(new Date('2026-11-11T00:00:00Z'));
    const p = pendingPayment(clock);
    p.abaCheckCount = 45; // polls made while the QR was on screen must not affect the schedule
    if (action === 'expire') p.expire(clock);
    if (action === 'cancel') p.cancel('SUPERSEDED', clock);
    if (action === 'fail') p.fail('ABA DECLINED', clock);

    expect(p.reconcileCount).toBe(0);
    expect(p.nextAbaCheckAt?.getTime()).toBe(clock.now().getTime() + 5 * MIN);
  });

  it('probes at +5 min, +1 h, +1 d, +3 d, +6 d after the end, then stops', () => {
    const end = new Date('2026-11-11T00:00:00Z');
    const clock = new FakeClock(end);
    const p = pendingPayment(clock);
    p.abaCheckCount = 45;
    p.expire(clock);

    const probeTimes: number[] = [];
    while (p.nextAbaCheckAt) {
      clock.setTime(p.nextAbaCheckAt); // the sweep runs exactly when due
      probeTimes.push(clock.now().getTime() - end.getTime());
      p.recordReconcileProbe(clock);
    }

    expect(probeTimes).toEqual([5 * MIN, 1 * HOUR, 1 * DAY, 3 * DAY, 6 * DAY]);
    expect(probeTimes).toEqual([...RECONCILE_PROBE_OFFSETS_MS]);
    expect(p.reconcileCount).toBe(5);
    expect(p.nextAbaCheckAt).toBeNull();
  });

  it('a late approval stops probing', () => {
    const clock = new FakeClock(new Date('2026-11-11T00:00:00Z'));
    const p = pendingPayment(clock);
    p.expire(clock);
    p.markPaid(clock, 60, 'APV', 'reconcile');
    expect(p.status).toBe('REFUND_REVIEW');
    expect(p.nextAbaCheckAt).toBeNull();
  });
});
