// End-to-end: local MQTT broker + backend (mock mode) + fake ESP32 client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import aedesFactory from 'aedes';
import mqtt from 'mqtt';

const MQTT_PORT = 18839;
const HTTP_PORT = 3098;
const serverPath = fileURLToPath(new URL('../src/server.js', import.meta.url));

function waitFor(fn, timeoutMs = 10000, label = 'condition') {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = async () => {
      try {
        const v = await fn();
        if (v) return resolve(v);
      } catch {}
      if (Date.now() - start > timeoutMs) return reject(new Error(`timeout waiting for ${label}`));
      setTimeout(tick, 100);
    };
    tick();
  });
}

test('MQTT payment flow: request -> qr -> paid', async (t) => {
  const broker = aedesFactory();
  const tcp = net.createServer(broker.handle);
  await new Promise((r) => tcp.listen(MQTT_PORT, r));

  const { NODE_TEST_CONTEXT, ...parentEnv } = process.env; // don't run the server as a test child
  const backend = spawn(process.execPath, [serverPath], {
    env: {
      ...parentEnv,
      PORT: String(HTTP_PORT),
      PAYWAY_MODE: 'mock',
      DEVICE_API_KEY: 'test-key',
      MQTT_URL: `mqtt://127.0.0.1:${MQTT_PORT}`,
      MQTT_USERNAME: '',
      MQTT_PASSWORD: '',
      MQTT_CA_FILE: '',
      CURRENCY: 'USD',
      PRICE_500: '0.15',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  backend.stdout.on('data', (d) => (log += d));
  backend.stderr.on('data', (d) => (log += d));

  const esp32 = mqtt.connect(`mqtt://127.0.0.1:${MQTT_PORT}`, { clientId: 'fake-esp32' });
  const received = [];
  esp32.on('message', (topic, buf) => received.push({ topic, msg: JSON.parse(buf.toString()) }));

  t.after(async () => {
    esp32.end(true);
    backend.kill();
    await new Promise((r) => broker.close(r));
    await new Promise((r) => tcp.close(r));
  });

  await waitFor(() => esp32.connected, 5000, 'esp32 connect');
  await new Promise((r) => esp32.subscribe('wrm/WRM-TEST/pay/#', { qos: 1 }, r));
  try {
    await waitFor(
      async () => (await (await fetch(`http://127.0.0.1:${HTTP_PORT}/health`)).json()).mqtt === 'connected',
      10000,
      'backend mqtt connect',
    );
  } catch (err) {
    err.message += `\n--- backend log ---\n${log}`;
    throw err;
  }

  // 1. ESP32 asks for a payment
  esp32.publish('wrm/WRM-TEST/pay/request', JSON.stringify({ volume_ml: 500 }), { qos: 1 });
  const qr = await waitFor(() => received.find((m) => m.topic === 'wrm/WRM-TEST/pay/qr'), 5000, 'pay/qr');
  assert.match(qr.msg.tran_id, /^\d{1,20}$/);
  assert.ok(qr.msg.qr_string.length > 50);
  assert.equal(qr.msg.amount, 0.15);
  assert.equal(qr.msg.currency, 'USD');

  // 2. Customer "pays" (mock)
  const res = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/dev/pay/${qr.msg.tran_id}`, { method: 'POST' });
  assert.equal(res.status, 200);

  // 3. Backend pushes "paid" with the same tran_id
  const status = await waitFor(
    () => received.find((m) => m.topic === 'wrm/WRM-TEST/pay/status' && m.msg.status === 'paid'),
    6000,
    'pay/status paid',
  );
  assert.equal(status.msg.tran_id, qr.msg.tran_id);

  // 4. Invalid volume -> failed
  esp32.publish('wrm/WRM-TEST/pay/request', JSON.stringify({ volume_ml: 600 }), { qos: 1 });
  const bad = await waitFor(
    () => received.find((m) => m.topic === 'wrm/WRM-TEST/pay/status' && m.msg.status === 'failed'),
    5000,
    'invalid volume -> failed',
  );
  assert.equal(bad.msg.tran_id, null);
});
