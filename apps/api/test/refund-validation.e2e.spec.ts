import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { hash } from '@node-rs/argon2';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/platform/errors/http-exception.filter';
import { PrismaService } from '../src/platform/database/prisma.service';
import { AuthService } from '../src/contexts/identity/application/auth.service';
import {
  ConfirmPaymentCommand,
  ConfirmPaymentHandler,
  CreatePaymentCommand,
  CreatePaymentHandler,
  RecordDispenseCommand,
  RecordDispenseHandler,
} from '../src/contexts/payments/application';

/**
 * Refund REST rules (C7) with real logins. The actor is always the logged-in user:
 * a body `actorId` must be ignored (it let one operator act and be audited as another).
 */
describe('Refund REST validation (C7)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const M = 'WRM-900';
  let tranId: string;
  const PASSWORD = 'RefundTest-Password-123!';
  const ALICE = { id: 'usr-test-alice', email: 'alice.refund@test.local' };
  const BOB = { id: 'usr-test-bob', email: 'bob.refund@test.local' };
  const tokens: Record<string, string> = {};

  const clean = async () => {
    await prisma.refundCase.deleteMany({ where: { payment: { machineId: M } } });
    await prisma.dispense.deleteMany({ where: { machineId: M } });
    await prisma.paymentEvent.deleteMany({ where: { payment: { machineId: M } } });
    await prisma.payment.deleteMany({ where: { machineId: M } });
  };

  const post = (as: string, url: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url, payload, headers: { authorization: `Bearer ${tokens[as]}` } });

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);

    await prisma.user.deleteMany({ where: { id: { in: [ALICE.id, BOB.id] } } });
    const passwordHash = await hash(PASSWORD);
    for (const u of [ALICE, BOB]) {
      await prisma.user.create({ data: { ...u, name: u.id, role: 'admin', passwordHash } });
      tokens[u.id] = (await app.get(AuthService).login({ email: u.email, password: PASSWORD, ipAddress: '127.0.0.1' })).token;
    }
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
    await prisma.user.deleteMany({ where: { id: { in: [ALICE.id, BOB.id] } } }); // sessions cascade
    await app.close();
  });

  it('mark-refunded without an active claim is refused', async () => {
    const res = await post(ALICE.id, `/v1/refund-cases/${tranId}/mark-refunded`, {
      method: 'ABA_PORTAL', reference: `REF-${tranId}`, amountMinor: 10,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('REFUND_INVALID_STATE');
  });

  it('only the claimant may mark refunded', async () => {
    expect((await post(ALICE.id, `/v1/refund-cases/${tranId}/claim`, {})).statusCode).toBe(201);
    const res = await post(BOB.id, `/v1/refund-cases/${tranId}/mark-refunded`, {
      method: 'ABA_PORTAL', reference: `REF-${tranId}`, amountMinor: 10,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('REFUND_INVALID_STATE');
  });

  it('a body actorId cannot impersonate another operator', async () => {
    // Bob claims while pretending to be Alice -> the claim is still Bob's
    await post(BOB.id, `/v1/refund-cases/${tranId}/claim`, { actorId: ALICE.id });
    expect((await prisma.refundCase.findUnique({ where: { tranId } }))?.claimedBy).toBe(BOB.id);

    // Alice cannot finish Bob's claim by sending Bob's id either
    const res = await post(ALICE.id, `/v1/refund-cases/${tranId}/mark-refunded`, {
      actorId: BOB.id, method: 'ABA_PORTAL', reference: `REF-${tranId}`, amountMinor: 10,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('REFUND_INVALID_STATE');
  });

  it.each([0, -5, 16, 2.5])('refund amount %s is rejected (must be 1..amount paid)', async (amountMinor) => {
    await post(ALICE.id, `/v1/refund-cases/${tranId}/claim`, {});
    const res = await post(ALICE.id, `/v1/refund-cases/${tranId}/mark-refunded`, {
      method: 'ABA_PORTAL', reference: `REF-${tranId}`, amountMinor,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('a decision needs a reason', async () => {
    expect((await post(ALICE.id, `/v1/refund-cases/${tranId}/reject`, {})).statusCode).toBe(400);
    expect((await post(ALICE.id, `/v1/refund-cases/${tranId}/reject`, { reason: '  ' })).statusCode).toBe(400);
  });

  it('without a session (and APP_ENV not local) the request is refused', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/refund-cases/${tranId}/claim`,
      payload: {},
      headers: { 'x-enforce-auth': 'true' }, // disables the local dev-admin fallback
    });
    expect(res.statusCode).toBe(401);
  });

  it('the claimant can refund the full amount', async () => {
    await post(ALICE.id, `/v1/refund-cases/${tranId}/claim`, {});
    const res = await post(ALICE.id, `/v1/refund-cases/${tranId}/mark-refunded`, {
      method: 'ABA_PORTAL', reference: `REF-${tranId}`, amountMinor: 15,
    });
    expect(res.statusCode).toBe(201);
    expect((await prisma.payment.findUnique({ where: { tranId } }))?.status).toBe('REFUNDED');
    expect((await prisma.refundCase.findUnique({ where: { tranId } }))?.decidedBy).toBe(ALICE.id);
  });
});
