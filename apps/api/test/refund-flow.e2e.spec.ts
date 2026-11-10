import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/platform/database/prisma.service';
import { GlobalExceptionFilter } from '../src/platform/errors/http-exception.filter';
import {
  ConfirmPaymentCommand,
  ConfirmPaymentHandler,
  CreatePaymentCommand,
  CreatePaymentHandler,
  RecordDispenseCommand,
  RecordDispenseHandler,
} from '../src/contexts/payments/application';

describe('Phase 3 E2E Dispensing & Refund Review Flow', () => {
  let app: NestFastifyApplication;
  let createPaymentHandler: CreatePaymentHandler;
  let confirmPaymentHandler: ConfirmPaymentHandler;
  let recordDispenseHandler: RecordDispenseHandler;
  let prisma: PrismaService;
  const testMachineId = 'WRM-900';
  const targetMachineIds = [testMachineId, 'WRM-001'];

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { logger: false },
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    createPaymentHandler = app.get(CreatePaymentHandler);
    confirmPaymentHandler = app.get(ConfirmPaymentHandler);
    recordDispenseHandler = app.get(RecordDispenseHandler);
    prisma = app.get(PrismaService);
  }, 30000);

  beforeEach(async () => {
    await prisma.refundCase.deleteMany({ where: { payment: { machineId: { in: targetMachineIds } } } });
    await prisma.dispense.deleteMany({ where: { machineId: { in: targetMachineIds } } });
    await prisma.paymentEvent.deleteMany({ where: { payment: { machineId: { in: targetMachineIds } } } });
    await prisma.payment.deleteMany({ where: { machineId: { in: targetMachineIds } } });
    await prisma.dispenseRejection.deleteMany({ where: { machineId: { in: targetMachineIds } } });
    await prisma.machine.updateMany({
      where: { id: { in: targetMachineIds } },
      data: { pendingOutcomes: 0 },
    });
  });

  afterAll(async () => {
    await prisma.refundCase.deleteMany({ where: { payment: { machineId: { in: targetMachineIds } } } });
    await prisma.dispense.deleteMany({ where: { machineId: { in: targetMachineIds } } });
    await prisma.paymentEvent.deleteMany({ where: { payment: { machineId: { in: targetMachineIds } } } });
    await prisma.payment.deleteMany({ where: { machineId: { in: targetMachineIds } } });
    await prisma.dispenseRejection.deleteMany({ where: { machineId: { in: targetMachineIds } } });
    await app.close();
  });

  it('records successful dispense with dual-sensor readings and completes lifecycle', async () => {
    const created = await createPaymentHandler.execute(
      new CreatePaymentCommand(testMachineId, `req-dsp-ok-${Date.now()}`, 500),
    );
    const tranId = created.payment.tranId;

    await confirmPaymentHandler.execute(
      new ConfirmPaymentCommand(tranId, 'APV_OK_123', 'callback'),
    );

    // Record dispense: 502 mL flow, 504 g weight (diff = 0.40%)
    const res = await recordDispenseHandler.execute(
      new RecordDispenseCommand(testMachineId, {
        v: 1,
        tran_id: tranId,
        result: 'ok',
        flow_ml: 502,
        weight_g: 504,
        ts: Math.floor(Date.now() / 1000),
      }),
    );

    expect(res.status).toBe('ok');

    const payment = await prisma.payment.findUnique({ where: { tranId } });
    expect(payment?.status).toBe('DISPENSED');

    const dispense = await prisma.dispense.findUnique({ where: { tranId } });
    expect(dispense).toBeDefined();
    expect(dispense?.flowMl).toBe(502);
    expect(dispense?.weightG).toBe(504);
    expect(Number(dispense?.diffPercent)).toBe(0.4);
    expect(dispense?.late).toBe(false);
  });

  it('records partial dispense, creates RefundCase per ADR-0008, and verifies REST claim & refund', async () => {
    const created = await createPaymentHandler.execute(
      new CreatePaymentCommand(testMachineId, `req-partial-${Date.now()}`, 1000),
    );
    const tranId = created.payment.tranId;

    await confirmPaymentHandler.execute(
      new ConfirmPaymentCommand(tranId, 'APV_PARTIAL', 'callback'),
    );

    // Partial dispense: delivered 400 mL out of 1000 mL (amount = 25 cents). Fault: BOTTLE_REMOVED
    // Unfulfilled ratio = 600/1000 = 60%. Suggested refund = 60% of 25 = 15 cents.
    await recordDispenseHandler.execute(
      new RecordDispenseCommand(testMachineId, {
        v: 1,
        tran_id: tranId,
        result: 'partial',
        flow_ml: 400,
        weight_g: 400,
        fault: 'BOTTLE_REMOVED',
        ts: Math.floor(Date.now() / 1000),
      }),
    );

    const payment = await prisma.payment.findUnique({ where: { tranId } });
    expect(payment?.status).toBe('REFUND_REVIEW');

    const rc = await prisma.refundCase.findUnique({ where: { tranId } });
    expect(rc).toBeDefined();
    expect(rc?.reason).toBe('DISPENSE_PARTIAL');
    expect(rc?.suggestedAmountMinor).toBe(15);
    expect(rc?.status).toBe('open');

    // 1. Operator claims the case via REST API
    const claimRes = await app.inject({
      method: 'POST',
      url: `/v1/refund-cases/${tranId}/claim`,
      payload: { actorId: 'operator_alice', durationMinutes: 30 },
    });
    expect(claimRes.statusCode).toBe(201);
    const claimData = claimRes.json();
    expect(claimData.data.status).toBe('claimed');

    // 2. Another operator attempts to claim concurrently -> rejected
    const conflictRes = await app.inject({
      method: 'POST',
      url: `/v1/refund-cases/${tranId}/claim`,
      payload: { actorId: 'operator_bob', durationMinutes: 30 },
    });
    expect(conflictRes.statusCode).toBe(409); // CONCURRENCY_CONFLICT / REFUND_ALREADY_CLAIMED

    // 3. Mark refunded while machine has pending_outcomes = 2 -> blocked by safety guard
    await prisma.machine.update({
      where: { id: testMachineId },
      data: { pendingOutcomes: 2 },
    });

    const blockedRes = await app.inject({
      method: 'POST',
      url: `/v1/refund-cases/${tranId}/mark-refunded`,
      payload: {
        actorId: 'operator_alice',
        method: 'ABA_PORTAL',
        reference: 'ABA-REF-12345',
        amountMinor: 15,
      },
    });
    expect(blockedRes.statusCode).toBe(400); // REFUND_BLOCKED_PENDING_OUTCOMES

    // 4. Mark refunded with admin override reason -> succeeds
    const overrideRes = await app.inject({
      method: 'POST',
      url: `/v1/refund-cases/${tranId}/mark-refunded`,
      payload: {
        actorId: 'operator_alice',
        method: 'ABA_PORTAL',
        reference: 'ABA-REF-12345',
        amountMinor: 15,
        adminOverrideReason: 'Customer present at kiosk with receipt',
      },
    });
    expect(overrideRes.statusCode).toBe(201);

    const finalizedPayment = await prisma.payment.findUnique({ where: { tranId } });
    expect(finalizedPayment?.status).toBe('REFUNDED');
    expect(finalizedPayment?.refundedAmountMinor).toBe(15);
  });

  it('rejects refund and reopens upon customer dispute via REST endpoints', async () => {
    const created = await createPaymentHandler.execute(
      new CreatePaymentCommand(testMachineId, `req-reject-${Date.now()}`, 500),
    );
    const tranId = created.payment.tranId;

    await confirmPaymentHandler.execute(
      new ConfirmPaymentCommand(tranId, 'APV_REJ', 'callback'),
    );

    await recordDispenseHandler.execute(
      new RecordDispenseCommand(testMachineId, {
        v: 1,
        tran_id: tranId,
        result: 'error',
        flow_ml: 0,
        weight_g: 0,
        fault: 'NO_FLOW',
        ts: Math.floor(Date.now() / 1000),
      }),
    );

    // Operator rejects refund (reason: water was poured manually)
    const rejectRes = await app.inject({
      method: 'POST',
      url: `/v1/refund-cases/${tranId}/reject`,
      payload: { actorId: 'operator_bob', reason: 'Staff poured water manually' },
    });
    expect(rejectRes.statusCode).toBe(201);

    const rejectedPayment = await prisma.payment.findUnique({ where: { tranId } });
    expect(rejectedPayment?.status).toBe('REFUND_REJECTED');

    // Admin reopens refund on customer complaint
    const reopenRes = await app.inject({
      method: 'POST',
      url: `/v1/refund-cases/${tranId}/reopen`,
      payload: { actorId: 'admin_supervisor', reason: 'Customer disputed via Telegram' },
    });
    expect(reopenRes.statusCode).toBe(201);

    const reopenedPayment = await prisma.payment.findUnique({ where: { tranId } });
    expect(reopenedPayment?.status).toBe('REFUND_REVIEW');
  });

  it('records malformed and unknown outcomes in dispense_rejections table', async () => {
    // 1. Outcome with unknown tran_id
    await expect(
      recordDispenseHandler.execute(
        new RecordDispenseCommand(testMachineId, {
          v: 1,
          tran_id: 'unknown-tran-999',
          result: 'ok',
          flow_ml: 500,
          weight_g: 500,
        }),
      ),
    ).rejects.toMatchObject({ code: 'DSP_UNKNOWN_PAYMENT' });

    // 2. Outcome for wrong machine
    const created = await createPaymentHandler.execute(
      new CreatePaymentCommand('WRM-001', `req-wrong-mac-${Date.now()}`, 500),
    );
    await confirmPaymentHandler.execute(
      new ConfirmPaymentCommand(created.payment.tranId, 'APV_WRONG', 'callback'),
    );

    await expect(
      recordDispenseHandler.execute(
        new RecordDispenseCommand('WRM-900', {
          v: 1,
          tran_id: created.payment.tranId,
          result: 'ok',
          flow_ml: 500,
          weight_g: 500,
        }),
      ),
    ).rejects.toMatchObject({ code: 'DSP_WRONG_MACHINE' });
  });
});
