import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConflictError, NotFoundError, Clock } from '../../../../shared-kernel';
import { PrismaService } from '../../../../platform/database/prisma.service';
import { Payment } from '../../domain/payment.aggregate';
import { PaymentRepository } from '../../domain/ports/payment.repository';
import { PaymentStatus, Currency } from '../../domain/payment.types';
import { Dispense } from '../../domain/dispense.entity';
import { RefundCase, RefundReason, RefundStatus } from '../../domain/refund-case.entity';

@Injectable()
export class PrismaPaymentRepository implements PaymentRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject('Clock') private readonly clock: Clock,
  ) {}

  private getClient(tx?: unknown): Prisma.TransactionClient | PrismaService {
    return (tx as Prisma.TransactionClient) ?? this.prisma;
  }

  private toDomain(row: {
    tranId: string;
    machineId: string;
    requestId: string;
    volumeMl: number;
    amountMinor: number;
    currency: string;
    status: string;
    qrString: string;
    expiresAt: Date;
    paidAt: Date | null;
    abaApv: string | null;
    nextAbaCheckAt: Date | null;
    abaCheckCount: number;
    lastAbaCheckAt: Date | null;
    closedAt: Date | null;
    refundedAmountMinor: number | null;
    refundedAt: Date | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): Payment {
    return new Payment({
      tranId: row.tranId,
      machineId: row.machineId,
      requestId: row.requestId,
      volumeMl: row.volumeMl,
      amountMinor: row.amountMinor,
      currency: row.currency as Currency,
      status: row.status as PaymentStatus,
      qrString: row.qrString,
      expiresAt: row.expiresAt,
      paidAt: row.paidAt,
      abaApv: row.abaApv,
      nextAbaCheckAt: row.nextAbaCheckAt,
      abaCheckCount: row.abaCheckCount,
      lastAbaCheckAt: row.lastAbaCheckAt,
      closedAt: row.closedAt,
      refundedAmountMinor: row.refundedAmountMinor,
      refundedAt: row.refundedAt,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  private toDispenseDomain(row: {
    tranId: string;
    machineId: string;
    result: string;
    flowMl: number;
    weightG: number;
    diffPercent: Prisma.Decimal | number;
    fault: string | null;
    occurredAt: Date;
    receivedAt: Date;
    clockSkew: boolean;
    late: boolean;
  }): Dispense {
    return new Dispense({
      tranId: row.tranId,
      machineId: row.machineId,
      result: row.result as 'ok' | 'partial' | 'error',
      flowMl: row.flowMl,
      weightG: row.weightG,
      diffPercent: typeof row.diffPercent === 'number' ? row.diffPercent : Number(row.diffPercent.toString()),
      fault: row.fault,
      occurredAt: row.occurredAt,
      receivedAt: row.receivedAt,
      clockSkew: row.clockSkew,
      late: row.late,
    });
  }

  private toRefundCaseDomain(row: {
    tranId: string;
    reason: string;
    suggestedAmountMinor: number;
    refundedAmountMinor: number | null;
    status: string;
    claimedBy: string | null;
    claimedUntil: Date | null;
    method: string | null;
    reference: string | null;
    decidedBy: string | null;
    decidedAt: Date | null;
    decisionReason: string | null;
    attempts: number;
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): RefundCase {
    return new RefundCase({
      tranId: row.tranId,
      reason: row.reason as RefundReason,
      suggestedAmountMinor: row.suggestedAmountMinor,
      refundedAmountMinor: row.refundedAmountMinor,
      status: row.status as RefundStatus,
      claimedBy: row.claimedBy,
      claimedUntil: row.claimedUntil,
      method: row.method,
      reference: row.reference,
      decidedBy: row.decidedBy,
      decidedAt: row.decidedAt,
      decisionReason: row.decisionReason,
      attempts: row.attempts,
      lastError: row.lastError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  async get(tranId: string, tx?: unknown): Promise<Payment> {
    const payment = await this.findByTranId(tranId, tx);
    if (!payment) {
      throw new NotFoundError('PAY_NOT_FOUND', `Payment with tranId ${tranId} not found`);
    }
    return payment;
  }

  async findByTranId(tranId: string, tx?: unknown): Promise<Payment | null> {
    const client = this.getClient(tx);
    const row = await client.payment.findUnique({
      where: { tranId },
    });
    return row ? this.toDomain(row) : null;
  }

  async findByRequest(machineId: string, requestId: string, tx?: unknown): Promise<Payment | null> {
    const client = this.getClient(tx);
    const row = await client.payment.findUnique({
      where: {
        machineId_requestId: {
          machineId,
          requestId,
        },
      },
    });
    return row ? this.toDomain(row) : null;
  }

  async hasPaidOpen(machineId: string, tx?: unknown): Promise<boolean> {
    const client = this.getClient(tx);
    const count = await client.payment.count({
      where: {
        machineId,
        status: 'PAID',
      },
    });
    return count > 0;
  }

  async cancelPendingForMachine(machineId: string, reason: string, tx?: unknown): Promise<Payment[]> {
    const client = this.getClient(tx);
    const rows = await client.payment.findMany({
      where: {
        machineId,
        status: 'PENDING',
      },
    });

    const cancelled: Payment[] = [];
    for (const row of rows) {
      const payment = this.toDomain(row);
      payment.cancel(reason, this.clock);
      await this.save(payment, tx);
      cancelled.push(payment);
    }
    return cancelled;
  }

  async insert(payment: Payment, tx?: unknown): Promise<void> {
    const client = this.getClient(tx);
    await client.payment.create({
      data: {
        tranId: payment.tranId,
        machineId: payment.machineId,
        requestId: payment.requestId,
        volumeMl: payment.volumeMl,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        status: payment.status,
        qrString: payment.qrString,
        expiresAt: payment.expiresAt,
        paidAt: payment.paidAt,
        abaApv: payment.abaApv,
        nextAbaCheckAt: payment.nextAbaCheckAt,
        abaCheckCount: payment.abaCheckCount,
        lastAbaCheckAt: payment.lastAbaCheckAt,
        closedAt: payment.closedAt,
        refundedAmountMinor: payment.refundedAmountMinor,
        refundedAt: payment.refundedAt,
        version: payment.version,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
      },
    });

    await this.recordEvents(payment, client);
  }

  async save(payment: Payment, tx?: unknown): Promise<void> {
    const client = this.getClient(tx);
    const currentVersion = payment.version;
    const nextVersion = currentVersion + 1;

    const res = await client.payment.updateMany({
      where: {
        tranId: payment.tranId,
        version: currentVersion,
      },
      data: {
        status: payment.status,
        qrString: payment.qrString,
        paidAt: payment.paidAt,
        abaApv: payment.abaApv,
        nextAbaCheckAt: payment.nextAbaCheckAt,
        abaCheckCount: payment.abaCheckCount,
        lastAbaCheckAt: payment.lastAbaCheckAt,
        closedAt: payment.closedAt,
        refundedAmountMinor: payment.refundedAmountMinor,
        refundedAt: payment.refundedAt,
        version: nextVersion,
        updatedAt: this.clock.now(),
      },
    });

    if (res.count === 0) {
      throw new ConflictError(
        'CONCURRENCY_CONFLICT',
        `Payment ${payment.tranId} optimistic lock failed (version ${currentVersion})`,
      );
    }

    await this.recordEvents(payment, client);
  }

  async findDueForAbaCheck(now: Date, limit: number, tx?: unknown): Promise<Payment[]> {
    const client = this.getClient(tx);
    const rows = await client.payment.findMany({
      where: {
        status: 'PENDING',
        nextAbaCheckAt: {
          lte: now,
        },
      },
      orderBy: {
        nextAbaCheckAt: 'asc',
      },
      take: limit,
    });

    return rows.map((r) => this.toDomain(r));
  }

  async findDueForReconciliation(now: Date, limit: number, tx?: unknown): Promise<Payment[]> {
    const client = this.getClient(tx);
    const rows = await client.payment.findMany({
      where: {
        status: {
          in: ['EXPIRED', 'CANCELLED', 'FAILED'],
        },
        nextAbaCheckAt: {
          lte: now,
        },
      },
      orderBy: {
        nextAbaCheckAt: 'asc',
      },
      take: limit,
    });

    return rows.map((r) => this.toDomain(r));
  }

  async findDueForDispenseUnknown(cutoff: Date, limit: number, tx?: unknown): Promise<Payment[]> {
    const client = this.getClient(tx);
    const rows = await client.payment.findMany({
      where: {
        status: 'PAID',
        paidAt: {
          lte: cutoff,
        },
      },
      orderBy: {
        paidAt: 'asc',
      },
      take: limit,
    });
    return rows.map((r) => this.toDomain(r));
  }

  async findDueForUnknownEscalation(cutoff: Date, limit: number, tx?: unknown): Promise<Payment[]> {
    const client = this.getClient(tx);
    const rows = await client.payment.findMany({
      where: {
        status: 'DISPENSE_UNKNOWN',
        updatedAt: {
          lte: cutoff,
        },
      },
      orderBy: {
        updatedAt: 'asc',
      },
      take: limit,
    });
    return rows.map((r) => this.toDomain(r));
  }

  async recordDispense(dispense: Dispense, tx?: unknown): Promise<void> {
    const client = this.getClient(tx);
    await client.dispense.upsert({
      where: { tranId: dispense.tranId },
      update: {
        result: dispense.result,
        flowMl: dispense.flowMl,
        weightG: dispense.weightG,
        diffPercent: new Prisma.Decimal(dispense.diffPercent),
        fault: dispense.fault,
        occurredAt: dispense.occurredAt,
        clockSkew: dispense.clockSkew,
        late: dispense.late,
      },
      create: {
        tranId: dispense.tranId,
        machineId: dispense.machineId,
        result: dispense.result,
        flowMl: dispense.flowMl,
        weightG: dispense.weightG,
        diffPercent: new Prisma.Decimal(dispense.diffPercent),
        fault: dispense.fault,
        occurredAt: dispense.occurredAt,
        receivedAt: dispense.receivedAt,
        clockSkew: dispense.clockSkew,
        late: dispense.late,
      },
    });
  }

  async getDispense(tranId: string, tx?: unknown): Promise<Dispense | null> {
    const client = this.getClient(tx);
    const row = await client.dispense.findUnique({
      where: { tranId },
    });
    return row ? this.toDispenseDomain(row) : null;
  }

  async recordRejection(
    machineId: string,
    tranId: string | undefined,
    code: string,
    raw: unknown,
    tx?: unknown,
  ): Promise<void> {
    const client = this.getClient(tx);
    await client.dispenseRejection.create({
      data: {
        machineId,
        tranId: tranId ?? null,
        code,
        raw: (raw ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async saveRefundCase(refundCase: RefundCase, tx?: unknown): Promise<void> {
    const client = this.getClient(tx);
    await client.refundCase.upsert({
      where: { tranId: refundCase.tranId },
      update: {
        status: refundCase.status,
        suggestedAmountMinor: refundCase.suggestedAmountMinor,
        refundedAmountMinor: refundCase.refundedAmountMinor,
        claimedBy: refundCase.claimedBy,
        claimedUntil: refundCase.claimedUntil,
        method: refundCase.method,
        reference: refundCase.reference,
        decidedBy: refundCase.decidedBy,
        decidedAt: refundCase.decidedAt,
        decisionReason: refundCase.decisionReason,
        attempts: refundCase.attempts,
        lastError: refundCase.lastError,
        updatedAt: this.clock.now(),
      },
      create: {
        tranId: refundCase.tranId,
        reason: refundCase.reason,
        suggestedAmountMinor: refundCase.suggestedAmountMinor,
        refundedAmountMinor: refundCase.refundedAmountMinor,
        status: refundCase.status,
        claimedBy: refundCase.claimedBy,
        claimedUntil: refundCase.claimedUntil,
        method: refundCase.method,
        reference: refundCase.reference,
        decidedBy: refundCase.decidedBy,
        decidedAt: refundCase.decidedAt,
        decisionReason: refundCase.decisionReason,
        attempts: refundCase.attempts,
        lastError: refundCase.lastError,
        createdAt: refundCase.createdAt,
        updatedAt: refundCase.updatedAt,
      },
    });
  }

  async getRefundCase(tranId: string, tx?: unknown): Promise<RefundCase | null> {
    const client = this.getClient(tx);
    const row = await client.refundCase.findUnique({
      where: { tranId },
    });
    return row ? this.toRefundCaseDomain(row) : null;
  }

  async findRefundCases(
    filter: { status?: RefundStatus; limit?: number },
    tx?: unknown,
  ): Promise<RefundCase[]> {
    const client = this.getClient(tx);
    const rows = await client.refundCase.findMany({
      where: filter.status ? { status: filter.status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: filter.limit ?? 50,
    });
    return rows.map((r) => this.toRefundCaseDomain(r));
  }

  async getMachinePendingOutcomes(machineId: string, tx?: unknown): Promise<number> {
    const client = this.getClient(tx);
    const machine = await client.machine.findUnique({
      where: { id: machineId },
      select: { pendingOutcomes: true },
    });
    return machine?.pendingOutcomes ?? 0;
  }

  private async recordEvents(payment: Payment, client: Prisma.TransactionClient | PrismaService): Promise<void> {
    if (payment.stateChanges.length === 0) return;

    for (const change of payment.stateChanges) {
      await client.paymentEvent.create({
        data: {
          tranId: payment.tranId,
          fromStatus: change.fromStatus,
          toStatus: change.toStatus,
          reason: change.reason,
          at: change.at,
        },
      });
    }
  }
}
