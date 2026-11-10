import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../../../../shared-kernel';
import { BaseSweep } from '../../../../platform/sweeps/sweep.base';
import { ConfigService } from '../../../../platform/config/config.service';
import { Payment } from '../../domain/payment.aggregate';
import { PaymentRepository } from '../../domain/ports/payment.repository';
import { PaymentGateway } from '../../domain/ports/payment-gateway.port';
import { ConfirmPaymentCommand, ConfirmPaymentHandler } from '../commands/confirm-payment.command';
import { ExpirePaymentCommand, ExpirePaymentHandler } from '../commands/expire-payment.command';
import { FailPaymentCommand, FailPaymentHandler } from '../commands/fail-payment.command';

@Injectable()
export class PaymentsSweep extends BaseSweep<Payment> {
  private readonly graceSeconds: number;

  constructor(
    @Inject('PaymentRepository') private readonly repo: PaymentRepository,
    @Inject('PaymentGateway') private readonly gateway: PaymentGateway,
    private readonly confirmHandler: ConfirmPaymentHandler,
    private readonly expireHandler: ExpirePaymentHandler,
    private readonly failHandler: FailPaymentHandler,
    private readonly clock: Clock,
    private readonly config: ConfigService,
  ) {
    // Runs every 3 seconds per Plan C5 / B4.8
    super('payments', 3000);
    this.graceSeconds = this.config.get('PAYMENT_GRACE_SECONDS');
  }

  async findDueItems(): Promise<Payment[]> {
    return this.repo.findDueForAbaCheck(this.clock.now(), 20);
  }

  async processItem(item: Payment): Promise<void> {
    const now = this.clock.now();
    const expiryWithGrace = item.expiresAt.getTime() + this.graceSeconds * 1000;

    if (now.getTime() > expiryWithGrace) {
      await this.expireHandler.execute(new ExpirePaymentCommand(item.tranId));
      return;
    }

    const check = await this.gateway.checkTransaction(item.tranId);
    if (check.status === 'approved') {
      await this.confirmHandler.execute(
        new ConfirmPaymentCommand(item.tranId, check.apv ?? 'APV_SWEEP', 'sweep'),
      );
      return;
    }

    if (check.status === 'declined') {
      await this.failHandler.execute(new FailPaymentCommand(item.tranId, 'ABA DECLINED'));
      return;
    }

    // Still pending / not_found: update schedule per B4.8
    const ageMs = now.getTime() - item.createdAt.getTime();
    const intervalMs = ageMs < 60 * 1000 ? 3000 : 5000;
    const nextCheckAt = new Date(now.getTime() + intervalMs);

    item.scheduleNextAbaCheck(nextCheckAt, this.clock);
    await this.repo.save(item);
  }
}
