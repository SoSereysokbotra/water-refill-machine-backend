import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { parseHeartbeatPayload } from '@wrm/contracts';
import { MqttService } from '../../../platform/mqtt/mqtt.service';
import { MachinePresenceService } from '../application';

@Injectable()
export class FleetMqttConsumer implements OnModuleInit {
  private readonly logger = new Logger(FleetMqttConsumer.name);

  constructor(
    @Inject(MqttService) private readonly mqtt: MqttService,
    @Inject(MachinePresenceService) private readonly presence: MachinePresenceService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.mqtt.subscribe('wrm/+/heartbeat', this.onHeartbeat.bind(this));
    await this.mqtt.subscribe('wrm/+/online', this.onOnline.bind(this));
  }

  async onHeartbeat(topic: string, payload: Buffer): Promise<void> {
    const machineId = topic.split('/')[1];
    if (!machineId) return;

    let raw: unknown;
    try {
      raw = JSON.parse(payload.toString('utf8'));
    } catch {
      this.logger.warn(`Heartbeat from ${machineId} is not JSON`);
      return;
    }

    const parsed = parseHeartbeatPayload(raw);
    if (!parsed.success) {
      this.logger.warn(`Invalid heartbeat from ${machineId}: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
      return;
    }
    await this.presence.recordHeartbeat(machineId, parsed.data, raw);
  }

  async onOnline(topic: string, payload: Buffer): Promise<void> {
    const machineId = topic.split('/')[1];
    if (!machineId) return;
    const value = payload.toString('utf8').trim();
    if (value !== '1' && value !== '0') {
      this.logger.warn(`Invalid online payload from ${machineId}: ${value}`);
      return;
    }
    await this.presence.recordOnline(machineId, value === '1');
  }
}
