import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/platform/errors/http-exception.filter';
import { PrismaService } from '../src/platform/database/prisma.service';
import {
  ConfirmPaymentCommand,
  ConfirmPaymentHandler,
  CreatePaymentCommand,
  CreatePaymentHandler,
  RecordDispenseCommand,
  RecordDispenseHandler,
} from '../src/contexts/payments/application';

describe('Refund REST validation (C7)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const M = 'WRM-900';
  let tranId: string;

  const clean = async () => {
    await prisma.refundCase.deleteMany({ where: { payment: { machineId: M } } });
    await prisma.dispense.deleteMany({ where: { machineId: M } });
    await prisma.paymentEvent.deleteMany({ where: { payment: { machineId: M } } });
    await prisma.payment.deleteMany({ where: { machineId: M } });
  };

  const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, payload });

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
  }, 30000);

  beforeEach(async () => {
    await clean();
    await prisma.machine.update({ where: { id: M }, data: { pendingOutcomes: 0 } });
    // A PAID 500 mL payment (USD 0.15 = 15 minor) with a partial outcome -> open refund case
    const res = await app.get(CreatePaymentHandler).execute(new CreatePaymentCommand(M, `req-rv-${Date.now()}`, 500));
    tranId = res.payment.tranId;
    await app.get(ConfirmPaymentHandler).execute(new ConfirmPaymentCommand(tranId, 'APV', 'callback'));
    await app.get(RecordDispenseHandler).execute(
      new RecordDispenseCommand(M, { v: 1, tran_id: tranId, result: 'partial', flow_ml: 100, weight_g: 100, fault: 'BOTTLE_REMOVED' }),
    );
  });

  afterAll(async () => {
    await clean();
    await app.close();
  });

  it('mark-refunded without an active claim is refused', async () => {
    const res = await post(`/v1/refund-cases/${tranId}/mark-refunded`, {
      actorId: 'alice', method: 'ABA_PORTAL', reference: `REF-${tranId}`, amountMinor: 10,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('REFUND_INVALID_STATE');
  });

  it('only the claimant may mark refunded', async () => {
    expect((await post(`/v1/refund-cases/${tranId}/claim`, { actorId: 'alice' })).statusCode).toBe(201);
    const res = await post(`/v1/refund-cases/${tranId}/mark-refunded`, {
      actorId: 'bob', method: 'ABA_PORTAL', reference: `REF-${tranId}`, amountMinor: 10,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('REFUND_INVALID_STATE');
  });

  it.each([0, -5, 16, 2.5])('refund amount %s is rejected (must be 1..amount paid)', async (amountMinor) => {
    await post(`/v1/refund-cases/${tranId}/claim`, { actorId: 'alice' });
    const res = await post(`/v1/refund-cases/${tranId}/mark-refunded`, {
      actorId: 'alice', method: 'ABA_PORTAL', reference: `REF-${tranId}`, amountMinor,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('missing actorId / reason are rejected', async () => {
    expect((await post(`/v1/refund-cases/${tranId}/claim`, {})).statusCode).toBe(400);
    expect((await post(`/v1/refund-cases/${tranId}/reject`, { actorId: 'alice' })).statusCode).toBe(400);
    expect((await post(`/v1/refund-cases/${tranId}/reject`, { actorId: 'alice', reason: '  ' })).statusCode).toBe(400);
  });

  it('the claimant can refund the full amount', async () => {
    await post(`/v1/refund-cases/${tranId}/claim`, { actorId: 'alice' });
    const res = await post(`/v1/refund-cases/${tranId}/mark-refunded`, {
      actorId: 'alice', method: 'ABA_PORTAL', reference: `REF-${tranId}`, amountMinor: 15,
    });
    expect(res.statusCode).toBe(201);
    expect((await prisma.payment.findUnique({ where: { tranId } }))?.status).toBe('REFUNDED');
  });
});
