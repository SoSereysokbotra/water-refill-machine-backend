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
  return createDomainEvent('payments.PaymentCreated', data, occurredAt);
}

export function paymentPaidEvent(data: PaymentPaidData, occurredAt: Date): DomainEvent<PaymentPaidData> {
  return createDomainEvent('payments.PaymentPaid', data, occurredAt);
}

export function paymentExpiredEvent(data: PaymentExpiredData, occurredAt: Date): DomainEvent<PaymentExpiredData> {
  return createDomainEvent('payments.PaymentExpired', data, occurredAt);
}

export function paymentCancelledEvent(data: PaymentCancelledData, occurredAt: Date): DomainEvent<PaymentCancelledData> {
  return createDomainEvent('payments.PaymentCancelled', data, occurredAt);
}

export function paymentFailedEvent(data: PaymentFailedData, occurredAt: Date): DomainEvent<PaymentFailedData> {
  return createDomainEvent('payments.PaymentFailed', data, occurredAt);
}

export function latePaymentDetectedEvent(data: LatePaymentDetectedData, occurredAt: Date): DomainEvent<LatePaymentDetectedData> {
  return createDomainEvent('payments.LatePaymentDetected', data, occurredAt);
}

export function refundReviewOpenedEvent(data: RefundReviewOpenedData, occurredAt: Date): DomainEvent<RefundReviewOpenedData> {
  return createDomainEvent('payments.RefundReviewOpened', data, occurredAt);
}
