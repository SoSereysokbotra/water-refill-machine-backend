import { Module } from '@nestjs/common';
import { PlatformModule } from './platform';
import { PaymentsModule } from './contexts/payments/payments.module';
import { FleetModule } from './contexts/fleet/fleet.module';

@Module({
  imports: [PlatformModule, PaymentsModule, FleetModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
