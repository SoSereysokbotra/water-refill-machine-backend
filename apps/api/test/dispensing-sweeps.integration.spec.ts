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
import { FleetMqttConsumer } from '../src/contexts/fleet/interface';

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
    await prisma.heartbeat.deleteMany({ where: { machineId: testMachineId } });
    await prisma.machine.update({
      where: { id: testMachineId },
      data: { pendingOutcomes: 0, lastSeenAt: null, online: false },
    });
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

    // Machine was online after the payment and reports pending_outcomes = 0
    await prisma.machine.update({
      where: { id: testMachineId },
      data: { pendingOutcomes: 0, lastSeenAt: new Date() },
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

    // Machine online, but pending_outcomes = 1 (queue in NVS not flushed yet!)
    await prisma.machine.update({
      where: { id: testMachineId },
      data: { pendingOutcomes: 1, lastSeenAt: new Date() },
    });

    // Run dispensing sweep
    await dispensingSweep.execute();

    // Must stay in DISPENSE_UNKNOWN until machine queue is flushed
    const updated = await prisma.payment.findUnique({ where: { tranId } });
    expect(updated?.status).toBe('DISPENSE_UNKNOWN');

    const refundCase = await prisma.refundCase.findUnique({ where: { tranId } });
    expect(refundCase).toBeNull();
  });

  it('holds DISPENSE_UNKNOWN when the machine was not seen online since the payment (C1 site check)', async () => {
    const res = await createPaymentHandler.execute(
      new CreatePaymentCommand(testMachineId, `req-dsp-offline-${Date.now()}`, 500),
    );
    const tranId = res.payment.tranId;

    const pastUnknownAt = new Date(Date.now() - 25 * 3600 * 1000);
    await prisma.payment.update({
      where: { tranId },
      data: { status: 'DISPENSE_UNKNOWN', paidAt: pastUnknownAt, updatedAt: pastUnknownAt },
    });

    // pending_outcomes = 0 is only the last known value: the machine has been offline since before the payment
    await prisma.machine.update({
      where: { id: testMachineId },
      data: { pendingOutcomes: 0, lastSeenAt: new Date(pastUnknownAt.getTime() - 60 * 1000) },
    });

    await dispensingSweep.execute();

    const updated = await prisma.payment.findUnique({ where: { tranId } });
    expect(updated?.status).toBe('DISPENSE_UNKNOWN');
    expect(await prisma.refundCase.findUnique({ where: { tranId } })).toBeNull();
  });

  it('heartbeat updates pending_outcomes and last_seen_at (v1 and ESP32 v0.4 formats)', async () => {
    const consumer = app.get(FleetMqttConsumer);
    await prisma.machine.update({ where: { id: testMachineId }, data: { pendingOutcomes: 0, lastSeenAt: null } });

    const v1 = {
      v: 1,
      fw: '0.4.1',
      uptime_s: 120,
      rssi: -60,
      heap: 150000,
      stm32: { link: 'ok', state: 'IDLE', tank: 'FULL', fault: 'NONE' },
      pending_outcomes: 3,
      rejected_outcomes: 0,
      dropped_outcomes: 0,
      ts: Math.floor(Date.now() / 1000),
    };
    await consumer.onHeartbeat(`wrm/${testMachineId}/heartbeat`, Buffer.from(JSON.stringify(v1)));
    let machine = await prisma.machine.findUnique({ where: { id: testMachineId } });
    expect(machine?.pendingOutcomes).toBe(3);
    expect(machine?.lastSeenAt).not.toBeNull();
    expect(machine?.lastStm32State).toBe('IDLE');
    expect(machine?.firmware).toBe('0.4.1');

    const legacy = { fw: '0.4.0', uptime_s: 5, rssi: -70, heap: 1, stm32: 'lost', pending_outcomes: 0, rejected_outcomes: 0, dropped_outcomes: 0 };
    await consumer.onHeartbeat(`wrm/${testMachineId}/heartbeat`, Buffer.from(JSON.stringify(legacy)));
    machine = await prisma.machine.findUnique({ where: { id: testMachineId } });
    expect(machine?.pendingOutcomes).toBe(0);

    // Unknown machines are never auto-registered
    await consumer.onHeartbeat('wrm/WRM-777/heartbeat', Buffer.from(JSON.stringify(v1)));
    expect(await prisma.machine.findUnique({ where: { id: 'WRM-777' } })).toBeNull();
  });
});
