import { Module } from '@nestjs/common';
import { PlatformModule } from './platform';
import { PaymentsModule } from './contexts/payments/payments.module';
import { FleetModule } from './contexts/fleet/fleet.module';
import { MonitoringModule } from './contexts/monitoring/monitoring.module';
import { IdentityModule } from './contexts/identity/identity.module';
import { ReportingModule } from './contexts/reporting/reporting.module';

@Module({
  imports: [PlatformModule, PaymentsModule, FleetModule, MonitoringModule, IdentityModule, ReportingModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
