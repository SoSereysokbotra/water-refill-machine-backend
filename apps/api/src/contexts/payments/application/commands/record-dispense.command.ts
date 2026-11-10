import { Inject, Injectable, Logger } from '@nestjs/common';
import { TransactionV1 } from '@wrm/contracts';
import { Clock, ConflictError, DomainError } from '../../../../shared-kernel';
import { UnitOfWork } from '../../../../platform/database/unit-of-work';
import { OutboxService } from '../../../../platform/outbox/outbox.service';
import { ConfigService } from '../../../../platform/config/config.service';
import { PrismaService } from '../../../../platform/database/prisma.service';
import { PaymentRepository } from '../../domain/ports/payment.repository';

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
    @Inject(PrismaService) private readonly prisma: PrismaService,
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

    if (payment.status === 'DISPENSED') {
      this.logger.log(`Duplicate dispense outcome received for already DISPENSED payment ${payment.tranId}`);
      return { status: 'ok', duplicate: true };
    }

    if (payment.status !== 'PAID') {
      throw new DomainError('DSP_NOT_PAID', `Cannot record dispense for payment ${payment.tranId} in status ${payment.status}`);
    }

    const now = this.clock.now();
    const deviceTime = cmd.data.ts ? new Date(cmd.data.ts * 1000) : now;
    const isClockSkewed = Math.abs(now.getTime() - deviceTime.getTime()) > this.maxClockSkewMs;
    const effectiveOccurredAt = isClockSkewed ? now : deviceTime;

    const volume = payment.volumeMl > 0 ? payment.volumeMl : 1;
    const diffPercent = (Math.abs(cmd.data.flow_ml - cmd.data.weight_g) / volume) * 100;

    await this.uow.run(
      async (tx) => {
        const p = await this.repo.get(payment.tranId, tx);
        if (p.status !== 'PAID') return;

        // Save dispense record
        await tx.dispense.upsert({
          where: { tranId: p.tranId },
          update: {
            result: cmd.data.result,
            flowMl: cmd.data.flow_ml,
            weightG: cmd.data.weight_g,
            diffPercent: Number(diffPercent.toFixed(2)),
            fault: cmd.data.fault ?? null,
            occurredAt: effectiveOccurredAt,
            clockSkew: isClockSkewed,
          },
          create: {
            tranId: p.tranId,
            machineId: cmd.machineId,
            result: cmd.data.result,
            flowMl: cmd.data.flow_ml,
            weightG: cmd.data.weight_g,
            diffPercent: Number(diffPercent.toFixed(2)),
            fault: cmd.data.fault ?? null,
            occurredAt: effectiveOccurredAt,
            clockSkew: isClockSkewed,
          },
        });

        p.recordDispense(cmd.data.result, this.clock);
        await this.repo.save(p, tx);
        await this.outbox.add(p.pullEvents(), tx, 'Payment', p.tranId);
      },
      { retryOn: [ConflictError], attempts: 3 },
    );

    return { status: 'ok' };
  }
}
