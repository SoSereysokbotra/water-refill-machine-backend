import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ConfigService } from './platform/config/config.service';
import { GlobalExceptionFilter } from './platform/errors/http-exception.filter';
import { initTelemetry } from './platform/telemetry/telemetry.init';

export async function bootstrap() {
  const adapter = new FastifyAdapter();
  const runMode = process.env.RUN_MODE ?? 'all';

  if (runMode === 'worker') {
    const appContext = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
    const logger = appContext.get(Logger);
    appContext.useLogger(logger);
    appContext.enableShutdownHooks();

    const config = appContext.get(ConfigService);
    initTelemetry(config.all);

    logger.log('WRM backend started in RUN_MODE=worker');
    return appContext;
  }

  // RUN_MODE='api' or 'all'
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();
  app.useGlobalFilters(new GlobalExceptionFilter());

  const config = app.get(ConfigService);
  initTelemetry(config.all);

  const port = config.get('PORT');
  await app.listen(port, '0.0.0.0');

  logger.log(`WRM backend started in RUN_MODE=${runMode} on port ${port}`);
  return app;
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap().catch((err) => {
    console.error('Fatal bootstrap error:', err);
    process.exit(1);
  });
}
