import { describe, expect, it } from 'vitest';
import {
  ruleAccuracyMismatch,
  ruleConfigRejected,
  ruleDispenseOutcomeUnknown,
  ruleFaultReported,
  ruleLatePaymentDetected,
  ruleMachineCameOnline,
  ruleMachineWentOffline,
  ruleOutcomeRejected,
  rulePayRequestRejected,
  rulePendingOutcomesStuck,
  ruleReconciliationNeeded,
  ruleRefundCaseDecided,
  ruleRefundCaseStale,
  ruleRefundReviewOpened,
  ruleSiteCheckNeeded,
  shouldMergeAlert,
} from '../src/contexts/monitoring/application/rules/monitoring.rules';

describe('Monitoring Rules & Deduplication', () => {
  describe('Pure Rule Functions', () => {
    it('ruleMachineWentOffline: critical MACHINE_OFFLINE with dedupeKey offline:<machineId>', () => {
      const res = ruleMachineWentOffline({ machineId: 'WRM-001' });
      expect(res).toEqual({
        action: 'raise',
        alert: {
          type: 'MACHINE_OFFLINE',
          severity: 'critical',
          dedupeKey: 'offline:WRM-001',
          message: 'Machine WRM-001 went offline',
          machineId: 'WRM-001',
        },
      });
    });

    it('ruleMachineCameOnline: resolves offline:<machineId>', () => {
      const res = ruleMachineCameOnline({ machineId: 'WRM-001' });
      expect(res).toEqual({
        action: 'resolve',
        dedupeKey: 'offline:WRM-001',
        resolvedBy: 'system',
      });
    });

    it('ruleDispenseOutcomeUnknown: warning DISPENSE_UNKNOWN with dedupeKey unknown:<tranId>', () => {
      const res = ruleDispenseOutcomeUnknown({ tranId: 'TR-100', machineId: 'WRM-001' });
      expect(res).toEqual({
        action: 'raise',
        alert: {
          type: 'DISPENSE_UNKNOWN',
          severity: 'warning',
          dedupeKey: 'unknown:TR-100',
          message: 'Dispense outcome unknown for transaction TR-100',
          machineId: 'WRM-001',
        },
      });
    });

    it('ruleSiteCheckNeeded: critical SITE_CHECK_NEEDED with dedupeKey sitecheck:<tranId>', () => {
      const res = ruleSiteCheckNeeded({ tranId: 'TR-100', machineId: 'WRM-001' });
      expect(res).toEqual({
        action: 'raise',
        alert: {
          type: 'SITE_CHECK_NEEDED',
          severity: 'critical',
          dedupeKey: 'sitecheck:TR-100',
          message: 'Site check needed for transaction TR-100 on machine WRM-001',
          machineId: 'WRM-001',
        },
      });
    });

    it('ruleRefundReviewOpened: info REFUND_REVIEW_OPENED with dedupeKey refund:<tranId>', () => {
      const res = ruleRefundReviewOpened({ tranId: 'TR-100' });
      expect(res).toEqual({
        action: 'raise',
        alert: {
          type: 'REFUND_REVIEW_OPENED',
          severity: 'info',
          dedupeKey: 'refund:TR-100',
          message: 'Refund review opened for transaction TR-100',
        },
      });
    });

    it('ruleRefundCaseStale: warning REFUND_CASE_STALE with dedupeKey refundstale:<tranId>', () => {
      const res = ruleRefundCaseStale({ tranId: 'TR-100', machineId: 'WRM-001' });
      expect(res).toEqual({
        action: 'raise',
        alert: {
          type: 'REFUND_CASE_STALE',
          severity: 'warning',
          dedupeKey: 'refundstale:TR-100',
          message: 'Refund case TR-100 open > 24h',
          machineId: 'WRM-001',
        },
      });
    });

    it('ruleRefundCaseDecided: resolves refundstale:<tranId>', () => {
      const res = ruleRefundCaseDecided({ tranId: 'TR-100' });
      expect(res).toEqual({
        action: 'resolve',
        dedupeKey: 'refundstale:TR-100',
        resolvedBy: 'system',
      });
    });

    it('ruleReconciliationNeeded: critical RECONCILIATION_NEEDED with dedupeKey reconcile:<tranId>', () => {
      const res = ruleReconciliationNeeded({ tranId: 'TR-100' });
      expect(res).toEqual({
        action: 'raise',
        alert: {
          type: 'RECONCILIATION_NEEDED',
          severity: 'critical',
          dedupeKey: 'reconcile:TR-100',
          message: 'Reconciliation needed for transaction TR-100',
        },
      });
    });

    it('ruleOutcomeRejected: critical OUTCOME_REJECTED with dedupeKey rejected:<machineId>:<code>', () => {
      const res = ruleOutcomeRejected({ machineId: 'WRM-001', code: 'DSP_NOT_PAID' });
      expect(res).toEqual({
        action: 'raise',
        alert: {
          type: 'OUTCOME_REJECTED',
          severity: 'critical',
          dedupeKey: 'rejected:WRM-001:DSP_NOT_PAID',
          message: 'Dispense outcome rejected on WRM-001 with code DSP_NOT_PAID',
          machineId: 'WRM-001',
        },
      });
    });

    it('ruleAccuracyMismatch: warning ACCURACY_MISMATCH with dedupeKey accuracy:<machineId>', () => {
      const res = ruleAccuracyMismatch({ machineId: 'WRM-001', diffPercent: 12.5 });
      expect(res).toEqual({
        action: 'raise',
        alert: {
          type: 'ACCURACY_MISMATCH',
          severity: 'warning',
          dedupeKey: 'accuracy:WRM-001',
          message: 'Dispense accuracy mismatch on WRM-001 (diff: 12.5%)',
          machineId: 'WRM-001',
        },
      });
    });

    it('ruleLatePaymentDetected: warning LATE_PAYMENT with dedupeKey late:<tranId>', () => {
      const res = ruleLatePaymentDetected({ tranId: 'TR-100', machineId: 'WRM-001' });
      expect(res).toEqual({
        action: 'raise',
        alert: {
          type: 'LATE_PAYMENT',
          severity: 'warning',
          dedupeKey: 'late:TR-100',
          message: 'Late payment detected for TR-100 on WRM-001',
          machineId: 'WRM-001',
        },
      });
    });

    it('ruleConfigRejected: warning CONFIG_REJECTED with dedupeKey config:<machineId>', () => {
      const res = ruleConfigRejected({ machineId: 'WRM-001', fault: 'CFG_INVALID' });
      expect(res).toEqual({
        action: 'raise',
        alert: {
          type: 'CONFIG_REJECTED',
          severity: 'warning',
          dedupeKey: 'config:WRM-001',
          message: 'Config rejected on WRM-001: CFG_INVALID',
          machineId: 'WRM-001',
        },
      });
    });

    describe('ruleFaultReported', () => {
      it('fault NONE resolves TANK_EMPTY and TANK_LOW', () => {
        const res = ruleFaultReported({ machineId: 'WRM-001', fault: 'NONE' });
        expect(res).toEqual({
          action: 'resolve_many',
          dedupeKeys: ['fault:WRM-001:TANK_EMPTY', 'fault:WRM-001:TANK_LOW'],
          resolvedBy: 'system',
        });
      });

      it('critical faults get critical severity (TANK_EMPTY, NO_FLOW, OVERFLOW, DISPENSE_TIMEOUT, LOADCELL_FAULT, etc.)', () => {
        const criticals = ['TANK_EMPTY', 'NO_FLOW', 'OVERFLOW', 'DISPENSE_TIMEOUT', 'LOADCELL_FAULT', 'FLOW_SENSOR_FAULT', 'VALVE_FAULT', 'PUMP_FAULT'];
        for (const fault of criticals) {
          const res = ruleFaultReported({ machineId: 'WRM-001', fault });
          expect(res).toEqual({
            action: 'raise',
            alert: {
              type: `FAULT_${fault}`,
              severity: 'critical',
              dedupeKey: `fault:WRM-001:${fault}`,
              message: `Fault reported on WRM-001: ${fault}`,
              machineId: 'WRM-001',
            },
          });
        }
      });

      it('warning faults get warning severity (TANK_LOW, BOTTLE_REMOVED, PAID_NOT_ACCEPTED, POWER_LOSS_RECOVERY, CFG_INVALID, UNKNOWN)', () => {
        const warnings = ['TANK_LOW', 'BOTTLE_REMOVED', 'PAID_NOT_ACCEPTED', 'POWER_LOSS_RECOVERY', 'CFG_INVALID', 'UNKNOWN'];
        for (const fault of warnings) {
          const res = ruleFaultReported({ machineId: 'WRM-001', fault });
          expect(res).toEqual({
            action: 'raise',
            alert: {
              type: `FAULT_${fault}`,
              severity: 'warning',
              dedupeKey: `fault:WRM-001:${fault}`,
              message: `Fault reported on WRM-001: ${fault}`,
              machineId: 'WRM-001',
            },
          });
        }
      });

      it('info faults get info severity (BOTTLE_TIMEOUT)', () => {
        const res = ruleFaultReported({ machineId: 'WRM-001', fault: 'BOTTLE_TIMEOUT' });
        expect(res).toEqual({
          action: 'raise',
          alert: {
            type: 'FAULT_BOTTLE_TIMEOUT',
            severity: 'info',
            dedupeKey: 'fault:WRM-001:BOTTLE_TIMEOUT',
            message: 'Fault reported on WRM-001: BOTTLE_TIMEOUT',
            machineId: 'WRM-001',
          },
        });
      });
    });

    it('rulePendingOutcomesStuck: warning PENDING_OUTCOMES_STUCK with dedupeKey pending:<machineId>', () => {
      const res = rulePendingOutcomesStuck({ machineId: 'WRM-001', pendingOutcomes: 3 });
      expect(res).toEqual({
        action: 'raise',
        alert: {
          type: 'PENDING_OUTCOMES_STUCK',
          severity: 'warning',
          dedupeKey: 'pending:WRM-001',
          message: 'Machine WRM-001 has 3 pending outcomes stuck for >= 1h',
          machineId: 'WRM-001',
        },
      });
    });

    describe('rulePayRequestRejected', () => {
      it('returns null if count < 3', () => {
        expect(rulePayRequestRejected({ machineId: 'WRM-001', code: 'RATE_LIMITED', count: 1 })).toBeNull();
        expect(rulePayRequestRejected({ machineId: 'WRM-001', code: 'RATE_LIMITED', count: 2 })).toBeNull();
      });

      it('raises warning PAY_REQUEST_REJECTED when count >= 3', () => {
        const res = rulePayRequestRejected({ machineId: 'WRM-001', code: 'RATE_LIMITED', count: 3 });
        expect(res).toEqual({
          action: 'raise',
          alert: {
            type: 'PAY_REQUEST_REJECTED',
            severity: 'warning',
            dedupeKey: 'payreject:WRM-001:RATE_LIMITED',
            message: 'Repeated pay/request rejections on WRM-001 with code RATE_LIMITED (3 times)',
            machineId: 'WRM-001',
          },
        });
      });
    });
  });

  describe('Dedupe & Merge Decision (shouldMergeAlert)', () => {
    const now = new Date('2026-11-12T12:00:00Z');

    it('returns false if no existing alert exists', () => {
      expect(shouldMergeAlert(null, now)).toBe(false);
      expect(shouldMergeAlert(undefined, now)).toBe(false);
    });

    it('returns true if existing alert is active', () => {
      expect(shouldMergeAlert({ status: 'active' }, now)).toBe(true);
    });

    it('returns true if existing alert is acknowledged', () => {
      expect(shouldMergeAlert({ status: 'acknowledged' }, now)).toBe(true);
    });

    it('returns true if existing alert was resolved less than 10 minutes ago', () => {
      const resolvedAt = new Date(now.getTime() - 5 * 60 * 1000); // 5 min ago
      expect(shouldMergeAlert({ status: 'resolved', resolvedAt }, now)).toBe(true);
    });

    it('returns false if existing alert was resolved more than 10 minutes ago', () => {
      const resolvedAt = new Date(now.getTime() - 11 * 60 * 1000); // 11 min ago
      expect(shouldMergeAlert({ status: 'resolved', resolvedAt }, now)).toBe(false);
    });

    it('returns false if resolved alert has null resolvedAt', () => {
      expect(shouldMergeAlert({ status: 'resolved', resolvedAt: null }, now)).toBe(false);
    });
  });
});

