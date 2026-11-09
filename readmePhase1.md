# Phase 1: Platform — Implementation & Verification Summary

This document details the completed implementation of **Phase 1: Platform** for the Water Refill Machine backend monorepo.

Phase 1 provides reusable platform building blocks without domain business logic, fully establishing the transaction model, outbox messaging, background job scheduling, rate limiting, MQTT 5 communication, and observability foundations.

---

## 1. Architecture Components Implemented

### 1.1 Config (`apps/api/src/platform/config/`)
- **Schema (`config.schema.ts`)**: Validated via Zod matching Plan §B5.
- **Fail-Fast Validation (`config.service.ts`)**: The process aborts startup immediately if mandatory environment variables are missing or misconfigured.
- **Run Modes**: Supports `RUN_MODE=all` (default), `RUN_MODE=api` (HTTP only), and `RUN_MODE=worker` (processors and sweeps only).

### 1.2 Structured Logging & Redaction (`apps/api/src/platform/logging/`)
- **JSON Logging**: Powered by `nestjs-pino` and `pino-pretty` in local development.
- **Trace Propagation**: Auto-generates or propagates request IDs (`traceId`) on every HTTP request and log entry.
- **Secret Redaction**: Redacts sensitive fields (`authorization`, `api_key`, `secret`, `password`, `hash`, `token`, `*.apiKey`) across all log streams.

### 1.3 Error Taxonomy & HTTP Filter (`apps/api/src/platform/errors/`, `shared-kernel/errors.ts`)
- **Taxonomy**: Standard domain errors (`DomainError`, `NotFoundError`, `ConflictError`, `ValidationError`, `RateLimitError`, `InfrastructureError`).
- **Error Mapping (`toErrorCode`)**: Normalizes arbitrary errors into standard error codes from `@wrm/contracts`.
- **Global Filter (`http-exception.filter.ts`)**: Fastify exception filter converting exceptions into standard RFC 7807 problem payloads with `traceId`.

### 1.4 Shared Kernel (`apps/api/src/shared-kernel/`)
- **`AggregateRoot`**: Tracks pending domain events and provides `raise()` and `pullEvents()`.
- **`DomainEvent`**: Common interface with UUIDv7 ID, type, schema version, occurredAt timestamp, and data.
- **`Clock`**: `SystemClock` and `FakeClock` for deterministic time manipulation in tests.
- **`Money`**: Scale-aware arithmetic value object handling minor units (scale 0 for KHR, scale 2 for USD), conversions, formatting, and strict validation.
- **`TranIdGenerator`**: Generates unique, URL-safe alphanumeric IDs with length $\le 20$ chars.
- **`generateUuidV7`**: Generates time-ordered UUIDv7 identifiers.

### 1.5 Database & Unit of Work (`apps/api/src/platform/database/`)
- **Prisma Client**: Pinned to `@prisma/client@^6.19.3` with connection budget limit (`connection_limit=5`) and `directUrl`.
- **Unit of Work (`unit-of-work.ts`)**: Wraps interactive `$transaction` with exponential conflict retry backoff (20ms, 50ms, 100ms) for concurrency conflict errors (`P2002`, `P2034`, `ConflictError`).
- **Prisma Error Mapper (`prisma-error.mapper.ts`)**: Converts known Prisma codes to clean domain errors (`P2002` / `P2034` $\to$ `ConflictError`, `P2025` $\to$ `NotFoundError`, network errors $\to$ `InfrastructureError`).

### 1.6 Outbox Engine (`apps/api/src/platform/outbox/`)
- **Schema (`outbox` table)**: UUIDv7 ID, aggregate type & ID, event type, JSON payload, `occurred_at`, `dispatched_at`, `attempts`, `last_error`, `dead_at`.
- **Writer (`outbox.service.ts`)**: `add(events, tx)` guarantees outbox events are inserted within the same database transaction as aggregate mutations.
- **Relay Loop (`outbox.relay.ts`)**: Polling loop (250ms interval) using `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 20` to guarantee zero lock contention and no double-dispatch across concurrent workers.
- **Deduplication**: Enqueues to BullMQ with deterministic job IDs (`${row.id}__${handler.name}`), ensuring that a process crash after enqueue before database commit never duplicates handler execution. Retries up to 10 times with exponential backoff before marking `dead_at`.

