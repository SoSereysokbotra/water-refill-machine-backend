import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { AppLoggerModule } from './logging/logger.module';
import { DatabaseModule } from './database/database.module';
import { OutboxModule } from './outbox/outbox.module';
import { InboxModule } from './inbox/inbox.module';
import { QueueModule } from './queues/queue.module';
import { SweepsModule } from './sweeps/sweeps.module';
import { MqttModule } from './mqtt/mqtt.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { HealthModule } from './health/health.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { MetricsModule } from './metrics/metrics.module';

@Module({
  imports: [
    ConfigModule,
    AppLoggerModule,
    DatabaseModule,
    OutboxModule,
    InboxModule,
    QueueModule,
    SweepsModule,
    MqttModule,
    RateLimitModule,
    HealthModule,
    TelemetryModule,
    MetricsModule,
  ],
  exports: [
    ConfigModule,
    AppLoggerModule,
    DatabaseModule,
    OutboxModule,
    InboxModule,
    QueueModule,
    SweepsModule,
    MqttModule,
    RateLimitModule,
    HealthModule,
    TelemetryModule,
    MetricsModule,
  ],
})
export class PlatformModule {}
