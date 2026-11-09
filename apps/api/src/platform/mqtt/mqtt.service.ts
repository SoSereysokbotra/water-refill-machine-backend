import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Inject } from '@nestjs/common';
import * as mqtt from 'mqtt';
import { ConfigService } from '../config/config.service';
import * as fs from 'fs';

export type MqttMessageHandler = (topic: string, payload: Buffer) => Promise<void> | void;

export interface MqttPublishOptions {
  qos?: 0 | 1 | 2;
  retain?: boolean;
  messageExpiryInterval?: number; // MQTT 5 message expiry in seconds
}

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client!: mqtt.MqttClient;
  private readonly handlers = new Map<string, MqttMessageHandler[]>();
  private isConnected = false;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get('MQTT_URL');
    const username = this.config.get('MQTT_USERNAME');
    const password = this.config.get('MQTT_PASSWORD');
    const caFile = this.config.get('MQTT_CA_FILE');

    const opts: mqtt.IClientOptions = {
      clientId: `wrm-backend-${process.pid}-${Math.random().toString(36).substring(2, 8)}`,
      username: username || undefined,
      password: password || undefined,
      protocolVersion: 5,
      reconnectPeriod: 2000,
      connectTimeout: 10000,
      clean: false, // Persistent session
    };

    if (caFile && fs.existsSync(caFile)) {
      opts.ca = fs.readFileSync(caFile);
      this.logger.log(`Loaded CA certificate from ${caFile}`);
    }

    this.logger.log(`Connecting to MQTT broker at ${url}...`);
    this.client = mqtt.connect(url, opts);

    this.client.on('connect', () => {
      this.isConnected = true;
      this.logger.log('Connected to MQTT broker.');
      this.resubscribeAll();
    });

    this.client.on('reconnect', () => {
      this.logger.warn('Reconnecting to MQTT broker...');
    });

    this.client.on('offline', () => {
      this.isConnected = false;
      this.logger.warn('MQTT broker is offline.');
    });

    this.client.on('error', (err) => {
      this.logger.error(`MQTT error: ${err.message}`, err.stack);
    });

    this.client.on('message', async (topic, payload) => {
      await this.dispatch(topic, payload);
    });
  }

  isHealthy(): boolean {
    return this.isConnected;
  }

  async publish(
    topic: string,
    message: string | Buffer | object,
    options?: MqttPublishOptions,
  ): Promise<void> {
    const payload =
      typeof message === 'object' && !Buffer.isBuffer(message)
        ? JSON.stringify(message)
        : message;

    const opts: mqtt.IClientPublishOptions = {
      qos: options?.qos ?? 1,
      retain: options?.retain ?? false,
      properties: options?.messageExpiryInterval
        ? { messageExpiryInterval: options.messageExpiryInterval }
        : undefined,
    };

    return new Promise((resolve, reject) => {
      this.client.publish(topic, payload, opts, (err) => {
        if (err) {
          this.logger.error(`Failed to publish to [${topic}]: ${err.message}`);
          return reject(err);
        }
        resolve();
      });
    });
  }

  subscribe(topic: string, handler: MqttMessageHandler): void {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler);
    this.handlers.set(topic, list);

    if (this.isConnected) {
      this.subscribeTopic(topic);
    }
  }

  private subscribeTopic(topic: string): void {
    const sharedGroup = this.config.get('MQTT_SHARED_GROUP');
    // If not already a shared subscription and contains wildcards, use shared subscription
    const fullTopic = topic.startsWith('$share/')
      ? topic
      : `$share/${sharedGroup}/${topic}`;

    this.client.subscribe(fullTopic, { qos: 1 }, (err) => {
      if (err) {
        this.logger.error(`Subscription failed for [${fullTopic}]: ${err.message}`);
      } else {
        this.logger.log(`Subscribed to MQTT topic [${fullTopic}]`);
      }
    });
  }

  private resubscribeAll(): void {
    for (const topic of this.handlers.keys()) {
      this.subscribeTopic(topic);
    }
  }

  private async dispatch(topic: string, payload: Buffer): Promise<void> {
    for (const [pattern, handlerList] of this.handlers.entries()) {
      if (this.topicMatches(pattern, topic)) {
        for (const handler of handlerList) {
          try {
            await handler(topic, payload);
          } catch (err) {
            this.logger.error(`Error in MQTT handler for topic [${topic}]: ${(err as Error).message}`, (err as Error).stack);
          }
        }
      }
    }
  }

  private topicMatches(pattern: string, topic: string): boolean {
    const cleanPattern = pattern.replace(/^\$share\/[^/]+\//, '');
    const patternParts = cleanPattern.split('/');
    const topicParts = topic.split('/');

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === '#') return true;
      if (patternParts[i] === '+') continue;
      if (patternParts[i] !== topicParts[i]) return false;
    }

    return patternParts.length === topicParts.length;
  }

  async onModuleDestroy() {
    if (!this.client) return;
    this.logger.log('Disconnecting from MQTT broker...');
    return new Promise<void>((resolve) => {
      this.client.end(false, {}, () => {
        this.logger.log('MQTT client closed.');
        resolve();
      });
    });
  }
}
