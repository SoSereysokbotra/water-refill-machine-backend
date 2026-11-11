import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/platform/database/prisma.service';
import {
  CreatePaymentCommand,
  CreatePaymentHandler,
  PaymentsSweep,
  ReconcileSweep,
} from '../src/contexts/payments/application';
import { MockPayWayGateway } from '../src/contexts/payments/infrastructure';

describe('Payment Sweeps & Reconcile Integration (Phase 2 DoD)', () => {
  let app: NestFastifyApplication;
  let createPaymentHandler: CreatePaymentHandler;
  let paymentsSweep: PaymentsSweep;
  let reconcileSweep: ReconcileSweep;
  let mockGateway: MockPayWayGateway;
  let prisma: PrismaService;
  const testMachineId = 'WRM-900';

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await app.init();

    createPaymentHandler = app.get(CreatePaymentHandler);
    paymentsSweep = app.get(PaymentsSweep);
    reconcileSweep = app.get(ReconcileSweep);
    mockGateway = app.get(MockPayWayGateway);
    prisma = app.get(PrismaService);
  }, 30000);

  beforeEach(async () => {
    await prisma.refundCase.deleteMany({ where: { payment: { machineId: testMachineId } } });
    await prisma.dispense.deleteMany({ where: { machineId: testMachineId } });
    await prisma.paymentEvent.deleteMany({ where: { payment: { machineId: testMachineId } } });
    await prisma.payment.deleteMany({ where: { machineId: testMachineId } });
  });

  afterAll(async () => {
    await prisma.refundCase.deleteMany({ where: { payment: { machineId: testMachineId } } });
    await prisma.dispense.deleteMany({ where: { machineId: testMachineId } });
    await prisma.paymentEvent.deleteMany({ where: { payment: { machineId: testMachineId } } });
    await prisma.payment.deleteMany({ where: { machineId: testMachineId } });
    await app.close();
  });

  it('with callback endpoint disabled, payments still confirm via payments.sweep (DoD)', async () => {
    const res = await createPaymentHandler.execute(
      new CreatePaymentCommand(testMachineId, `req-sweep-confirm-${Date.now()}`, 500),
    );
    expect(res.action).toBe('created');
    const tranId = res.payment.tranId;

    // Simulate ABA approving the payment without any callback being received
    mockGateway.setTransactionStatus(tranId, 'approved', 'APV_MOCK_SWEEP');

    // Make check due immediately
    await prisma.payment.update({
      where: { tranId },
      data: { nextAbaCheckAt: new Date(Date.now() - 1000) },
    });

    // Run the payments sweep directly (as the worker would)
    const sweepResult = await paymentsSweep.execute();
    expect(sweepResult.processed).toBeGreaterThanOrEqual(1);

    // Check payment row in DB
    const payment = await prisma.payment.findUnique({ where: { tranId } });
    expect(payment?.status).toBe('PAID');
    expect(payment?.abaApv).toBe('APV_MOCK_SWEEP');
    expect(payment?.paidAt).toBeDefined();
  });

  it('payments past expiresAt + grace are transitioned to EXPIRED by payments.sweep', async () => {
    const res = await createPaymentHandler.execute(
      new CreatePaymentCommand(testMachineId, `req-sweep-expire-${Date.now()}`, 500),
    );
    const tranId = res.payment.tranId;

    // Manipulate expiresAt and nextAbaCheckAt into the past
    const past = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
    await prisma.payment.update({
      where: { tranId },
      data: { expiresAt: past, nextAbaCheckAt: past },
    });

    // ABA returns not_found
    mockGateway.setTransactionStatus(tranId, 'not_found');

    await paymentsSweep.execute();

    const payment = await prisma.payment.findUnique({ where: { tranId } });
    expect(payment?.status).toBe('EXPIRED');
  });

  it('reconcile.sweep finds a late approved payment at +5 min and transitions it to REFUND_REVIEW (DoD)', async () => {
    const res = await createPaymentHandler.execute(
      new CreatePaymentCommand(testMachineId, `req-reconcile-late-${Date.now()}`, 750),
    );
    const tranId = res.payment.tranId;

    // Transition to EXPIRED with due reconcile probe
    const past = new Date(Date.now() - 6 * 60 * 1000);
    await prisma.payment.update({
      where: { tranId },
      data: {
        status: 'EXPIRED',
        expiresAt: past,
        nextAbaCheckAt: past, // Due for reconcile probe
      },
    });

    // Customer actually paid late in ABA app!
    mockGateway.setTransactionStatus(tranId, 'approved', 'APV_LATE_PAYMENT');

    // Run reconcile sweep
    const result = await reconcileSweep.execute();
    expect(result.processed).toBeGreaterThanOrEqual(1);

    const payment = await prisma.payment.findUnique({ where: { tranId } });
    expect(payment?.status).toBe('REFUND_REVIEW');

    // Verify refund case was recorded or event raised
    const events = await prisma.paymentEvent.findMany({ where: { tranId } });
    const statuses = events.map((e) => e.toStatus);
    expect(statuses).toContain('REFUND_REVIEW');

    // C1: late payment -> refund case with 100 % suggested refund, so an operator can act on it
    const refundCase = await prisma.refundCase.findUnique({ where: { tranId } });
    expect(refundCase?.reason).toBe('LATE_PAYMENT');
    expect(refundCase?.status).toBe('open');
    expect(refundCase?.suggestedAmountMinor).toBe(payment?.amountMinor);
  });

  it('reconcile keeps probing after the first probe even when many ABA polls happened while pending (B4.8)', async () => {
    const res = await createPaymentHandler.execute(
      new CreatePaymentCommand(testMachineId, `req-reconcile-sched-${Date.now()}`, 500),
    );
    const tranId = res.payment.tranId;

    // Realistic: ~45 polls while the QR was on screen, then expired; first probe due now
    await prisma.payment.update({
      where: { tranId },
      data: { status: 'EXPIRED', abaCheckCount: 45, reconcileCount: 0, nextAbaCheckAt: new Date(Date.now() - 1000) },
    });
    mockGateway.setTransactionStatus(tranId, 'not_found');

    await reconcileSweep.execute();

    const payment = await prisma.payment.findUnique({ where: { tranId } });
    expect(payment?.reconcileCount).toBe(1);
    // Next probe is at +1 h after the end, i.e. ~55 min after the +5 min probe
    const delayMs = (payment?.nextAbaCheckAt?.getTime() ?? 0) - Date.now();
    expect(delayMs).toBeGreaterThan(50 * 60 * 1000);
    expect(delayMs).toBeLessThanOrEqual(55 * 60 * 1000);
  });

  it('a superseded payment gets a reconcile schedule (C1: PENDING -> CANCELLED starts reconcile)', async () => {
    const first = await createPaymentHandler.execute(
      new CreatePaymentCommand(testMachineId, `req-supersede-a-${Date.now()}`, 500),
    );
    await createPaymentHandler.execute(
      new CreatePaymentCommand(testMachineId, `req-supersede-b-${Date.now()}`, 1000),
    );

    const superseded = await prisma.payment.findUnique({ where: { tranId: first.payment.tranId } });
    expect(superseded?.status).toBe('CANCELLED');
    expect(superseded?.reconcileCount).toBe(0);
    const delayMs = (superseded?.nextAbaCheckAt?.getTime() ?? 0) - Date.now();
    expect(delayMs).toBeGreaterThan(4 * 60 * 1000);
    expect(delayMs).toBeLessThanOrEqual(5 * 60 * 1000);
  });
});
