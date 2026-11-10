import { DomainEvent, createDomainEvent } from '../../../shared-kernel';
import { Currency } from './payment.types';

export interface PaymentCreatedData {
  tranId: string;
  machineId: string;
  requestId: string;
  volumeMl: number;
  amountMinor: number;
  currency: Currency;
  qrString: string;
  expiresAt: Date;
}

export interface PaymentPaidData {
  tranId: string;
  machineId: string;
  paidAt: Date;
  abaApv?: string;
}

export interface PaymentExpiredData {
  tranId: string;
  machineId: string;
  reason?: string;
}

export interface PaymentCancelledData {
  tranId: string;
  machineId: string;
  reason?: string;
}

export interface PaymentFailedData {
  tranId: string;
  machineId: string;
  reason?: string;
}

export interface LatePaymentDetectedData {
  tranId: string;
  machineId: string;
  foundBy: 'callback' | 'sweep' | 'reconcile';
}

export interface RefundReviewOpenedData {
  tranId: string;
  reason: string;
  suggestedAmountMinor: number;
}

export function paymentCreatedEvent(data: PaymentCreatedData, occurredAt: Date): DomainEvent<PaymentCreatedData> {
  return createDomainEvent('payments.PaymentCreated', data, { occurredAt });
}

export function paymentPaidEvent(data: PaymentPaidData, occurredAt: Date): DomainEvent<PaymentPaidData> {
  return createDomainEvent('payments.PaymentPaid', data, { occurredAt });
}

export function paymentExpiredEvent(data: PaymentExpiredData, occurredAt: Date): DomainEvent<PaymentExpiredData> {
  return createDomainEvent('payments.PaymentExpired', data, { occurredAt });
}

export function paymentCancelledEvent(data: PaymentCancelledData, occurredAt: Date): DomainEvent<PaymentCancelledData> {
  return createDomainEvent('payments.PaymentCancelled', data, { occurredAt });
}

export function paymentFailedEvent(data: PaymentFailedData, occurredAt: Date): DomainEvent<PaymentFailedData> {
  return createDomainEvent('payments.PaymentFailed', data, { occurredAt });
}

export function latePaymentDetectedEvent(data: LatePaymentDetectedData, occurredAt: Date): DomainEvent<LatePaymentDetectedData> {
  return createDomainEvent('payments.LatePaymentDetected', data, { occurredAt });
}

export function refundReviewOpenedEvent(data: RefundReviewOpenedData, occurredAt: Date): DomainEvent<RefundReviewOpenedData> {
  return createDomainEvent('payments.RefundReviewOpened', data, { occurredAt });
}

export interface RefundClaimedData {
  tranId: string;
  by: string;
  until: Date;
}

export interface PaymentRefundedData {
  tranId: string;
  by: string;
  amountMinor: number;
  reference: string;
  method: string;
}

export interface RefundRejectedData {
  tranId: string;
  by: string;
  reason: string;
}

export interface RefundReopenedData {
  tranId: string;
  by: string;
  reason: string;
}

export interface DispenseCompletedData {
  tranId: string;
  machineId: string;
  flowMl: number;
  weightG: number;
  diffPercent: number;
}

export interface DispenseFailedData {
  tranId: string;
  machineId: string;
  result: 'partial' | 'error';
  flowMl: number;
  weightG: number;
  fault?: string;
}

export interface DispenseOutcomeUnknownData {
  tranId: string;
  machineId: string;
}

export interface AccuracyMismatchData {
  tranId: string;
  machineId: string;
  diffPercent: number;
}

export interface OutcomeRejectedData {
  machineId: string;
  tranId?: string;
  code: string;
}

export interface ReconciliationNeededData {
  tranId: string;
  currentStatus: string;
  lateOutcome: unknown;
}

export function refundClaimedEvent(data: RefundClaimedData, occurredAt: Date): DomainEvent<RefundClaimedData> {
  return createDomainEvent('payments.RefundClaimed', data, { occurredAt });
}

export function paymentRefundedEvent(data: PaymentRefundedData, occurredAt: Date): DomainEvent<PaymentRefundedData> {
  return createDomainEvent('payments.Refunded', data, { occurredAt });
}

export function refundRejectedEvent(data: RefundRejectedData, occurredAt: Date): DomainEvent<RefundRejectedData> {
  return createDomainEvent('payments.RefundRejected', data, { occurredAt });
}

export function refundReopenedEvent(data: RefundReopenedData, occurredAt: Date): DomainEvent<RefundReopenedData> {
  return createDomainEvent('payments.RefundReopened', data, { occurredAt });
}

export function dispenseCompletedEvent(data: DispenseCompletedData, occurredAt: Date): DomainEvent<DispenseCompletedData> {
  return createDomainEvent('dispensing.DispenseCompleted', data, { occurredAt });
}

export function dispenseFailedEvent(data: DispenseFailedData, occurredAt: Date): DomainEvent<DispenseFailedData> {
  return createDomainEvent('dispensing.DispenseFailed', data, { occurredAt });
}

export function dispenseOutcomeUnknownEvent(data: DispenseOutcomeUnknownData, occurredAt: Date): DomainEvent<DispenseOutcomeUnknownData> {
  return createDomainEvent('dispensing.DispenseOutcomeUnknown', data, { occurredAt });
}

export function accuracyMismatchEvent(data: AccuracyMismatchData, occurredAt: Date): DomainEvent<AccuracyMismatchData> {
  return createDomainEvent('dispensing.AccuracyMismatch', data, { occurredAt });
}

export function outcomeRejectedEvent(data: OutcomeRejectedData, occurredAt: Date): DomainEvent<OutcomeRejectedData> {
  return createDomainEvent('dispensing.OutcomeRejected', data, { occurredAt });
}

export function reconciliationNeededEvent(data: ReconciliationNeededData, occurredAt: Date): DomainEvent<ReconciliationNeededData> {
  return createDomainEvent('dispensing.ReconciliationNeeded', data, { occurredAt });
}
