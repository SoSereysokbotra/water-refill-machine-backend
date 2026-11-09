import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

export type RunMode = 'all' | 'api' | 'worker';

export async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const runMode = (process.env.RUN_MODE ?? 'all') as RunMode;
  const port = parseInt(process.env.PORT ?? '3000', 10);

  logger.log(`Starting application in RUN_MODE=${runMode}`);

  if (runMode === 'api' || runMode === 'all') {
    const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
    app.enableShutdownHooks();
    await app.listen(port, '0.0.0.0');
    logger.log(`API HTTP server listening on http://0.0.0.0:${port}`);
  }

  if (runMode === 'worker' || runMode === 'all') {
    logger.log('Worker processors initialized (sweeps, outbox relay)');
  }
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap().catch((err) => {
    console.error('Fatal bootstrap error:', err);
    process.exit(1);
  });
}
