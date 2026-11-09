import { z } from 'zod';

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),
  RUN_MODE: z.enum(['all', 'api', 'worker']).default('all'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().default('postgresql://wrm:wrm_dev_password@localhost:5434/wrm_dev?connection_limit=5'),
  DIRECT_DATABASE_URL: z.string().optional(),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  MQTT_URL: z.string().default('mqtt://localhost:1883'),
  MQTT_USERNAME: z.string().default('wrm-backend'),
  MQTT_PASSWORD: z.string().default('password123'),
  MQTT_CA_FILE: z.string().optional(),
  MQTT_SHARED_GROUP: z.string().default('backend'),

  PAYWAY_MODE: z.enum(['mock', 'sandbox', 'live']).default('mock'),
  PAYWAY_BASE_URL: z.string().url().default('https://checkout-sandbox.payway.com.kh'),
  PAYWAY_MERCHANT_ID: z.string().default('ec480065'),
  PAYWAY_API_KEY: z.string().default('mock_api_key'),
  PAYWAY_CALLBACK_URL: z.string().default('http://localhost:3000/v1/payway/callback'),

  PAYMENT_TTL_MINUTES: z.coerce.number().int().min(3).default(3),
  PAYMENT_GRACE_SECONDS: z.coerce.number().int().nonnegative().default(60),
  PAY_REQUEST_MIN_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  PAY_REQUEST_BURST: z.coerce.number().int().positive().default(3),
  CALLBACK_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(600),
  CLOCK_SKEW_MAX_SECONDS: z.coerce.number().int().positive().default(300),
  DISPENSE_UNKNOWN_AFTER_SECONDS: z.coerce.number().int().min(180).default(300),
  DISPENSE_ESCALATE_AFTER_HOURS: z.coerce.number().int().positive().default(24),

  REFUND_MODE: z.enum(['manual', 'auto']).default('manual'),
  REFUND_CLAIM_MINUTES: z.coerce.number().int().positive().default(30),
  MACHINE_OFFLINE_AFTER_SECONDS: z.coerce.number().int().positive().default(180),

  RETENTION_OUTBOX_DAYS: z.coerce.number().int().positive().default(7),
  RETENTION_INBOX_DAYS: z.coerce.number().int().positive().default(7),
  RETENTION_HEARTBEAT_DAYS: z.coerce.number().int().positive().default(30),

  AUTH_SECRET: z.string().min(16).default('dev_secret_must_change_in_production_32chars'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type AppConfig = z.infer<typeof configSchema>;
