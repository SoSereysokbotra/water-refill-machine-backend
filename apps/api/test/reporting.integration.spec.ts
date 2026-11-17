import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/platform/database/prisma.service';
import { ReportingService } from '../src/contexts/reporting/application/reporting.service';
import { ReportingSweep } from '../src/contexts/reporting/application/reporting.sweep';

/**
 * Phase 7 DoD against the REAL database views (reporting.spec.ts only uses a mocked Prisma):
 * gross, refunds and net revenue match the seeded payments in both currencies,
 * late payments count as revenue, refund-queue totals use refund amounts.
 */
describe('Reporting views (real database)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reports: ReportingService;
  const USD_M = 'WRM-9701';
  const KHR_M = 'WRM-9702';
  const IDS = [USD_M, KHR_M];
  const now = new Date();

  const clean = async () => {
    await prisma.refundCase.deleteMany({ where: { payment: { machineId: { in: IDS } } } });
    await prisma.paymentEvent.deleteMany({ where: { payment: { machineId: { in: IDS } } } });
    await prisma.payment.deleteMany({ where: { machineId: { in: IDS } } });
    await prisma.machinePrice.deleteMany({ where: { machineId: { in: IDS } } });
    await prisma.machine.deleteMany({ where: { id: { in: IDS } } });
  };

  const payment = (
    tranId: string,
    machineId: string,
    currency: 'USD' | 'KHR',
    amountMinor: number,
    status: 'DISPENSED' | 'REFUNDED' | 'REFUND_REVIEW',
    opts: { paid?: boolean; refundedAmountMinor?: number } = {},
  ) =>
    prisma.payment.create({
      data: {
        tranId,
        machineId,
        requestId: `req-${tranId}`,
        volumeMl: 500,
        amountMinor,
        currency,
        status,
        qrString: 'x',
        expiresAt: now,
        paidAt: opts.paid === false ? null : now,
        refundedAmountMinor: opts.refundedAmountMinor ?? null,
      },
    });

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    prisma = app.get(PrismaService);
    reports = app.get(ReportingService);
    await clean();

    for (const [id, currency] of [[USD_M, 'USD'], [KHR_M, 'KHR']] as const) {
      await prisma.machine.create({ data: { id, name: id, currency, mqttUsername: id.toLowerCase() } });
    }

    // USD: dispensed 25; fully refunded 20; partial dispense pending review 25 (suggest 10, claimed); late payment 15
    await payment('rpt-usd-ok', USD_M, 'USD', 25, 'DISPENSED');
    await payment('rpt-usd-ref', USD_M, 'USD', 20, 'REFUNDED', { refundedAmountMinor: 20 });
    await prisma.refundCase.create({
      data: { tranId: 'rpt-usd-ref', reason: 'DISPENSE_FAILED', suggestedAmountMinor: 20, refundedAmountMinor: 20, status: 'refunded' },
    });
    await payment('rpt-usd-rev', USD_M, 'USD', 25, 'REFUND_REVIEW');
    await prisma.refundCase.create({
      data: {
        tranId: 'rpt-usd-rev', reason: 'DISPENSE_PARTIAL', suggestedAmountMinor: 10, status: 'claimed',
        claimedBy: 'alice', claimedUntil: new Date(now.getTime() + 30 * 60 * 1000),
      },
    });
    await payment('rpt-usd-late', USD_M, 'USD', 15, 'REFUND_REVIEW', { paid: false }); // paid_at stays NULL
    await prisma.refundCase.create({
      data: { tranId: 'rpt-usd-late', reason: 'LATE_PAYMENT', suggestedAmountMinor: 15, status: 'open' },
    });

    // KHR: dispensed 1000; partly refunded 1000 (refund 300)
    await payment('rpt-khr-ok', KHR_M, 'KHR', 1000, 'DISPENSED');
    await payment('rpt-khr-part', KHR_M, 'KHR', 1000, 'REFUNDED', { refundedAmountMinor: 300 });
    await prisma.refundCase.create({
      data: { tranId: 'rpt-khr-part', reason: 'DISPENSE_PARTIAL', suggestedAmountMinor: 300, refundedAmountMinor: 300, status: 'refunded' },
    });

    await app.get(ReportingSweep).execute(); // refresh materialized views
  }, 60000);

  afterAll(async () => {
    await clean();
    await app.get(ReportingSweep).execute();
    await app.close();
  });

  it('USD: gross, refunds and net per machine (late payment counted as revenue)', async () => {
    const res = await reports.getSalesReport({ groupBy: 'machine', machineId: USD_M });
    expect(res.summary.usd).toMatchObject({
      totalPayments: 4,
      dispensedCount: 1,
      refundedCount: 1,
      grossAmountMinor: 85, // 25 + 20 + 25 + 15
      refundedAmountMinor: 20,
      netAmountMinor: 65,
    });
    expect(res.summary.khr.totalPayments).toBe(0);
  });

  it('KHR: gross, refunds and net per machine', async () => {
    const res = await reports.getSalesReport({ groupBy: 'machine', machineId: KHR_M });
    expect(res.summary.khr).toMatchObject({
      totalPayments: 2,
      grossAmountMinor: 2000,
      refundedAmountMinor: 300,
      netAmountMinor: 1700,
    });
  });

  it('daily report includes the seeded totals (both currencies)', async () => {
    const res = await reports.getSalesReport({ groupBy: 'day' });
    // other test data may exist; the seeded amounts must be included
    expect(res.summary.usd.grossAmountMinor).toBeGreaterThanOrEqual(85);
    expect(res.summary.khr.grossAmountMinor).toBeGreaterThanOrEqual(2000);
    expect(res.summary.khr.netAmountMinor).toBeGreaterThanOrEqual(1700);
  });

  it('refund queue maps claim fields and totals refund amounts, not payment amounts', async () => {
    const res = await reports.getRefundsReport();
    const mine = res.items.filter((i) => i.tranId.startsWith('rpt-'));
    expect(mine).toHaveLength(4);

    const claimed = mine.find((i) => i.tranId === 'rpt-usd-rev')!;
    expect(claimed.claimantId).toBe('alice');
    expect(claimed.expiresAt).not.toBeNull();
    expect(claimed.suggestedAmountMinor).toBe(10);

    const partial = mine.find((i) => i.tranId === 'rpt-khr-part')!;
    expect(partial.refundedAmountMinor).toBe(300);

    const onlyMine = await reports.getRefundsReport({ status: 'refunded' });
    const khrRefunded = onlyMine.items
      .filter((i) => i.tranId.startsWith('rpt-khr'))
      .reduce((sum, i) => sum + (i.refundedAmountMinor ?? 0), 0);
    expect(khrRefunded).toBe(300); // not the 1000 payment amount
  });

  it('fleet status view works', async () => {
    const rows = await reports.getFleetStatus();
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining(IDS));
  });
});
