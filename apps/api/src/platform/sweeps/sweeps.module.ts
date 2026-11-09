import { Global, Module } from '@nestjs/common';
import { SweepsScheduler } from './sweeps.scheduler';

@Global()
@Module({
  providers: [SweepsScheduler],
  exports: [SweepsScheduler],
})
export class SweepsModule {}
