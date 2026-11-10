import { Inject, Injectable } from '@nestjs/common';
import { Clock, ConflictError } from '../../../../shared-kernel';
import { BaseSweep } from '../../../../platform/sweeps/sweep.base';
import { ConfigService } from '../../../../platform/config/config.service';
import { UnitOfWork } from '../../../../platform/database/unit-of-work';
import { OutboxService } from '../../../../platform/outbox/outbox.service';
import { Payment } from '../../domain/payment.aggregate';
import { PaymentRepository } from '../../domain/ports/payment.repository';
import { RefundCase } from '../../domain/refund-case.entity';

@Injectable()
export class DispensingSweep extends BaseSweep<Payment> {
  private readonly unknownAfterSeconds: number;
  private readonly escalateAfterHours: number;

  constructor(
    @Inject('PaymentRepository') private readonly repo: PaymentRepository,
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject('Clock') private readonly clock: Clock,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {
    // Runs every 30 seconds per Plan C5
    super('dispensing', 30000);
    this.unknownAfterSeconds = this.config.get('DISPENSE_UNKNOWN_AFTER_SECONDS');
    this.escalateAfterHours = this.config.get('DISPENSE_ESCALATE_AFTER_HOURS');
  }

  async findDueItems(): Promise<Payment[]> {
    const now = this.clock.now();

    // 1. PAID payments past DISPENSE_UNKNOWN_AFTER_SECONDS (default: 300s / 5min)
    const unknownCutoff = new Date(now.getTime() - this.unknownAfterSeconds * 1000);
    const dueForUnknown = await this.repo.findDueForDispenseUnknown(unknownCutoff, 20);

    // 2. DISPENSE_UNKNOWN payments past DISPENSE_ESCALATE_AFTER_HOURS (default: 24h)
    const escalateCutoff = new Date(now.getTime() - this.escalateAfterHours * 3600 * 1000);
    const dueForEscalate = await this.repo.findDueForUnknownEscalation(escalateCutoff, 20);

    return [...dueForUnknown, ...dueForEscalate];
  }

  async processItem(item: Payment): Promise<void> {
    const now = this.clock.now();

    if (item.status === 'PAID') {
      // Transition PAID -> DISPENSE_UNKNOWN
      await this.uow.run(
        async (tx) => {
          const p = await this.repo.get(item.tranId, tx);
          if (p.status !== 'PAID') return;

          p.markDispenseUnknown(this.clock);
          await this.repo.save(p, tx);
          await this.outbox.add(p.pullEvents(), tx, 'Payment', p.tranId);
        },
        { retryOn: [ConflictError], attempts: 3 },
      );
      this.logger.warn(`Payment ${item.tranId} timed out waiting for dispense outcome -> DISPENSE_UNKNOWN`);
      return;
    }

    if (item.status === 'DISPENSE_UNKNOWN') {
      // Evaluate 24h escalation:
      // Check if machine reports pending_outcomes > 0
      const pendingOutcomes = await this.repo.getMachinePendingOutcomes(item.machineId);

      if (pendingOutcomes === 0) {
        // Machine has communicated and has 0 queued outcomes -> safe to open refund case
        await this.uow.run(
          async (tx) => {
            const p = await this.repo.get(item.tranId, tx);
            if (p.status !== 'DISPENSE_UNKNOWN') return;

            p.escalateUnknownToRefundReview(this.clock);
            await this.repo.save(p, tx);

            const refundCase = new RefundCase({
              tranId: p.tranId,
              reason: 'DISPENSE_UNKNOWN',
              suggestedAmountMinor: p.amountMinor,
              createdAt: now,
              updatedAt: now,
            });
            await this.repo.saveRefundCase(refundCase, tx);

            await this.outbox.add(p.pullEvents(), tx, 'Payment', p.tranId);
          },
          { retryOn: [ConflictError], attempts: 3 },
        );
        this.logger.warn(`DISPENSE_UNKNOWN payment ${item.tranId} escalated to REFUND_REVIEW (machine idle, 0 pending)`);
      } else {
        // Machine still reports pending outcomes in NVS -> keep waiting, do not refund yet!
        this.logger.warn(`Payment ${item.tranId} has ${pendingOutcomes} pending outcomes on machine ${item.machineId}; holding in DISPENSE_UNKNOWN`);
      }
    }
  }
}
