import { FAULT_SEVERITY, FaultCode } from '@wrm/contracts';
import { AlertSeverity } from '@prisma/client';

export interface AlertDefinition {
  type: string;
  severity: AlertSeverity;
  dedupeKey: string;
  message: string;
  machineId?: string | null;
}

export type RuleResult =
  | { action: 'raise'; alert: AlertDefinition }
  | { action: 'resolve'; dedupeKey: string; resolvedBy: string }
  | { action: 'resolve_many'; dedupeKeys: string[]; resolvedBy: string }
  | null;

export const MERGE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Pure dedupe/merge rule:
 * If an alert with the same dedupe key is active or acknowledged,
 * or was resolved less than 10 minutes ago -> merge (increment count, update lastSeenAt).
 */
export function shouldMergeAlert(
  existing: { status: 'active' | 'acknowledged' | 'resolved'; resolvedAt?: Date | null } | null | undefined,
  now: Date,
  mergeWindowMs: number = MERGE_WINDOW_MS,
): boolean {
  if (!existing) return false;
  if (existing.status === 'active' || existing.status === 'acknowledged') {
    return true;
  }
  if (existing.status === 'resolved' && existing.resolvedAt) {
    return now.getTime() - existing.resolvedAt.getTime() < mergeWindowMs;
  }
  return false;
}

export function ruleMachineWentOffline(data: { machineId: string }): RuleResult {
  return {
    action: 'raise',
    alert: {
      type: 'MACHINE_OFFLINE',
      severity: 'critical',
      dedupeKey: `offline:${data.machineId}`,
      message: `Machine ${data.machineId} went offline`,
      machineId: data.machineId,
    },
  };
}

export function ruleMachineCameOnline(data: { machineId: string }): RuleResult {
  return {
    action: 'resolve',
    dedupeKey: `offline:${data.machineId}`,
    resolvedBy: 'system',
  };
}

export function ruleDispenseOutcomeUnknown(data: { tranId: string; machineId?: string }): RuleResult {
  return {
    action: 'raise',
    alert: {
      type: 'DISPENSE_UNKNOWN',
      severity: 'warning',
      dedupeKey: `unknown:${data.tranId}`,
      message: `Dispense outcome unknown for transaction ${data.tranId}`,
      machineId: data.machineId ?? null,
    },
  };
}

export function ruleSiteCheckNeeded(data: { tranId: string; machineId: string }): RuleResult {
  return {
    action: 'raise',
    alert: {
      type: 'SITE_CHECK_NEEDED',
      severity: 'critical',
      dedupeKey: `sitecheck:${data.tranId}`,
      message: `Site check needed for transaction ${data.tranId} on machine ${data.machineId}`,
      machineId: data.machineId,
    },
  };
}

export function ruleRefundReviewOpened(data: { tranId: string }): RuleResult {
  return {
    action: 'raise',
    alert: {
      type: 'REFUND_REVIEW_OPENED',
      severity: 'info',
      dedupeKey: `refund:${data.tranId}`,
      message: `Refund review opened for transaction ${data.tranId}`,
    },
  };
}

export function ruleRefundCaseStale(data: { tranId: string; machineId?: string | null }): RuleResult {
  return {
    action: 'raise',
    alert: {
      type: 'REFUND_CASE_STALE',
      severity: 'warning',
      dedupeKey: `refundstale:${data.tranId}`,
      message: `Refund case ${data.tranId} open > 24h`,
      machineId: data.machineId ?? null,
    },
  };
}

export function ruleRefundCaseDecided(data: { tranId: string }): RuleResult {
  return {
    action: 'resolve',
    dedupeKey: `refundstale:${data.tranId}`,
    resolvedBy: 'system',
  };
}

export function ruleReconciliationNeeded(data: { tranId: string }): RuleResult {
  return {
    action: 'raise',
    alert: {
      type: 'RECONCILIATION_NEEDED',
      severity: 'critical',
      dedupeKey: `reconcile:${data.tranId}`,
      message: `Reconciliation needed for transaction ${data.tranId}`,
    },
  };
}

export function ruleOutcomeRejected(data: { machineId: string; tranId?: string; code: string }): RuleResult {
  return {
    action: 'raise',
    alert: {
      type: 'OUTCOME_REJECTED',
      severity: 'critical',
      dedupeKey: `rejected:${data.machineId}:${data.code}`,
      message: `Dispense outcome rejected on ${data.machineId} with code ${data.code}${data.tranId ? ` (tran: ${data.tranId})` : ''}`,
      machineId: data.machineId,
    },
  };
}

export function ruleAccuracyMismatch(data: { machineId: string; diffPercent: number }): RuleResult {
  return {
    action: 'raise',
    alert: {
      type: 'ACCURACY_MISMATCH',
      severity: 'warning',
      dedupeKey: `accuracy:${data.machineId}`,
      message: `Dispense accuracy mismatch on ${data.machineId} (diff: ${data.diffPercent}%)`,
      machineId: data.machineId,
    },
  };
}

export function ruleLatePaymentDetected(data: { tranId: string; machineId: string }): RuleResult {
  return {
    action: 'raise',
    alert: {
      type: 'LATE_PAYMENT',
      severity: 'warning',
      dedupeKey: `late:${data.tranId}`,
      message: `Late payment detected for ${data.tranId} on ${data.machineId}`,
      machineId: data.machineId,
    },
  };
}

export function ruleConfigRejected(data: { machineId: string; fault: string }): RuleResult {
  return {
    action: 'raise',
    alert: {
      type: 'CONFIG_REJECTED',
      severity: 'warning',
      dedupeKey: `config:${data.machineId}`,
      message: `Config rejected on ${data.machineId}: ${data.fault}`,
      machineId: data.machineId,
    },
  };
}

export function ruleFaultReported(data: { machineId: string; fault: string }): RuleResult {
  if (data.fault === 'NONE') {
    return {
      action: 'resolve_many',
      dedupeKeys: [
        `fault:${data.machineId}:TANK_EMPTY`,
        `fault:${data.machineId}:TANK_LOW`,
      ],
      resolvedBy: 'system',
    };
  }

  const code = data.fault as FaultCode;
  const severityMapped = (FAULT_SEVERITY as Record<string, AlertSeverity | null>)[code];
  const severity: AlertSeverity = severityMapped ?? 'warning';

  return {
    action: 'raise',
    alert: {
      type: `FAULT_${data.fault}`,
      severity,
      dedupeKey: `fault:${data.machineId}:${data.fault}`,
      message: `Fault reported on ${data.machineId}: ${data.fault}`,
      machineId: data.machineId,
    },
  };
}

export function rulePendingOutcomesStuck(data: { machineId: string; pendingOutcomes: number }): RuleResult {
  return {
    action: 'raise',
    alert: {
      type: 'PENDING_OUTCOMES_STUCK',
      severity: 'warning',
      dedupeKey: `pending:${data.machineId}`,
      message: `Machine ${data.machineId} has ${data.pendingOutcomes} pending outcomes stuck for >= 1h`,
      machineId: data.machineId,
    },
  };
}

export function rulePayRequestRejected(data: { machineId: string; code: string; count: number }): RuleResult {
  if (data.count < 3) {
    return null;
  }
  return {
    action: 'raise',
    alert: {
      type: 'PAY_REQUEST_REJECTED',
      severity: 'warning',
      dedupeKey: `payreject:${data.machineId}:${data.code}`,
      message: `Repeated pay/request rejections on ${data.machineId} with code ${data.code} (${data.count} times)`,
      machineId: data.machineId,
    },
  };
}
