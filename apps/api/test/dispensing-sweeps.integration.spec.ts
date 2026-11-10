import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/platform/database/prisma.service';
import {
  CreatePaymentCommand,
  CreatePaymentHandler,
  DispensingSweep,
} from '../src/contexts/payments/application';

describe('Dispensing Sweeps Integration (Phase 3)', () => {
  let app: NestFastifyApplication;
  let createPaymentHandler: CreatePaymentHandler;
  let dispensingSweep: DispensingSweep;
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
    dispensingSweep = app.get(DispensingSweep);
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

  it('transitions PAID payments past 300s to DISPENSE_UNKNOWN', async () => {
    const res = await createPaymentHandler.execute(
      new CreatePaymentCommand(testMachineId, `req-dsp-sweep-${Date.now()}`, 500),
    );
    const tranId = res.payment.tranId;

    // Simulate payment becoming PAID 6 minutes ago (past 300s timeout)
    const pastPaidAt = new Date(Date.now() - 6 * 60 * 1000);
    await prisma.payment.update({
      where: { tranId },
      data: {
        status: 'PAID',
        paidAt: pastPaidAt,
      },
    });

    // Run dispensing sweep
    const result = await dispensingSweep.execute();
    expect(result.processed).toBeGreaterThanOrEqual(1);

    const updated = await prisma.payment.findUnique({ where: { tranId } });
    expect(updated?.status).toBe('DISPENSE_UNKNOWN');
  });

  it('escalates DISPENSE_UNKNOWN to REFUND_REVIEW after 24h when machine reports pending_outcomes = 0', async () => {
    const res = await createPaymentHandler.execute(
      new CreatePaymentCommand(testMachineId, `req-dsp-esc-${Date.now()}`, 500),
    );
    const tranId = res.payment.tranId;

    // Set status to DISPENSE_UNKNOWN updated 25 hours ago
    const pastUnknownAt = new Date(Date.now() - 25 * 3600 * 1000);
    await prisma.payment.update({
      where: { tranId },
      data: {
        status: 'DISPENSE_UNKNOWN',
        paidAt: pastUnknownAt,
        updatedAt: pastUnknownAt,
      },
    });

    // Ensure machine has pending_outcomes = 0
    await prisma.machine.update({
      where: { id: testMachineId },
      data: { pendingOutcomes: 0 },
    });

    // Run dispensing sweep
    const result = await dispensingSweep.execute();
    expect(result.processed).toBeGreaterThanOrEqual(1);

    const updated = await prisma.payment.findUnique({ where: { tranId } });
    expect(updated?.status).toBe('REFUND_REVIEW');

    const refundCase = await prisma.refundCase.findUnique({ where: { tranId } });
    expect(refundCase).toBeDefined();
    expect(refundCase?.reason).toBe('DISPENSE_UNKNOWN');
    expect(refundCase?.suggestedAmountMinor).toBe(15);
  });

  it('holds DISPENSE_UNKNOWN payments when machine reports pending_outcomes > 0', async () => {
    const res = await createPaymentHandler.execute(
      new CreatePaymentCommand(testMachineId, `req-dsp-hold-${Date.now()}`, 500),
    );
    const tranId = res.payment.tranId;

    const pastUnknownAt = new Date(Date.now() - 25 * 3600 * 1000);
    await prisma.payment.update({
      where: { tranId },
      data: {
        status: 'DISPENSE_UNKNOWN',
        paidAt: pastUnknownAt,
        updatedAt: pastUnknownAt,
      },
    });

    // Set machine pending_outcomes = 1 (queue in NVS not flushed yet!)
    await prisma.machine.update({
      where: { id: testMachineId },
      data: { pendingOutcomes: 1 },
    });

    // Run dispensing sweep
    await dispensingSweep.execute();

    // Must stay in DISPENSE_UNKNOWN until machine queue is flushed
    const updated = await prisma.payment.findUnique({ where: { tranId } });
    expect(updated?.status).toBe('DISPENSE_UNKNOWN');

    const refundCase = await prisma.refundCase.findUnique({ where: { tranId } });
    expect(refundCase).toBeNull();
  });
});
