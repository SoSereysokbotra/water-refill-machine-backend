import { Inject, Injectable, Logger } from '@nestjs/common';
import crypto from 'node:crypto';
import { ConfigService } from '../../../../platform/config/config.service';
import { Currency } from '../../domain/payment.types';
import {
  CheckTransactionResult,
  CreateQrInput,
  CreateQrResult,
  DuplicateTranIdError,
  GatewayRejectedError,
  GatewayUnavailableError,
  PaymentGateway,
} from '../../domain/ports/payment-gateway.port';

function reqTime(date = new Date()): string {
  return date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

function sign(message: string, apiKey: string): string {
  return crypto.createHmac('sha512', apiKey).update(message, 'utf8').digest('base64');
}

@Injectable()
export class PayWayGatewayAdapter implements PaymentGateway {
  private readonly logger = new Logger(PayWayGatewayAdapter.name);
  private readonly baseUrl: string;
  private readonly merchantId: string;
  private readonly apiKey: string;
  private readonly callbackUrl: string;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {
    this.baseUrl = this.config.get('PAYWAY_BASE_URL').replace(/\/+$/, '');
    this.merchantId = this.config.get('PAYWAY_MERCHANT_ID');
    this.apiKey = this.config.get('PAYWAY_API_KEY');
    this.callbackUrl = this.config.get('PAYWAY_CALLBACK_URL') || '';
  }

  private async postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000), // 8 s timeout per D7 / C10
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`PayWay request failed to ${path}: ${msg}`);
      throw new GatewayUnavailableError(`PayWay network error: ${msg}`);
    }

    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new GatewayUnavailableError(`PayWay returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }

    return json as T;
  }

  async createQr(input: CreateQrInput): Promise<CreateQrResult> {
    const time = reqTime();
    const effectiveCallbackUrl = input.callbackUrl ?? this.callbackUrl;
    const b64Callback = effectiveCallbackUrl ? Buffer.from(effectiveCallbackUrl, 'utf8').toString('base64') : '';

    const f: Record<string, string | number> = {
      req_time: time,
      merchant_id: this.merchantId,
      tran_id: input.tranId,
      amount: input.amount,
      items: '',
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      purchase_type: 'purchase',
      payment_option: 'abapay_khqr',
      callback_url: b64Callback,
      return_deeplink: '',
      currency: input.currency,
      custom_fields: '',
      return_params: '',
      payout: '',
      lifetime: Math.max(3, input.lifetimeMin),
      qr_image_template: 'template3_color',
    };

    const order = [
      'req_time',
      'merchant_id',
      'tran_id',
      'amount',
      'items',
      'first_name',
      'last_name',
      'email',
      'phone',
      'purchase_type',
      'payment_option',
      'callback_url',
      'return_deeplink',
      'currency',
      'custom_fields',
      'return_params',
      'payout',
      'lifetime',
      'qr_image_template',
    ];

    const message = order.map((k) => String(f[k] ?? '')).join('');
    const hash = sign(message, this.apiKey);

    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f)) {
      if (v !== '') body[k] = v;
    }
    body.hash = hash;

    const json = await this.postJson<any>('/api/payment-gateway/v1/payments/generate-qr', body);
    const code = String(json?.status?.code ?? '');

    if (code === '0') {
      return {
        qrString: json.qrString,
        qrMd5: json.qrImageMd5 ?? json.qrMd5,
        qrImage: json.qrImage,
        deeplink: json.abapay_deeplink,
      };
    }

    if (code === '403') {
      throw new DuplicateTranIdError(`Duplicate tran_id: ${json?.status?.message ?? ''}`);
    }

    if (code === '8' || code === '429') {
      throw new GatewayUnavailableError(`PayWay unavailable (code ${code}): ${json?.status?.message ?? ''}`);
    }

    throw new GatewayRejectedError(`PayWay rejected generate-qr (code ${code}): ${json?.status?.message ?? ''}`, json);
  }

  async checkTransaction(tranId: string): Promise<CheckTransactionResult> {
    const time = reqTime();
    const hash = sign(`${time}${this.merchantId}${tranId}`, this.apiKey);

    const body = {
      req_time: time,
      merchant_id: this.merchantId,
      tran_id: tranId,
      hash,
    };

    const json = await this.postJson<any>('/api/payment-gateway/v1/payments/check-transaction-2', body);
    const code = String(json?.status?.code ?? '');

    // Per D7 / C10.3: code 6 means transaction not found yet -> customer has not paid
    if (code === '6') {
      return { status: 'not_found', raw: json };
    }

    if (code === '11' || code === '429') {
      throw new GatewayUnavailableError(`PayWay unavailable (code ${code}): ${json?.status?.message ?? ''}`);
    }

    if (code !== '00' && code !== '0') {
      throw new GatewayRejectedError(`PayWay rejected check-transaction (code ${code}): ${json?.status?.message ?? ''}`, json);
    }

    const psc = Number(json?.data?.payment_status_code);
    const paymentStatus = json?.data?.payment_status;
    const apv = json?.data?.apv ?? json?.data?.approval_code;

    if (psc === 0) {
      return { status: 'approved', paymentStatusCode: psc, paymentStatus, apv, raw: json };
    }
    if (psc === 2) {
      return { status: 'pending', paymentStatusCode: psc, paymentStatus, raw: json };
    }
    if (psc === 3 || psc === 7) {
      return { status: 'declined', paymentStatusCode: psc, paymentStatus, raw: json };
    }
    if (psc === 4) {
      return { status: 'refunded', paymentStatusCode: psc, paymentStatus, raw: json };
    }

    return { status: 'pending', paymentStatusCode: psc, paymentStatus, raw: json };
  }

  async closeTransaction(tranId: string): Promise<void> {
    try {
      const time = reqTime();
      const hash = sign(`${time}${this.merchantId}${tranId}`, this.apiKey);
      await this.postJson<any>('/api/payment-gateway/v1/payments/close-transaction', {
        req_time: time,
        merchant_id: this.merchantId,
        tran_id: tranId,
        hash,
      });
    } catch (err: unknown) {
      // Close transaction is best-effort until confirmed by ABA (C10.5)
      this.logger.debug(`closeTransaction for ${tranId} completed with note: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async refund(tranId: string, amount: number, currency: Currency): Promise<void> {
    // ABA has not confirmed a KHQR refund API, its endpoint, fields or hash (Plan C10.5, F3 Q7).
    // Never call a guessed endpoint and treat the result as success: refunds stay manual (REFUND_MODE=manual).
    throw new GatewayRejectedError(
      `ABA refund API not confirmed (C10.5); refund ${tranId} ${amount} ${currency} manually`,
      null,
    );
  }
}
