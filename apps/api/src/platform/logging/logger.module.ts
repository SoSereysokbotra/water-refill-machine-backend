import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import { getCorrelationContext } from './correlation-context';

/** Log fields that must never be written in clear text (secrets, credentials, session tokens). */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-admin-key"]',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.apiKey',
  '*.api_key',
  '*.hash',
  '*.qrString',
  '*.qr_string',
  '*.WIFI_PASSWORD',
  '*.MQTT_PASSWORD',
  '*.secret',
  '*.authSecret',
];

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      useFactory: () => {
        const isProduction = process.env.NODE_ENV === 'production';
        return {
          pinoHttp: {
            level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
            genReqId: (req) => (req.headers['x-trace-id'] as string) ?? randomUUID(),
            customProps: (req) => {
              const correlation = getCorrelationContext();
              const traceId = (req as unknown as { id?: string }).id ?? correlation?.traceId;
              return {
                traceId,
                ...(correlation?.tranId ? { tranId: correlation.tranId } : {}),
                ...(correlation?.machineId ? { machineId: correlation.machineId } : {}),
                ...(correlation?.requestId ? { requestId: correlation.requestId } : {}),
              };
            },
            formatters: {
              log: (object: Record<string, unknown>) => {
                const correlation = getCorrelationContext();
                if (!correlation) return object;
                return {
                  ...object,
                  ...(correlation.traceId ? { traceId: correlation.traceId } : {}),
                  ...(correlation.spanId ? { spanId: correlation.spanId } : {}),
                  ...(correlation.tranId ? { tranId: correlation.tranId } : {}),
                  ...(correlation.machineId ? { machineId: correlation.machineId } : {}),
                  ...(correlation.requestId ? { requestId: correlation.requestId } : {}),
                  ...(correlation.jobId ? { jobId: correlation.jobId } : {}),
                  ...(correlation.eventType ? { eventType: correlation.eventType } : {}),
                  ...(correlation.errorCode ? { errorCode: correlation.errorCode } : {}),
                };
              },
            },
            redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
            transport: !isProduction
              ? {
                  target: 'pino-pretty',
                  options: {
                    singleLine: true,
                    colorize: true,
                    translateTime: 'SYS:standard',
                  },
                }
              : undefined,
          },
        };
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class AppLoggerModule {}
