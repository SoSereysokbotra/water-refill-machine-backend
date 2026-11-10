import { Inject, Injectable, Logger } from '@nestjs/common';
import { Clock, ConflictError, DomainError, NotFoundError } from '../../../../shared-kernel';
import { UnitOfWork } from '../../../../platform/database/unit-of-work';
import { OutboxService } from '../../../../platform/outbox/outbox.service';
import { PaymentRepository } from '../../domain/ports/payment.repository';
import { RefundCase } from '../../domain/refund-case.entity';

export class ClaimRefundCaseCommand {
  constructor(
    public readonly tranId: string,
    public readonly actorId: string,
    public readonly durationMinutes = 30,
  ) {}
}

export class MarkRefundedCommand {
  constructor(
    public readonly tranId: string,
    public readonly actorId: string,
    public readonly method: string,
    public readonly reference: string,
    public readonly amountMinor: number,
    public readonly adminOverrideReason?: string,
  ) {}
}

export class RejectRefundCommand {
  constructor(
    public readonly tranId: string,
    public readonly actorId: string,
    public readonly reason: string,
  ) {}
}

export class ReopenRefundCommand {
  constructor(
    public readonly tranId: string,
    public readonly actorId: string,
    public readonly reason: string,
  ) {}
}

export class ResolveUnknownDispenseCommand {
  constructor(
    public readonly tranId: string,
    public readonly actorId: string,
    public readonly resolution: 'dispensed' | 'refund',
    public readonly reason: string,
    public readonly adminOverrideReason?: string,
  ) {}
}

@Injectable()
export class ClaimRefundCaseHandler {
  constructor(
    @Inject('PaymentRepository') private readonly repo: PaymentRepository,
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject('Clock') private readonly clock: Clock,
  ) {}

  async execute(cmd: ClaimRefundCaseCommand): Promise<{ status: 'claimed'; claimedUntil: Date }> {
    return this.uow.run(
      async (tx) => {
        const rc = await this.repo.getRefundCase(cmd.tranId, tx);
        if (!rc) {
          throw new NotFoundError('REFUND_NOT_FOUND' as any, `Refund case ${cmd.tranId} not found`);
        }

        const payment = await this.repo.get(cmd.tranId, tx);
        payment.claimRefund(cmd.actorId, cmd.durationMinutes, this.clock);

        rc.claim(cmd.actorId, cmd.durationMinutes, this.clock);
        await this.repo.saveRefundCase(rc, tx);
        await this.repo.save(payment, tx);

        await this.outbox.add(payment.pullEvents(), tx, 'RefundCase', cmd.tranId);
        return { status: 'claimed', claimedUntil: rc.claimedUntil! };
      },
      { retryOn: [ConflictError], attempts: 3 },
    );
  }
}

@Injectable()
export class MarkRefundedHandler {
  private readonly logger = new Logger(MarkRefundedHandler.name);

  constructor(
    @Inject('PaymentRepository') private readonly repo: PaymentRepository,
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject('Clock') private readonly clock: Clock,
  ) {}

  async execute(cmd: MarkRefundedCommand): Promise<{ status: 'refunded' }> {
    return this.uow.run(
      async (tx) => {
        const payment = await this.repo.get(cmd.tranId, tx);
        const rc = await this.repo.getRefundCase(cmd.tranId, tx);
        if (!rc) {
          throw new NotFoundError('REFUND_NOT_FOUND' as any, `Refund case ${cmd.tranId} not found`);
        }

        // Plan §C1 Guard: Block refund while machine reports pending_outcomes > 0
        const pendingOutcomes = await this.repo.getMachinePendingOutcomes(payment.machineId, tx);
        if (pendingOutcomes > 0 && !cmd.adminOverrideReason) {
          throw new DomainError(
            'REFUND_BLOCKED_PENDING_OUTCOMES',
            `Machine ${payment.machineId} has ${pendingOutcomes} pending outcomes in NVS queue. Admin override reason required to refund before queue flush.`,
          );
        }

        rc.markRefunded({
          actorId: cmd.actorId,
          method: cmd.method,
          reference: cmd.reference,
          amountMinor: cmd.amountMinor,
          clock: this.clock,
        });

        payment.markRefunded({
          adminId: cmd.actorId,
          method: cmd.method,
          reference: cmd.reference,
          amountMinor: cmd.amountMinor,
          clock: this.clock,
        });

        await this.repo.saveRefundCase(rc, tx);
        await this.repo.save(payment, tx);

        await this.outbox.add(payment.pullEvents(), tx, 'Payment', payment.tranId);
        return { status: 'refunded' };
      },
      { retryOn: [ConflictError], attempts: 3 },
    );
  }
}

