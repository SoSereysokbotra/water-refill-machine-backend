import { Module } from '@nestjs/common';
import { PlatformModule } from './platform';
import { PaymentsModule } from './contexts/payments/payments.module';
import { FleetModule } from './contexts/fleet/fleet.module';
import { MonitoringModule } from './contexts/monitoring/monitoring.module';

@Module({
  imports: [PlatformModule, PaymentsModule, FleetModule, MonitoringModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
