import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DomainEvent } from '../../../../shared-kernel/domain-event';
import { OutboxHandlerRegistry } from '../../../../platform/outbox/outbox-handler.registry';
import { MqttService } from '../../../../platform/mqtt/mqtt.service';
import { buildMachineTopic, MQTT_TOPICS } from '@wrm/contracts';
import {
  PaymentCancelledData,
  PaymentCreatedData,
  PaymentExpiredData,
  PaymentFailedData,
  PaymentPaidData,
} from '../../application';

@Injectable()
export class PaymentOutboxHandlers implements OnModuleInit {
  private readonly logger = new Logger(PaymentOutboxHandlers.name);

  constructor(
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
    @Inject(MqttService) private readonly mqtt: MqttService,
  ) {}

  onModuleInit(): void {
    this.registry.register<PaymentCreatedData>(
      'payments.PaymentCreated',
      'PaymentCreatedMqttHandler',
      this.handlePaymentCreated.bind(this),
    );

    this.registry.register<PaymentPaidData>(
      'payments.PaymentPaid',
      'PaymentPaidMqttHandler',
      this.handlePaymentPaid.bind(this),
    );

    this.registry.register<PaymentExpiredData>(
      'payments.PaymentExpired',
      'PaymentExpiredMqttHandler',
      this.handlePaymentExpired.bind(this),
    );

    this.registry.register<PaymentCancelledData>(
      'payments.PaymentCancelled',
      'PaymentCancelledMqttHandler',
      this.handlePaymentCancelled.bind(this),
    );

    this.registry.register<PaymentFailedData>(
      'payments.PaymentFailed',
      'PaymentFailedMqttHandler',
      this.handlePaymentFailed.bind(this),
    );
  }

  async handlePaymentCreated(event: DomainEvent<PaymentCreatedData>): Promise<void> {
    const data = event.data;
    const topic = buildMachineTopic(data.machineId, MQTT_TOPICS.PAY_QR);
    const amount = data.currency === 'USD' ? data.amountMinor / 100 : data.amountMinor;

    const payload = {
      v: 1,
      request_id: data.requestId,
      tran_id: data.tranId,
      qr_string: data.qrString,
      amount,
      currency: data.currency,
      volume_ml: data.volumeMl,
      expires_at: data.expiresAt,
    };

    const remainingSec = Math.max(
      1,
      Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000),
    );

    this.logger.log(`Publishing pay/qr for ${data.tranId} to ${topic} (expires in ${remainingSec}s)`);
    await this.mqtt.publish(topic, payload, {
      qos: 1,
      messageExpiryInterval: remainingSec,
    });
  }

  async handlePaymentPaid(event: DomainEvent<PaymentPaidData>): Promise<void> {
    const data = event.data;
    const topic = buildMachineTopic(data.machineId, MQTT_TOPICS.PAY_STATUS);

    const payload = {
      v: 1,
      tran_id: data.tranId,
      status: 'paid',
    };

    this.logger.log(`Publishing pay/status [paid] for ${data.tranId} to ${topic}`);
    await this.mqtt.publish(topic, payload, { qos: 1 });
  }

  async handlePaymentExpired(event: DomainEvent<PaymentExpiredData>): Promise<void> {
    const data = event.data;
    const topic = buildMachineTopic(data.machineId, MQTT_TOPICS.PAY_STATUS);

    const payload = {
      v: 1,
      tran_id: data.tranId,
      status: 'expired',
      reason: data.reason,
    };

    this.logger.log(`Publishing pay/status [expired] for ${data.tranId} to ${topic}`);
    await this.mqtt.publish(topic, payload, { qos: 1 });
  }

  async handlePaymentCancelled(event: DomainEvent<PaymentCancelledData>): Promise<void> {
    const data = event.data;
    const topic = buildMachineTopic(data.machineId, MQTT_TOPICS.PAY_STATUS);

    const payload = {
      v: 1,
      tran_id: data.tranId,
      status: 'cancelled',
      reason: data.reason,
    };

    this.logger.log(`Publishing pay/status [cancelled] for ${data.tranId} to ${topic}`);
    await this.mqtt.publish(topic, payload, { qos: 1 });
  }

  async handlePaymentFailed(event: DomainEvent<PaymentFailedData>): Promise<void> {
    const data = event.data;
    const topic = buildMachineTopic(data.machineId, MQTT_TOPICS.PAY_STATUS);

    const payload = {
      v: 1,
      tran_id: data.tranId,
      status: 'failed',
      reason: data.reason,
    };

    this.logger.log(`Publishing pay/status [failed] for ${data.tranId} to ${topic}`);
    await this.mqtt.publish(topic, payload, { qos: 1 });
  }
}
