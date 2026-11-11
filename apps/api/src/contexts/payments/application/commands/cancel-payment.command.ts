import { Inject, Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(CancelPaymentHandler.name);

  constructor(
    @Inject('PaymentRepository') private readonly repo: PaymentRepository,
    @Inject('PaymentGateway') private readonly gateway: PaymentGateway,
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject('Clock') private readonly clock: Clock,
  ) {}

  async execute(cmd: CancelPaymentCommand): Promise<void> {
    let payment = cmd.tranId ? await this.repo.findByTranId(cmd.tranId) : null;
    if (!payment && cmd.requestId) {
      payment = await this.repo.findByRequest(cmd.machineId, cmd.requestId);
    }

    if (!payment || payment.status !== 'PENDING') return;

    // A machine may only cancel its own payment (tran_id lookup is global)
    if (payment.machineId !== cmd.machineId) {
      this.logger.warn(`pay/cancel from ${cmd.machineId} for ${payment.tranId} of ${payment.machineId} ignored`);
      return;
    }

    await this.uow.run(
      async (tx) => {
        const p = await this.repo.get(payment.tranId, tx);
        if (p.status !== 'PENDING') return;

        p.cancel(cmd.reason, this.clock); // starts the reconcile schedule (B4.8)

        await this.repo.save(p, tx);
        await this.outbox.add(p.pullEvents(), tx, 'Payment', p.tranId);
      },
      { retryOn: [ConflictError], attempts: 3 },
    );

    await this.gateway.closeTransaction(payment.tranId).catch(() => {});
  }
}
