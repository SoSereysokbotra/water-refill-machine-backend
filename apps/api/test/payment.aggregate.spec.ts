import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/shared-kernel';
import { Payment } from '../src/contexts/payments/domain/payment.aggregate';

describe('Payment Aggregate', () => {
  const clock = new FakeClock(new Date('2026-11-10T12:00:00Z'));

  beforeEach(() => {
    clock.setTime(new Date('2026-11-10T12:00:00Z'));
  });

  function createTestPayment(ttlMinutes = 3) {
    return Payment.create({
      machineId: 'WRM-001',
      requestId: 'req-12345',
      volumeMl: 500,
      amountMinor: 15,
      currency: 'USD',
      tranId: 'tran-test-01',
      clock,
      ttlMinutes,
    });
  }

  it('initializes in PENDING status with correct expiration and check schedule', () => {
    const payment = createTestPayment(3);
    expect(payment.status).toBe('PENDING');
    expect(payment.expiresAt.toISOString()).toBe('2026-11-10T12:03:00.000Z');
    expect(payment.nextAbaCheckAt?.toISOString()).toBe('2026-11-10T12:00:03.000Z');
    expect(payment.pullEvents()).toHaveLength(0); // Before attachQr
  });

  it('attaches QR and raises PaymentCreated event', () => {
    const payment = createTestPayment(3);
    payment.attachQr('khqr-sample-string', clock);

    expect(payment.qrString).toBe('khqr-sample-string');
    const events = payment.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('payments.PaymentCreated');
    expect(events[0]?.data).toMatchObject({
      tranId: 'tran-test-01',
      machineId: 'WRM-001',
      amountMinor: 15,
      qrString: 'khqr-sample-string',
    });
  });

  it('transitions PENDING -> PAID on timely approval (<= expiresAt + grace)', () => {
    const payment = createTestPayment(3);
    payment.attachQr('qr', clock);
    payment.pullEvents(); // Clear creation event

    // 1 minute in
    clock.advance(60 * 1000);
    payment.markPaid(clock, 60, 'APV123456', 'callback');

    expect(payment.status).toBe('PAID');
    expect(payment.paidAt?.toISOString()).toBe('2026-11-10T12:01:00.000Z');
    expect(payment.abaApv).toBe('APV123456');
    expect(payment.nextAbaCheckAt).toBeNull();

    const events = payment.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('payments.PaymentPaid');
  });

  it('is idempotent when markPaid is called multiple times on PAID payment', () => {
    const payment = createTestPayment(3);
    payment.attachQr('qr', clock);
    payment.markPaid(clock, 60, 'APV1', 'callback');
    payment.pullEvents();

    // Call again with different source
    payment.markPaid(clock, 60, 'APV1', 'sweep');
    expect(payment.status).toBe('PAID');
    expect(payment.pullEvents()).toHaveLength(0);
  });

  it('transitions PENDING -> EXPIRED -> REFUND_REVIEW when approval arrives past expiresAt + grace', () => {
    const payment = createTestPayment(3); // expires at 12:03:00, grace 60s -> 12:04:00
    payment.attachQr('qr', clock);
    payment.pullEvents();

    // Advance clock to 12:04:05 (past grace)
    clock.setTime(new Date('2026-11-10T12:04:05Z'));
    payment.markPaid(clock, 60, 'APV-LATE', 'callback');

    expect(payment.status).toBe('REFUND_REVIEW');
    const events = payment.pullEvents();
    // Should have raised LatePaymentDetected and RefundReviewOpened
    const types = events.map((e) => e.type);
    expect(types).toContain('payments.LatePaymentDetected');
    expect(types).toContain('payments.RefundReviewOpened');
  });

  it('transitions EXPIRED -> REFUND_REVIEW on late approval (reconcile)', () => {
    const payment = createTestPayment(3);
    payment.attachQr('qr', clock);
    payment.expire(clock);
    expect(payment.status).toBe('EXPIRED');
    payment.pullEvents();

    clock.advance(5 * 60 * 1000); // 5 min later
    payment.markPaid(clock, 60, 'APV-RECONCILE', 'reconcile');

    expect(payment.status).toBe('REFUND_REVIEW');
    const events = payment.pullEvents();
    expect(events.map((e) => e.type)).toEqual([
      'payments.LatePaymentDetected',
      'payments.RefundReviewOpened',
    ]);
  });

  it('transitions PAID -> DISPENSED on ok outcome', () => {
    const payment = createTestPayment(3);
    payment.attachQr('qr', clock);
    payment.markPaid(clock, 60, 'APV1', 'callback');
    payment.pullEvents();

    payment.recordDispense('ok', clock);
    expect(payment.status).toBe('DISPENSED');
    expect(payment.pullEvents()).toHaveLength(0);
  });

  it('transitions PAID -> REFUND_REVIEW on partial or error outcome', () => {
    const payment = createTestPayment(3);
    payment.attachQr('qr', clock);
    payment.markPaid(clock, 60, 'APV1', 'callback');
    payment.pullEvents();

    payment.recordDispense('partial', clock);
    expect(payment.status).toBe('REFUND_REVIEW');
    const events = payment.pullEvents();
    expect(events[0]?.type).toBe('payments.RefundReviewOpened');
    expect(events[0]?.data).toMatchObject({
      reason: 'DISPENSE_PARTIAL',
      suggestedAmountMinor: 15,
    });
  });
});
