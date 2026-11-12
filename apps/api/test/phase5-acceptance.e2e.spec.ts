import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/platform/errors/http-exception.filter';
import { PrismaService } from '../src/platform/database/prisma.service';
import { ConfigService } from '../src/platform/config/config.service';
import { OutboxHandlerRegistry } from '../src/platform/outbox/outbox-handler.registry';
import { OutboxRelay } from '../src/platform/outbox/outbox.relay';
import { FleetMqttConsumer } from '../src/contexts/fleet/interface/fleet.mqtt-consumer';
import { PaymentsMqttConsumer } from '../src/contexts/payments/interface/mqtt/payments.mqtt-consumer';
import { CreatePaymentCommand, CreatePaymentHandler, DispensingSweep } from '../src/contexts/payments/application';
import {
  AlertService,
  ITelegramClient,
  MonitoringSweep,
  TelegramClient,
  TelegramNotifierService,
} from '../src/contexts/monitoring/application';

class FakeTelegramClient implements ITelegramClient {
  public messages: string[] = [];
  public shouldThrow = false;

  async sendMessage(text: string): Promise<void> {
    if (this.shouldThrow) {
      throw new Error('Telegram network error');
    }
    this.messages.push(text);
  }

  clear() {
    this.messages = [];
    this.shouldThrow = false;
  }
}

