import { Inject, Injectable } from '@nestjs/common';
import { Clock, ConflictError } from '../../../../shared-kernel';
import { UnitOfWork } from '../../../../platform/database/unit-of-work';
import { OutboxService } from '../../../../platform/outbox/outbox.service';
import { PaymentRepository } from '../../domain/ports/payment.repository';
import { PaymentGateway } from '../../domain/ports/payment-gateway.port';

export class CancelPaymentCommand {
  constructor(
    public readonly machineId: string,
    public readonly tranId?: string,
    public readonly requestId?: string,
    public readonly reason: string = 'USER_CANCELLED',
  ) {}
}

@Injectable()
export class CancelPaymentHandler {
  constructor(
    @Inject('PaymentRepository') private readonly repo: PaymentRepository,
    @Inject('PaymentGateway') private readonly gateway: PaymentGateway,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
  ) {}

  async execute(cmd: CancelPaymentCommand): Promise<void> {
    let payment = cmd.tranId ? await this.repo.findByTranId(cmd.tranId) : null;
    if (!payment && cmd.requestId) {
      payment = await this.repo.findByRequest(cmd.machineId, cmd.requestId);
    }

    if (!payment || payment.status !== 'PENDING') return;

    await this.uow.run(
      async (tx) => {
        const p = await this.repo.get(payment.tranId, tx);
        if (p.status !== 'PENDING') return;

        p.cancel(cmd.reason, this.clock);
        // Start reconcile probe schedule at +5 min per B4.8
        p.scheduleNextAbaCheck(new Date(this.clock.now().getTime() + 5 * 60 * 1000), this.clock);

        await this.repo.save(p, tx);
        await this.outbox.add(p.pullEvents(), tx, 'Payment', p.tranId);
      },
      { retryOn: [ConflictError], attempts: 3 },
    );

    await this.gateway.closeTransaction(payment.tranId).catch(() => {});
  }
}
