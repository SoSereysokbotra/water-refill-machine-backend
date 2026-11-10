import { Inject, Injectable, Logger } from '@nestjs/common';
import { Clock, ConflictError } from '../../../../shared-kernel';
import { UnitOfWork } from '../../../../platform/database/unit-of-work';
import { PaymentRepository } from '../../domain/ports/payment.repository';
import { PaymentGateway } from '../../domain/ports/payment-gateway.port';
import { ConfirmPaymentCommand, ConfirmPaymentHandler } from './confirm-payment.command';

export class ProbePaymentCommand {
  constructor(public readonly tranId: string) {}
}

const RECONCILE_INTERVALS_MS = [
  60 * 60 * 1000, // +1 hour after 5m
  24 * 60 * 60 * 1000, // +1 day
  2 * 24 * 60 * 60 * 1000, // +3 days
  3 * 24 * 60 * 60 * 1000, // +6 days
];

@Injectable()
export class ProbePaymentHandler {
  private readonly logger = new Logger(ProbePaymentHandler.name);

  constructor(
    @Inject('PaymentRepository') private readonly repo: PaymentRepository,
    @Inject('PaymentGateway') private readonly gateway: PaymentGateway,
    @Inject(ConfirmPaymentHandler) private readonly confirmHandler: ConfirmPaymentHandler,
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject('Clock') private readonly clock: Clock,
  ) {}

  async execute(cmd: ProbePaymentCommand): Promise<void> {
    const payment = await this.repo.findByTranId(cmd.tranId);
    if (!payment) return;

    if (!['EXPIRED', 'CANCELLED', 'FAILED'].includes(payment.status)) {
      return;
    }

    try {
      const check = await this.gateway.checkTransaction(cmd.tranId);
      if (check.status === 'approved') {
        this.logger.warn(`Reconcile probe found late approved payment for ${cmd.tranId}! Confirming to REFUND_REVIEW...`);
        await this.confirmHandler.execute(
          new ConfirmPaymentCommand(cmd.tranId, check.apv ?? 'APV_RECONCILE', 'reconcile'),
        );
        return;
      }
    } catch (err: unknown) {
      this.logger.warn(`Reconcile probe checkTransaction failed for ${cmd.tranId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    await this.uow.run(
      async (tx) => {
        const p = await this.repo.get(cmd.tranId, tx);
        const nextInterval = RECONCILE_INTERVALS_MS[p.abaCheckCount];
        const nextCheckAt = nextInterval ? new Date(this.clock.now().getTime() + nextInterval) : null;

        p.scheduleNextAbaCheck(nextCheckAt, this.clock);
        await this.repo.save(p, tx);
      },
      { retryOn: [ConflictError], attempts: 3 },
    );
  }
}
