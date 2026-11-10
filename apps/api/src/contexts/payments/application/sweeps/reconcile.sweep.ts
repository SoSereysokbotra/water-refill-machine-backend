import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../../../../shared-kernel';
import { BaseSweep } from '../../../../platform/sweeps/sweep.base';
import { Payment } from '../../domain/payment.aggregate';
import { PaymentRepository } from '../../domain/ports/payment.repository';
import { ProbePaymentCommand, ProbePaymentHandler } from '../commands/probe-payment.command';

@Injectable()
export class ReconcileSweep extends BaseSweep<Payment> {
  constructor(
    @Inject('PaymentRepository') private readonly repo: PaymentRepository,
    @Inject(ProbePaymentHandler) private readonly probeHandler: ProbePaymentHandler,
    @Inject('Clock') private readonly clock: Clock,
  ) {
    // Runs every 5 minutes per Plan C5
    super('reconcile', 5 * 60 * 1000);
  }

  async findDueItems(): Promise<Payment[]> {
    return this.repo.findDueForReconciliation(this.clock.now(), 20);
  }

  async processItem(item: Payment): Promise<void> {
    await this.probeHandler.execute(new ProbePaymentCommand(item.tranId));
  }
}
