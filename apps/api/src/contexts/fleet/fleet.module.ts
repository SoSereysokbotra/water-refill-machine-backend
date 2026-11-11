import { Module } from '@nestjs/common';
import { SystemClock } from '../../shared-kernel';
import { MachinePresenceService } from './application';
import { FleetMqttConsumer } from './interface';

@Module({
  providers: [{ provide: 'Clock', useClass: SystemClock }, MachinePresenceService, FleetMqttConsumer],
})
export class FleetModule {}
