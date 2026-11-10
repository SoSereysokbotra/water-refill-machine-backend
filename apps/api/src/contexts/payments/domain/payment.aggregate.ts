import { AggregateRoot, Clock, DomainError } from '../../../shared-kernel';
import {
  dispenseCompletedEvent,
  dispenseFailedEvent,
  dispenseOutcomeUnknownEvent,
  latePaymentDetectedEvent,
  paymentCancelledEvent,
  paymentCreatedEvent,
  paymentExpiredEvent,
  paymentFailedEvent,
  paymentPaidEvent,
  paymentRefundedEvent,
  reconciliationNeededEvent,
  refundClaimedEvent,
  refundRejectedEvent,
  refundReopenedEvent,
  refundReviewOpenedEvent,
} from './payment.events';
import { Currency, PaymentProps, PaymentStatus } from './payment.types';
import { calculateSuggestedRefund } from './refund-policy';

export interface StateChangeAudit {
  fromStatus: PaymentStatus;
  toStatus: PaymentStatus;
  reason: string;
  at: Date;
}

export class Payment extends AggregateRoot {
  readonly tranId: string;
  readonly machineId: string;
  readonly requestId: string;
  readonly volumeMl: number;
  readonly amountMinor: number;
  readonly currency: Currency;
  private _status: PaymentStatus;
  private _qrString: string;
  readonly expiresAt: Date;
  paidAt: Date | null;
  abaApv: string | null;
  nextAbaCheckAt: Date | null;
  abaCheckCount: number;
  lastAbaCheckAt: Date | null;
  closedAt: Date | null;
  refundedAmountMinor: number | null;
  refundedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private readonly _stateChanges: StateChangeAudit[] = [];

