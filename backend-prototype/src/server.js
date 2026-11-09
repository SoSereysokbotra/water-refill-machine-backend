import crypto from 'node:crypto';
import express from 'express';
import QRCode from 'qrcode';
import { createPayWayClient, PayWayError } from './payway.js';
import { startMqttBridge } from './mqtt.js';

// ---------- config ----------
const env = process.env;
const PORT = Number(env.PORT || 3000);
const DEVICE_API_KEY = env.DEVICE_API_KEY || 'change-me';
const MODE = (env.PAYWAY_MODE || 'mock').toLowerCase(); // mock | sandbox | live
const LIFETIME_MIN = Math.max(3, Number(env.QR_LIFETIME_MIN || 3));
const CURRENCY = (env.CURRENCY || 'KHR').toUpperCase();
const PRICES = {
  500: Number(env.PRICE_500 || 500),
  750: Number(env.PRICE_750 || 700),
  1000: Number(env.PRICE_1000 || 1000),
};
const STATUS_CHECK_MIN_INTERVAL_MS = 2000;

const payway =
  MODE === 'mock'
    ? null
    : createPayWayClient({
        merchantId: env.PAYWAY_MERCHANT_ID,
        apiKey: env.PAYWAY_API_KEY,
        baseUrl: env.PAYWAY_BASE_URL || 'https://checkout-sandbox.payway.com.kh',
        qrTemplate: env.PAYWAY_QR_TEMPLATE || 'template3_color',
      });

// ---------- storage (in-memory for now; replace with PostgreSQL later) ----------
/** @type {Map<string, any>} */
const payments = new Map();

function newTranId() {
  // PayWay limit: 20 chars, must be unique
  return `${Date.now()}${crypto.randomInt(100, 1000)}`;
}

function refreshExpiry(p) {
  if (p.status === 'pending' && Date.now() > p.expiresAt) p.status = 'expired';
  return p;
}

function mockQrString(p) {
  // Not a real KHQR - only for testing QR rendering on the LCD.
  // Padded to ~200 chars so it has a similar size/density to a real KHQR.
  const base = `MOCK-KHQR|WRM|${p.machineId}|${p.tranId}|${p.amount}${p.currency}|`;
  return base.padEnd(200, '0');
}

function publicView(p) {
  return {
    tran_id: p.tranId,
    status: p.status,
    machine_id: p.machineId,
    volume_ml: p.volumeMl,
    amount: p.amount,
    currency: p.currency,
    expires_at: new Date(p.expiresAt).toISOString(),
    expires_in_s: Math.max(0, Math.round((p.expiresAt - Date.now()) / 1000)),
    paid_at: p.paidAt ? new Date(p.paidAt).toISOString() : null,
  };
}

// ---------- app ----------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

function requireDeviceKey(req, res, next) {
  if (req.get('X-API-Key') !== DEVICE_API_KEY) {
    return res.status(401).json({ error: 'invalid or missing X-API-Key' });
  }
  next();
}

app.get('/health', (_req, res) =>
  res.json({ ok: true, mode: MODE, mqtt: mqttBridge ? (mqttBridge.connected ? 'connected' : 'disconnected') : 'disabled' }),
);

/**
 * Machine asks for a payment QR.
 * Body: { "machine_id": "WRM-001", "volume_ml": 500 | 750 | 1000 }
 * Returns the raw KHQR string - the device renders it as a QR on the TFT.
 */
app.post('/api/payment/create', requireDeviceKey, async (req, res) => {
  const machineId = String(req.body?.machine_id || '').trim();
  const volumeMl = Number(req.body?.volume_ml);
  if (!machineId) return res.status(400).json({ error: 'machine_id is required' });
  if (!PRICES[volumeMl]) return res.status(400).json({ error: 'volume_ml must be 500, 750 or 1000' });

  try {
    const p = await createPayment(machineId, volumeMl);
    res.status(201).json({ ...publicView(p), qr_string: p.qrString });
  } catch (err) {
    const status = err instanceof PayWayError ? 502 : 500;
    res.status(status).json({ error: err.message, payway_code: err.code ?? null });
  }
});

/** Create a payment (PayWay KHQR or mock) and store it. Throws on PayWay errors. */
async function createPayment(machineId, volumeMl) {
  const p = {
    tranId: newTranId(),
    machineId,
    volumeMl,
    amount: PRICES[volumeMl],
    currency: CURRENCY,
    status: 'pending',
    createdAt: Date.now(),
    expiresAt: Date.now() + LIFETIME_MIN * 60_000,
    lastCheckAt: 0,
    paidAt: null,
    qrString: '',
    qrImage: null,
  };

  try {
    if (payway) {
      const qr = await payway.generateQr({
        tranId: p.tranId,
        amount: p.amount,
        currency: p.currency,
        lifetimeMin: LIFETIME_MIN,
        callbackUrl: env.PAYWAY_CALLBACK_URL || '',
      });
      p.qrString = qr.qrString;
      p.qrImage = qr.qrImage;
    } else {
      p.qrString = mockQrString(p);
    }
  } catch (err) {
    console.error('[payment/create]', err.message, err.response ?? '');
    throw err;
  }

  payments.set(p.tranId, p);
  console.log(`[payment/create] ${p.tranId} ${machineId} ${volumeMl}mL ${p.amount} ${p.currency} (${MODE})`);
  return p;
}

