import { AggregateRoot, Clock, DomainError } from '../../../shared-kernel';
import {
  latePaymentDetectedEvent,
  paymentCancelledEvent,
  paymentCreatedEvent,
  paymentExpiredEvent,
  paymentFailedEvent,
  paymentPaidEvent,
  refundReviewOpenedEvent,
} from './payment.events';
import { Currency, PaymentProps, PaymentStatus } from './payment.types';

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

  recordDispense(result: 'ok' | 'partial' | 'error', clock: Clock): void {
    if (this._status === 'PAID') {
      if (result === 'ok') {
        this.transition('DISPENSED', 'dispense ok', clock);
      } else {
        const reason = result === 'partial' ? 'DISPENSE_PARTIAL' : 'DISPENSE_FAILED';
        this.transition('REFUND_REVIEW', `dispense ${result}`, clock);
        this.raise(
          refundReviewOpenedEvent(
            {
              tranId: this.tranId,
              reason,
              suggestedAmountMinor: this.amountMinor,
            },
            clock.now(),
          ),
        );
      }
    }
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
