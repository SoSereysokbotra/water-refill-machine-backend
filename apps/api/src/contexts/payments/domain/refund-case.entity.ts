import { Clock, ConflictError, DomainError } from '../../../shared-kernel';

export type RefundStatus = 'open' | 'claimed' | 'refunded' | 'rejected' | 'auto_failed';
export type RefundReason =
  | 'LATE_PAYMENT'
  | 'DISPENSE_FAILED'
  | 'DISPENSE_PARTIAL'
  | 'DISPENSE_UNKNOWN';

export interface RefundCaseProps {
  tranId: string;
  reason: RefundReason;
  suggestedAmountMinor: number;
  refundedAmountMinor?: number | null;
  status?: RefundStatus;
  claimedBy?: string | null;
  claimedUntil?: Date | null;
  method?: string | null;
  reference?: string | null;
  decidedBy?: string | null;
  decidedAt?: Date | null;
  decisionReason?: string | null;
  attempts?: number;
  lastError?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class RefundCase {
  readonly tranId: string;
  readonly reason: RefundReason;
  readonly suggestedAmountMinor: number;
  refundedAmountMinor: number | null;
  status: RefundStatus;
  claimedBy: string | null;
  claimedUntil: Date | null;
  method: string | null;
  reference: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionReason: string | null;
  attempts: number;
  lastError: string | null;
  readonly createdAt: Date;
  updatedAt: Date;

  constructor(props: RefundCaseProps) {
    this.tranId = props.tranId;
    this.reason = props.reason;
    this.suggestedAmountMinor = props.suggestedAmountMinor;
    this.refundedAmountMinor = props.refundedAmountMinor ?? null;
    this.status = props.status ?? 'open';
    this.claimedBy = props.claimedBy ?? null;
    this.claimedUntil = props.claimedUntil ?? null;
    this.method = props.method ?? null;
    this.reference = props.reference ?? null;
    this.decidedBy = props.decidedBy ?? null;
    this.decidedAt = props.decidedAt ?? null;
    this.decisionReason = props.decisionReason ?? null;
    this.attempts = props.attempts ?? 0;
    this.lastError = props.lastError ?? null;
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  isClaimActive(now: Date): boolean {
    if (this.status !== 'claimed' || !this.claimedBy || !this.claimedUntil) {
      return false;
    }
    return now.getTime() < this.claimedUntil.getTime();
  }

  claim(actorId: string, durationMinutes: number, clock: Clock): void {
    const now = clock.now();
    if (this.status === 'refunded' || this.status === 'rejected') {
      throw new DomainError('REFUND_ALREADY_DECIDED', `Refund case ${this.tranId} is already decided (${this.status})`);
    }

    if (this.isClaimActive(now) && this.claimedBy !== actorId) {
      throw new ConflictError(
        'REFUND_ALREADY_CLAIMED',
        `Refund case is already claimed by ${this.claimedBy} until ${this.claimedUntil?.toISOString()}`,
      );
    }

    this.status = 'claimed';
    this.claimedBy = actorId;
    this.claimedUntil = new Date(now.getTime() + durationMinutes * 60 * 1000);
    this.updatedAt = now;
  }

  markRefunded(params: {
    actorId: string;
    method: string;
    reference: string;
    amountMinor: number;
    clock: Clock;
  }): void {
    const now = params.clock.now();
    if (this.status === 'refunded') {
      throw new DomainError('REFUND_ALREADY_DECIDED', `Refund case ${this.tranId} is already refunded`);
    }

    // C7: only the operator holding an active claim may record the refund
    // (the claim stops two operators paying the same customer twice).
    if (!this.isClaimActive(now) || this.claimedBy !== params.actorId) {
      throw new DomainError(
        'REFUND_INVALID_STATE',
        `Refund case ${this.tranId} must be claimed by ${params.actorId} (active claim) before marking it refunded`,
      );
    }

    this.status = 'refunded';
    this.refundedAmountMinor = params.amountMinor;
    this.method = params.method;
    this.reference = params.reference;
    this.decidedBy = params.actorId;
    this.decidedAt = now;
    this.claimedUntil = null;
    this.updatedAt = now;
  }

  reject(params: { actorId: string; reason: string; clock: Clock }): void {
    const now = params.clock.now();
    if (this.status === 'refunded') {
      throw new DomainError('REFUND_ALREADY_DECIDED', `Refund case ${this.tranId} is already refunded`);
    }

    if (this.isClaimActive(now) && this.claimedBy !== params.actorId) {
      throw new DomainError('REFUND_INVALID_STATE', `Refund case ${this.tranId} is currently claimed by ${this.claimedBy}`);
    }

    this.status = 'rejected';
    this.decisionReason = params.reason;
    this.decidedBy = params.actorId;
    this.decidedAt = now;
    this.claimedUntil = null;
    this.updatedAt = now;
  }

  reopen(params: { actorId: string; reason: string; clock: Clock }): void {
    const now = params.clock.now();
    if (this.status !== 'rejected') {
      throw new DomainError('REFUND_INVALID_STATE', `Only rejected refund cases can be reopened (current: ${this.status})`);
    }

    this.status = 'open';
    this.decisionReason = `Reopened: ${params.reason}`;
    this.decidedBy = null;
    this.decidedAt = null;
    this.claimedBy = null;
    this.claimedUntil = null;
    this.updatedAt = now;
  }
}
