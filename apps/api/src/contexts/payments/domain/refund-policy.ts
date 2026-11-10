import { Currency } from './payment.types';

export type RefundReasonCode =
  | 'LATE_PAYMENT'
  | 'BOTTLE_TIMEOUT'
  | 'PAID_NOT_ACCEPTED'
  | 'DISPENSE_FAILED'
  | 'DISPENSE_PARTIAL'
  | 'DISPENSE_UNKNOWN_ESCALATED'
  | 'ADMIN_OVERRIDE';

export interface RefundCalculationInput {
  reason: RefundReasonCode;
  amountMinor: number;
  volumeMl: number;
  flowMl?: number;
  currency: Currency;
  fault?: string;
}

/**
 * Calculates suggested refund amount in minor currency units per ADR-0008 and Plan §C1.
 * - Late payment: 100%
 * - Faults with flow < 10% (or BOTTLE_TIMEOUT / PAID_NOT_ACCEPTED): 100%
 * - Partial dispense: (1 - flow / volume) * amount, rounded per currency scale
 */
export function calculateSuggestedRefund(input: RefundCalculationInput): number {
  if (input.amountMinor <= 0) return 0;

  // 100% refund cases
  if (
    input.reason === 'LATE_PAYMENT' ||
    input.reason === 'BOTTLE_TIMEOUT' ||
    input.reason === 'PAID_NOT_ACCEPTED' ||
    input.reason === 'DISPENSE_UNKNOWN_ESCALATED' ||
    input.fault === 'BOTTLE_TIMEOUT' ||
    input.fault === 'PAID_NOT_ACCEPTED'
  ) {
    return input.amountMinor;
  }

  const flowMl = Math.max(0, input.flowMl ?? 0);
  const volumeMl = Math.max(1, input.volumeMl);

  // If dispensed less than 10% of volume on error/partial -> full refund
  if (flowMl < 0.1 * volumeMl) {
    return input.amountMinor;
  }

  // If physically delivered >= 100% volume -> no refund
  if (flowMl >= volumeMl) {
    return 0;
  }

  // Pro-rated partial refund
  const unfulfilledRatio = (volumeMl - flowMl) / volumeMl;
  const rawRefund = unfulfilledRatio * input.amountMinor;

  // Rounding:
  // USD minor is cents (integer cents)
  // KHR minor is Riels (integer Riels)
  const rounded = Math.round(rawRefund);
  return Math.min(input.amountMinor, Math.max(0, rounded));
}
