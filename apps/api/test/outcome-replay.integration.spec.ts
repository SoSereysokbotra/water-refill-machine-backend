import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/platform/database/prisma.service';
import {
  ConfirmPaymentCommand,
  ConfirmPaymentHandler,
  CreatePaymentCommand,
  CreatePaymentHandler,
  RecordDispenseCommand,
  RecordDispenseHandler,
} from '../src/contexts/payments/application';

/**
 * The ESP32 re-sends an outcome until it receives transaction/ack (B4.7), so the backend sees the
 * same outcome more than once whenever an ack is lost (Plan D6: duplicate -> ack ok).
 */
describe('Dispense outcome replays and late outcomes (C1 / D6)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let create: CreatePaymentHandler;
  let confirm: ConfirmPaymentHandler;
  let record: RecordDispenseHandler;
  const M = 'WRM-900';

  const clean = async () => {
    await prisma.refundCase.deleteMany({ where: { payment: { machineId: M } } });
    await prisma.dispense.deleteMany({ where: { machineId: M } });
    await prisma.paymentEvent.deleteMany({ where: { payment: { machineId: M } } });
    await prisma.payment.deleteMany({ where: { machineId: M } });
  };

  const paidPayment = async (tag: string) => {
    const res = await create.execute(new CreatePaymentCommand(M, `req-${tag}-${Date.now()}`, 500));
    await confirm.execute(new ConfirmPaymentCommand(res.payment.tranId, 'APV', 'callback'));
    return res.payment.tranId;
  };

  const outcome = (tranId: string, result: 'ok' | 'partial' | 'error', flow: number, weight: number, fault?: string) => ({
    v: 1 as const,
    tran_id: tranId,
    result,
    flow_ml: flow,
    weight_g: weight,
    fault,
    ts: Math.floor(Date.now() / 1000),
  });

  const eventTypes = async (tranId: string) =>
    (await prisma.outbox.findMany({ where: { aggregateId: tranId } })).map((o) => o.eventType);

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    prisma = app.get(PrismaService);
    create = app.get(CreatePaymentHandler);
    confirm = app.get(ConfirmPaymentHandler);
    record = app.get(RecordDispenseHandler);
  }, 30000);

  beforeEach(clean);

  afterAll(async () => {
    await clean();
    await app.close();
  });

  it('identical PARTIAL replay is acked ok and changes nothing', async () => {
    const tranId = await paidPayment('dup-partial');
    const msg = outcome(tranId, 'partial', 200, 201, 'BOTTLE_REMOVED');

    await record.execute(new RecordDispenseCommand(M, msg));
    const caseBefore = await prisma.refundCase.findUnique({ where: { tranId } });

    const second = await record.execute(new RecordDispenseCommand(M, msg));
    expect(second).toEqual({ status: 'ok', duplicate: true });

    expect((await prisma.payment.findUnique({ where: { tranId } }))?.status).toBe('REFUND_REVIEW');
    expect(await prisma.refundCase.findUnique({ where: { tranId } })).toEqual(caseBefore);
    // exactly one DispenseFailed, no reconciliation alert
    const types = await eventTypes(tranId);
    expect(types.filter((t) => t === 'dispensing.DispenseFailed')).toHaveLength(1);
    expect(types).not.toContain('dispensing.ReconciliationNeeded');
  });

  it('identical OK replay after DISPENSED raises no alert and keeps the record unchanged', async () => {
    const tranId = await paidPayment('dup-ok');
    const msg = outcome(tranId, 'ok', 500, 501);

    await record.execute(new RecordDispenseCommand(M, msg));
    const second = await record.execute(new RecordDispenseCommand(M, { ...msg, ts: msg.ts + 30 }));
    expect(second.duplicate).toBe(true);

    const dispense = await prisma.dispense.findUnique({ where: { tranId } });
    expect(dispense?.late).toBe(false);
    expect(await eventTypes(tranId)).not.toContain('dispensing.ReconciliationNeeded');
  });

  it('a different outcome after DISPENSED keeps the original record and raises ReconciliationNeeded', async () => {
    const tranId = await paidPayment('conflict');
    await record.execute(new RecordDispenseCommand(M, outcome(tranId, 'ok', 500, 501)));

    const res = await record.execute(new RecordDispenseCommand(M, outcome(tranId, 'partial', 300, 299, 'BOTTLE_REMOVED')));
    expect(res.late).toBe(true);

    const dispense = await prisma.dispense.findUnique({ where: { tranId } });
    expect(dispense?.result).toBe('ok');
    expect(dispense?.flowMl).toBe(500);
    expect((await prisma.payment.findUnique({ where: { tranId } }))?.status).toBe('DISPENSED');
    expect(await eventTypes(tranId)).toContain('dispensing.ReconciliationNeeded');
  });

  it('an outcome after escalation to REFUND_REVIEW is stored as late and alerts; payment unchanged', async () => {
    const tranId = await paidPayment('escalated');
    await prisma.payment.update({ where: { tranId }, data: { status: 'REFUND_REVIEW' } });

    const res = await record.execute(new RecordDispenseCommand(M, outcome(tranId, 'ok', 500, 498)));
    expect(res.late).toBe(true);

    const dispense = await prisma.dispense.findUnique({ where: { tranId } });
    expect(dispense?.late).toBe(true);
    expect((await prisma.payment.findUnique({ where: { tranId } }))?.status).toBe('REFUND_REVIEW');
    expect(await eventTypes(tranId)).toContain('dispensing.ReconciliationNeeded');
  });

  it('an outcome for a payment the machine was never told was paid is rejected (DSP_NOT_PAID)', async () => {
    const res = await create.execute(new CreatePaymentCommand(M, `req-notpaid-${Date.now()}`, 500));
    const tranId = res.payment.tranId;
    // late payment: EXPIRED then approved -> REFUND_REVIEW, paid_at stays null
    await prisma.payment.update({ where: { tranId }, data: { status: 'EXPIRED' } });
    await confirm.execute(new ConfirmPaymentCommand(tranId, 'APV', 'reconcile'));

    await expect(record.execute(new RecordDispenseCommand(M, outcome(tranId, 'ok', 500, 500)))).rejects.toMatchObject({
      code: 'DSP_NOT_PAID',
    });
  });
});