### 1.7 Inbox Pattern (`apps/api/src/platform/inbox/`)
- **Deduplication (`inbox.service.ts`)**: `record(messageId, source, tx)` requires a transaction argument by type. If a duplicate message ID is processed within the state-change transaction, the unique constraint aborts the transaction cleanly.

### 1.8 Sweeps Framework (`apps/api/src/platform/sweeps/`)
- **`BaseSweep`**: Reusable base class supporting batch item retrieval, per-item execution, skip-on-error behavior, and processed/failed metrics.
- **`SweepsScheduler`**: Repeatable job scheduler upserting BullMQ repeatable schedulers at worker boot. Guarantees that even after `FLUSHALL` on Redis, all sweep schedulers resume within one interval upon boot/restart.

### 1.9 MQTT Platform (`apps/api/src/platform/mqtt/`)
- **MQTT 5 Engine (`mqtt.service.ts`)**: Protocol version 5, TLS/CA certificate loading, automatic reconnection, persistent sessions, and graceful client termination.
- **Shared Subscriptions**: Automatically subscribes via `$share/<MQTT_SHARED_GROUP>/<topic>` so multiple backend replicas balance MQTT device messages evenly without duplicates.
- **Message Expiry**: Supports MQTT 5 `messageExpiryInterval` property and QoS 1.
- **Decorator (`@MqttSubscribe`)**: Declarative metadata decorator for event routing.

### 1.10 Queues & Retention (`apps/api/src/platform/queues/`)
- **BullMQ Platform (`queue.service.ts`)**: Standard queue factory, worker lifecycle management, concurrency control, and DLQ handling.
- **Maintenance Retention (`retention.service.ts`)**: Scheduled daily at 03:00 (`maintenance.retention`) to purge:
  - Dispatched outbox records older than `RETENTION_OUTBOX_DAYS` (default 7 days). **Preserves undispatched rows indefinitely.**
  - Inbox records older than `RETENTION_INBOX_DAYS` (default 7 days).
  - Heartbeat records older than `RETENTION_HEARTBEAT_DAYS` (default 30 days).

### 1.11 Rate Limiter (`apps/api/src/platform/rate-limit/`)
- **Redis-Backed (`rate-limiter.service.ts`)**: Uses `rate-limiter-flexible` connected to Redis.
- **Injectable Limits**: Custom point/duration parameters per key (e.g. per-machine payment requests or ABA callbacks). Throws `RateLimitError` (HTTP 429) upon limit breach.

### 1.12 Health Probes & Telemetry (`apps/api/src/platform/health/`, `telemetry/`)
- **`GET /health/live`**: Fast liveness check returning `{ status: "ok", uptime: number }`.
- **`GET /health/ready`**: Deep readiness probe verifying database connectivity (`SELECT 1`), Redis ping (`PONG`), and MQTT broker connection status.
- **Telemetry (`telemetry.init.ts`)**: Sentry SDK initialization and OpenTelemetry tracing exporter hooks.

---

## 2. Test Verification & Results

All 11 test suites (32 individual tests) pass with 100% green status:

```text
 ✓ src/shared-kernel/money.spec.ts (8 tests)
 ✓ test/config.spec.ts (3 tests)
 ✓ test/errors.spec.ts (4 tests)
 ✓ test/shared-kernel.spec.ts (3 tests)
 ✓ test/unit-of-work.integration.spec.ts (3 tests)
 ✓ test/sweeps.integration.spec.ts (1 test)
 ✓ test/outbox-relay.integration.spec.ts (2 tests)
 ✓ test/retention.integration.spec.ts (2 tests)
 ✓ test/testcontainers.smoke.spec.ts (1 test)
 ✓ test/platform.e2e.spec.ts (3 tests)
 ✓ test/architecture-boundaries.spec.ts (2 tests)

Test Files  11 passed (11)
     Tests  32 passed (32)
```

