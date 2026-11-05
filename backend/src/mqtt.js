// MQTT bridge: machines (ESP32 gateways) <-> payment logic.
//
// Topics (machine_id = e.g. WRM-001):
//   wrm/{id}/pay/request   machine -> server  {"volume_ml":500}
//   wrm/{id}/pay/qr        server -> machine  {"tran_id","qr_string","amount","currency","volume_ml","expires_in_s"}
//   wrm/{id}/pay/status    server -> machine  {"tran_id","status":"paid|expired|failed"}
//   wrm/{id}/transaction   machine -> server  {"tran_id","flow_ml","weight_g","status"}
//   wrm/{id}/heartbeat     machine -> server  {...}
//   wrm/{id}/error         machine -> server  {"code":"..."}
//   wrm/{id}/online        machine -> server  "1" / "0" (retained, Last Will)
import fs from 'node:fs';
import mqtt from 'mqtt';

const STATUS_PUSH_INTERVAL_MS = 2500;

export function startMqttBridge({ env, payments, createPayment, syncWithPayWay, publicView, prices }) {
  if (!env.MQTT_URL) {
    console.log('[mqtt] MQTT_URL not set - MQTT disabled (HTTP API still works)');
    return null;
  }

  const options = {
    clientId: `wrm-backend-${Math.random().toString(16).slice(2, 8)}`,
    username: env.MQTT_USERNAME || undefined,
    password: env.MQTT_PASSWORD || undefined,
    reconnectPeriod: 3000,
    connectTimeout: 15000,
    clean: true,
  };
  if (env.MQTT_CA_FILE) options.ca = fs.readFileSync(env.MQTT_CA_FILE);

  const client = mqtt.connect(env.MQTT_URL, options);
  const topic = (machineId, suffix) => `wrm/${machineId}/${suffix}`;
  const publish = (t, payload) =>
    client.publish(t, typeof payload === 'string' ? payload : JSON.stringify(payload), { qos: 1 });

  client.on('connect', () => {
    console.log(`[mqtt] connected to ${env.MQTT_URL}`);
    client.subscribe(
      ['wrm/+/pay/request', 'wrm/+/transaction', 'wrm/+/heartbeat', 'wrm/+/error', 'wrm/+/online'],
      { qos: 1 },
    );
  });
  client.on('reconnect', () => console.log('[mqtt] reconnecting...'));
  client.on('close', () => console.log('[mqtt] connection closed'));
  client.on('error', (err) => console.error('[mqtt] error:', err.message));

  client.on('message', async (t, buf) => {
    const parts = t.split('/');
    if (parts.length < 3 || parts[0] !== 'wrm') return;
    const machineId = parts[1];
    const kind = parts.slice(2).join('/');
    const text = buf.toString();

    if (kind === 'online') {
      console.log(`[mqtt] ${machineId} ${text === '1' ? 'ONLINE' : 'OFFLINE'}`);
      return;
    }

    let msg;
    try {
      msg = text ? JSON.parse(text) : {};
    } catch {
      console.warn(`[mqtt] ignoring non-JSON message on ${t}: ${text.slice(0, 100)}`);
      return;
    }

    if (kind === 'pay/request') {
      const volumeMl = Number(msg.volume_ml);
      if (!prices[volumeMl]) {
        publish(topic(machineId, 'pay/status'), {
          tran_id: null,
          status: 'failed',
          error: 'volume_ml must be 500, 750 or 1000',
        });
        return;
      }
      try {
        const p = await createPayment(machineId, volumeMl);
        p.via = 'mqtt';
        p.notifiedStatus = 'pending';
        publish(topic(machineId, 'pay/qr'), {
          tran_id: p.tranId,
          qr_string: p.qrString,
          amount: p.amount,
          currency: p.currency,
          volume_ml: p.volumeMl,
          expires_in_s: publicView(p).expires_in_s,
        });
        console.log(`[mqtt] -> ${machineId} pay/qr ${p.tranId}`);
      } catch (err) {
        publish(topic(machineId, 'pay/status'), { tran_id: null, status: 'failed', error: err.message });
      }
    } else if (kind === 'transaction') {
      const p = payments.get(String(msg.tran_id || ''));
      if (p) p.dispense = { ...msg, receivedAt: Date.now() };
      console.log(`[mqtt] ${machineId} transaction ${text}`);
    } else if (kind === 'heartbeat' || kind === 'error') {
      console.log(`[mqtt] ${machineId} ${kind} ${text}`);
    }
  });

  // Push status changes (paid / expired / failed) to the machine that asked.
  let busy = false;
  const timer = setInterval(async () => {
    if (busy || !client.connected) return;
    busy = true;
    try {
      for (const p of payments.values()) {
        if (p.via !== 'mqtt') continue;
        if (p.status === 'pending') await syncWithPayWay(p);
        if (p.status !== p.notifiedStatus) {
          p.notifiedStatus = p.status;
          publish(topic(p.machineId, 'pay/status'), { tran_id: p.tranId, status: p.status });
          console.log(`[mqtt] -> ${p.machineId} pay/status ${p.tranId} ${p.status}`);
        }
      }
    } finally {
      busy = false;
    }
  }, STATUS_PUSH_INTERVAL_MS);

  return {
    get connected() {
      return client.connected;
    },
    close() {
      clearInterval(timer);
      client.end(true);
    },
  };
}
