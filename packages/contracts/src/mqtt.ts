import { z } from 'zod';

export const VolumeMlSchema = z.union([z.literal(500), z.literal(750), z.literal(1000)]);
export type VolumeMl = z.infer<typeof VolumeMlSchema>;

export const CurrencySchema = z.enum(['KHR', 'USD']);
export type Currency = z.infer<typeof CurrencySchema>;

export const PayRequestV1Schema = z.object({
  v: z.literal(1).default(1),
  request_id: z.string().min(1).max(64),
  volume_ml: VolumeMlSchema,
  currency: CurrencySchema.optional(),
});
export type PayRequestV1 = z.infer<typeof PayRequestV1Schema>;

export const LegacyPayRequestSchema = z.object({
  volume_ml: VolumeMlSchema,
  currency: CurrencySchema.optional(),
});

export function parsePayRequestPayload(raw: unknown): { success: true; data: PayRequestV1 } | { success: false; error: z.ZodError } {
  const v1Result = PayRequestV1Schema.safeParse(raw);
  if (v1Result.success) {
    return { success: true, data: v1Result.data };
  }
  const legacyResult = LegacyPayRequestSchema.safeParse(raw);
  if (legacyResult.success) {
    // Generate synthetic legacy request_id for backward compatibility with prototype
    return {
      success: true,
      data: {
        v: 1,
        request_id: `legacy-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        volume_ml: legacyResult.data.volume_ml,
        currency: legacyResult.data.currency,
      },
    };
  }
  return { success: false, error: v1Result.error };
}

export const PayCancelV1Schema = z
  .object({
    v: z.literal(1).default(1),
    tran_id: z.string().min(1).max(20).optional(),
    request_id: z.string().min(1).max(64).optional(),
    reason: z.string().optional(),
  })
  .refine((data) => data.tran_id !== undefined || data.request_id !== undefined, {
    message: 'Either tran_id or request_id must be provided',
  });
export type PayCancelV1 = z.infer<typeof PayCancelV1Schema>;

export const PayQrV1Schema = z.object({
  v: z.literal(1).default(1),
  request_id: z.string().min(1).max(64),
  tran_id: z.string().min(1).max(20),
  qr_string: z.string().min(1),
  amount: z.number().positive(),
  currency: CurrencySchema,
  volume_ml: VolumeMlSchema,
  expires_at: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)),
});
export type PayQrV1 = z.infer<typeof PayQrV1Schema>;

export const PayStatusValueSchema = z.enum(['paid', 'expired', 'failed', 'cancelled']);
export type PayStatusValue = z.infer<typeof PayStatusValueSchema>;

export const PayStatusV1Schema = z.object({
  v: z.literal(1).default(1),
  tran_id: z.string().max(20).nullable(),
  request_id: z.string().max(64).optional(),
  status: PayStatusValueSchema,
  reason: z.string().optional(),
});
export type PayStatusV1 = z.infer<typeof PayStatusV1Schema>;

export const DispenseResultSchema = z.enum(['ok', 'partial', 'error']);
export type DispenseResult = z.infer<typeof DispenseResultSchema>;

export const TransactionV1Schema = z.object({
  v: z.literal(1).default(1),
  tran_id: z.string().min(1).max(20),
  result: DispenseResultSchema,
  flow_ml: z.number().nonnegative(),
  weight_g: z.number().nonnegative(),
  fault: z.string().optional(),
  ts: z.number().optional(),
});
export type TransactionV1 = z.infer<typeof TransactionV1Schema>;

export const LegacyTransactionSchema = z.object({
  tran_id: z.string().min(1).max(20),
  status: z.enum(['ok', 'aborted', 'fault', 'error', 'partial']),
  flow_ml: z.number().optional(),
  weight_g: z.number().optional(),
  fault_code: z.string().optional(),
  ts: z.number().optional(),
});

export function parseTransactionPayload(raw: unknown): { success: true; data: TransactionV1 } | { success: false; error: z.ZodError } {
  const v1 = TransactionV1Schema.safeParse(raw);
  if (v1.success) return { success: true, data: v1.data };

  const legacy = LegacyTransactionSchema.safeParse(raw);
  if (legacy.success) {
    const res: DispenseResult =
      legacy.data.status === 'ok'
        ? 'ok'
        : legacy.data.status === 'partial'
          ? 'partial'
          : 'error';
    return {
      success: true,
      data: {
        v: 1,
        tran_id: legacy.data.tran_id,
        result: res,
        flow_ml: legacy.data.flow_ml ?? 0,
        weight_g: legacy.data.weight_g ?? 0,
        fault: legacy.data.fault_code,
        ts: legacy.data.ts,
      },
    };
  }
  return { success: false, error: v1.error };
}

export const TransactionAckV1Schema = z.object({
  v: z.literal(1).default(1),
  tran_id: z.string().min(1).max(20),
  status: z.enum(['ok', 'rejected']),
  reason: z.string().optional(),
});
export type TransactionAckV1 = z.infer<typeof TransactionAckV1Schema>;

export const ErrorV1Schema = z.object({
  v: z.literal(1).default(1),
  fault: z.string(),
  tran_id: z.string().max(20).optional(),
  ts: z.number().optional(),
});
export type ErrorV1 = z.infer<typeof ErrorV1Schema>;

// ---------------------------------------------------------------------------
// heartbeat (machine -> backend, every 60 s) — Plan §C2
// ---------------------------------------------------------------------------
export const Stm32StateSchema = z.enum(['IDLE', 'WAIT_QR', 'QR', 'WAIT_BOTTLE', 'DISPENSING', 'ERROR']);
export const TankLevelSchema = z.enum(['EMPTY', 'LOW', 'MEDIUM', 'FULL']);

export const HeartbeatV1Schema = z.object({
  v: z.literal(1),
  fw: z.string(),
  uptime_s: z.number().int().nonnegative(),
  rssi: z.number().int(),
  heap: z.number().int().nonnegative(),
  stm32: z.object({
    link: z.enum(['ok', 'lost']),
    // state/tank/fault come from the last PONG; absent while the UART link is lost
    state: Stm32StateSchema.optional(),
    tran_id: z.string().max(20).optional(),
    tank: TankLevelSchema.optional(),
    fault: z.string().optional(),
  }),
  pending_outcomes: z.number().int().nonnegative(),
  rejected_outcomes: z.number().int().nonnegative(),
  dropped_outcomes: z.number().int().nonnegative(),
  ts: z.number().int().optional(),
});
export type HeartbeatV1 = z.infer<typeof HeartbeatV1Schema>;

/** ESP32 firmware v0.4.0 heartbeat (no `v`, `stm32` is "ok" | "lost"). Accepted until Phase 10 like other legacy payloads. */
export const LegacyHeartbeatSchema = z.object({
  fw: z.string().optional(),
  stm32: z.enum(['ok', 'lost']).optional(),
  pending_outcomes: z.number().int().nonnegative(),
});

/** What the backend needs from any heartbeat version. */
export interface NormalizedHeartbeat {
  fw?: string;
  stm32Link?: 'ok' | 'lost';
  stm32State?: z.infer<typeof Stm32StateSchema>;
  stm32Fault?: string;
  pendingOutcomes: number;
}

export function parseHeartbeatPayload(
  raw: unknown,
): { success: true; data: NormalizedHeartbeat } | { success: false; error: z.ZodError } {
  const v1 = HeartbeatV1Schema.safeParse(raw);
  if (v1.success) {
    return {
      success: true,
      data: {
        fw: v1.data.fw,
        stm32Link: v1.data.stm32.link,
        stm32State: v1.data.stm32.state,
        stm32Fault: v1.data.stm32.fault,
        pendingOutcomes: v1.data.pending_outcomes,
      },
    };
  }
  const legacy = LegacyHeartbeatSchema.safeParse(raw);
  if (legacy.success) {
    return {
      success: true,
      data: { fw: legacy.data.fw, stm32Link: legacy.data.stm32, pendingOutcomes: legacy.data.pending_outcomes },
    };
  }
  return { success: false, error: v1.error };
}

// ---------------------------------------------------------------------------
// config (backend -> machine, retained) and config/ack (machine -> backend) — Plan §C2
// Prices are MAJOR units as decimal strings (same as the QR amount): USD "0.15", KHR "500".
// ---------------------------------------------------------------------------
export const MajorPriceSchema = z.string().regex(/^\d+(\.\d{2})?$/, 'major units: "0.15" (USD) or "500" (KHR)');

export const ConfigV1Schema = z.object({
  v: z.literal(1),
  prices: z.object({ '500': MajorPriceSchema, '750': MajorPriceSchema, '1000': MajorPriceSchema }),
  currency: CurrencySchema,
  enabled: z.boolean(),
});
export type ConfigV1 = z.infer<typeof ConfigV1Schema>;

export const ConfigAckV1Schema = z.object({
  v: z.literal(1).default(1),
  status: z.enum(['ok', 'error']),
  fault: z.string().optional(),
});
export type ConfigAckV1 = z.infer<typeof ConfigAckV1Schema>;
