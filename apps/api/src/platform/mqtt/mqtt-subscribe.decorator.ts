import { SetMetadata } from '@nestjs/common';

export const MQTT_SUBSCRIBE_METADATA = 'MQTT_SUBSCRIBE_METADATA';

export interface MqttSubscriptionMetadata {
  topic: string;
}

export const MqttSubscribe = (topic: string): MethodDecorator =>
  SetMetadata(MQTT_SUBSCRIBE_METADATA, { topic });