  constructor(props: PaymentProps) {
    super(props.tranId, props.version ?? 0);
    this.tranId = props.tranId;
    this.machineId = props.machineId;
    this.requestId = props.requestId;
    this.volumeMl = props.volumeMl;
    this.amountMinor = props.amountMinor;
    this.currency = props.currency;
    this._status = props.status;
    this._qrString = props.qrString;
    this.expiresAt = props.expiresAt;
    this.paidAt = props.paidAt ?? null;
    this.abaApv = props.abaApv ?? null;
    this.nextAbaCheckAt = props.nextAbaCheckAt ?? null;
    this.abaCheckCount = props.abaCheckCount ?? 0;
    this.lastAbaCheckAt = props.lastAbaCheckAt ?? null;
    this.closedAt = props.closedAt ?? null;
    this.refundedAmountMinor = props.refundedAmountMinor ?? null;
    this.refundedAt = props.refundedAt ?? null;
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  get status(): PaymentStatus {
    return this._status;
  }

  get qrString(): string {
    return this._qrString;
  }

  get stateChanges(): readonly StateChangeAudit[] {
    return this._stateChanges;
  }

  static create(params: {
    machineId: string;
    requestId: string;
    volumeMl: number;
    amountMinor: number;
    currency: Currency;
    tranId: string;
    clock: Clock;
    ttlMinutes: number;
  }): Payment {
    const now = params.clock.now();
    const expiresAt = new Date(now.getTime() + params.ttlMinutes * 60 * 1000);
    const firstCheckAt = new Date(now.getTime() + 3000); // 3s initial check per B4.8

    return new Payment({
      tranId: params.tranId,
      machineId: params.machineId,
      requestId: params.requestId,
      volumeMl: params.volumeMl,
      amountMinor: params.amountMinor,
      currency: params.currency,
      status: 'PENDING',
      qrString: '',
      expiresAt,
      nextAbaCheckAt: firstCheckAt,
      abaCheckCount: 0,
      version: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  attachQr(qrString: string, clock: Clock): void {
    if (this._status !== 'PENDING') {
      throw new DomainError('PAY_INVALID_STATE', `Cannot attach QR to payment in status ${this._status}`);
    }
    this._qrString = qrString;
    this.raise(
      paymentCreatedEvent(
        {
          tranId: this.tranId,
          machineId: this.machineId,
          requestId: this.requestId,
          volumeMl: this.volumeMl,
          amountMinor: this.amountMinor,
          currency: this.currency,
          qrString: this._qrString,
          expiresAt: this.expiresAt,
        },
        clock.now(),
      ),
    );
  }

  markPaid(clock: Clock, graceSeconds: number, abaApv: string, foundBy: 'callback' | 'sweep' | 'reconcile'): void {
    switch (this._status) {
      case 'PAID':
      case 'DISPENSED':
      case 'DISPENSE_UNKNOWN':
      case 'REFUND_REVIEW':
      case 'REFUNDED':
      case 'REFUND_REJECTED':
        return; // Idempotent — already handled

      case 'EXPIRED':
      case 'CANCELLED':
      case 'FAILED': {
        // Late payment detected: never dispense water, customer may have departed
        this.transition('REFUND_REVIEW', `late payment (${foundBy})`, clock);
        this.raise(
          latePaymentDetectedEvent(
            {
              tranId: this.tranId,
              machineId: this.machineId,
              foundBy,
            },
            clock.now(),
          ),
        );
        this.raise(
          refundReviewOpenedEvent(
            {
              tranId: this.tranId,
              reason: 'LATE_PAYMENT',
              suggestedAmountMinor: this.amountMinor,
            },
            clock.now(),
          ),
        );
        return;
      }

      case 'PENDING': {
        const graceMs = graceSeconds * 1000;
        if (clock.now().getTime() > this.expiresAt.getTime() + graceMs) {
          this.transition('EXPIRED', 'approved after grace', clock);
          return this.markPaid(clock, graceSeconds, abaApv, foundBy);
        }
        this.transition('PAID', `aba approved (${foundBy})`, clock);
        this.paidAt = clock.now();
        this.abaApv = abaApv;
        this.nextAbaCheckAt = null;
        this.raise(
          paymentPaidEvent(
            {
              tranId: this.tranId,
              machineId: this.machineId,
              paidAt: this.paidAt,
              abaApv,
            },
            clock.now(),
          ),
        );
        return;
      }
    }
  }

  cancel(reason: string, clock: Clock): void {
    if (this._status !== 'PENDING') return;
    this.transition('CANCELLED', reason, clock);
    this.nextAbaCheckAt = null;
    this.raise(
      paymentCancelledEvent(
        {
          tranId: this.tranId,
          machineId: this.machineId,
          reason,
        },
        clock.now(),
      ),
    );
  }

  expire(clock: Clock): void {
    if (this._status !== 'PENDING') return;
    this.transition('EXPIRED', 'ttl + grace expired', clock);
    this.nextAbaCheckAt = null;
    this.raise(
      paymentExpiredEvent(
        {
          tranId: this.tranId,
          machineId: this.machineId,
          reason: 'EXPIRED',
        },
        clock.now(),
      ),
    );
  }

  fail(reason: string, clock: Clock): void {
    if (this._status !== 'PENDING') return;
    this.transition('FAILED', reason, clock);
    this.nextAbaCheckAt = null;
    this.raise(
      paymentFailedEvent(
        {
          tranId: this.tranId,
          machineId: this.machineId,
          reason,
        },
        clock.now(),
      ),
    );
  }

  recordOutcome(params: {
    result: 'ok' | 'partial' | 'error';
    flowMl: number;
    weightG: number;
    diffPercent: number;
    fault?: string | null;
    clock: Clock;
  }): { isLate: boolean; suggestedRefundMinor: number } {
    const { result, flowMl, weightG, diffPercent, fault, clock } = params;

    // If already finalized (DISPENSED, REFUNDED, REFUND_REJECTED) -> late outcome per C1
    if (this._status === 'DISPENSED' || this._status === 'REFUNDED' || this._status === 'REFUND_REJECTED') {
      this.raise(
        reconciliationNeededEvent(
          {
            tranId: this.tranId,
            currentStatus: this._status,
            lateOutcome: { result, flowMl, weightG, fault },
          },
          clock.now(),
        ),
      );
      return { isLate: true, suggestedRefundMinor: 0 };
    }

    let suggestedRefundMinor = 0;

    if (this._status === 'PAID' || this._status === 'DISPENSE_UNKNOWN') {
      if (result === 'ok') {
        this.transition('DISPENSED', 'dispense ok', clock);
        this.raise(
          dispenseCompletedEvent(
            {
              tranId: this.tranId,
              machineId: this.machineId,
              flowMl,
              weightG,
              diffPercent,
            },
            clock.now(),
          ),
        );
      } else {
        const reasonCode = result === 'partial' ? 'DISPENSE_PARTIAL' : 'DISPENSE_FAILED';
        suggestedRefundMinor = calculateSuggestedRefund({
          reason: reasonCode,
          amountMinor: this.amountMinor,
          volumeMl: this.volumeMl,
          flowMl,
          currency: this.currency,
          fault: fault ?? undefined,
        });

        this.transition('REFUND_REVIEW', `dispense ${result} (${fault ?? 'no_fault'})`, clock);
        this.raise(
          dispenseFailedEvent(
            {
              tranId: this.tranId,
              machineId: this.machineId,
              result,
              flowMl,
              weightG,
              fault: fault ?? undefined,
            },
            clock.now(),
          ),
        );
        this.raise(
          refundReviewOpenedEvent(
            {
              tranId: this.tranId,
              reason: reasonCode,
              suggestedAmountMinor: suggestedRefundMinor,
            },
            clock.now(),
          ),
        );
      }
    }

    return { isLate: false, suggestedRefundMinor };
  }

  // Backward compatibility alias for Phase 2 tests
  recordDispense(result: 'ok' | 'partial' | 'error', clock: Clock): void {
    this.recordOutcome({
      result,
      flowMl: result === 'ok' ? this.volumeMl : 0,
      weightG: result === 'ok' ? this.volumeMl : 0,
      diffPercent: 0,
      clock,
    });
  }

  markDispenseUnknown(clock: Clock): void {
    if (this._status !== 'PAID') return;
    this.transition('DISPENSE_UNKNOWN', 'dispense outcome unknown (timeout 300s)', clock);
    this.raise(
      dispenseOutcomeUnknownEvent(
        {
          tranId: this.tranId,
          machineId: this.machineId,
        },
        clock.now(),
      ),
    );
  }

  escalateUnknownToRefundReview(clock: Clock): void {
    if (this._status !== 'DISPENSE_UNKNOWN') return;
    this.transition('REFUND_REVIEW', 'dispense unknown escalated (24h online)', clock);
    this.raise(
      refundReviewOpenedEvent(
        {
          tranId: this.tranId,
          reason: 'DISPENSE_UNKNOWN_ESCALATED',
          suggestedAmountMinor: this.amountMinor,
        },
        clock.now(),
      ),
    );
  }

  claimRefund(adminId: string, durationMinutes: number, clock: Clock): void {
    if (this._status !== 'REFUND_REVIEW') {
      throw new DomainError('PAY_INVALID_STATE', `Cannot claim refund in status ${this._status}`);
    }
    const until = new Date(clock.now().getTime() + durationMinutes * 60 * 1000);
    this.raise(
      refundClaimedEvent(
        {
          tranId: this.tranId,
          by: adminId,
          until,
        },
        clock.now(),
      ),
    );
  }

  markRefunded(params: {
    adminId: string;
    method: string;
    reference: string;
    amountMinor: number;
    clock: Clock;
  }): void {
    if (this._status !== 'REFUND_REVIEW') {
      throw new DomainError('PAY_INVALID_STATE', `Cannot mark refunded in status ${this._status}`);
    }
    this.transition('REFUNDED', `refunded via ${params.method} (${params.reference})`, params.clock);
    this.refundedAmountMinor = params.amountMinor;
    this.refundedAt = params.clock.now();
    this.raise(
      paymentRefundedEvent(
        {
          tranId: this.tranId,
          by: params.adminId,
          amountMinor: params.amountMinor,
          reference: params.reference,
          method: params.method,
        },
        params.clock.now(),
      ),
    );
  }

  rejectRefund(adminId: string, reason: string, clock: Clock): void {
    if (this._status !== 'REFUND_REVIEW') {
      throw new DomainError('PAY_INVALID_STATE', `Cannot reject refund in status ${this._status}`);
    }
    this.transition('REFUND_REJECTED', reason, clock);
    this.raise(
      refundRejectedEvent(
        {
          tranId: this.tranId,
          by: adminId,
          reason,
        },
        clock.now(),
      ),
    );
  }

  reopenRefund(adminId: string, reason: string, clock: Clock): void {
    if (this._status !== 'REFUND_REJECTED') {
      throw new DomainError('PAY_INVALID_STATE', `Cannot reopen refund in status ${this._status}`);
    }
    this.transition('REFUND_REVIEW', `reopened by ${adminId}: ${reason}`, clock);
    this.raise(
      refundReopenedEvent(
        {
          tranId: this.tranId,
          by: adminId,
          reason,
        },
        clock.now(),
      ),
    );
  }

  scheduleNextAbaCheck(nextCheckAt: Date | null, clock: Clock): void {
    this.nextAbaCheckAt = nextCheckAt;
    this.abaCheckCount += 1;
    this.lastAbaCheckAt = clock.now();
  }

  markAbaClosed(clock: Clock): void {
    this.closedAt = clock.now();
  }

  private transition(toStatus: PaymentStatus, reason: string, clock: Clock): void {
    const fromStatus = this._status;
    this._status = toStatus;
    this._stateChanges.push({
      fromStatus,
      toStatus,
      reason,
      at: clock.now(),
    });
  }
}
