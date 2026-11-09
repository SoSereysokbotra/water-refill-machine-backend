import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      useFactory: () => {
        const isProduction = process.env.NODE_ENV === 'production';
        return {
          pinoHttp: {
            level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
            genReqId: (req) => (req.headers['x-trace-id'] as string) ?? randomUUID(),
            customProps: (req) => ({
              traceId: (req as unknown as { id?: string }).id,
            }),
            redact: {
              paths: [
                'req.headers.authorization',
                '*.password',
                '*.apiKey',
                '*.api_key',
                '*.hash',
                '*.qrString',
                '*.qr_string',
                '*.WIFI_PASSWORD',
                '*.MQTT_PASSWORD',
              ],
              censor: '[REDACTED]',
            },
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
