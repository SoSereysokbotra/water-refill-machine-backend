// ABA PayWay client: KHQR generation + transaction status check.
// Docs: https://developer.payway.com.kh/qr-api-14530840e0
//       https://developer.payway.com.kh/check-transaction-14530826e0
import crypto from 'node:crypto';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

/** PayWay req_time: UTC, YYYYMMDDHHmmss */
export function reqTime(date = new Date()) {
  return date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

/** Base64(HMAC-SHA512(message, apiKey)) */
export function sign(message, apiKey) {
  return crypto.createHmac('sha512', apiKey).update(message, 'utf8').digest('base64');
}

export class PayWayError extends Error {
  constructor(message, { code, response } = {}) {
    super(message);
    this.name = 'PayWayError';
    this.code = code;
    this.response = response;
  }
}

export function createPayWayClient({ merchantId, apiKey, baseUrl, qrTemplate = 'template3_color' }) {
  if (!merchantId || !apiKey) {
    throw new Error('PAYWAY_MERCHANT_ID and PAYWAY_API_KEY are required for sandbox/live mode');
  }
  const base = baseUrl.replace(/\/+$/, '');

  async function post(path, body) {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new PayWayError(`PayWay returned non-JSON (HTTP ${res.status})`, { response: text.slice(0, 500) });
    }
    return json;
  }

  /**
   * Create a dynamic KHQR for a payment.
   * Returns { qrString, qrImage, deeplink, raw }.
   */
  async function generateQr({ tranId, amount, currency, lifetimeMin, callbackUrl = '' }) {
    const f = {
      req_time: reqTime(),
      merchant_id: merchantId,
      tran_id: tranId,
      amount,
      items: '',
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      purchase_type: 'purchase',
      payment_option: 'abapay_khqr',
      callback_url: callbackUrl ? b64(callbackUrl) : '',
      return_deeplink: '',
      currency,
      custom_fields: '',
      return_params: '',
      payout: '',
      lifetime: lifetimeMin,
      qr_image_template: qrTemplate,
    };

    // Hash order is fixed by PayWay; empty optional fields hash as "".
    const order = [
      'req_time', 'merchant_id', 'tran_id', 'amount', 'items', 'first_name', 'last_name',
      'email', 'phone', 'purchase_type', 'payment_option', 'callback_url', 'return_deeplink',
      'currency', 'custom_fields', 'return_params', 'payout', 'lifetime', 'qr_image_template',
    ];
    const hash = sign(order.map((k) => String(f[k])).join(''), apiKey);

    // Send only non-empty fields (empty optional strings can fail PayWay validation).
    const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));
    body.hash = hash;

    const json = await post('/api/payment-gateway/v1/payments/generate-qr', body);
    const code = String(json?.status?.code ?? '');
    if (code !== '0') {
      throw new PayWayError(`generate-qr failed: ${json?.status?.message ?? 'unknown error'} (code ${code})`, {
        code,
        response: json,
      });
    }
    return { qrString: json.qrString, qrImage: json.qrImage, deeplink: json.abapay_deeplink, raw: json };
  }

  /**
   * Check a transaction (created within the last 7 days).
   * Returns { status: 'paid'|'pending'|'failed', paymentStatus, raw }.
   */
  async function checkTransaction(tranId) {
    const t = reqTime();
    const hash = sign(`${t}${merchantId}${tranId}`, apiKey);
    const json = await post('/api/payment-gateway/v1/payments/check-transaction-2', {
      req_time: t,
      merchant_id: merchantId,
      tran_id: tranId,
      hash,
    });

    const code = String(json?.status?.code ?? '');
    // "6" = transaction not found yet -> customer has not paid
    if (code === '6') return { status: 'pending', paymentStatus: 'NOT_FOUND', raw: json };
    if (code !== '00' && code !== '0') {
      throw new PayWayError(`check-transaction failed: ${json?.status?.message ?? 'unknown error'} (code ${code})`, {
        code,
        response: json,
      });
    }

    const psc = Number(json?.data?.payment_status_code);
    const paymentStatus = json?.data?.payment_status;
    // 0 APPROVED/PRE-AUTH, 2 PENDING, 3 DECLINED, 4 REFUNDED, 7 CANCELLED
    let status = 'pending';
    if (psc === 0) status = 'paid';
    else if (psc === 3 || psc === 4 || psc === 7) status = 'failed';
    return { status, paymentStatus, raw: json };
  }

  return { generateQr, checkTransaction };
}
