import { Module } from '@nestjs/common';
import { PlatformModule } from './platform';
import { PaymentsModule } from './contexts/payments/payments.module';

@Module({
  imports: [PlatformModule, PaymentsModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
