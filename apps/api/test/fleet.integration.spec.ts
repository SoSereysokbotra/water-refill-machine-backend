import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/platform/errors/http-exception.filter';
import { PrismaService } from '../src/platform/database/prisma.service';
import { MqttService } from '../src/platform/mqtt/mqtt.service';
import { CreatePaymentCommand, CreatePaymentHandler } from '../src/contexts/payments/application';
import { FleetOfflineSweep } from '../src/contexts/fleet/application';
import { FleetMqttConsumer, FleetOutboxHandlers } from '../src/contexts/fleet/interface';

/** Phase 4 (Fleet): provisioning, prices, config, decommission, online/offline, config/ack. */
describe('Fleet (Phase 4)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const IDS = ['WRM-9101', 'WRM-9102', 'WRM-9103'];

  const clean = async () => {
    await prisma.outbox.deleteMany({ where: { aggregateId: { in: IDS } } });
    await prisma.heartbeat.deleteMany({ where: { machineId: { in: IDS } } });
    await prisma.paymentEvent.deleteMany({ where: { payment: { machineId: { in: IDS } } } });
    await prisma.payment.deleteMany({ where: { machineId: { in: IDS } } });
    await prisma.machinePrice.deleteMany({ where: { machineId: { in: IDS } } });
    await prisma.machine.deleteMany({ where: { id: { in: IDS } } });
  };

  const req = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: Record<string, unknown>) =>
    app.inject({ method, url, payload });

  const provision = (id: string, prices = { '500': 15, '750': 20, '1000': 25 }) =>
    req('POST', '/v1/machines', { id, name: `Test ${id}`, currency: 'USD', prices });

  const events = async (id: string) =>
    (await prisma.outbox.findMany({ where: { aggregateId: id }, orderBy: { occurredAt: 'asc' } })).map((o) => o.eventType);

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    await clean();
  }, 30000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await clean();
    await app.close();
  });

  it('provisions a machine: prices, MQTT username, one-time password, config event', async () => {
    const res = await provision('WRM-9101');
    expect(res.statusCode).toBe(201);
    const data = res.json().data;

    expect(data.machine.id).toBe('WRM-9101');
    expect(data.machine.enabled).toBe(true);
    expect(data.machine.pricesMinor).toEqual({ 500: 15, 750: 20, 1000: 25 });
    expect(data.credentials.username).toBe('wrm-9101');
    expect(data.credentials.password).toHaveLength(24);
    expect(data.credentials.brokerSetup.join(' ')).toContain('wrm-9101');
    expect(await events('WRM-9101')).toContain('fleet.MachineConfigChanged');
  });

  it('rejects a duplicate, a bad id and a missing price tier', async () => {
    const dup = await provision('WRM-9101');
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('FLEET_MACHINE_EXISTS');

    expect((await provision('MACHINE-1')).json().error.code).toBe('VALIDATION_FAILED');

    const missing = await req('POST', '/v1/machines', {
      id: 'WRM-9103', name: 'x', currency: 'USD', prices: { '500': 15, '750': 20 },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('publishes the retained config with prices in major units', async () => {
    const mqtt = app.get(MqttService);
    const publish = vi.spyOn(mqtt, 'publish').mockResolvedValue();

    await app.get(FleetOutboxHandlers).publishConfig({
      eventId: 'e1', type: 'fleet.MachineConfigChanged', version: 1, occurredAt: new Date(),
      data: { machineId: 'WRM-9101', reason: 'provisioned' },
    });

    expect(publish).toHaveBeenCalledWith(
      'wrm/WRM-9101/config',
      { v: 1, prices: { '500': '0.15', '750': '0.20', '1000': '0.25' }, currency: 'USD', enabled: true },
      { qos: 1, retain: true },
    );
    publish.mockRestore();
  });

  it('a price change is used by the next payment (a payment keeps its own price)', async () => {
    const create = app.get(CreatePaymentHandler);
    const before = await create.execute(new CreatePaymentCommand('WRM-9101', `req-fleet-a-${Date.now()}`, 500));
    expect(before.payment.amountMinor).toBe(15);

    const put = await req('PUT', '/v1/machines/WRM-9101/prices', {
      currency: 'USD', prices: { '500': 30, '750': 40, '1000': 50 },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().data.pricesMinor).toEqual({ 500: 30, 750: 40, 1000: 50 });

    const after = await create.execute(new CreatePaymentCommand('WRM-9101', `req-fleet-b-${Date.now()}`, 500));
    expect(after.payment.amountMinor).toBe(30);
    const old = await prisma.payment.findUnique({ where: { tranId: before.payment.tranId } });
    expect(old?.amountMinor).toBe(15);
  });

  it('a disabled machine refuses payments; enabling again works', async () => {
    expect((await req('PATCH', '/v1/machines/WRM-9101', { enabled: false })).statusCode).toBe(200);
    await expect(
      app.get(CreatePaymentHandler).execute(new CreatePaymentCommand('WRM-9101', `req-fleet-c-${Date.now()}`, 500)),
    ).rejects.toMatchObject({ code: 'PAY_MACHINE_DISABLED' });

    expect((await req('PATCH', '/v1/machines/WRM-9101', { enabled: true })).json().data.enabled).toBe(true);
  });

  it('rotate-credentials returns a new one-time password for the same user', async () => {
    const res = await req('POST', '/v1/machines/WRM-9101/rotate-credentials');
    expect(res.statusCode).toBe(201);
    expect(res.json().data.username).toBe('wrm-9101');
    expect(res.json().data.password).toHaveLength(24);
  });

  it('decommission disables the machine for good', async () => {
    await provision('WRM-9102');
    const res = await req('POST', '/v1/machines/WRM-9102/decommission');
    expect(res.statusCode).toBe(201);
    expect(res.json().data.machine.enabled).toBe(false);
    expect(res.json().data.machine.decommissionedAt).not.toBeNull();

    const enable = await req('PATCH', '/v1/machines/WRM-9102', { enabled: true });
    expect(enable.statusCode).toBe(409);
    expect(enable.json().error.code).toBe('FLEET_MACHINE_DECOMMISSIONED');

    const prices = await req('PUT', '/v1/machines/WRM-9102/prices', {
      currency: 'USD', prices: { '500': 1, '750': 2, '1000': 3 },
    });
    expect(prices.json().error.code).toBe('FLEET_MACHINE_DECOMMISSIONED');
    expect((await req('GET', '/v1/machines/WRM-9102')).json().data.enabled).toBe(false);
  });

  it('unknown machine -> 404', async () => {
    const res = await req('GET', '/v1/machines/WRM-9999');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('PAY_MACHINE_NOT_FOUND');
  });

  it('a silent machine goes offline (sweep) and comes back online with a heartbeat', async () => {
    await prisma.outbox.deleteMany({ where: { aggregateId: 'WRM-9101' } });
    await prisma.machine.update({
      where: { id: 'WRM-9101' },
      data: { online: true, lastSeenAt: new Date(Date.now() - 10 * 60 * 1000) },
    });

    await app.get(FleetOfflineSweep).execute();
    expect((await prisma.machine.findUnique({ where: { id: 'WRM-9101' } }))?.online).toBe(false);
    expect(await events('WRM-9101')).toContain('fleet.MachineWentOffline');

    const hb = { fw: '0.5.0', stm32: 'ok', pending_outcomes: 0 };
    await app.get(FleetMqttConsumer).onHeartbeat('wrm/WRM-9101/heartbeat', Buffer.from(JSON.stringify(hb)));
    expect((await prisma.machine.findUnique({ where: { id: 'WRM-9101' } }))?.online).toBe(true);
    expect(await events('WRM-9101')).toContain('fleet.MachineCameOnline');
  });

  it('Last Will online=0 marks the machine offline once', async () => {
    await prisma.outbox.deleteMany({ where: { aggregateId: 'WRM-9101' } });
    const consumer = app.get(FleetMqttConsumer);
    await consumer.onOnline('wrm/WRM-9101/online', Buffer.from('0'));
    await consumer.onOnline('wrm/WRM-9101/online', Buffer.from('0'));
    expect((await prisma.machine.findUnique({ where: { id: 'WRM-9101' } }))?.online).toBe(false);
    expect((await events('WRM-9101')).filter((e) => e === 'fleet.MachineWentOffline')).toHaveLength(1);
  });

  it('config/ack error raises fleet.ConfigRejected; ok does not', async () => {
    await prisma.outbox.deleteMany({ where: { aggregateId: 'WRM-9101' } });
    const consumer = app.get(FleetMqttConsumer);
    await consumer.onConfigAck('wrm/WRM-9101/config/ack', Buffer.from(JSON.stringify({ v: 1, status: 'ok' })));
    expect(await events('WRM-9101')).not.toContain('fleet.ConfigRejected');

    await consumer.onConfigAck(
      'wrm/WRM-9101/config/ack',
      Buffer.from(JSON.stringify({ v: 1, status: 'error', fault: 'CFG_INVALID' })),
    );
    const rejected = await prisma.outbox.findFirst({ where: { aggregateId: 'WRM-9101', eventType: 'fleet.ConfigRejected' } });
    expect((rejected?.payload as { data: { fault: string } }).data.fault).toBe('CFG_INVALID');
  });
});
