import { Inject, Injectable, Logger } from '@nestjs/common';
import { TransactionV1 } from '@wrm/contracts';
import { Clock, ConflictError, DomainError } from '../../../../shared-kernel';
import { UnitOfWork } from '../../../../platform/database/unit-of-work';
import { OutboxService } from '../../../../platform/outbox/outbox.service';
import { ConfigService } from '../../../../platform/config/config.service';
import { PaymentRepository } from '../../domain/ports/payment.repository';
import { Dispense } from '../../domain/dispense.entity';
import { RefundCase } from '../../domain/refund-case.entity';
import { accuracyMismatchEvent, dispenseCompletedEvent } from '../../domain/payment.events';

export class RecordDispenseCommand {
  constructor(
    public readonly machineId: string,
    public readonly data: TransactionV1,
  ) {}
}

@Injectable()
export class RecordDispenseHandler {
  private readonly logger = new Logger(RecordDispenseHandler.name);
  private readonly maxClockSkewMs: number;

  constructor(
    @Inject('PaymentRepository') private readonly repo: PaymentRepository,
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject('Clock') private readonly clock: Clock,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {
    this.maxClockSkewMs = this.config.get('CLOCK_SKEW_MAX_SECONDS') * 1000;
  }

  async execute(cmd: RecordDispenseCommand): Promise<{ status: 'ok'; duplicate?: boolean; late?: boolean }> {
    const payment = await this.repo.findByTranId(cmd.data.tran_id);
    if (!payment) {
      throw new DomainError('DSP_UNKNOWN_PAYMENT', `No payment found with tranId ${cmd.data.tran_id}`);
    }

    if (payment.machineId !== cmd.machineId) {
      throw new DomainError('DSP_WRONG_MACHINE', `Payment ${cmd.data.tran_id} belongs to ${payment.machineId}, not ${cmd.machineId}`);
    }

    const now = this.clock.now();
    const deviceTime = cmd.data.ts ? new Date(cmd.data.ts * 1000) : now;
    const isClockSkewed = Math.abs(now.getTime() - deviceTime.getTime()) > this.maxClockSkewMs;
    const effectiveOccurredAt = isClockSkewed ? now : deviceTime;

    const volume = payment.volumeMl > 0 ? payment.volumeMl : 1;
    const diffPercent = Dispense.calculateDiffPercent(cmd.data.flow_ml, cmd.data.weight_g, volume);
    const outcome = {
      result: cmd.data.result,
      flowMl: cmd.data.flow_ml,
      weightG: cmd.data.weight_g,
      fault: cmd.data.fault ?? null,
    };

    // 1. An outcome is already recorded for this payment
    const existing = await this.repo.getDispense(payment.tranId);
    if (existing) {
      if (existing.sameOutcomeAs(outcome)) {
        // The device re-sent it because the ack was lost: ack ok, change nothing (no alert)
        return { status: 'ok', duplicate: true };
      }
      // A different outcome: keep the original record (audit), alert for reconciliation (C1)
      this.logger.warn(`Conflicting outcome for ${payment.tranId} (status ${payment.status}); original kept`);
      await this.raiseLateOutcome(payment.tranId, outcome);
      return { status: 'ok', late: true };
    }

    // 2. No outcome yet, but the payment already left PAID / DISPENSE_UNKNOWN after the machine was told
    //    "paid" (resolved manually, escalated to refund review, refunded...): late outcome, payment unchanged.
    if (payment.status !== 'PAID' && payment.status !== 'DISPENSE_UNKNOWN' && payment.paidAt !== null) {
      this.logger.warn(`Late dispense outcome for ${payment.tranId} in status ${payment.status}`);
      await this.uow.run(
        async (tx) => {
          await this.repo.recordDispense(
            new Dispense({
              tranId: payment.tranId,
              machineId: cmd.machineId,
              ...outcome,
              diffPercent,
              occurredAt: effectiveOccurredAt,
              clockSkew: isClockSkewed,
              late: true,
            }),
            tx,
          );
          const p = await this.repo.get(payment.tranId, tx);
          p.recordLateOutcome({ ...outcome, clock: this.clock });
          await this.outbox.add(p.pullEvents(), tx, 'Payment', p.tranId);
        },
        { retryOn: [ConflictError], attempts: 3 },
      );
      return { status: 'ok', late: true };
    }

    // Only PAID and DISPENSE_UNKNOWN can accept primary outcome
    if (payment.status !== 'PAID' && payment.status !== 'DISPENSE_UNKNOWN') {
      throw new DomainError('DSP_NOT_PAID', `Cannot record dispense for payment ${payment.tranId} in status ${payment.status}`);
    }

    await this.uow.run(
      async (tx) => {
        const p = await this.repo.get(payment.tranId, tx);
        if (p.status !== 'PAID' && p.status !== 'DISPENSE_UNKNOWN') return;

        const outcomeRes = p.recordOutcome({
          result: cmd.data.result,
          flowMl: cmd.data.flow_ml,
          weightG: cmd.data.weight_g,
          diffPercent,
          fault: cmd.data.fault,
          clock: this.clock,
        });

        const dispense = new Dispense({
          tranId: p.tranId,
          machineId: cmd.machineId,
          result: cmd.data.result,
          flowMl: cmd.data.flow_ml,
          weightG: cmd.data.weight_g,
          diffPercent,
          fault: cmd.data.fault ?? null,
          occurredAt: effectiveOccurredAt,
          clockSkew: isClockSkewed,
          late: outcomeRes.isLate,
        });
        await this.repo.recordDispense(dispense, tx);

        // If partial or error, persist RefundCase
        if (cmd.data.result !== 'ok') {
          const reasonCode = cmd.data.result === 'partial' ? 'DISPENSE_PARTIAL' : 'DISPENSE_FAILED';
          const refundCase = new RefundCase({
            tranId: p.tranId,
            reason: reasonCode,
            suggestedAmountMinor: outcomeRes.suggestedRefundMinor,
            createdAt: now,
            updatedAt: now,
          });
          await this.repo.saveRefundCase(refundCase, tx);
        }

        await this.repo.save(p, tx);

        const events = [...p.pullEvents()];

        // Producer: Dispensing events per Plan C4
        // (DispenseFailed for partial/error is raised by Payment.recordOutcome — not added here again)
        if (cmd.data.result === 'ok') {
          events.push(
            dispenseCompletedEvent(
              {
                tranId: p.tranId,
                machineId: cmd.machineId,
                flowMl: cmd.data.flow_ml,
                weightG: cmd.data.weight_g,
                diffPercent,
              },
              now,
            ),
          );
        }

        // Accuracy discrepancy alert (>5%)
        if (dispense.hasAccuracyMismatch) {
          events.push(
            accuracyMismatchEvent(
              {
                tranId: p.tranId,
                machineId: cmd.machineId,
                diffPercent,
              },
              now,
            ),
          );
        }

        await this.outbox.add(events, tx, 'Dispense', p.tranId);
      },
      { retryOn: [ConflictError], attempts: 3 },
    );

    return { status: 'ok' };
  }

  private async raiseLateOutcome(
    tranId: string,
    outcome: { result: 'ok' | 'partial' | 'error'; flowMl: number; weightG: number; fault: string | null },
  ): Promise<void> {
    await this.uow.run(
      async (tx) => {
        const p = await this.repo.get(tranId, tx);
        p.recordLateOutcome({ ...outcome, clock: this.clock });
        await this.outbox.add(p.pullEvents(), tx, 'Payment', p.tranId);
      },
      { retryOn: [ConflictError], attempts: 3 },
    );
  }
}
