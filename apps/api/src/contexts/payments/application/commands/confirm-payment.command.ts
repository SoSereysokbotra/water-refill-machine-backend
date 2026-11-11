import { Inject, Injectable } from '@nestjs/common';
import { Clock, ConflictError } from '../../../../shared-kernel';
import { UnitOfWork } from '../../../../platform/database/unit-of-work';
import { OutboxService } from '../../../../platform/outbox/outbox.service';
import { ConfigService } from '../../../../platform/config/config.service';
import { PaymentRepository } from '../../domain/ports/payment.repository';
import { RefundCase } from '../../domain/refund-case.entity';
import { calculateSuggestedRefund } from '../../domain/refund-policy';

export class ConfirmPaymentCommand {
  constructor(
    public readonly tranId: string,
    public readonly abaApv: string,
    public readonly foundBy: 'callback' | 'sweep' | 'reconcile',
  ) {}
}

@Injectable()
export class ConfirmPaymentHandler {
  private readonly graceSeconds: number;

  constructor(
    @Inject('PaymentRepository') private readonly repo: PaymentRepository,
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject('Clock') private readonly clock: Clock,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {
    this.graceSeconds = this.config.get('PAYMENT_GRACE_SECONDS');
  }

  async execute(cmd: ConfirmPaymentCommand): Promise<void> {
    await this.uow.run(
      async (tx) => {
        const payment = await this.repo.get(cmd.tranId, tx);
        const before = payment.status;
        payment.markPaid(this.clock, this.graceSeconds, cmd.abaApv, cmd.foundBy);

        // C1: a late payment (after EXPIRED/CANCELLED/FAILED or past grace) goes to refund review.
        // Every REFUND_REVIEW needs a refund case, otherwise it can never be claimed or refunded.
        if (before !== 'REFUND_REVIEW' && payment.status === 'REFUND_REVIEW') {
          const existing = await this.repo.getRefundCase(payment.tranId, tx);
          if (!existing) {
            const now = this.clock.now();
            await this.repo.saveRefundCase(
              new RefundCase({
                tranId: payment.tranId,
                reason: 'LATE_PAYMENT',
                suggestedAmountMinor: calculateSuggestedRefund({
                  reason: 'LATE_PAYMENT',
                  amountMinor: payment.amountMinor,
                  volumeMl: payment.volumeMl,
                  currency: payment.currency,
                }),
                createdAt: now,
                updatedAt: now,
              }),
              tx,
            );
          }
        }

        await this.repo.save(payment, tx);
        await this.outbox.add(payment.pullEvents(), tx, 'Payment', payment.tranId);
      },
      { retryOn: [ConflictError], attempts: 3 },
    );
  }
}