describe('Phase 5 Acceptance (E2E)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let registry: OutboxHandlerRegistry;
  let fleetConsumer: FleetMqttConsumer;
  let paymentsConsumer: PaymentsMqttConsumer;
  let createPaymentHandler: CreatePaymentHandler;
  let dispensingSweep: DispensingSweep;
  let monitoringSweep: MonitoringSweep;
  let alertService: AlertService;
  const fakeTelegram = new FakeTelegramClient();

  const MACHINE_ID = 'WRM-9501';

  const clean = async () => {
    await prisma.alert.deleteMany({});
    await prisma.outbox.deleteMany({});
    await prisma.heartbeat.deleteMany({ where: { machineId: MACHINE_ID } });
    await prisma.dispenseRejection.deleteMany({ where: { machineId: MACHINE_ID } });
    await prisma.dispense.deleteMany({ where: { machineId: MACHINE_ID } });
    await prisma.paymentEvent.deleteMany({ where: { payment: { machineId: MACHINE_ID } } });
    await prisma.refundCase.deleteMany({ where: { payment: { machineId: MACHINE_ID } } });
    await prisma.payment.deleteMany({ where: { machineId: MACHINE_ID } });
    await prisma.machinePrice.deleteMany({ where: { machineId: MACHINE_ID } });
    await prisma.machine.deleteMany({ where: { id: MACHINE_ID } });
  };

  const req = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: Record<string, unknown>) =>
    app.inject({ method, url, payload });

  const dispatchOutbox = async (_machineId?: string) => {
    // Process all pending outbox rows, including any cascaded events (e.g. AlertRaised)
    for (let round = 0; round < 5; round++) {
      const rows = await prisma.outbox.findMany({
        where: { dispatchedAt: null },
        orderBy: { occurredAt: 'asc' },
      });

      if (rows.length === 0) break;

      for (const row of rows) {
        const handlers = registry.handlersFor(row.eventType);
        const event = {
          eventId: row.id,
          type: row.eventType,
          data: (row.payload as Record<string, unknown>).data,
          occurredAt: row.occurredAt,
          version: 1,
        };
        for (const h of handlers) {
          await h.handler(event as any);
        }
        await prisma.outbox.update({
          where: { id: row.id },
          data: { dispatchedAt: new Date() },
        });
      }
    }
  };

  const waitForTelegramMessages = async (count: number, timeoutMs = 3000): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (fakeTelegram.messages.length >= count) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // Disable background outbox relay timer so the test has full, deterministic dispatch control
    app.get(OutboxRelay).onModuleDestroy();

    prisma = app.get(PrismaService);
    registry = app.get(OutboxHandlerRegistry);
    fleetConsumer = app.get(FleetMqttConsumer);
    paymentsConsumer = app.get(PaymentsMqttConsumer);
    createPaymentHandler = app.get(CreatePaymentHandler);
    dispensingSweep = app.get(DispensingSweep);
    monitoringSweep = app.get(MonitoringSweep);
    alertService = app.get(AlertService);

    const notifier = app.get(TelegramNotifierService);
    (notifier as any).telegramClient = fakeTelegram;
    const origEnqueue = notifier.enqueue.bind(notifier);
    notifier.enqueue = async (job) => {
      await origEnqueue(job);
      try {
        await notifier.processJob(job);
      } catch {
        // Allow intentional throw tests
      }
    };

    await clean();

    // Provision WRM-9501
    const res = await req('POST', '/v1/machines', {
      id: MACHINE_ID,
      name: `Test ${MACHINE_ID}`,
      currency: 'USD',
      prices: { '500': 15, '750': 20, '1000': 25 },
    });
    expect(res.statusCode).toBe(201);
  }, 30000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await clean();
    await app.close();
  });

  // 1. Offline -> one critical alert -> Telegram once
  it('Scenario 1: Offline -> one critical alert -> Telegram once', async () => {
    fakeTelegram.clear();

    // Bring machine online first
    await fleetConsumer.onOnline(`wrm/${MACHINE_ID}/online`, Buffer.from('1'));
    await dispatchOutbox(MACHINE_ID);
    fakeTelegram.clear();

    // Last Will online=0 twice
    await fleetConsumer.onOnline(`wrm/${MACHINE_ID}/online`, Buffer.from('0'));
    await dispatchOutbox(MACHINE_ID);
    await waitForTelegramMessages(1);

    // Second online=0 directly triggering offline handler to test alert dedupe/merge
    await app.get(FleetMqttConsumer).onOnline(`wrm/${MACHINE_ID}/online`, Buffer.from('0'));
    // Also trigger offline handler directly if the machine was already online=false
    const offlineHandlers = registry.handlersFor('fleet.MachineWentOffline');
    for (const h of offlineHandlers) {
      await h.handler({
        eventId: 'test-evt-offline-2',
        type: 'fleet.MachineWentOffline',
        data: { machineId: MACHINE_ID, at: new Date() },
        occurredAt: new Date(),
        version: 1,
      } as any);
    }

    const alerts = await prisma.alert.findMany({
      where: { machineId: MACHINE_ID, type: 'MACHINE_OFFLINE' },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.status).toBe('active');
    expect(alerts[0]!.severity).toBe('critical');

    expect(fakeTelegram.messages).toHaveLength(1);
    expect(fakeTelegram.messages[0]).toContain(MACHINE_ID);
  });

  // 2. Back online -> resolved
  it('Scenario 2: Back online -> resolved', async () => {
    fakeTelegram.clear();

    // Heartbeat / online=1
    await fleetConsumer.onOnline(`wrm/${MACHINE_ID}/online`, Buffer.from('1'));
    await dispatchOutbox(MACHINE_ID);
    await waitForTelegramMessages(1);

    const alert = await prisma.alert.findFirst({
      where: { machineId: MACHINE_ID, type: 'MACHINE_OFFLINE' },
    });
    expect(alert).not.toBeNull();
    expect(alert!.status).toBe('resolved');

    expect(fakeTelegram.messages.length).toBeGreaterThanOrEqual(1);
    expect(fakeTelegram.messages.some((m) => m.toLowerCase().includes('resolved'))).toBe(true);
  });

  // 3. 10-minute merge
  it('Scenario 3: 10-minute merge', async () => {
    fakeTelegram.clear();

    // Going offline again within 10 min of resolving
    await fleetConsumer.onOnline(`wrm/${MACHINE_ID}/online`, Buffer.from('0'));
    await dispatchOutbox(MACHINE_ID);

    const alerts = await prisma.alert.findMany({
      where: { machineId: MACHINE_ID, type: 'MACHINE_OFFLINE' },
    });
    // Still no new row (merged into existing)
    expect(alerts).toHaveLength(1);
    expect(fakeTelegram.messages).toHaveLength(0);
  });

  // 4. Unknown dispense
  it('Scenario 4: Unknown dispense', async () => {
    fakeTelegram.clear();

    const result = await createPaymentHandler.execute(
      new CreatePaymentCommand(MACHINE_ID, 'req-unknown-1', 500),
    );
    const tranId = result.payment.tranId;

    // Set paid_at 6 min in the past
    await prisma.payment.update({
      where: { tranId },
      data: {
        status: 'PAID',
        paidAt: new Date(Date.now() - 6 * 60 * 1000),
      },
    });

    await dispensingSweep.execute();
    await dispatchOutbox(tranId);

    const alerts = await prisma.alert.findMany({
      where: { dedupeKey: `unknown:${tranId}` },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.type).toBe('DISPENSE_UNKNOWN');
    expect(alerts[0]!.severity).toBe('warning');

    // Run sweep again -> still 1
    await dispensingSweep.execute();
    await dispatchOutbox(tranId);

    const alertsAfter = await prisma.alert.findMany({
      where: { dedupeKey: `unknown:${tranId}` },
    });
    expect(alertsAfter).toHaveLength(1);
  });

  // 5. Outcome rejected
  it('Scenario 5: Outcome rejected', async () => {
    fakeTelegram.clear();

    await paymentsConsumer.onTransaction(
      `wrm/${MACHINE_ID}/transaction`,
      Buffer.from(
        JSON.stringify({
          v: 1,
          tran_id: 'UNKNOWN_TRAN_9501',
          result: 'ok',
          flow_ml: 500,
          weight_g: 500,
          ts: Math.floor(Date.now() / 1000),
        }),
      ),
    );

    await dispatchOutbox(MACHINE_ID);

    const alert = await prisma.alert.findFirst({
      where: { machineId: MACHINE_ID, type: 'OUTCOME_REJECTED' },
    });
    expect(alert).not.toBeNull();
    expect(alert!.severity).toBe('critical');
    expect(alert!.dedupeKey).toContain(`rejected:${MACHINE_ID}`);
  });

  // 6. Fault from error topic
  it('Scenario 6: Fault from error topic', async () => {
    fakeTelegram.clear();

    await paymentsConsumer.onError(
      `wrm/${MACHINE_ID}/error`,
      Buffer.from(JSON.stringify({ v: 1, fault: 'TANK_EMPTY' })),
    );

    await dispatchOutbox(MACHINE_ID);

    const alert = await prisma.alert.findFirst({
      where: { machineId: MACHINE_ID, type: 'FAULT_TANK_EMPTY' },
    });
    expect(alert).not.toBeNull();
    expect(alert!.severity).toBe('critical');
    expect(alert!.dedupeKey).toBe(`fault:${MACHINE_ID}:TANK_EMPTY`);
  });

  // 7. Pending outcomes stuck
  it('Scenario 7: Pending outcomes stuck', async () => {
    fakeTelegram.clear();

    // Heartbeat with pending_outcomes: 2
    await fleetConsumer.onHeartbeat(
      `wrm/${MACHINE_ID}/heartbeat`,
      Buffer.from(
        JSON.stringify({
          v: 1,
          fw: '0.5.1',
          uptime_s: 100,
          rssi: -60,
          heap: 50000,
          stm32: { link: 'ok' },
          pending_outcomes: 2,
          rejected_outcomes: 0,
          dropped_outcomes: 0,
        }),
      ),
    );

    // Set pending_outcomes_since 61 min in the past
    await prisma.machine.update({
      where: { id: MACHINE_ID },
      data: {
        pendingOutcomesSince: new Date(Date.now() - 61 * 60 * 1000),
      },
    });

    await monitoringSweep.execute();

    const alert = await prisma.alert.findFirst({
      where: { machineId: MACHINE_ID, type: 'PENDING_OUTCOMES_STUCK' },
    });
    expect(alert).not.toBeNull();
    expect(alert!.status).toBe('active');

    // Heartbeat with pending_outcomes: 0 + sweep -> resolved
    await fleetConsumer.onHeartbeat(
      `wrm/${MACHINE_ID}/heartbeat`,
      Buffer.from(
        JSON.stringify({
          v: 1,
          fw: '0.5.1',
          uptime_s: 160,
          rssi: -60,
          heap: 50000,
          stm32: { link: 'ok' },
          pending_outcomes: 0,
          rejected_outcomes: 0,
          dropped_outcomes: 0,
        }),
      ),
    );

    await monitoringSweep.execute();

    const resolvedAlert = await prisma.alert.findFirst({
      where: { machineId: MACHINE_ID, type: 'PENDING_OUTCOMES_STUCK' },
    });
    expect(resolvedAlert!.status).toBe('resolved');
  });

  // 8. Telegram failure does not block
  it('Scenario 8: Telegram failure does not block', async () => {
    fakeTelegram.shouldThrow = true;

    // Raising an alert while Telegram throws
    const alert = await prisma.$transaction(async (tx) => {
      return alertService.raiseAlert(tx as any, {
        type: 'ACCURACY_MISMATCH',
        severity: 'warning',
        dedupeKey: `accuracy:${MACHINE_ID}:test8`,
        message: 'Test accuracy mismatch',
        machineId: MACHINE_ID,
      });
    });

    // Alert row was still created
    expect(alert.id).toBeDefined();
    const found = await prisma.alert.findUnique({ where: { id: alert.id } });
    expect(found).not.toBeNull();

    fakeTelegram.shouldThrow = false;
  });

  // 9. REST
  it('Scenario 9: REST endpoints (list, ack, validation)', async () => {
    const listRes = await req('GET', '/v1/alerts?status=active');
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json();
    expect(Array.isArray(list)).toBe(true);

    const targetAlert = list.find((a: any) => a.machineId === MACHINE_ID);
    expect(targetAlert).toBeDefined();

    // Valid ack
    const ackRes = await req('POST', `/v1/alerts/${targetAlert.id}/ack`, { actorId: 'alice' });
    expect(ackRes.statusCode).toBe(201);
    const acked = ackRes.json();
    expect(acked.status).toBe('acknowledged');
    expect(acked.acknowledgedBy).toBe('alice');

    // Missing actorId -> 400 VALIDATION_FAILED
    const badRes = await req('POST', `/v1/alerts/${targetAlert.id}/ack`, {});
    expect(badRes.statusCode).toBe(400);
    expect(badRes.json().error.code).toBe('VALIDATION_FAILED');
  });

  // 10. No Telegram config
  it('Scenario 10: No Telegram config does not throw', async () => {
    const realConfig = new ConfigService();
    vi.spyOn(realConfig, 'get').mockImplementation((key: string) => {
      if (key === 'TELEGRAM_BOT_TOKEN' || key === 'TELEGRAM_CHAT_ID') return undefined as any;
      return '' as any;
    });

    const realClient = new TelegramClient(realConfig);
    await expect(realClient.sendMessage('Test without telegram configured')).resolves.not.toThrow();
  });
});
