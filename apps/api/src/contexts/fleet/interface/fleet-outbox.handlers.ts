import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { buildMachineTopic, MQTT_TOPICS } from '@wrm/contracts';
import { DomainEvent } from '../../../shared-kernel';
import { MqttService } from '../../../platform/mqtt/mqtt.service';
import { OutboxHandlerRegistry } from '../../../platform/outbox/outbox-handler.registry';
import { FLEET_EVENTS, MachineConfigChangedData, MachinesService } from '../application';

/** fleet.MachineConfigChanged -> retained `config` (Plan §C2, QoS 1, retain). */
@Injectable()
export class FleetOutboxHandlers implements OnModuleInit {
  private readonly logger = new Logger(FleetOutboxHandlers.name);

  constructor(
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
    @Inject(MqttService) private readonly mqtt: MqttService,
    @Inject(MachinesService) private readonly machines: MachinesService,
  ) {}

  onModuleInit(): void {
    this.registry.register<MachineConfigChangedData>(
      FLEET_EVENTS.MACHINE_CONFIG_CHANGED,
      'MachineConfigMqttHandler',
      this.publishConfig.bind(this),
    );
  }

  async publishConfig(event: DomainEvent<MachineConfigChangedData>): Promise<void> {
    const { machineId } = event.data;
    // Built from the DB now, not from the event: if two changes are dispatched out of order the newest still wins.
    const config = await this.machines.getConfig(machineId);
    await this.mqtt.publish(buildMachineTopic(machineId, MQTT_TOPICS.CONFIG), config, { qos: 1, retain: true });
    this.logger.log(`Published retained config for ${machineId} (${event.data.reason})`);
  }
}
