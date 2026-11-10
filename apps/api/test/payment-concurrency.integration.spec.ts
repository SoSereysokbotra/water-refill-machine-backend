import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/platform/database/prisma.service';
import { CreatePaymentCommand, CreatePaymentHandler } from '../src/contexts/payments/application';

describe('Payment Concurrency Integration (Plan §D5 / Phase 2 DoD)', () => {
  let app: NestFastifyApplication;
  let createPaymentHandler: CreatePaymentHandler;
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
    prisma = app.get(PrismaService);

    // Clean up payments for test machine
    await prisma.dispense.deleteMany({ where: { machineId: testMachineId } });
    await prisma.paymentEvent.deleteMany({ where: { payment: { machineId: testMachineId } } });
    await prisma.payment.deleteMany({ where: { machineId: testMachineId } });
  }, 30000);

  afterAll(async () => {
    await prisma.dispense.deleteMany({ where: { machineId: testMachineId } });
    await prisma.paymentEvent.deleteMany({ where: { payment: { machineId: testMachineId } } });
    await prisma.payment.deleteMany({ where: { machineId: testMachineId } });
    await app.close();
  });

  it('20 parallel pay/request for one machine leave exactly one open payment (DoD)', async () => {
    const promises = Array.from({ length: 20 }, (_, i) =>
      createPaymentHandler
        .execute(new CreatePaymentCommand(testMachineId, `req-parallel-${i}`, 500))
        .catch((err) => ({ error: err })),
    );

    await Promise.all(promises);

    // Query open payments for WRM-900
    const openPayments = await prisma.payment.findMany({
      where: {
        machineId: testMachineId,
        status: { in: ['PENDING', 'PAID'] },
      },
    });

    // Exactly one open payment must remain (the others were superseded or locked out)
    expect(openPayments).toHaveLength(1);
    expect(openPayments[0]?.status).toBe('PENDING');

    // Total payments created in DB should show previous ones were cancelled (superseded)
    const allPayments = await prisma.payment.findMany({
      where: { machineId: testMachineId },
    });
    expect(allPayments.length).toBeGreaterThanOrEqual(1);
    const nonOpen = allPayments.filter((p) => p.status === 'CANCELLED');
    expect(nonOpen.length).toBe(allPayments.length - 1);
  });

  it('duplicate pay/request with same request_id returns existing payment without creating another row', async () => {
    const requestId = `req-idempotent-${Date.now()}`;
    const res1 = await createPaymentHandler.execute(
      new CreatePaymentCommand(testMachineId, requestId, 750),
    );
    expect(res1.action).toBe('created');

    const res2 = await createPaymentHandler.execute(
      new CreatePaymentCommand(testMachineId, requestId, 750),
    );
    expect(res2.action).toBe('republish_qr');
    expect(res2.payment.tranId).toBe(res1.payment.tranId);

    // Verify row count in database for this request_id
    const count = await prisma.payment.count({
      where: { machineId: testMachineId, requestId },
    });
    expect(count).toBe(1);
  });

  it('rejects new pay/request with PAY_MACHINE_BUSY when machine has open PAID payment', async () => {
    // Transition the current open payment to PAID
    const open = await prisma.payment.findFirst({
      where: { machineId: testMachineId, status: 'PENDING' },
    });
    expect(open).toBeDefined();

    await prisma.payment.update({
      where: { tranId: open!.tranId },
      data: { status: 'PAID', paidAt: new Date() },
    });

    // Attempting a new payment must fail with PAY_MACHINE_BUSY
    try {
      await createPaymentHandler.execute(
        new CreatePaymentCommand(testMachineId, `req-busy-${Date.now()}`, 1000),
      );
      expect.unreachable('Should have thrown DomainError PAY_MACHINE_BUSY');
    } catch (err: unknown) {
      expect((err as any).code).toBe('PAY_MACHINE_BUSY');
    }
  });
});
