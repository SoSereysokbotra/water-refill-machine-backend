import { Inject, Injectable, Logger } from '@nestjs/common';
import { TransactionV1 } from '@wrm/contracts';
import { Clock, ConflictError, DomainError } from '../../../../shared-kernel';
import { UnitOfWork } from '../../../../platform/database/unit-of-work';
import { OutboxService } from '../../../../platform/outbox/outbox.service';
import { ConfigService } from '../../../../platform/config/config.service';
import { PaymentRepository } from '../../domain/ports/payment.repository';
import { Dispense } from '../../domain/dispense.entity';
import { RefundCase } from '../../domain/refund-case.entity';
import { accuracyMismatchEvent, dispenseCompletedEvent, dispenseFailedEvent } from '../../domain/payment.events';

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

  async execute(cmd: RecordDispenseCommand): Promise<{ status: 'ok'; duplicate?: boolean }> {
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

    // If already finalized (DISPENSED, REFUNDED, REFUND_REJECTED) -> late outcome per C1
    if (payment.status === 'DISPENSED' || payment.status === 'REFUNDED' || payment.status === 'REFUND_REJECTED') {
      this.logger.warn(`Late dispense outcome received for ${payment.tranId} in status ${payment.status}`);
      await this.uow.run(
        async (tx) => {
          const p = await this.repo.get(payment.tranId, tx);
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

          const events = p.pullEvents();
          if (events.length > 0) {
            await this.outbox.add(events, tx, 'Payment', p.tranId);
          }
        },
        { retryOn: [ConflictError], attempts: 3 },
      );

      return { status: 'ok', duplicate: true };
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
        } else {
          events.push(
            dispenseFailedEvent(
              {
                tranId: p.tranId,
                machineId: cmd.machineId,
                result: cmd.data.result,
                flowMl: cmd.data.flow_ml,
                weightG: cmd.data.weight_g,
                fault: cmd.data.fault,
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
}
