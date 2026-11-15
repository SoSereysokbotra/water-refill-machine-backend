import * as Sentry from '@sentry/node';
import { Logger } from '@nestjs/common';
import { AppConfig } from '../config/config.schema';

const logger = new Logger('Telemetry');

export function initTelemetry(config: AppConfig): void {
  const sentryDsn = config.SENTRY_DSN;
  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      environment: config.APP_ENV,
      release: process.env.npm_package_version ?? '0.1.0',
      tracesSampleRate: config.APP_ENV === 'production' ? 0.2 : 1.0,
    });
    logger.log('Sentry telemetry initialized with release tracking.');
  }

  const otelEndpoint = config.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (otelEndpoint) {
    logger.log(`OpenTelemetry exporter configured for ${otelEndpoint}`);
  }
}

export function captureSentryException(err: unknown, context?: Record<string, unknown>): void {
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err, { extra: context });
  }
}
