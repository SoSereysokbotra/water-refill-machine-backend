import { beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../src/shared-kernel';
import { Payment } from '../src/contexts/payments/domain/payment.aggregate';
import { Dispense } from '../src/contexts/payments/domain/dispense.entity';
import { RefundCase } from '../src/contexts/payments/domain/refund-case.entity';
import { calculateSuggestedRefund } from '../src/contexts/payments/domain/refund-policy';

describe('Phase 3 Domain Models & Rules', () => {
  const clock = new FakeClock(new Date('2026-11-10T12:00:00Z'));

  beforeEach(() => {
    clock.setTime(new Date('2026-11-10T12:00:00Z'));
  });

  describe('Dispense Entity & Accuracy Check', () => {
    it('calculates discrepancy percentage accurately (|flow - weight| / target * 100)', () => {
      // 500 mL target, flow = 502, weight = 504 -> diff = 2 -> (2 / 500) * 100 = 0.40%
      const diff1 = Dispense.calculateDiffPercent(502, 504, 500);
      expect(diff1).toBe(0.4);

      // 500 mL target, flow = 450, weight = 500 -> diff = 50 -> (50 / 500) * 100 = 10.00%
      const diff2 = Dispense.calculateDiffPercent(450, 500, 500);
      expect(diff2).toBe(10);
    });

    it('flags accuracy mismatch when discrepancy exceeds 5%', () => {
      const normalDispense = new Dispense({
        tranId: 'tran-1',
        machineId: 'WRM-001',
        result: 'ok',
        flowMl: 502,
        weightG: 504,
        diffPercent: 0.4,
        occurredAt: clock.now(),
      });
      expect(normalDispense.hasAccuracyMismatch).toBe(false);

      const erraticDispense = new Dispense({
        tranId: 'tran-2',
        machineId: 'WRM-001',
        result: 'ok',
        flowMl: 460,
        weightG: 500,
        diffPercent: 8.0,
        occurredAt: clock.now(),
      });
      expect(erraticDispense.hasAccuracyMismatch).toBe(true);
    });
  });

  describe('Refund Policy Calculation (ADR-0008 / Plan §C1)', () => {
    it('suggests 100% refund for late payments, bottle timeouts, and paid not accepted', () => {
      expect(
        calculateSuggestedRefund({
          reason: 'LATE_PAYMENT',
          amountMinor: 15,
          volumeMl: 500,
          currency: 'USD',
        }),
      ).toBe(15);

      expect(
        calculateSuggestedRefund({
          reason: 'BOTTLE_TIMEOUT',
          amountMinor: 1000,
          volumeMl: 1000,
          currency: 'KHR',
        }),
      ).toBe(1000);

      expect(
        calculateSuggestedRefund({
          reason: 'PAID_NOT_ACCEPTED',
          amountMinor: 25,
          volumeMl: 1000,
          currency: 'USD',
        }),
      ).toBe(25);
    });

    it('suggests 100% refund if flow is less than 10% of volume on failure', () => {
      // 500 mL requested, but only 30 mL pumped before pump fault
      const refund = calculateSuggestedRefund({
        reason: 'DISPENSE_FAILED',
        amountMinor: 15,
        volumeMl: 500,
        flowMl: 30, // 6% of target
        currency: 'USD',
        fault: 'PUMP_FAULT',
      });
      expect(refund).toBe(15);
    });

    it('pro-rates partial dispenses correctly and rounds per currency scale', () => {
      // USD: 1000 mL costs 25 cents ($0.25). Delivered 600 mL (60%).
      // Unfulfilled = 40% -> 40% of 25 = 10 cents
      const usdRefund = calculateSuggestedRefund({
        reason: 'DISPENSE_PARTIAL',
        amountMinor: 25,
        volumeMl: 1000,
        flowMl: 600,
        currency: 'USD',
      });
      expect(usdRefund).toBe(10);

      // KHR: 1000 mL costs 1000 KHR. Delivered 750 mL (75%).
      // Unfulfilled = 25% -> 250 KHR
      const khrRefund = calculateSuggestedRefund({
        reason: 'DISPENSE_PARTIAL',
        amountMinor: 1000,
        volumeMl: 1000,
        flowMl: 750,
        currency: 'KHR',
      });
      expect(khrRefund).toBe(250);
    });

    it('suggests 0 refund if delivered volume meets target', () => {
      const refund = calculateSuggestedRefund({
        reason: 'DISPENSE_PARTIAL',
        amountMinor: 15,
        volumeMl: 500,
        flowMl: 500,
        currency: 'USD',
      });
      expect(refund).toBe(0);
    });
  });

  describe('RefundCase Entity Operations & Concurrency', () => {
    it('claims an open case and prevents conflicting operator claims during active claim period', () => {
      const rc = new RefundCase({
        tranId: 'tran-rc-1',
        reason: 'late_payment',
        suggestedAmountMinor: 15,
      });

      expect(rc.status).toBe('open');
      rc.claim('admin-alice', 30, clock);

      expect(rc.status).toBe('claimed');
      expect(rc.claimedBy).toBe('admin-alice');
      expect(rc.isClaimActive(clock.now())).toBe(true);

      // Same operator re-claiming is allowed
      expect(() => rc.claim('admin-alice', 30, clock)).not.toThrow();

      // Different operator cannot claim while claim is active
      expect(() => rc.claim('admin-bob', 30, clock)).toThrowError(/already claimed by admin-alice/);

      // After claim expires (31 minutes later), another operator can claim
      clock.advance(31 * 60 * 1000);
      expect(rc.isClaimActive(clock.now())).toBe(false);
      rc.claim('admin-bob', 30, clock);
      expect(rc.claimedBy).toBe('admin-bob');
    });

    it('marks refunded and rejects further decision attempts', () => {
      const rc = new RefundCase({
        tranId: 'tran-rc-2',
        reason: 'dispense_failed',
        suggestedAmountMinor: 25,
      });

      rc.claim('admin-alice', 30, clock);
      rc.markRefunded({
        actorId: 'admin-alice',
        method: 'ABA_PORTAL',
        reference: 'ABA-REF-9988',
        amountMinor: 25,
        clock,
      });

      expect(rc.status).toBe('refunded');
      expect(rc.refundedAmountMinor).toBe(25);
      expect(rc.reference).toBe('ABA-REF-9988');

      // Cannot claim or decide once refunded
      expect(() => rc.claim('admin-bob', 30, clock)).toThrowError(/already decided/);
      expect(() => rc.reject({ actorId: 'admin-alice', reason: 'Too late', clock })).toThrowError(/already refunded/);
    });

    it('rejects and can be reopened by administrator', () => {
      const rc = new RefundCase({
        tranId: 'tran-rc-3',
        reason: 'dispense_partial',
        suggestedAmountMinor: 10,
      });

      rc.reject({ actorId: 'admin-alice', reason: 'Water was manually poured', clock });
      expect(rc.status).toBe('rejected');

      // Admin reopens on complaint
      rc.reopen({ actorId: 'admin-super', reason: 'Customer disputed via Telegram', clock });
      expect(rc.status).toBe('open');
      expect(rc.claimedBy).toBeNull();
    });
  });

  describe('Payment Aggregate Phase 3 State Machine', () => {
    function createPaidPayment() {
      const p = Payment.create({
        machineId: 'WRM-001',
        requestId: 'req-p3',
        volumeMl: 500,
        amountMinor: 15,
        currency: 'USD',
        tranId: 'tran-p3-01',
        clock,
        ttlMinutes: 3,
      });
      p.attachQr('khqr', clock);
      p.markPaid(clock, 60, 'APV123', 'callback');
      p.pullEvents();
      return p;
    }

    it('transitions PAID -> DISPENSED on ok outcome', () => {
      const p = createPaidPayment();
      const res = p.recordOutcome({
        result: 'ok',
        flowMl: 502,
        weightG: 504,
        diffPercent: 0.4,
        clock,
      });

      expect(res.isLate).toBe(false);
      expect(p.status).toBe('DISPENSED');

      const events = p.pullEvents();
      expect(events.map((e) => e.type)).toContain('dispensing.DispenseCompleted');
    });

    it('transitions PAID -> REFUND_REVIEW on partial outcome with suggested refund', () => {
      const p = createPaidPayment();
      const res = p.recordOutcome({
        result: 'partial',
        flowMl: 250, // 50%
        weightG: 250,
        diffPercent: 0,
        fault: 'BOTTLE_REMOVED',
        clock,
      });

      expect(res.isLate).toBe(false);
      expect(res.suggestedRefundMinor).toBe(8); // 50% of 15 rounded = 8
      expect(p.status).toBe('REFUND_REVIEW');

      const events = p.pullEvents();
      expect(events.map((e) => e.type)).toContain('dispensing.DispenseFailed');
      expect(events.map((e) => e.type)).toContain('payments.RefundReviewOpened');
    });

    it('transitions PAID -> DISPENSE_UNKNOWN on 300s timeout', () => {
      const p = createPaidPayment();
      clock.advance(301 * 1000);
      p.markDispenseUnknown(clock);

      expect(p.status).toBe('DISPENSE_UNKNOWN');
      const events = p.pullEvents();
      expect(events.map((e) => e.type)).toContain('dispensing.DispenseOutcomeUnknown');

      // If outcome ok arrives later -> successfully transitions to DISPENSED
      p.recordOutcome({
        result: 'ok',
        flowMl: 500,
        weightG: 500,
        diffPercent: 0,
        clock,
      });
      expect(p.status).toBe('DISPENSED');
    });

    it('escalates DISPENSE_UNKNOWN -> REFUND_REVIEW after 24h', () => {
      const p = createPaidPayment();
      p.markDispenseUnknown(clock);
      clock.advance(24 * 3600 * 1000);

      p.escalateUnknownToRefundReview(clock);
      expect(p.status).toBe('REFUND_REVIEW');
    });

    it('flags late outcome if received after payment is already DISPENSED', () => {
      const p = createPaidPayment();
      p.recordOutcome({
        result: 'ok',
        flowMl: 502,
        weightG: 504,
        diffPercent: 0.4,
        clock,
      });
      expect(p.status).toBe('DISPENSED');
      p.pullEvents();

      // Duplicate or late outcome arrives
      const res = p.recordOutcome({
        result: 'ok',
        flowMl: 502,
        weightG: 504,
        diffPercent: 0.4,
        clock,
      });
      expect(res.isLate).toBe(true);
      expect(p.status).toBe('DISPENSED'); // Unchanged

      const events = p.pullEvents();
      expect(events.map((e) => e.type)).toContain('dispensing.ReconciliationNeeded');
    });

    it('handles refund lifecycle: REFUND_REVIEW -> REFUNDED or REFUND_REJECTED -> reopened', () => {
      const p = createPaidPayment();
      p.recordOutcome({
        result: 'error',
        flowMl: 0,
        weightG: 0,
        diffPercent: 0,
        fault: 'NO_FLOW',
        clock,
      });
      expect(p.status).toBe('REFUND_REVIEW');

      p.claimRefund('admin-1', 30, clock);
      p.markRefunded({
        adminId: 'admin-1',
        method: 'ABA_KHQR',
        reference: 'REF-TX-001',
        amountMinor: 15,
        clock,
      });
      expect(p.status).toBe('REFUNDED');
      expect(p.refundedAmountMinor).toBe(15);
      expect(p.refundedAt).not.toBeNull();
    });
  });
});
