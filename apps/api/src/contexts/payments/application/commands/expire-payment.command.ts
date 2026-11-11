import { Inject, Injectable, Logger } from '@nestjs/common';
import { Clock, ConflictError } from '../../../../shared-kernel';
import { UnitOfWork } from '../../../../platform/database/unit-of-work';
import { OutboxService } from '../../../../platform/outbox/outbox.service';
import { PaymentRepository } from '../../domain/ports/payment.repository';
import { PaymentGateway } from '../../domain/ports/payment-gateway.port';
import { ConfirmPaymentCommand, ConfirmPaymentHandler } from './confirm-payment.command';

export class ExpirePaymentCommand {
  constructor(public readonly tranId: string) {}
}

@Injectable()
export class ExpirePaymentHandler {
  private readonly logger = new Logger(ExpirePaymentHandler.name);

  constructor(
    @Inject('PaymentRepository') private readonly repo: PaymentRepository,
    @Inject('PaymentGateway') private readonly gateway: PaymentGateway,
    @Inject(ConfirmPaymentHandler) private readonly confirmHandler: ConfirmPaymentHandler,
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject('Clock') private readonly clock: Clock,
  ) {}

  async execute(cmd: ExpirePaymentCommand): Promise<void> {
    const payment = await this.repo.findByTranId(cmd.tranId);
    if (!payment || payment.status !== 'PENDING') return;

    // Plan B4.8: One final check with ABA before expiring
    try {
      const check = await this.gateway.checkTransaction(cmd.tranId);
      if (check.status === 'approved') {
        this.logger.log(`Final ABA check for ${cmd.tranId} returned approved, confirming payment instead of expiring.`);
        await this.confirmHandler.execute(
          new ConfirmPaymentCommand(cmd.tranId, check.apv ?? 'APV_FINAL_CHECK', 'sweep'),
        );
        return;
      }
    } catch (err: unknown) {
      this.logger.warn(`Final ABA check before expiry threw error for ${cmd.tranId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    await this.uow.run(
      async (tx) => {
        const p = await this.repo.get(cmd.tranId, tx);
        if (p.status !== 'PENDING') return;

        p.expire(this.clock); // starts the reconcile schedule (B4.8)

        await this.repo.save(p, tx);
        await this.outbox.add(p.pullEvents(), tx, 'Payment', p.tranId);
      },
      { retryOn: [ConflictError], attempts: 3 },
    );

    // Best-effort close transaction with PayWay
    await this.gateway.closeTransaction(cmd.tranId).catch(() => {});
  }
}