### Key Integration Tests Verified
1. **Unit of Work & Transactions (`unit-of-work.integration.spec.ts`)**:
   - Transaction rollback cleanly discards both outbox and inbox records on error.
   - Transaction commit atomically persists outbox and inbox records.
   - Concurrency conflicts trigger automatic retries up to 3 attempts.
2. **Outbox Relay & Concurrency (`outbox-relay.integration.spec.ts`)**:
   - Two concurrent relays running simultaneously never double-dispatch outbox rows (`SKIP LOCKED`).
   - Crash after enqueue before commit does not duplicate jobs in BullMQ thanks to deterministic job IDs.
3. **Sweeps & Redis Resilience (`sweeps.integration.spec.ts`)**:
   - `FLUSHALL` on Redis wipes schedulers; `SweepsScheduler.upsertAllSchedulers()` successfully restores all repeatable jobs in Redis.
4. **Retention Policies (`retention.integration.spec.ts`)**:
   - Deletes only dispatched outbox records past the retention cutoff.
   - Undispatched outbox records and recent records are strictly preserved.
   - Prunes expired inbox and heartbeat rows.
5. **E2E Smoke & Pipeline (`platform.e2e.spec.ts`)**:
   - `GET /health/live` returns HTTP 200.
   - `GET /health/ready` returns HTTP 200 with `database: up`, `redis: up`, `mqtt: up`.
   - Complete event cycle verified: `DomainEvent` $\to$ `outbox` table $\to$ `OutboxRelay` $\to$ BullMQ worker $\to$ MQTT publish $\to$ MQTT subscriber reception.

---

## 3. How to Run & Verify

### Start Infrastructure
Ensure Docker is running, then start the local database, cache, and MQTT broker:
```powershell
docker compose -f infra/docker-compose.yml up -d
```

### Run All Quality Checks
```powershell
# 1. Type check
pnpm run typecheck

# 2. Lint check
pnpm run lint

# 3. Architecture dependency validation (0 boundary violations)
pnpm run depcruise

# 4. Run all test suites
pnpm test

# 5. Build all packages
pnpm run build
```

### Run Application Locally
```powershell
# Run API + Worker together (default)
pnpm --filter @wrm/api dev
```

Test readiness endpoint in another terminal:
```powershell
curl http://localhost:3000/health/ready
```
Expected output:
```json
{"status":"ok","checks":{"database":"up","redis":"up","mqtt":"up"}}
```

---

## 4. Phase 1 Definition of Done Checklist

- [x] Worker killed mid-dispatch $\to$ each event handled once per handler after restart
- [x] `FLUSHALL` on Redis $\to$ sweeps resume within one interval
- [x] `/health/ready` accurate; logs carry `traceId`; secrets redacted
- [x] `RUN_MODE=all` runs API + worker in one process
- [x] `PROGRESS.md` updated with handoff note

---

## 5. Next Steps (Phase 2 Preview)

Phase 2 will implement the **Payments** domain layer:
1. `Payment` aggregate root (states: `CREATED`, `PENDING`, `PAID`, `EXPIRED`, `REFUNDED`, `FAILED`).
2. PayWay client (ABA sandbox KHQR generation, checksum calculation, webhook signature verification).
3. `POST /v1/payments`: generates payment transaction, displays KHQR.
4. `POST /v1/payway/callback`: idempotently processes ABA webhook callback via Inbox and emits `PaymentReceived` domain event to Outbox.
5. `payments.reconcile` sweep: background reconciliation probing terminal payments at +5 min, +1 h, +1 d, +3 d, +6 d.
