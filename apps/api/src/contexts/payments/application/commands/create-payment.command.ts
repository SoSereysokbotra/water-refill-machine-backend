import { Inject, Injectable, Logger } from '@nestjs/common';
import { Clock, ConflictError, DomainError, TranIdGenerator } from '../../../../shared-kernel';
import { UnitOfWork } from '../../../../platform/database/unit-of-work';
import { OutboxService } from '../../../../platform/outbox/outbox.service';
import { ConfigService } from '../../../../platform/config/config.service';
import { Payment } from '../../domain/payment.aggregate';
import { PaymentRepository } from '../../domain/ports/payment.repository';
import { DuplicateTranIdError, PaymentGateway } from '../../domain/ports/payment-gateway.port';
import { MachinePort } from '../../domain/ports/machine.port';

export class CreatePaymentCommand {
  constructor(
    public readonly machineId: string,
    public readonly requestId: string,
    public readonly volumeMl: number,
  ) {}
}

export type CreatePaymentResult =
  | { action: 'created'; payment: Payment }
  | { action: 'republish_qr'; payment: Payment }
  | { action: 'status'; payment: Payment; status: string };

@Injectable()
export class CreatePaymentHandler {
  private readonly logger = new Logger(CreatePaymentHandler.name);
  private readonly ttlMinutes: number;

  constructor(
    @Inject('PaymentRepository') private readonly repo: PaymentRepository,
    @Inject('PaymentGateway') private readonly gateway: PaymentGateway,
    @Inject('MachinePort') private readonly machines: MachinePort,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly tranIds: TranIdGenerator,
    private readonly config: ConfigService,
  ) {
    this.ttlMinutes = this.config.get('PAYMENT_TTL_MINUTES');
  }

  async execute(cmd: CreatePaymentCommand): Promise<CreatePaymentResult> {
    const existing = await this.repo.findByRequest(cmd.machineId, cmd.requestId);
    if (existing) {
      return this.replayResponse(existing);
    }

    const machine = await this.machines.getForPayment(cmd.machineId);
    const amountMinor = machine.priceFor(cmd.volumeMl);
    if (amountMinor === undefined) {
      throw new DomainError('PAY_INVALID_VOLUME', `Volume ${cmd.volumeMl} is not available for machine ${cmd.machineId}`);
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      const tranId = this.tranIds.next();
      const payment = Payment.create({
        machineId: machine.id,
        requestId: cmd.requestId,
        volumeMl: cmd.volumeMl,
        amountMinor,
        currency: machine.currency,
        tranId,
        clock: this.clock,
        ttlMinutes: this.ttlMinutes,
      });

      const majorAmount = machine.currency === 'USD' ? amountMinor / 100 : amountMinor;
      let qrString: string;
      try {
        const qrRes = await this.gateway.createQr({
          tranId,
          amount: majorAmount,
          currency: machine.currency,
          lifetimeMin: this.ttlMinutes,
        });
        qrString = qrRes.qrString;
      } catch (err: unknown) {
        if (err instanceof DuplicateTranIdError && attempt < 3) {
          this.logger.warn(`Duplicate tran_id collision at ABA on attempt ${attempt}: ${tranId}. Retrying with new ID...`);
          continue;
        }
        throw err;
      }

      payment.attachQr(qrString, this.clock);

      try {
        await this.uow.run(
          async (tx) => {
            // Per D5: serialize concurrent requests for the same machine
            await tx.$executeRaw`SELECT 1 FROM machines WHERE id = ${machine.id} FOR UPDATE`;

            if (await this.repo.hasPaidOpen(machine.id, tx)) {
              throw new DomainError('PAY_MACHINE_BUSY', `Machine ${machine.id} already has a paid payment awaiting dispense`);
            }

            const superseded = await this.repo.cancelPendingForMachine(machine.id, 'SUPERSEDED', tx);
            await this.repo.insert(payment, tx);

            const allEvents = [...superseded.flatMap((p) => p.pullEvents()), ...payment.pullEvents()];
            await this.outbox.add(allEvents, tx, 'Payment', payment.tranId);
          },
          { retryOn: [ConflictError], attempts: 3 },
        );

        return { action: 'created', payment };
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('payments_machine_id_request_id_key')) {
          const winner = await this.repo.findByRequest(cmd.machineId, cmd.requestId);
          if (winner) return this.replayResponse(winner);
        }

        if (err instanceof Error && err.message.includes('payments_pkey') && attempt < 3) {
          this.logger.warn(`DB tran_id collision on attempt ${attempt}: ${tranId}. Retrying...`);
          continue;
        }

        throw err;
      }
    }

    throw new DomainError('CONCURRENCY_CONFLICT', 'Failed to generate unique payment transaction after 3 attempts');
  }

  private replayResponse(payment: Payment): CreatePaymentResult {
    const now = this.clock.now();
    if (payment.status === 'PENDING') {
      if (now < payment.expiresAt) {
        return { action: 'republish_qr', payment };
      }
      return { action: 'status', payment, status: 'expired' };
    }

    if (['PAID', 'DISPENSED', 'DISPENSE_UNKNOWN'].includes(payment.status)) {
      return { action: 'status', payment, status: 'paid' };
    }

    return { action: 'status', payment, status: payment.status.toLowerCase() };
  }
}