/** Update a pending payment from PayWay (rate-limited). Never throws. */
async function syncWithPayWay(p) {
  refreshExpiry(p);
  const due = Date.now() - p.lastCheckAt >= STATUS_CHECK_MIN_INTERVAL_MS;
  if (!payway || p.status !== 'pending' || !due) return p;
  p.lastCheckAt = Date.now();
  try {
    const r = await payway.checkTransaction(p.tranId);
    if (r.status === 'paid') {
      p.status = 'paid';
      p.paidAt = Date.now();
    } else if (r.status === 'failed') {
      p.status = 'failed';
    }
  } catch (err) {
    // Network/PayWay hiccup: keep "pending", caller will check again.
    console.warn('[payment/status]', p.tranId, err.message);
  }
  return p;
}

/**
 * Machine polls this every 2-3 s until status is "paid", "expired" or "failed".
 */
app.get('/api/payment/status/:tranId', requireDeviceKey, async (req, res) => {
  const p = payments.get(req.params.tranId);
  if (!p) return res.status(404).json({ error: 'unknown tran_id' });
  await syncWithPayWay(p);
  res.json(publicView(p));
});

/**
 * PayWay pushback (callback_url). The body is not trusted on its own:
 * we re-check the transaction with PayWay before marking it paid.
 */
app.post('/api/payment/callback', async (req, res) => {
  const tranId = String(req.body?.tran_id || '');
  const p = payments.get(tranId);
  console.log('[payment/callback]', tranId, JSON.stringify(req.body));
  if (p && payway && p.status === 'pending') {
    try {
      const r = await payway.checkTransaction(tranId);
      if (r.status === 'paid') {
        p.status = 'paid';
        p.paidAt = Date.now();
      }
    } catch (err) {
      console.warn('[payment/callback] verify failed', err.message);
    }
  }
  res.json({ ok: true });
});

// ---------- developer helpers ----------

/** Mock mode only: pretend the customer paid. */
app.post('/api/dev/pay/:tranId', (req, res) => {
  if (MODE !== 'mock') return res.status(403).json({ error: 'only available in mock mode' });
  const p = payments.get(req.params.tranId);
  if (!p) return res.status(404).json({ error: 'unknown tran_id' });
  refreshExpiry(p);
  if (p.status !== 'pending') return res.status(409).json({ error: `payment is ${p.status}` });
  p.status = 'paid';
  p.paidAt = Date.now();
  res.json(publicView(p));
});

/** Browser page: create test payments and see their QR codes + live status. */
app.get('/dev', async (req, res) => {
  const rows = [];
  const recent = [...payments.values()].slice(-1); // show only the latest payment
  await Promise.all(recent.map(syncWithPayWay)); // pick up "paid" from ABA
  for (const p of recent) {
    const img = p.qrImage || (await QRCode.toDataURL(p.qrString, { margin: 2, width: 260 }));
    const payBtn =
      MODE === 'mock' && p.status === 'pending'
        ? `<form method="post" action="/dev/pay/${p.tranId}"><button>Simulate payment</button></form>`
        : '';
    rows.push(`<div class="card"><img src="${img}" alt="QR"><div>
      <b>${p.tranId}</b><br>${p.machineId} · ${p.volumeMl} mL · ${p.amount} ${p.currency}<br>
      Status: <b>${p.status}</b><br><code>${p.qrString.length} chars</code>${payBtn}</div></div>`);
  }
  res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
  <meta http-equiv="refresh" content="5"><title>Payments (${MODE})</title>
  <style>body{font-family:system-ui;margin:16px}.card{display:flex;gap:16px;align-items:center;border:1px solid #ccc;border-radius:8px;padding:12px;margin:8px 0}img{width:200px}
  .create{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.create button{padding:10px 16px;font-size:15px;cursor:pointer}.err{color:#b00020}</style>
  <h2>Payments - mode: ${MODE}</h2>
  <form class="create" method="post" action="/dev/create">
    <b style="align-self:center">Create test payment:</b>
    ${Object.entries(PRICES).map(([ml, price]) =>
      `<button name="volume_ml" value="${ml}">${ml} mL · ${price} ${CURRENCY}</button>`).join('')}
  </form>
  ${req.query.error ? `<p class="err">Error: ${String(req.query.error).replace(/[<>&"]/g, '')}</p>` : ''}
  <p>Auto-refreshes every 5 s. Status is checked with ABA on each refresh.</p>${rows.join('') || '<p>No payments yet.</p>'}`);
});

app.post('/dev/create', async (req, res) => {
  const volumeMl = Number(req.body?.volume_ml);
  if (!PRICES[volumeMl]) return res.redirect('/dev?error=' + encodeURIComponent('invalid volume'));
  try {
    await createPayment('WRM-DEV', volumeMl);
    res.redirect('/dev');
  } catch (err) {
    res.redirect('/dev?error=' + encodeURIComponent(err.message));
  }
});

app.post('/dev/pay/:tranId', (req, res) => {
  const p = payments.get(req.params.tranId);
  if (MODE === 'mock' && p && refreshExpiry(p).status === 'pending') {
    p.status = 'paid';
    p.paidAt = Date.now();
  }
  res.redirect('/dev');
});

const mqttBridge = startMqttBridge({ env, payments, createPayment, syncWithPayWay, publicView, prices: PRICES });

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Water Refill backend on http://0.0.0.0:${PORT}  (payment mode: ${MODE})`);
  if (DEVICE_API_KEY === 'change-me') console.warn('WARNING: DEVICE_API_KEY is the default "change-me"');
});
