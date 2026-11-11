import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/platform/database/prisma.service';
import {
  CancelPaymentCommand,
  CancelPaymentHandler,
  CreatePaymentCommand,
  CreatePaymentHandler,
} from '../src/contexts/payments/application';

describe('pay/cancel ownership', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const M = 'WRM-900';

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    prisma = app.get(PrismaService);
  }, 30000);

  afterAll(async () => {
    await prisma.paymentEvent.deleteMany({ where: { payment: { machineId: M } } });
    await prisma.payment.deleteMany({ where: { machineId: M } });
    await app.close();
  });

  it('a machine cannot cancel another machine payment; the owner can', async () => {
    await prisma.payment.updateMany({ where: { machineId: M, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    const created = await app
      .get(CreatePaymentHandler)
      .execute(new CreatePaymentCommand(M, `req-cancel-owner-${Date.now()}`, 500));
    const tranId = created.payment.tranId;
    const cancel = app.get(CancelPaymentHandler);

    await cancel.execute(new CancelPaymentCommand('WRM-001', tranId));
    expect((await prisma.payment.findUnique({ where: { tranId } }))?.status).toBe('PENDING');

    await cancel.execute(new CancelPaymentCommand(M, tranId));
    expect((await prisma.payment.findUnique({ where: { tranId } }))?.status).toBe('CANCELLED');
  });
});
