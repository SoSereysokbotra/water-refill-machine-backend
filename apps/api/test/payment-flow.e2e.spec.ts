import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/platform/database/prisma.service';
import { MqttService } from '../src/platform/mqtt/mqtt.service';
import { buildMachineTopic, MQTT_TOPICS } from '@wrm/contracts';

describe('Phase 2 E2E Payment & Dispense Flow', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let mqtt: MqttService;
  const testMachineId = 'WRM-900';

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(PrismaService);
    mqtt = app.get(MqttService);

    await prisma.dispense.deleteMany({ where: { machineId: testMachineId } });
    await prisma.paymentEvent.deleteMany({ where: { payment: { machineId: testMachineId } } });
    await prisma.payment.deleteMany({ where: { machineId: testMachineId } });
    await prisma.outbox.deleteMany({});
    await prisma.inbox.deleteMany({});
  }, 30000);

  afterAll(async () => {
    await prisma.dispense.deleteMany({ where: { machineId: testMachineId } });
    await prisma.paymentEvent.deleteMany({ where: { payment: { machineId: testMachineId } } });
    await prisma.payment.deleteMany({ where: { machineId: testMachineId } });
    await prisma.outbox.deleteMany({});
    await prisma.inbox.deleteMany({});
    await app.close();
  });

  it('runs complete payment -> qr -> paid -> done -> dispensed + ack lifecycle', async () => {
    const requestId = `req-e2e-${Date.now()}`;
    let capturedQr: any = null;
    let capturedPaid: any = null;
    let capturedAck: any = null;

    // Set up machine listeners on client MQTT topics
    mqtt.subscribe(buildMachineTopic(testMachineId, MQTT_TOPICS.PAY_QR), (_topic, payload) => {
      const msg = JSON.parse(payload.toString());
      if (msg.request_id === requestId) {
        capturedQr = msg;
      }
    });

    mqtt.subscribe(buildMachineTopic(testMachineId, MQTT_TOPICS.PAY_STATUS), (_topic, payload) => {
      const msg = JSON.parse(payload.toString());
      if (msg.status === 'paid') {
        capturedPaid = msg;
      }
    });

    mqtt.subscribe(buildMachineTopic(testMachineId, MQTT_TOPICS.TRANSACTION_ACK), (_topic, payload) => {
      capturedAck = JSON.parse(payload.toString());
    });

    // Step 1: Machine requests payment for 500 mL
    await mqtt.publish(
      buildMachineTopic(testMachineId, MQTT_TOPICS.PAY_REQUEST),
      { v: 1, request_id: requestId, volume_ml: 500 },
      { qos: 1 },
    );

    // Wait for pay/qr to be generated & published via outbox
    for (let i = 0; i < 40 && !capturedQr; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(capturedQr).toBeDefined();
    expect(capturedQr.request_id).toBe(requestId);
    expect(capturedQr.qr_string).toContain('000201010212');
    const tranId = capturedQr.tran_id;

    // Step 2: PayWay Webhook callback arrives
    const callbackRes = await app.inject({
      method: 'POST',
      url: '/v1/payway/callback',
      payload: { tran_id: tranId, apv: 'APV_E2E_CONFIRMED' },
    });
    expect(callbackRes.statusCode).toBe(200);

    // Wait for pay/status (paid) to be emitted
    for (let i = 0; i < 40 && !capturedPaid; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(capturedPaid).toBeDefined();
    expect(capturedPaid.tran_id).toBe(tranId);
    expect(capturedPaid.status).toBe('paid');

    // Step 3: Machine finishes dispensing and reports transaction outcome
    await mqtt.publish(
      buildMachineTopic(testMachineId, MQTT_TOPICS.TRANSACTION),
      {
        v: 1,
        tran_id: tranId,
        result: 'ok',
        flow_ml: 502,
        weight_g: 504,
        ts: Math.floor(Date.now() / 1000),
      },
      { qos: 1 },
    );

    // Wait for transaction/ack
    for (let i = 0; i < 40 && !capturedAck; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(capturedAck).toBeDefined();
    expect(capturedAck.tran_id).toBe(tranId);
    expect(capturedAck.status).toBe('ok');

    // Step 4: Verify Database Records
    const payment = await prisma.payment.findUnique({
      where: { tranId },
      include: { dispense: true },
    });
    expect(payment?.status).toBe('DISPENSED');
    expect(payment?.dispense?.result).toBe('ok');
    expect(payment?.dispense?.flowMl).toBe(502);
    expect(payment?.dispense?.weightG).toBe(504);
  });
});
