import { Inject, Injectable } from '@nestjs/common';
import { Clock, ConflictError } from '../../../../shared-kernel';
import { UnitOfWork } from '../../../../platform/database/unit-of-work';
import { OutboxService } from '../../../../platform/outbox/outbox.service';
import { ConfigService } from '../../../../platform/config/config.service';
import { PaymentRepository } from '../../domain/ports/payment.repository';

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
        payment.markPaid(this.clock, this.graceSeconds, cmd.abaApv, cmd.foundBy);
        await this.repo.save(payment, tx);
        await this.outbox.add(payment.pullEvents(), tx, 'Payment', payment.tranId);
      },
      { retryOn: [ConflictError], attempts: 3 },
    );
  }
}
