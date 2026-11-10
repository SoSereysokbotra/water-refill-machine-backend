import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  buildMachineTopic,
  MQTT_TOPICS,
  parsePayRequestPayload,
  parseTransactionPayload,
  PayCancelV1Schema,
} from '@wrm/contracts';
import { toErrorCode } from '../../../../shared-kernel/errors';
import { MqttService } from '../../../../platform/mqtt/mqtt.service';
import { RateLimiterService } from '../../../../platform/rate-limit/rate-limiter.service';
import {
  CancelPaymentCommand,
  CancelPaymentHandler,
  CreatePaymentCommand,
  CreatePaymentHandler,
  PaymentRepository,
  RecordDispenseCommand,
  RecordDispenseHandler,
} from '../../application';

@Injectable()
export class PaymentsMqttConsumer implements OnModuleInit {
  private readonly logger = new Logger(PaymentsMqttConsumer.name);

  constructor(
    @Inject(MqttService) private readonly mqtt: MqttService,
    @Inject(RateLimiterService) private readonly limiter: RateLimiterService,
    @Inject(CreatePaymentHandler) private readonly createPaymentHandler: CreatePaymentHandler,
    @Inject(CancelPaymentHandler) private readonly cancelPaymentHandler: CancelPaymentHandler,
    @Inject(RecordDispenseHandler) private readonly recordDispenseHandler: RecordDispenseHandler,
    @Inject('PaymentRepository') private readonly repo: PaymentRepository,
  ) {}

  onModuleInit(): void {
    this.mqtt.subscribe('wrm/+/pay/request', this.onPayRequest.bind(this));
    this.mqtt.subscribe('wrm/+/pay/cancel', this.onPayCancel.bind(this));
    this.mqtt.subscribe('wrm/+/transaction', this.onTransaction.bind(this));
    this.logger.log('PaymentsMqttConsumer subscribed to pay/request, pay/cancel, transaction');
  }

  private parseJson(payload: Buffer): unknown {
    try {
      const text = payload.toString('utf8');
      return text ? JSON.parse(text) : {};
    } catch {
      return null;
    }
  }

  async onPayRequest(topic: string, payload: Buffer): Promise<void> {
    const parts = topic.split('/');
    const machineId = parts[1];
    if (!machineId) return;

    const raw = this.parseJson(payload);
    const parsed = parsePayRequestPayload(raw);
    if (!parsed.success) {
      this.logger.warn(`Invalid pay/request from ${machineId}: ${JSON.stringify(raw)}`);
      await this.publishStatus(machineId, null, 'failed', 'VALIDATION_FAILED');
      return;
    }

    const { request_id, volume_ml } = parsed.data;

    try {
      await this.limiter.consume(`pay:${machineId}`, 1, { points: 3, duration: 3, keyPrefix: 'rl_pay' });
    } catch {
      this.logger.warn(`Rate limit exceeded for machine ${machineId} on pay/request`);
      await this.publishStatus(machineId, null, 'failed', 'RATE_LIMITED', request_id);
      return;
    }

    try {
      const result = await this.createPaymentHandler.execute(
        new CreatePaymentCommand(machineId, request_id, volume_ml),
      );

      if (result.action === 'republish_qr') {
        const remainingSec = Math.max(
          1,
          Math.floor((result.payment.expiresAt.getTime() - Date.now()) / 1000),
        );
        const amount = result.payment.currency === 'USD' ? result.payment.amountMinor / 100 : result.payment.amountMinor;
        await this.mqtt.publish(
          buildMachineTopic(machineId, MQTT_TOPICS.PAY_QR),
          {
            v: 1,
            request_id: result.payment.requestId,
            tran_id: result.payment.tranId,
            qr_string: result.payment.qrString,
            amount,
            currency: result.payment.currency,
            volume_ml: result.payment.volumeMl,
            expires_at: result.payment.expiresAt,
          },
          { qos: 1, messageExpiryInterval: remainingSec },
        );
      } else if (result.action === 'status') {
        await this.publishStatus(machineId, result.payment.tranId, result.status as any, undefined, result.payment.requestId);
      }
    } catch (err: unknown) {
      const code = toErrorCode(err);
      this.logger.error(`Error processing pay/request for machine ${machineId}: ${code}`);
      await this.publishStatus(machineId, null, 'failed', code, request_id);
    }
  }

  async onPayCancel(topic: string, payload: Buffer): Promise<void> {
    const parts = topic.split('/');
    const machineId = parts[1];
    if (!machineId) return;

    const raw = this.parseJson(payload);
    const parsed = PayCancelV1Schema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(`Invalid pay/cancel from ${machineId}: ${JSON.stringify(raw)}`);
      return;
    }

    await this.cancelPaymentHandler.execute(
      new CancelPaymentCommand(machineId, parsed.data.tran_id, parsed.data.request_id, parsed.data.reason),
    );
  }

  async onTransaction(topic: string, payload: Buffer): Promise<void> {
    const parts = topic.split('/');
    const machineId = parts[1];
    if (!machineId) return;

    const raw = this.parseJson(payload);
    const parsed = parseTransactionPayload(raw);

    if (!parsed.success) {
      const tranId = (raw as Record<string, unknown>)?.tran_id;
      const tranIdStr = typeof tranId === 'string' ? tranId : undefined;
      await this.repo.recordRejection(machineId, tranIdStr, 'DSP_MALFORMED', raw);

      if (tranIdStr) {
        await this.publishAck(machineId, tranIdStr, 'rejected', 'DSP_MALFORMED');
      }
      return;
    }

    try {
      await this.recordDispenseHandler.execute(
        new RecordDispenseCommand(machineId, parsed.data),
      );
      await this.publishAck(machineId, parsed.data.tran_id, 'ok');
    } catch (err: unknown) {
      const code = toErrorCode(err);
      if (['DSP_NOT_PAID', 'DSP_WRONG_MACHINE', 'DSP_UNKNOWN_PAYMENT'].includes(code)) {
        await this.repo.recordRejection(machineId, parsed.data.tran_id, code, parsed.data);
        await this.publishAck(machineId, parsed.data.tran_id, 'rejected', code);
      } else {
        this.logger.error(`Infrastructure error processing dispense for ${parsed.data.tran_id}: ${(err as Error).message}`);
        // No ack on infrastructure error -> device retries with backoff (B4.7)
      }
    }
  }

  private async publishStatus(
    machineId: string,
    tranId: string | null,
    status: 'paid' | 'expired' | 'failed' | 'cancelled',
    reason?: string,
    requestId?: string,
  ): Promise<void> {
    await this.mqtt.publish(
      buildMachineTopic(machineId, MQTT_TOPICS.PAY_STATUS),
      {
        v: 1,
        tran_id: tranId,
        request_id: requestId,
        status,
        reason,
      },
      { qos: 1 },
    );
  }

  private async publishAck(
    machineId: string,
    tranId: string,
    status: 'ok' | 'rejected',
    reason?: string,
  ): Promise<void> {
    await this.mqtt.publish(
      buildMachineTopic(machineId, MQTT_TOPICS.TRANSACTION_ACK),
      {
        v: 1,
        tran_id: tranId,
        status,
        reason,
      },
      { qos: 1 },
    );
  }
}
