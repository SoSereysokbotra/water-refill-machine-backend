import { Inject, Injectable } from '@nestjs/common';
import { Clock, ConflictError } from '../../../../shared-kernel';
import { UnitOfWork } from '../../../../platform/database/unit-of-work';
import { OutboxService } from '../../../../platform/outbox/outbox.service';
import { PaymentRepository } from '../../domain/ports/payment.repository';

export class FailPaymentCommand {
  constructor(
    public readonly tranId: string,
    public readonly reason: string,
  ) {}
}

@Injectable()
export class FailPaymentHandler {
  constructor(
    @Inject('PaymentRepository') private readonly repo: PaymentRepository,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
  ) {}

  async execute(cmd: FailPaymentCommand): Promise<void> {
    await this.uow.run(
      async (tx) => {
        const payment = await this.repo.get(cmd.tranId, tx);
        if (payment.status !== 'PENDING') return;

        payment.fail(cmd.reason, this.clock);
        // Start reconcile probe schedule at +5 min
        payment.scheduleNextAbaCheck(new Date(this.clock.now().getTime() + 5 * 60 * 1000), this.clock);

        await this.repo.save(payment, tx);
        await this.outbox.add(payment.pullEvents(), tx, 'Payment', payment.tranId);
      },
      { retryOn: [ConflictError], attempts: 3 },
    );
  }
}
