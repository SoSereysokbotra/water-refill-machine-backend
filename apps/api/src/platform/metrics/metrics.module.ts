import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsCollectorService } from './metrics-collector.service';
import { MetricsController } from './metrics.controller';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, MetricsCollectorService],
  exports: [MetricsService, MetricsCollectorService],
})
export class MetricsModule {}
