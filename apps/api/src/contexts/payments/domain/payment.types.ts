export type PaymentStatus =
  | 'PENDING'
  | 'PAID'
  | 'DISPENSED'
  | 'DISPENSE_UNKNOWN'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'FAILED'
  | 'REFUND_REVIEW'
  | 'REFUNDED'
  | 'REFUND_REJECTED';

export type Currency = 'KHR' | 'USD';

export interface PaymentProps {
  tranId: string;
  machineId: string;
  requestId: string;
  volumeMl: number;
  amountMinor: number;
  currency: Currency;
  status: PaymentStatus;
  qrString: string;
  expiresAt: Date;
  paidAt?: Date | null;
  abaApv?: string | null;
  nextAbaCheckAt?: Date | null;
  abaCheckCount?: number;
  lastAbaCheckAt?: Date | null;
  closedAt?: Date | null;
  refundedAmountMinor?: number | null;
  refundedAt?: Date | null;
  version?: number;
  createdAt?: Date;
  updatedAt?: Date;
}
