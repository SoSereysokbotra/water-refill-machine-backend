import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/platform/database/prisma.service';
import { OutboxService } from '../src/platform/outbox/outbox.service';
import { OutboxHandlerRegistry } from '../src/platform/outbox/outbox-handler.registry';
import { OutboxRelay } from '../src/platform/outbox/outbox.relay';
import { MqttService } from '../src/platform/mqtt/mqtt.service';
import { createDomainEvent, generateUuidV7 } from '../src/shared-kernel';

describe('Phase 1 Platform E2E Smoke & Event Pipeline', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let outboxService: OutboxService;
  let registry: OutboxHandlerRegistry;
  let relay: OutboxRelay;
  let mqttService: MqttService;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(PrismaService);
    outboxService = app.get(OutboxService);
    registry = app.get(OutboxHandlerRegistry);
    relay = app.get(OutboxRelay);
    mqttService = app.get(MqttService);

    // Wait for MQTT client to connect
    for (let i = 0; i < 30; i++) {
      if (mqttService.isHealthy()) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live returns 200 OK with status and uptime', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('GET /health/ready returns 200 OK with DB, Redis, and MQTT all up', async () => {
    // Wait briefly for MQTT connection to complete if needed
    for (let i = 0; i < 10; i++) {
      if (mqttService.isHealthy()) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    const res = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.checks.database).toBe('up');
    expect(body.checks.redis).toBe('up');
    expect(body.checks.mqtt).toBe('up');
  });

  it('E2E Event Flow: DomainEvent -> Outbox -> Relay -> Handler -> MQTT Publish/Receive', async () => {
    const eventType = `smoke.payment.received.${Date.now()}`;
    const baseTopic = `wrm/smoke-test/${Date.now()}`;
    const targetTopic = `$share/smoke-${Date.now()}/${baseTopic}`;
    const eventId = generateUuidV7();

    const receivedPayloads: string[] = [];

    // 1. Subscribe to MQTT topic
    await mqttService.subscribe(targetTopic, (_topic, payload) => {
      receivedPayloads.push(payload.toString());
    });

    // 2. Register outbox handler that publishes to MQTT
    registry.register(eventType, 'MqttPublishHandler', async (event) => {
      await mqttService.publish(baseTopic, JSON.stringify(event.data), {
        qos: 1,
        messageExpiryInterval: 60,
      });
    });

    // 3. Add DomainEvent to Outbox
    const domainEvt = createDomainEvent(
      eventType,
      { paymentId: 'pay-smoke-1', amount: 2000, currency: 'KHR' },
      { eventId },
    );

    await prisma.$transaction(async (tx) => {
      await outboxService.add([domainEvt], tx, 'Payment', 'pay-smoke-1');
    });

    // 4. Trigger Outbox Relay pollOnce
    await relay.pollOnce();

    // 5. Wait for BullMQ worker to dispatch and MQTT message to arrive
    for (let i = 0; i < 30; i++) {
      if (receivedPayloads.length > 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    expect(receivedPayloads).toHaveLength(1);
    const parsed = JSON.parse(receivedPayloads[0]!);
    expect(parsed.paymentId).toBe('pay-smoke-1');
    expect(parsed.amount).toBe(2000);
    expect(parsed.currency).toBe('KHR');

    // 6. Verify outbox row is marked dispatched in DB
    const outboxRow = await prisma.outbox.findUnique({ where: { id: eventId } });
    expect(outboxRow).not.toBeNull();
    expect(outboxRow?.dispatchedAt).not.toBeNull();

    // Clean up
    await prisma.outbox.delete({ where: { id: eventId } });
  });
});