@Injectable()
export class RejectRefundHandler {
  constructor(
    @Inject('PaymentRepository') private readonly repo: PaymentRepository,
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject('Clock') private readonly clock: Clock,
  ) {}

  async execute(cmd: RejectRefundCommand): Promise<{ status: 'rejected' }> {
    return this.uow.run(
      async (tx) => {
        const payment = await this.repo.get(cmd.tranId, tx);
        const rc = await this.repo.getRefundCase(cmd.tranId, tx);
        if (!rc) {
          throw new NotFoundError('REFUND_NOT_FOUND' as any, `Refund case ${cmd.tranId} not found`);
        }

        rc.reject({ actorId: cmd.actorId, reason: cmd.reason, clock: this.clock });
        payment.rejectRefund(cmd.actorId, cmd.reason, this.clock);

        await this.repo.saveRefundCase(rc, tx);
        await this.repo.save(payment, tx);

        await this.outbox.add(payment.pullEvents(), tx, 'Payment', payment.tranId);
        return { status: 'rejected' };
      },
      { retryOn: [ConflictError], attempts: 3 },
    );
  }
}

@Injectable()
export class ReopenRefundHandler {
  constructor(
    @Inject('PaymentRepository') private readonly repo: PaymentRepository,
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject('Clock') private readonly clock: Clock,
  ) {}

  async execute(cmd: ReopenRefundCommand): Promise<{ status: 'open' }> {
    return this.uow.run(
      async (tx) => {
        const payment = await this.repo.get(cmd.tranId, tx);
        const rc = await this.repo.getRefundCase(cmd.tranId, tx);
        if (!rc) {
          throw new NotFoundError('REFUND_NOT_FOUND' as any, `Refund case ${cmd.tranId} not found`);
        }

        rc.reopen({ actorId: cmd.actorId, reason: cmd.reason, clock: this.clock });
        payment.reopenRefund(cmd.actorId, cmd.reason, this.clock);

        await this.repo.saveRefundCase(rc, tx);
        await this.repo.save(payment, tx);

        await this.outbox.add(payment.pullEvents(), tx, 'Payment', payment.tranId);
        return { status: 'open' };
      },
      { retryOn: [ConflictError], attempts: 3 },
    );
  }
}

@Injectable()
export class ResolveUnknownDispenseHandler {
  constructor(
    @Inject('PaymentRepository') private readonly repo: PaymentRepository,
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject('Clock') private readonly clock: Clock,
  ) {}

  async execute(cmd: ResolveUnknownDispenseCommand): Promise<{ status: string }> {
    return this.uow.run(
      async (tx) => {
        const payment = await this.repo.get(cmd.tranId, tx);
        if (payment.status !== 'DISPENSE_UNKNOWN') {
          throw new DomainError('PAY_INVALID_STATE', `Payment ${cmd.tranId} is not in DISPENSE_UNKNOWN (current: ${payment.status})`);
        }

        const pendingOutcomes = await this.repo.getMachinePendingOutcomes(payment.machineId, tx);
        if (pendingOutcomes > 0 && !cmd.adminOverrideReason) {
          throw new DomainError(
            'REFUND_BLOCKED_PENDING_OUTCOMES',
            `Machine ${payment.machineId} has ${pendingOutcomes} pending outcomes. Admin override reason required to force resolution.`,
          );
        }

        if (cmd.resolution === 'dispensed') {
          payment.recordDispense('ok', this.clock);
          await this.repo.save(payment, tx);
          await this.outbox.add(payment.pullEvents(), tx, 'Payment', payment.tranId);
          return { status: 'DISPENSED' };
        } else {
          payment.escalateUnknownToRefundReview(this.clock);
          const refundCase = new RefundCase({
            tranId: payment.tranId,
            reason: 'DISPENSE_UNKNOWN',
            suggestedAmountMinor: payment.amountMinor,
            createdAt: this.clock.now(),
            updatedAt: this.clock.now(),
          });
          await this.repo.saveRefundCase(refundCase, tx);
          await this.repo.save(payment, tx);
          await this.outbox.add(payment.pullEvents(), tx, 'Payment', payment.tranId);
          return { status: 'REFUND_REVIEW' };
        }
      },
      { retryOn: [ConflictError], attempts: 3 },
    );
  }
}
