# Backend Implementation Plan

> Phase-by-phase plan to build the production backend described in **[Backend Architecture](backend-architecture.md)** and deploy it as described in **[Deployment](../06-Testing-and-Operations/deployment.md)**.
> This document is the **single source of truth for implementation**: conventions, contracts, data model, error handling, code patterns, tests and the definition of done for every phase. If code and this plan disagree, fix one of them in the same pull request.

| | |
|---|---|
| **Version** | **v3** — revised after two external architecture reviews |
| **Status** | Approved plan — progress is tracked in **[PROGRESS.md](../PROGRESS.md)** (not in this file) |
| **Owner** | Backend (also owns the ESP32 gateway) |
| **Prototype** | `backend/` (Node.js) stays running until Phase 2 cut-over |
| **Last updated** | 2026-11-08 |

### Revision history

| Version | Change | Reason |
|---|---|---|
| v2 | Idempotency via `payments(machine_id, request_id)`; inbox only inside the state-change transaction | Inbox written before the command could block retries |
| v2 | States DISPENSE_UNKNOWN, REFUND_REVIEW, REFUND_REJECTED; no automatic refund when outcome unknown | Water **and** refund if machine offline |
| v2 | `transaction/ack` + ESP32 NVS replay; operator refund queue by default (`REFUND_MODE`) | Outcomes must survive network loss; KHQR refund API unconfirmed |
| v2 | Atomic supersede; UART `CFG`/`PONG`/STM32 safety rules; Kysely removed; retention; OTA phase | Races, missing formats, complexity, storage |
| v3 | **ABA response codes mapped per operation**; `not_found` = pending until expiry + grace (D7, ADR-0009) | Code `6` means "not paid yet" for check-transaction, not "rejected" |
| v3 | **`payments.reconcile`** probes terminal payments at +5 min / +1 h / +1 d / +3 d / +6 d | A lost ABA callback made late payments invisible |
| v3 | **All money timers are DB-driven sweeps** (repeatable jobs re-created at boot); no money decision depends on a Redis delayed job | Redis data loss left payments PENDING forever |
| v3 | **UART acknowledgements both ways** (`PAID,ACK`, `ACK,<tran_id>`), STM32 keeps outcome until acked, **`BOTTLE_TIMEOUT`**, `PAID,REJECT`, shared **fault-code list** | One lost UART line caused no water or wrong refund |
| v3 | **One open payment per machine** (PENDING or PAID) → `PAY_MACHINE_BUSY` | Two PAID payments on one machine |
| v3 | **Status-aware resend** for repeated `pay/request`; cancel before `tran_id` exists; ESP32 discards stale `pay/qr` | Dead QRs shown; cancel race |
| v3 | Refund **claim** state, `refunded_amount`, reopen path, refund blocked while machine holds unsent outcomes | Double refunds by two operators; refund before replay |
| v3 | `transaction/ack` rules for unknown/malformed outcomes, `dispense_rejections`, NVS queue policy, device retry policy | Infinite replay loops |
| v3 | TTL in **minutes**; `tran_id` generator spec + ABA 403 regeneration; per-machine request rate limit; callback queued + configurable limit; clock-skew guard | Correctness and abuse protection |
| v3 | **No PgBouncer at start** (small pools, `DIRECT_DATABASE_URL`); LISTEN/NOTIFY removed; relay batches of 20 | Simpler operations at < 100 machines |
| v3 | Minimal `transaction` recording in **Phase 2**; machine provisioning endpoint; refunds in revenue reports; enums/relations/timestamps in schema | Cut-over gap; operations; data integrity |
| v3 | **Early pilot** (Phase 3.5) running in parallel; go-live ≈ week 20 | Pilot could not fit in a 2-week phase |
| v3 | Architecture and Deployment docs re-synchronised | Document drift |
| v3.1 | **C10 ABA PayWay API reference** (moved out of prototype code); **Read before starting** per phase | Prototype is deleted after Phase 3; agents need every input listed |
| v3.1 | AI-agent handoff: `PROGRESS.md`, task tags `[HUMAN]` / `[HARDWARE]` / `[MANUAL CHECK]`, **Needs before starting** per phase, handoff DoD item, B8 commit style | Several developers / AI agents continue each other's phases |

---

## Table of contents

- [Part A — How to use this plan](#part-a--how-to-use-this-plan)
- [Part B — Global standards](#part-b--global-standards-apply-to-every-phase)
- [Part C — Contracts & data model](#part-c--contracts--data-model)
- [Part D — Core code patterns](#part-d--core-code-patterns)
- [Part E — Phases](#part-e--phases)
- [Part F — Timeline, risks, open questions, traceability](#part-f--timeline-risks-open-questions-traceability)

---

# Part A — How to use this plan

0. **Start of every session:** read `CLAUDE.md` (repo root) → **[`docs/PROGRESS.md`](../PROGRESS.md)** (current phase + handoff note of the previous phase) → Part A–C of this plan → the current phase only.
1. Work **one phase at a time**, in order (Phase 3.5 pilot runs in parallel with Phases 4–10). A phase is finished only when its **Definition of Done** is fully checked.
2. Each phase lists: **Goal → Tasks → Error handling → Tests → Definition of Done**.
3. **Part B** and **Part C** apply to all phases — read them before Phase 0.
4. Significant decisions go into an **ADR** (`docs/adr/NNNN-title.md`) before code.
5. Contract changes (MQTT, UART, REST, DB, fault codes) require: update Part C → update `packages/contracts` → regenerate firmware header (C9) → update tests → update firmware docs — in **one** pull request.
6. **Task tags:**

   | Tag | Meaning | What an AI agent does |
   |---|---|---|
   | *(none)* | Code, tests, docs | Do it |
   | **`[HUMAN]`** | Needs a person: accounts, payments, servers, secrets, emails, GitHub settings | Do **not** do it. Prepare what you can (scripts, text) and list it under "Waiting for human" in `PROGRESS.md` |
   | **`[HARDWARE]`** | STM32 work by the hardware developer (Keil) | Do **not** do it. Only provide contracts, fixtures and docs |
   | **`[MANUAL CHECK]`** | DoD item that needs real devices (ESP32, STM32, ABA app) | Write the steps; a person runs them and ticks the box in `PROGRESS.md` |

   A phase may be marked **done** only when every DoD item is ticked, including `[MANUAL CHECK]` items confirmed by a person.
7. **End of every phase:** tick the DoD in `PROGRESS.md`, write the **handoff note** (template in `PROGRESS.md`), and update this plan if anything changed.
8. **System invariants** (must never be broken by any change):
   1. No water without a confirmed payment for that machine and `tran_id`.
   2. A payment dispenses at most once.
   3. No automatic refund while the dispense outcome is unknown.
   4. No money decision depends only on a message that can be lost (every decision is re-derivable from PostgreSQL + ABA).
   5. No payment that ABA may still accept is left unobserved (reconciliation).

---

# Part B — Global standards (apply to every phase)

## B1 Repository & tooling

| Item | Decision |
|---|---|
| Monorepo | **pnpm workspaces** (+ Turborepo) |
| Node.js | **22 LTS** (`.nvmrc`, `engines`) |
| Language | **TypeScript 5**, `strict`, `noUncheckedIndexedAccess` |
| Backend | **NestJS 11** on **Fastify** |
| Data access | **Prisma** only — writes, reads, migrations; **TypedSQL / `$queryRaw`** for reports |
| Database | **PostgreSQL 16** (managed in production); **no PgBouncer at start** (ADR-0011) |
| Queue | **BullMQ** on **Redis 7** |
| MQTT | **mqtt.js 5** (backend, MQTT 5); **PubSubClient** (ESP32, MQTT 3.1.1) |
| Validation | **Zod** |
| Rate limiting | **rate-limiter-flexible** (Redis-backed, shared by all API instances) |
| Circuit breaker | **opossum** |
| Tests | **Vitest** (+ `unplugin-swc`), **Testcontainers** |
| Lint / format | ESLint (typescript-eslint strict) + Prettier |
| Boundaries | **dependency-cruiser** |
| Dashboard | **Next.js 15** + Tailwind + shadcn/ui |
| Auth | **Better Auth** — confirmed by a spike in Phase 6; fallback NestJS guards + Argon2id + session table |
| Logs / tracing / errors | **pino** · **OpenTelemetry** → Grafana Cloud · **Sentry** |

> Versions are re-checked and pinned in Phase 0; any replacement is recorded in an ADR.

### Target repository layout

```text
water-refill-machine/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── contexts/
│   │   │   │   ├── payments/   { domain, application, infrastructure, interface }   ← core (4 layers)
│   │   │   │   ├── dispensing/ { domain, application, infrastructure, interface }   ← core (4 layers)
│   │   │   │   ├── fleet/      { application, interface }                           ← supporting (2 layers)
│   │   │   │   ├── monitoring/ { application, interface }
│   │   │   │   ├── identity/   { application, interface }
│   │   │   │   └── reporting/  { application (queries), interface }
│   │   │   ├── shared-kernel/          AggregateRoot, DomainEvent, errors, Clock, Id, Money
│   │   │   ├── platform/               config, db, outbox, inbox, mqtt, queue, ratelimit, logging, health, telemetry
│   │   │   └── main.ts                 boots api / worker / both by RUN_MODE
│   │   ├── prisma/ { schema.prisma, migrations/, sql/ (TypedSQL), seed.ts }
│   │   └── test/ { e2e/, fixtures/ }
│   └── dashboard/
├── packages/
│   ├── contracts/                      Zod: MQTT topics/payloads, REST DTOs, error codes, fault codes
│   │   └── generated/wrm_contract.h    C header for firmware (C9)
│   └── tsconfig/
├── firmware/esp32-gateway/
├── backend-prototype/                  (renamed from backend/; deleted after Phase 3)
├── infra/ { docker-compose.yml, docker-compose.prod.yml, Caddyfile, mosquitto/, scripts/, load/ }
├── docs/ { adr/, ... }
├── .github/workflows/ { ci.yml, deploy.yml }
└── pnpm-workspace.yaml
```

## B2 Code structure & layer rules

**Core contexts (Payments, Dispensing)** — four layers (Architecture §5):

| Layer | May import | Must not import | Contains |
|---|---|---|---|
| `domain/` | `shared-kernel` only | NestJS, Prisma, mqtt, BullMQ, other contexts | Aggregates, value objects, domain events, domain errors, **port interfaces** |
| `application/` | `domain`, `shared-kernel`, `platform` ports | Prisma client, mqtt client | Command/query handlers, process managers, sweeps logic |
| `infrastructure/` | `domain`, `application`, `platform` | `interface/` | Prisma repositories, PayWay adapter, publishers |
| `interface/` | `application`, `packages/contracts` | `domain` internals, `infrastructure` | MQTT consumers, REST controllers, job processors |

**Supporting / generic contexts (Fleet, Monitoring, Identity, Reporting)** — two layers: `application/` (NestJS services using Prisma; rules as small pure functions with unit tests) and `interface/`. They still publish events through the **outbox** and expose **public ports**.

**Cross-context rules:** communicate via domain events (outbox) or public ports (`<context>/application/public/*.port.ts`); never write another context's tables; Reporting reads only its own SQL views; enforced by dependency-cruiser in CI.

## B3 Coding conventions

| Topic | Rule |
|---|---|
| Naming | Files `kebab-case`; classes `PascalCase`; commands `VerbNounCommand`; events past tense |
| One handler per use case | `create-payment.handler.ts` handles only `CreatePaymentCommand` |
| Time | Never `new Date()` in domain/application — inject `Clock` |
| `TranId` | ≤ 20 chars: `base36(epoch_ms)` (8–9 chars) + **6 CSPRNG digits** → ~15 chars. Generated by `TranIdGenerator`; collisions handled by ABA code 403 → regenerate (max 3) |
| Other IDs | UUIDv7 |
| `request_id` | Generated by the ESP32: 16 hex chars from the hardware RNG (`esp_random`) — unique across reboots without NVS |
| Volumes | **Fixed tiers 500 / 750 / 1000 mL** (STM32 has three buttons); validated by `Volume` |
| Money | `Money` = integer **`amountMinor`** + `currency`. **KHR scale 0** (500 KHR → `500`), **USD scale 2** ($0.15 → `15`). The PayWay adapter converts to ABA major units (`500` / `0.15`). No floats in arithmetic |
| Async | No floating promises (lint error) |
| Comments | Explain why; every invariant has a one-line comment |
| Exports | Each context exposes only its module, public ports and event types |

## B4 Error handling

### B4.1 Error taxonomy

```text
AppError (base: code, message, details?, cause?)
├── DomainError          business rule violated          → never retried
├── ValidationError      bad input (Zod)                 → never retried
├── NotFoundError        entity missing                  → never retried
├── ConflictError        version / unique conflict       → retried by handler (bounded)
├── AuthError            unauthenticated / forbidden     → never retried
├── RateLimitError       too many requests               → caller backs off
└── InfrastructureError  DB, Redis, MQTT, ABA failure    → retried with backoff
    ├── GatewayUnavailableError   (timeout, 5xx, 429, circuit open, ABA internal error)
    └── GatewayRejectedError      (ABA business rejection — per-operation table D7)
```

Domain/application code **throws** typed errors (no `Result` type). Adapters translate library errors to `InfrastructureError`. Only the **interface layer** maps errors to HTTP, MQTT replies or job outcomes. Every error has a stable code in `packages/contracts/src/errors.ts`.

### B4.2 Error code catalog

| Code | Class | HTTP | Reply to machine | Retry | Log | Alert |
|---|---|---|---|---|---|---|
| `VALIDATION_FAILED` | Validation | 400 | `pay/status failed` | No | warn | No |
| `PAY_INVALID_VOLUME` | Domain | 400 | `failed` | No | warn | No |
| `PAY_MACHINE_NOT_FOUND` | NotFound | 404 | `failed` | No | warn | Yes |
| `PAY_MACHINE_DISABLED` | Domain | 409 | `failed` (`MACHINE_DISABLED`) | No | info | No |
| `PAY_MACHINE_BUSY` | Domain | 409 | `failed` (`MACHINE_BUSY`) | No | warn | If repeated |
| `PAY_NOT_FOUND` | NotFound | 404 | — | No | warn | No |
| `PAY_INVALID_STATE` | Domain | 409 | — | No | warn | No |
| `PAY_EXPIRED` | Domain | 409 | `expired` | No | info | No |
| `PAY_GATEWAY_UNAVAILABLE` | Infra | 503 | `failed` (`GATEWAY_UNAVAILABLE`) | Yes | error | > 3 / 5 min |
| `PAY_GATEWAY_REJECTED` | Infra | 502 | `failed` | No | error | Yes |
| `DSP_NOT_PAID` | Domain | 409 | `transaction/ack rejected` | No | error | **Yes** |
| `DSP_WRONG_MACHINE` | Domain | 409 | `ack rejected` | No | error | **Yes** |
| `DSP_UNKNOWN_PAYMENT` | NotFound | 404 | `ack rejected` | No | error | **Yes** |
| `DSP_MALFORMED` | Validation | 400 | `ack rejected` (if `tran_id` readable) | No | error | Yes |
| `DSP_DUPLICATE` | Conflict | 200 | `ack ok` | No | debug | No |
| `REFUND_INVALID_STATE` | Domain | 409 | — | No | warn | No |
| `REFUND_ALREADY_CLAIMED` | Conflict | 409 | — | No | info | No |
| `REFUND_ALREADY_DECIDED` | Conflict | 409 | — | No | info | No |
| `REFUND_BLOCKED_PENDING_OUTCOMES` | Domain | 409 (admin override with reason) | — | No | warn | No |
| `CFG_REJECTED` | Domain | — | — | No | warn | Yes |
| `CONCURRENCY_CONFLICT` | Conflict | 409 | — | Yes (×3) | warn | No |
| `AUTH_UNAUTHENTICATED` / `AUTH_FORBIDDEN` | Auth | 401 / 403 | — | No | info / warn | No |
| `RATE_LIMITED` | RateLimit | 429 | `failed` (`RATE_LIMITED`) | Device policy (B4.7) | warn | If sustained |
| `INTERNAL_ERROR` | (unknown) | 500 | `failed` | Job: Yes | error | Sentry |

### B4.3 Handling by entry point

| Entry point | Behaviour on error |
|---|---|
| **REST** | Global exception filter → `{ error: { code, message, details, traceId } }`; unknown → `INTERNAL_ERROR` (message hidden, Sentry) |
| **ABA callback** | Always **200** quickly (unknown, duplicate, malformed bodies included) after enqueueing `payments.confirm`; never calls ABA inline |
| **MQTT consumer** | Zod validate → domain errors replied per catalog → infra errors replied `failed` (retryable reason) → consumer never crashes; malformed JSON logged + dropped (or `ack rejected` for outcomes) |
| **Job processor** | Retryable → throw (BullMQ backoff); non-retryable → `UnrecoverableError`; max attempts → DLQ + alert |
| **Sweeps** | A failure on one row is logged and skipped; the row is picked up again on the next run |
| **Outbox relay** | Per-row failure increments `attempts`; after 10 → `dead_at` + alert; never blocks other rows |

### B4.4 Idempotency rules

| Message | Key | Mechanism |
|---|---|---|
| `pay/request` | `(machine_id, request_id)` | Unique constraint; existing row → **status-aware resend** (D5) |
| `pay/cancel` | `tran_id` (or `request_id`) + status | No-op if already terminal |
| `transaction` | `tran_id` | `dispenses.tran_id` PK; duplicate → ack `ok` |
| `error` with `tran_id` | `tran_id` + fault code | Treated as an outcome (`result=error`), same key |
| ABA callback / check job | `tran_id` + status | `markPaid` idempotent for all states (D2) |
| Messages without a natural key | `inbox.message_id` | Inbox row in the **same** transaction as the state change (currently no consumer needs it; kept for future topics) |

### B4.5 Retry & timeout policy (backend)

| Operation | Timeout | Retries | Backoff | Circuit breaker |
|---|---|---|---|---|
| ABA `generate-qr` | 8 s | 0 in request path (device retries same `request_id`); code 403 → new `tran_id`, max 3 | — | 5 failures / 30 s → open 30 s |
| ABA `check-transaction` | 8 s | Driven by sweeps (B4.8) | Schedule | Same |
| ABA `close-transaction` | 8 s | 3 | Exponential | Same |
| ABA refund (`REFUND_MODE=auto`) | 15 s | 8 | Exp. up to 10 min | Same |
| DB conflict | — | 3 | 20 / 50 / 100 ms | — |
| MQTT publish (outbox handler) | 5 s | 10 | Exp. 1 s → 5 min | — |
| Telegram | 5 s | 5 | Exponential | — |

### B4.6 Never-do list

- Never swallow an error without logging `tran_id` / `machine_id`.
- Never send stack traces or internal messages to clients or machines.
- Never retry a non-idempotent external call without an idempotency guarantee.
- Never mark a payment `PAID` from a callback body — always `check-transaction`.
- **Never refund automatically while the dispense outcome is unknown.**
- Never make a money decision in a Redis delayed job — use DB-driven sweeps.
- Never resend a QR for a payment that is not `PENDING` and unexpired.
- Never write an inbox row outside the state-change transaction.

### B4.7 Device retry policy (ESP32)

| Message | Policy |
|---|---|
| `pay/request` | No `pay/qr`/`pay/status` within 8 s → resend **same** `request_id` after 2 s, 5 s, 10 s (3 retries) → send `FAILED,0` to STM32 ("Service unavailable") |
| `pay/status failed RATE_LIMITED` | Show "Please wait", one retry after 3 s |
| `transaction` / `error` with `tran_id` | Kept in NVS queue; resend with exponential backoff **5 s → 5 min** + jitter until `transaction/ack` |
| NVS queue | Capacity **64** outcomes; max age **7 days**; on overflow drop the oldest, increment `dropped_outcomes`; `ack rejected` → delete + increment `rejected_outcomes` |
| `config` | Forward as `CFG` until `CFG,OK` (retry every 5 s, max 12) → `config/ack` |
| `pay/qr` | Discard if `request_id` ≠ outstanding request or `expires_at ≤ now` (NTP time); if the request was cancelled locally → publish `pay/cancel {tran_id}` |

### B4.8 ABA polling schedule (DB-driven)

| Payment state | Check schedule (`next_aba_check_at`) |
|---|---|
| PENDING, first 60 s | every 3 s |
| PENDING, until `expires_at + grace` | every 5 s |
| PENDING, after `expires_at + grace` | one final check → PAID or EXPIRED |
| EXPIRED / CANCELLED / FAILED (reconcile) | +5 min, +1 h, +1 d, +3 d, +6 d (inside ABA's 7-day check window), then stop |

`not_found` from ABA = **pending** until `expires_at + grace`; afterwards = not paid (reconcile continues).

## B5 Configuration

All environment variables are **validated with Zod at startup** (fail fast).

| Variable | Example | Used by |
|---|---|---|
| `NODE_ENV`, `APP_ENV` | `production`, `local`/`staging`/`production` | all |
| `RUN_MODE` | `all` / `api` / `worker` | process role |
| `PORT` | `3000` | api |
| `DATABASE_URL` | `postgresql://…?connection_limit=5` | api, worker (pooled by Prisma) |
| `DIRECT_DATABASE_URL` | `postgresql://…` | migrations (`directUrl`) |
| `REDIS_URL` | `redis://redis:6379` | api, worker |
| `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_CA_FILE`, `MQTT_SHARED_GROUP` | `mqtts://…:8883`, `wrm-backend`, *secret*, `/certs/emqxsl-ca.crt`, `backend` | api, worker |
| `PAYWAY_MODE` | `mock` / `sandbox` / `live` | api, worker |
| `PAYWAY_BASE_URL`, `PAYWAY_MERCHANT_ID`, `PAYWAY_API_KEY`, `PAYWAY_CALLBACK_URL` | | api, worker |
| `PAYMENT_TTL_MINUTES` | `3` (validated ≥ 3, integer — ABA lifetime is in minutes) | api |
| `PAYMENT_GRACE_SECONDS` | `60` | worker |
| `PAY_REQUEST_MIN_INTERVAL_MS` / `PAY_REQUEST_BURST` | `3000` / `3` | api |
| `CALLBACK_RATE_LIMIT_PER_MIN` | `600` | api |
| `CLOCK_SKEW_MAX_SECONDS` | `300` | api |
| `DISPENSE_UNKNOWN_AFTER_SECONDS` | `300` (must be ≥ bottle 60 + dispense 60 + 60) | worker |
| `DISPENSE_ESCALATE_AFTER_HOURS` | `24` | worker |
| `REFUND_MODE` | `manual` (default) / `auto` | worker |
| `REFUND_CLAIM_MINUTES` | `30` | api |
| `MACHINE_OFFLINE_AFTER_SECONDS` | `180` | worker |
| `RETENTION_OUTBOX_DAYS` / `RETENTION_INBOX_DAYS` / `RETENTION_HEARTBEAT_DAYS` | `7` / `7` / `30` | worker |
| `AUTH_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `LOG_LEVEL` | | various |

**Connection budget (no PgBouncer):** Prisma pool per process = `connection_limit` in `DATABASE_URL`. Production: api 2 × 5 + worker 1 × 5 = **15 client connections** + 1–2 for migrations ⇒ fits a managed PostgreSQL plan with ≥ 25 connections. Add PgBouncer / managed pooler only when this budget is exceeded (ADR-0011). No session-scoped PostgreSQL features (`LISTEN`, advisory session locks) are used, so a pooler can be added later without code changes.

## B6 Logging, tracing, metrics

Log fields: `time`, `level`, `msg`, `service`, `env`, `traceId`, and when relevant `tranId`, `machineId`, `requestId`, `jobId`, `eventType`, `errorCode`. Levels: `error` (unexpected/after retries/machine invariant violations), `warn` (validation, rejections, retries), `info` (state transitions), `debug` (payload details, never secrets or full QR strings in prod). Redact `password`, `apiKey`, `authorization`, `hash`, `qrString`.

**Tracing:** one trace per payment (MQTT → command → DB → ABA → outbox → MQTT), `traceId` carried in the outbox payload.

**Metrics:**

| Metric | Type |
|---|---|
| `wrm_payments_created_total{machine,currency}` / `wrm_payments_status_total{status}` | counter |
| `wrm_payment_time_to_paid_seconds` | histogram |
| `wrm_late_payments_total` | counter |
| `wrm_aba_request_duration_seconds{operation,outcome}` / `wrm_aba_check_failures_total` | histogram / counter |
| `wrm_aba_circuit_state` | gauge |
| `wrm_outbox_lag_seconds` / `wrm_queue_depth{queue}` | gauge |
| `wrm_machines_online` | gauge |
| `wrm_pay_request_throttled_total` | counter |
| `wrm_transaction_ack_total{status}` | counter |
| `wrm_pending_outcomes{machine}` (from heartbeats) | gauge |
| `wrm_dispense_accuracy_diff_percent` | histogram |
| `wrm_dispense_unknown_open` / `wrm_refund_cases_open` | gauge |

## B7 Testing strategy

| Level | Scope | Tools | Required |
|---|---|---|---|
| **Unit** | Aggregates, value objects, handlers, pure rules | Vitest | Core domain ≥ **95 %** lines, application ≥ **85 %** |
| **Integration** | Repositories, sweeps, relay, processors, PayWay adapter (recorded responses) | Vitest + Testcontainers | Every adapter and sweep |
| **Contract** | MQTT/REST payloads; **golden fixtures for firmware** (C9) | Vitest + host-side C test of the ESP32 parser | Every topic, UART line, fault code |
| **E2E** | Fake ESP32 + broker + api + worker + mock ABA | Vitest + Docker Compose | All critical flows |
| **Load / chaos** | Phase 10 | k6, emqtt-bench | Before go-live |

Rules: no real ABA calls in CI; `FakeClock`; isolated data; flaky test = bug. Money tests cover **KHR and USD** end to end, including the amount sent to ABA. **Redis-loss test:** flush Redis mid-flow → all payments still reach a correct final state.

## B8 Git workflow & definition of done

Branches `feat/phase-<n>-<topic>` (e.g. `feat/phase-1-outbox`); PR to `main`; PR checklist (tests · contracts · ADR · docs · no secrets · `PROGRESS.md` updated).

**Commit style (team rule):**
- **One commit per topic** — never one commit for the whole phase.
- Subject: imperative, capitalised, no prefix, ≤ 72 chars — e.g. `Add outbox relay with SKIP LOCKED batching`, `Fix grace boundary in payment expiry sweep`. **No** Conventional-Commit prefixes (`feat:`, `fix:`).
- **No `Co-Authored-By` or AI attribution lines.**
- Never commit secrets (`.env`, `secrets.h`, keys) or `docs_archive_all_60/`.
- Merge with a normal merge (keep the topic commits); no squash.

**Global Definition of Done:** code follows B2/B3 (depcruise passes) · errors per B4 · logs/metrics per B6 · tests per B7 pass · contracts/docs updated · `PROGRESS.md` handoff note written · reviewed and merged.

---

# Part C — Contracts & data model

## C1 Payment state machine (final)

Supersedes Architecture §6.1 (which references this section).

```text
                QR created
  ┌──────────▶ PENDING ───── customer cancels / superseded ─▶ CANCELLED ─┐
  │              │   └────── TTL + grace, ABA not paid ──────▶ EXPIRED ───┤ ABA APPROVED later
  │              │                                                         │ (reconcile/callback;
  │         ABA APPROVED (≤ TTL + grace)                                   │  machine NOT told)
  │              ▼                                                         ▼
  │            PAID ─── DONE ok (same machine) ───▶ DISPENSED ✅      REFUND_REVIEW ◀──┐
  │              │                                                         ▲           │ reopen
  │              ├── PARTIAL / ERR / PAID,REJECT / BOTTLE_TIMEOUT ─────────┤           │ (admin)
  │              │                                                         │           │
  │              └── no outcome after 5 min ──▶ DISPENSE_UNKNOWN ──────────┤    REFUND_REJECTED
  │                                                 │      (24 h, machine online,       ▲
  │                                  outcome ok     │       no pending outcomes)        │
  │                                  replayed ──────┴──▶ DISPENSED ✅                   │
  │                                                                                     │
  │   REFUND_REVIEW ── claimed → refund done (operator) or auto ──▶ REFUNDED            │
  │                └── operator: water was delivered ───────────────────────────────────┘
  │
  └── ABA DECLINED / CANCELLED ──▶ FAILED ── ABA APPROVED later (reconcile) ──▶ REFUND_REVIEW
```

| From | To | Trigger | Guard / rule |
|---|---|---|---|
| — | PENDING | `CreatePayment` | Machine enabled; valid tier; **no PAID payment open on the machine** (else `PAY_MACHINE_BUSY`); previous PENDING superseded (CANCELLED) in the same transaction |
| PENDING | PAID | ABA APPROVED (callback job or sweep) | `now ≤ expiresAt + grace` |
| PENDING | EXPIRED | Sweep: `now > expiresAt + grace` and final ABA check not APPROVED | Close-transaction attempted; reconcile schedule starts |
| PENDING | CANCELLED | `pay/cancel` from same machine, or superseded | Close-transaction attempted; reconcile schedule starts |
| PENDING | FAILED | ABA DECLINED / CANCELLED | Reconcile schedule starts |
| EXPIRED / CANCELLED / FAILED | REFUND_REVIEW | ABA APPROVED later (callback or reconcile) | Reason `LATE_PAYMENT`; machine **never** told to dispense |
| PAID | DISPENSED | Outcome `ok`, same machine, first outcome | — |
| PAID | REFUND_REVIEW | Outcome `partial` / `error` (incl. `ERR` with `tran_id`, `PAID_NOT_ACCEPTED`, `BOTTLE_TIMEOUT`) | Suggested refund per policy |
| PAID | DISPENSE_UNKNOWN | Sweep: no outcome `DISPENSE_UNKNOWN_AFTER_SECONDS` after `paid_at` | Alert; **no refund** |
| DISPENSE_UNKNOWN | DISPENSED / REFUND_REVIEW | Outcome replayed (`ok` / `partial`/`error`) | — |
| DISPENSE_UNKNOWN | REFUND_REVIEW | Sweep: ≥ 24 h **and** machine online since payment **and** `pending_outcomes = 0`; or admin decision | If the machine has not been online since payment → alert "site check", stay UNKNOWN |
| REFUND_REVIEW | REFUNDED | Claimed case marked refunded (manual) or ABA refund OK (auto) | Blocked while machine reports `pending_outcomes > 0` (admin override with reason) |
| REFUND_REVIEW | REFUND_REJECTED | Operator: water was delivered | Reason required, audit-logged |
| REFUND_REJECTED | REFUND_REVIEW | Admin reopen (complaint) | Reason required, audit-logged |
| DISPENSED / REFUNDED / REFUND_REJECTED | (unchanged) | Late outcome | Stored with `late=true`, alert `RECONCILIATION_NEEDED` |

**Open payment rule:** a machine has at most **one open payment** — `PENDING` or `PAID` (DB partial unique index). `PENDING` is superseded by a new request; `PAID` blocks new requests (`PAY_MACHINE_BUSY`) until an outcome or DISPENSE_UNKNOWN. DISPENSE_UNKNOWN does not block if the latest `PONG` state is `IDLE`.

**Refund policy (ADR-0008):**

| Case | Suggested refund |
|---|---|
| Late payment | 100 % |
| `error` / `PAID_NOT_ACCEPTED` / `BOTTLE_TIMEOUT` with `flow_ml < 10 %` of volume | 100 % |
| `partial` | `(1 − flow_ml / volume) × amount`, rounded per currency scale |
| DISPENSE_UNKNOWN escalated | Operator decides (machine logs, site check) |

`REFUND_MODE=manual` (default): operator **claims** the case, refunds in the ABA portal or cash, records method + reference + amount. `REFUND_MODE=auto`: 100 % cases refunded via ABA API — only after ABA confirms programmatic KHQR refunds (ADR-0008 update).

## C2 MQTT contract v1

JSON, UTF-8, Zod schemas in `packages/contracts/src/mqtt.ts`. Prefix `wrm/{machineId}/`, `machineId` = `^WRM-\d{3,6}$`. Backend uses shared subscriptions (`$share/backend/…`). Backend publishes `pay/qr` and `pay/status` with MQTT 5 **message expiry** = remaining QR lifetime, so the broker drops stale ones for an offline machine.

| Topic | Dir | QoS | Retain | Payload |
|---|---|---|---|---|
| `pay/request` | M → B | 1* | no | `{ v:1, request_id, volume_ml }` |
| `pay/cancel` | M → B | 1* | no | `{ v:1, tran_id?, request_id?, reason }` (one of the IDs required) |
| `pay/qr` | B → M | 1 | no | `{ v:1, request_id, tran_id, qr_string, amount, currency, volume_ml, expires_at }` |
| `pay/status` | B → M | 1 | no | `{ v:1, tran_id \| null, request_id?, status: "paid"\|"expired"\|"failed"\|"cancelled", reason? }` |
| `transaction` | M → B | 1* | no | `{ v:1, tran_id, result: "ok"\|"partial"\|"error", flow_ml, weight_g, fault?, ts }` |
| `transaction/ack` | B → M | 1 | no | `{ v:1, tran_id, status: "ok"\|"rejected", reason? }` |
| `heartbeat` | M → B | 0 | no | `{ v:1, fw, uptime_s, rssi, heap, stm32: { link, state, tran_id?, tank, fault }, pending_outcomes, rejected_outcomes, dropped_outcomes, ts }` |
| `error` | M → B | 1* | no | `{ v:1, fault, tran_id?, ts }` |
| `online` | M → B | 1 | **yes** | `"1"` / `"0"` (Last Will) |
| `config` | B → M | 1 | **yes** | `{ v:1, prices: { "500", "750", "1000" }, currency, enabled }` |
| `config/ack` | M → B | 1* | no | `{ v:1, status: "ok"\|"error", fault? }` |
| `ota/*` | — | — | — | **Reserved** (Phase 11) |

\* The ESP32 (PubSubClient) publishes at QoS 0; delivery is guaranteed by **application-level retries** (B4.7). The backend publishes at QoS 1 to a persistent session.

Field rules:

- `request_id`: 16 hex chars (B3). Same `(machine_id, request_id)` → status-aware resend (D5).
- `expires_at`: ISO time; the ESP32 converts it to **remaining seconds** for the STM32 (`QR` line) and drops expired QRs.
- `ts`: device Unix seconds (NTP). If `|server_now − ts| > CLOCK_SKEW_MAX_SECONDS`, the backend uses its receive time and flags `clock_skew`.
- `fault`: value from the shared fault-code list (C8).
- `transaction/ack rejected`: **permanent** — the device deletes the outcome, increments `rejected_outcomes`. The backend has already stored the outcome in `dispense_rejections`.
- **Backward compatibility:** prototype payloads (`{volume_ml}` without `v`) accepted until Phase 10.

## C3 UART contract v1 (ESP32 ↔ STM32)

Text lines, `\n`-terminated, 115200 8N1. `<fault>` values from C8.

| Message | Dir | Meaning |
|---|---|---|
| `REQ_PAY,<volume_ml>` | S → E | Customer selected a tier |
| `CANCEL` / `CANCEL,<tran_id>` | S → E | Customer pressed Cancel (without `tran_id` while waiting for the QR) |
| `QR,<tran_id>,<amount>,<currency>,<remaining_s>,<qr_string>` | E → S | Show QR (only if STM32 is waiting for a QR) |
| `PAID,<tran_id>` | E → S | Paid — repeated every 2 s until acknowledged |
| `PAID,ACK,<tran_id>` | S → E | STM32 accepted the payment and is waiting for the bottle |
| `PAID,REJECT,<tran_id>,<fault>` | S → E | STM32 cannot dispense this payment (e.g. QR no longer shown) → becomes an outcome `error` |
| `EXPIRED,<tran_id>` / `FAILED,<tran_id\|0>` / `CANCELLED,<tran_id>` | E → S | Back to idle |
| `DONE,<tran_id>,<flow_ml>,<weight_g>` | S → E | Dispense finished OK |
| `PARTIAL,<tran_id>,<flow_ml>,<weight_g>,<fault>` | S → E | Stopped early (`BOTTLE_REMOVED`, `BOTTLE_TIMEOUT`, `TANK_EMPTY`, …) |
| `ERR,<fault>[,<tran_id>]` | S → E | Fault (with `tran_id` during a payment = outcome `error`) |
| `ACK,<tran_id>` | E → S | ESP32 stored the outcome in NVS — STM32 may forget it |
| `CFG,<price_500>,<price_750>,<price_1000>,<currency>,<enabled 0\|1>` | E → S | Prices/config |
| `CFG,OK` / `CFG,ERR,<fault>` | S → E | Config applied / rejected |
| `NET,OK` / `NET,DOWN` | E → S | Network status |
| `PING` | E → S | Every 5 s |
| `PONG,<state>,<tran_id\|0>,<tank>,<fault>` | S → E | `state`: `IDLE\|WAIT_QR\|QR\|WAIT_BOTTLE\|DISPENSING\|ERROR`; `tank`: `EMPTY\|LOW\|MEDIUM\|FULL` |

**Hard safety rules for the STM32 (non-negotiable):**

1. **Autonomous cut-off:** stop the pump and close both valves on its own at target volume, sensor fault, bottle removal, **dispense timeout (60 s)** or empty tank — never waits for the ESP32.
2. **Bottle timeout:** after `PAID,ACK`, if no bottle within **60 s** → `PARTIAL,<tran_id>,0,0,BOTTLE_TIMEOUT` and return to IDLE.
3. **Dispense only for the shown QR:** `PAID,<tran_id>` is accepted only if `tran_id` equals the QR on screen, once per `tran_id`; otherwise reply `PAID,REJECT,<tran_id>,PAID_NOT_ACCEPTED` (a repeated `PAID` for an already accepted `tran_id` is answered with `PAID,ACK` again).
4. **Outcome persistence:** the STM32 keeps the last outcome (`DONE`/`PARTIAL`/`ERR` with `tran_id`) in non-volatile memory and re-sends it every 2 s until `ACK,<tran_id>` — also after a reboot.
5. **Link loss:** no `PING` for 15 s → show "Offline" when idle; during a dispense finish or stop by rule 1, then report when the link returns. (The ESP32 separately tracks missing `PONG` for its own status.)

**ESP32 mapping:** `REQ_PAY` → `pay/request` (+`request_id`); `CANCEL` → `pay/cancel` (by `tran_id`, or local cancel by `request_id` per B4.7); `DONE`/`PARTIAL`/`ERR`+`tran_id`/`PAID,REJECT` → NVS queue → `transaction` (or `error`) → `ACK,<tran_id>` to STM32 **after** writing NVS; `config` → `CFG` (retry until `CFG,OK`) → `config/ack`; `PONG` → `heartbeat.stm32`.

## C4 Domain events catalog

Stored in `outbox.payload` as `{ eventId, type, version, occurredAt, traceId, data }`.

| Event | Producer | Data | Subscribers |
|---|---|---|---|
| `payments.PaymentCreated` | Payments | tranId, machineId, requestId, volumeMl, amountMinor, currency, qrString, expiresAt | MqttNotifier (`pay/qr`), Fleet (last activity) |
| `payments.PaymentPaid` | Payments | tranId, machineId, paidAt | MqttNotifier (`pay/status paid`), Reporting |
| `payments.PaymentExpired` / `PaymentCancelled` / `PaymentFailed` | Payments | tranId, machineId, reason? | MqttNotifier, AbaCloser (close-transaction) |
| `payments.LatePaymentDetected` | Payments | tranId, machineId, foundBy (`callback`/`reconcile`) | Monitoring |
| `payments.RefundReviewOpened` | Payments | tranId, reason, suggestedAmountMinor | Monitoring, RefundExecutor (auto mode) |
| `payments.RefundClaimed` | Payments | tranId, by, until | Dashboard |
| `payments.Refunded` / `RefundRejected` / `RefundReopened` | Payments | tranId, by, amountMinor?, reason? | Reporting, Monitoring |
| `dispensing.DispenseCompleted` | Dispensing | tranId, machineId, flowMl, weightG, diffPercent | Payments (→ DISPENSED), Reporting |
| `dispensing.DispenseFailed` | Dispensing | tranId, result, flowMl, weightG, fault | Payments (→ REFUND_REVIEW) |
| `dispensing.DispenseOutcomeUnknown` | Dispensing | tranId, machineId | Payments (→ DISPENSE_UNKNOWN), Monitoring |
| `dispensing.AccuracyMismatch` | Dispensing | tranId, machineId, diffPercent | Monitoring |
| `dispensing.OutcomeRejected` | Dispensing | machineId, tranId?, code | Monitoring |
| `dispensing.ReconciliationNeeded` | Dispensing | tranId, currentStatus, lateOutcome | Monitoring |
| `fleet.MachineWentOffline` / `MachineCameOnline` | Fleet | machineId, at | Monitoring |
| `fleet.MachineConfigChanged` | Fleet | machineId, config | MqttNotifier (`config`, retained) |
| `fleet.ConfigRejected` | Fleet | machineId, fault | Monitoring |
| `monitoring.AlertRaised` / `AlertResolved` | Monitoring | alertId, type, severity, machineId | TelegramNotifier, dashboard |

Events are versioned; breaking changes add a new version and handlers support both during migration.

## C5 Queues, jobs & sweeps

**Rule:** money timing lives in PostgreSQL columns (`expires_at`, `next_aba_check_at`, `paid_at`). Repeatable sweep jobs read them; job schedulers are **upserted at every worker boot**, so a Redis loss only delays work by one sweep interval.

| Queue / job | Type | Schedule | Work | Attempts | Concurrency |
|---|---|---|---|---|---|
| `outbox.dispatch` | per event × handler | relay (250 ms poll, batch 20) | Run one handler | 10, exp 1 s → 5 min | 20 |
| `sweep.payments` | repeatable | every **3 s** | PENDING rows with `next_aba_check_at ≤ now` → enqueue `payments.aba-check`; PENDING past `expires_at + grace` → final check → PAID/EXPIRED | 3 | 1 |
| `payments.aba-check` | per payment | from sweep (`jobId = tranId:checkNo`) | `check-transaction` → Confirm / no-op; set next check (B4.8) | 3 | 10 (ABA-limited) |
| `payments.confirm` | per callback | from callback (`jobId = tranId`) | `check-transaction` → Confirm | 5 | 10 |
| `sweep.reconcile` | repeatable | every **5 min** | Terminal unpaid rows with due probe (B4.8) → `aba-check`; APPROVED → REFUND_REVIEW | 3 | 1 |
| `payments.close` | per payment | outbox handler | ABA close-transaction | 3 | 5 |
| `payments.refund-execute` | per case | **auto mode only** | ABA refund | 8, exp ≤ 10 min | 2 |
| `sweep.dispensing` | repeatable | every **30 s** | PAID past `DISPENSE_UNKNOWN_AFTER_SECONDS` → DISPENSE_UNKNOWN; DISPENSE_UNKNOWN ≥ 24 h → REFUND_REVIEW or site-check alert (C1) | 3 | 1 |
| `sweep.fleet-offline` | repeatable | every 30 s | Mark machines offline | 3 | 1 |
| `notify.telegram` | per alert | AlertRaised handler | Send message | 5 | 5 |
| `maintenance.retention` | repeatable | daily 03:00 | Delete dispatched outbox, inbox, heartbeats past retention | 3 | 1 |
| `*.dlq` | — | failed handler | Store + alert | — | — |

**ABA limiter:** shared BullMQ limiter `max 20 / 1 s` across ABA jobs (tune with ABA's answer).

## C6 Database schema

`apps/api/prisma/schema.prisma` (abridged). Every model has `createdAt DateTime @default(now()) @map("created_at")` and `updatedAt DateTime @updatedAt @map("updated_at")` (omitted below for brevity). Money in minor units (B3). Relations use `onDelete: Restrict`.

```prisma
enum PaymentStatus {
  PENDING PAID DISPENSED DISPENSE_UNKNOWN EXPIRED CANCELLED FAILED
  REFUND_REVIEW REFUNDED REFUND_REJECTED
}
enum Currency        { KHR USD }
enum DispenseResult  { ok partial error }
enum RefundReason    { LATE_PAYMENT DISPENSE_FAILED DISPENSE_PARTIAL DISPENSE_UNKNOWN }
enum RefundStatus    { open claimed refunded rejected auto_failed }
enum AlertSeverity   { info warning critical }
enum AlertStatus     { active acknowledged resolved }

model Machine {
  id               String    @id                   // "WRM-001"
  name             String
  location         String?
  enabled          Boolean   @default(true)
  currency         Currency  @default(USD)
  firmware         String?
  mqttUsername     String    @unique @map("mqtt_username")
  lastSeenAt       DateTime? @map("last_seen_at")
  online           Boolean   @default(false)
  lastStm32State   String?   @map("last_stm32_state")
  pendingOutcomes  Int       @default(0) @map("pending_outcomes")
  version          Int       @default(0)           // optimistic lock; row also used for per-machine FOR UPDATE
  prices           MachinePrice[]
  payments         Payment[]
  @@map("machines")
}

model MachinePrice {
  machineId   String  @map("machine_id")
  volumeMl    Int     @map("volume_ml")           // 500 | 750 | 1000 (CHECK constraint)
  amountMinor Int     @map("amount_minor")
  machine     Machine @relation(fields: [machineId], references: [id], onDelete: Restrict)
  @@id([machineId, volumeMl])
  @@map("machine_prices")
}

model Payment {
  tranId              String        @id @map("tran_id")
  machineId           String        @map("machine_id")
  requestId           String        @map("request_id")
  volumeMl            Int           @map("volume_ml")
  amountMinor         Int           @map("amount_minor")
  currency            Currency
  status              PaymentStatus
  qrString            String        @map("qr_string")
  expiresAt           DateTime      @map("expires_at")
  paidAt              DateTime?     @map("paid_at")
  abaApv              String?       @map("aba_apv")
  nextAbaCheckAt      DateTime?     @map("next_aba_check_at")
  abaCheckCount       Int           @default(0) @map("aba_check_count")
  lastAbaCheckAt      DateTime?     @map("last_aba_check_at")
  closedAt            DateTime?     @map("closed_at")          // ABA close-transaction done
  refundedAmountMinor Int?          @map("refunded_amount_minor")
  refundedAt          DateTime?     @map("refunded_at")
  version             Int           @default(0)
  machine             Machine       @relation(fields: [machineId], references: [id], onDelete: Restrict)
  events              PaymentEvent[]
  dispense            Dispense?
  refundCase          RefundCase?
  @@unique([machineId, requestId])                              // pay/request idempotency
  @@index([status, nextAbaCheckAt])                             // sweeps
  @@index([status, paidAt])
  @@index([machineId, createdAt])
  @@map("payments")
}
// raw SQL migrations:
//   CREATE UNIQUE INDEX one_open_payment_per_machine ON payments(machine_id) WHERE status IN ('PENDING','PAID');
//   ALTER TABLE machine_prices ADD CONSTRAINT tier_check CHECK (volume_ml IN (500,750,1000));

model PaymentEvent {
  id         String         @id @default(uuid())
  tranId     String         @map("tran_id")
  fromStatus PaymentStatus? @map("from_status")
  toStatus   PaymentStatus  @map("to_status")
  reason     String?
  actorId    String?        @map("actor_id")
  at         DateTime       @default(now())
  payment    Payment        @relation(fields: [tranId], references: [tranId], onDelete: Restrict)
  @@index([tranId])
  @@map("payment_events")
}

model Dispense {
  tranId      String         @id @map("tran_id")
  machineId   String         @map("machine_id")
  result      DispenseResult
  flowMl      Int            @map("flow_ml")
  weightG     Int            @map("weight_g")
  diffPercent Decimal        @map("diff_percent") @db.Decimal(5, 2)
  fault       String?
  occurredAt  DateTime       @map("occurred_at")        // device ts, or receive time if skewed
  receivedAt  DateTime       @default(now()) @map("received_at")
  clockSkew   Boolean        @default(false) @map("clock_skew")
  late        Boolean        @default(false)
  payment     Payment        @relation(fields: [tranId], references: [tranId], onDelete: Restrict)
  @@index([machineId, occurredAt])
  @@map("dispenses")
}

model DispenseRejection {                                  // outcomes that could not be applied
  id         String   @id @default(uuid())
  machineId  String   @map("machine_id")
  tranId     String?  @map("tran_id")
  code       String                                       // DSP_UNKNOWN_PAYMENT | DSP_NOT_PAID | DSP_WRONG_MACHINE | DSP_MALFORMED
  raw        Json
  receivedAt DateTime @default(now()) @map("received_at")
  @@index([machineId, receivedAt])
  @@map("dispense_rejections")
}

model RefundCase {
  tranId               String        @id @map("tran_id")
  reason               RefundReason
  suggestedAmountMinor Int           @map("suggested_amount_minor")
  refundedAmountMinor  Int?          @map("refunded_amount_minor")
  status               RefundStatus  @default(open)
  claimedBy            String?       @map("claimed_by")
  claimedUntil         DateTime?     @map("claimed_until")
  method               String?                          // aba_portal | aba_api | cash
  reference            String?       @unique            // ABA refund ref / receipt no.
  decidedBy            String?       @map("decided_by")
  decidedAt            DateTime?     @map("decided_at")
  decisionReason       String?       @map("decision_reason")
  attempts             Int           @default(0)
  lastError            String?       @map("last_error")
  payment              Payment       @relation(fields: [tranId], references: [tranId], onDelete: Restrict)
  @@index([status, createdAt])
  @@map("refund_cases")
}

model Outbox {
  id            String    @id                       // UUIDv7 = event id
  aggregateType String    @map("aggregate_type")
  aggregateId   String    @map("aggregate_id")
  eventType     String    @map("event_type")
  payload       Json
  occurredAt    DateTime  @map("occurred_at")
  dispatchedAt  DateTime? @map("dispatched_at")       // enqueued to BullMQ (handlers retry independently)
  attempts      Int       @default(0)
  lastError     String?   @map("last_error")
  deadAt        DateTime? @map("dead_at")
  @@map("outbox")
}
// raw SQL:
//   CREATE INDEX outbox_pending ON outbox (occurred_at) WHERE dispatched_at IS NULL AND dead_at IS NULL;
//   CREATE INDEX outbox_dispatched ON outbox (dispatched_at) WHERE dispatched_at IS NOT NULL;

model Inbox {
  messageId  String   @id @map("message_id")
  source     String
  receivedAt DateTime @default(now()) @map("received_at")
  @@index([receivedAt])
  @@map("inbox")
}

model Heartbeat {
  id        BigInt   @id @default(autoincrement())
  machineId String   @map("machine_id")
  data      Json
  at        DateTime @default(now())
  @@index([machineId, at])
  @@index([at])
  @@map("heartbeats")
}

model Alert {
  id         String        @id @default(uuid())
  machineId  String?       @map("machine_id")
  type       String
  severity   AlertSeverity
  message    String
  status     AlertStatus   @default(active)
  resolvedBy String?       @map("resolved_by")
  dedupeKey  String        @map("dedupe_key")
  @@index([status, dedupeKey])
  @@index([machineId, createdAt])
  @@map("alerts")
}

model AuditLog {
  id         String   @id @default(uuid())
  actorId    String   @map("actor_id")
  action     String                                  // price.update, refund.claim, refund.mark_refunded, …
  entityType String   @map("entity_type")
  entityId   String   @map("entity_id")
  before     Json?
  after      Json?
  reason     String?
  at         DateTime @default(now())
  @@index([entityType, entityId])
  @@index([at])
  @@map("audit_logs")
}
// + auth tables (Better Auth or fallback) with role field
```

**Migration rules:** expand → migrate → contract; reviewed; never edit applied migrations; run with `DIRECT_DATABASE_URL`; seed `WRM-001` (USD) and `WRM-900` (KHR) for local/staging only.

## C7 REST API

Base `/v1`. Responses `{ data }` / `{ error: { code, message, details?, traceId } }`; cursor pagination (max 100). Until Phase 6, operator/admin endpoints exist **only** with `APP_ENV=local`.

| Method & path | Role | Purpose | Phase |
|---|---|---|---|
| `GET /health/live`, `/health/ready` | none | Liveness / readiness | 1 |
| `POST /v1/payway/callback` | none; limit `CALLBACK_RATE_LIMIT_PER_MIN`/IP | Enqueue `payments.confirm`; always 200 | 2 |
| `GET /v1/payments/:tranId` | operator | Detail + timeline | 2 |
| `POST /v1/dev/payments/:tranId/simulate-paid` | local only | Mock payment | 2 |
| `GET /v1/refund-cases?status=` | operator | Refund queue (with machine `pending_outcomes`, last STM32 state) | 3 |
| `POST /v1/refund-cases/:tranId/claim` | admin | Atomic claim for `REFUND_CLAIM_MINUTES` | 3 |
| `POST /v1/refund-cases/:tranId/mark-refunded` | admin (claimant) | Method, unique reference, amount | 3 |
| `POST /v1/refund-cases/:tranId/reject` | admin | Reason required | 3 |
| `POST /v1/refund-cases/:tranId/reopen` | admin | Reason required | 3 |
| `POST /v1/payments/:tranId/resolve-unknown` | admin | Decide DISPENSE_UNKNOWN (blocked while `pending_outcomes > 0` unless override reason) | 3 |
| `POST /v1/machines` | admin | Provision: row + default prices + MQTT username + **one-time password** | 4 |
| `GET /v1/machines`, `/v1/machines/:id` | viewer | Fleet | 4 |
| `PATCH /v1/machines/:id` | admin | Enable/disable, name, location | 4 |
| `PUT /v1/machines/:id/prices` | admin | Prices for 500/750/1000 (audit) | 4 |
| `POST /v1/machines/:id/rotate-credentials` / `decommission` | admin | Credential rotation / retire | 4 |
| `GET /v1/alerts`, `POST /v1/alerts/:id/ack`, `/resolve` | operator | Alerts | 5 |
| `/v1/auth/*`, `GET/POST/PATCH /v1/users` | — / admin | Auth, users | 6 |
| `GET /v1/reports/sales?from&to&machineId&groupBy` | viewer | Gross, refunds, **net** | 7 |
| `GET /v1/reports/machines/status` | viewer | Live fleet | 7 |
| `GET /metrics` | internal only | Prometheus | 8 |

## C8 Fault codes (shared list)

Defined once in `packages/contracts/src/faults.ts` and generated into the firmware header (C9). Used by `ERR`, `PARTIAL`, `CFG,ERR`, `PONG`, `transaction.fault`, `error.fault` and Monitoring rules.

| Code | Meaning | Severity |
|---|---|---|
| `NONE` | No fault (`PONG` field `0` = `NONE`) | — |
| `TANK_EMPTY` / `TANK_LOW` | Float sensors | critical / warning |
| `NO_FLOW` | Pump on, no flow pulses | critical |
| `OVERFLOW` | Volume > target + 10 % | critical |
| `BOTTLE_REMOVED` | Weight dropped during dispense | warning |
| `BOTTLE_TIMEOUT` | No bottle within 60 s after `PAID,ACK` | info |
| `DISPENSE_TIMEOUT` | Dispense exceeded 60 s | critical |
| `LOADCELL_FAULT` / `FLOW_SENSOR_FAULT` | Sensor not responding / erratic | critical |
| `VALVE_FAULT` / `PUMP_FAULT` | Actuator failure | critical |
| `PAID_NOT_ACCEPTED` | `PAID` for a QR no longer shown | warning |
| `POWER_LOSS_RECOVERY` | Reboot during a dispense | warning |
| `CFG_INVALID` | Config line rejected | warning |
| `UNKNOWN` | Anything else (with log) | warning |

## C9 Firmware contract generation

`packages/contracts` generates `generated/wrm_contract.h` (topic names, payload keys, fault codes, UART keywords) and a set of **golden fixtures** (sample MQTT payloads and UART lines). CI runs a host-side C unit test of the ESP32 parser against the fixtures; the STM32 developer uses the same header and fixtures.

---

## C10 ABA PayWay API reference

Everything needed to call ABA PayWay. This was proven against the sandbox by the prototype (`backend/src/payway.js`), which is deleted after Phase 3, so **this section is the reference**. Official docs: [generate QR](https://developer.payway.com.kh/qr-api-14530840e0) · [check transaction](https://developer.payway.com.kh/check-transaction-14530826e0).

### C10.1 Basics

| Item | Value |
|---|---|
| Sandbox base URL | `https://checkout-sandbox.payway.com.kh` |
| Live base URL | Given by ABA with the live account (`PAYWAY_BASE_URL`) |
| Method / body | `POST`, `Content-Type: application/json` |
| Credentials | `PAYWAY_MERCHANT_ID` (e.g. `ec480065` in sandbox) and `PAYWAY_API_KEY` (secret, never logged) |
| `req_time` | UTC, format `YYYYMMDDHHmmss` (e.g. `20261108093015`) |
| Signature (`hash`) | **Base64( HMAC-SHA512( concatenated fields, PAYWAY_API_KEY ) )** |
| Live requirement | Server's **static public IP must be whitelisted** by ABA |
| Sandbox currency | **USD only** (KHR returned code `12`, currency not allowed) |
| Timeout | 8 s per call (D7), circuit breaker |

```ts
const hash = createHmac('sha512', apiKey).update(message, 'utf8').digest('base64');
```

### C10.2 Generate QR: `POST /api/payment-gateway/v1/payments/generate-qr`

Fields, **in hash order** (the order is fixed by ABA; do not change it):

| # | Field | Value we send |
|---|---|---|
| 1 | `req_time` | Current UTC time (C10.1) |
| 2 | `merchant_id` | `PAYWAY_MERCHANT_ID` |
| 3 | `tran_id` | From `TranIdGenerator` (≤ 20 chars, B3) |
| 4 | `amount` | Major units: USD `0.15`, KHR `500` (converted from `Money`, B3) |
| 5 | `items` | `""` |
| 6 | `first_name` | `""` |
| 7 | `last_name` | `""` |
| 8 | `email` | `""` |
| 9 | `phone` | `""` |
| 10 | `purchase_type` | `purchase` |
| 11 | `payment_option` | `abapay_khqr` |
| 12 | `callback_url` | **Base64** of `PAYWAY_CALLBACK_URL`, or `""` |
| 13 | `return_deeplink` | `""` |
| 14 | `currency` | `USD` or `KHR` |
| 15 | `custom_fields` | `""` |
| 16 | `return_params` | `""` |
| 17 | `payout` | `""` |
| 18 | `lifetime` | `PAYMENT_TTL_MINUTES`, **minutes, minimum 3** |
| 19 | `qr_image_template` | `template3_color` |

**Rules:**
1. `message` = values of fields 1–19 converted to strings and joined **with no separator**, in the order above. **Empty fields are included as `""`.**
2. The JSON body contains **only the non-empty fields** plus `hash`. ABA validation can fail on empty optional strings.
3. Success when `status.code` = `0`. Use `qrString` (raw KHQR text, ~240 chars; this is what goes to the machine). `qrImage` and `abapay_deeplink` are ignored.
4. Other codes → mapping in **D7** (`403` = duplicate `tran_id` → regenerate).

**Example** (sandbox, USD 0.15, no callback; `hash` shortened):

```text
message = "20261108093015" + "ec480065" + "m3k9x2a1123456" + "0.15" + "" + "" + "" + "" + ""
        + "purchase" + "abapay_khqr" + "" + "" + "USD" + "" + "" + "" + "3" + "template3_color"
```
```json
{
  "req_time": "20261108093015",
  "merchant_id": "ec480065",
  "tran_id": "m3k9x2a1123456",
  "amount": 0.15,
  "purchase_type": "purchase",
  "payment_option": "abapay_khqr",
  "currency": "USD",
  "lifetime": 3,
  "qr_image_template": "template3_color",
  "hash": "q8Zx…=="
}
```
Response (success): `{ "status": { "code": "0", "message": "…" }, "qrString": "000201010212…", "qrImage": "data:image/png;base64,…", "abapay_deeplink": "…" }`

### C10.3 Check transaction: `POST /api/payment-gateway/v1/payments/check-transaction-2`

| Field | Value |
|---|---|
| `req_time` | Current UTC time |
| `merchant_id` | `PAYWAY_MERCHANT_ID` |
| `tran_id` | The payment's `tran_id` |
| `hash` | Base64(HMAC-SHA512(`req_time + merchant_id + tran_id`, key)) |

Response: `{ "status": { "code": "00", … }, "data": { "payment_status_code": 0, "payment_status": "APPROVED", … } }`

| `status.code` | `payment_status_code` | Meaning → `GatewayStatus` |
|---|---|---|
| `00` / `0` | `0` | APPROVED → `approved` |
| `00` / `0` | `2` | PENDING → `pending` |
| `00` / `0` | `3` / `7` | DECLINED / CANCELLED → `declined` |
| `00` / `0` | `4` | REFUNDED → `refunded` |
| `6` | — | Not found → `not_found` (**= not paid yet**, pending until expiry + grace, B4.8) |

Only works for transactions **created in the last 7 days** (hence the reconcile schedule ending at +6 d, B4.8). Polling schedule: B4.8. Other codes: D7.

### C10.4 Callback (pushback): `POST /v1/payway/callback`

- ABA calls the URL given (Base64) in `callback_url` when a payment happens. The body contains `tran_id`.
- **Never trust the body.** Read only `tran_id`, enqueue `payments.confirm`, and **always answer HTTP 200** (also for unknown, duplicate or malformed bodies). The job confirms the payment with **check-transaction (C10.3)**.
- Callbacks can be lost. Sweeps and reconcile (B4.8) must work with the callback endpoint disabled (Phase 2 DoD).

### C10.5 Not yet confirmed by ABA (see F3)

Close-transaction, KHQR refund API, callback retry policy and source IPs, rate limits, KHR on the live account. Record the answers in **ADR-0009** and update this section.

---

# Part D — Core code patterns

### D1 Aggregate base & domain event

```ts
export interface DomainEvent<T = unknown> {
  readonly eventId: string; readonly type: string; readonly version: number;
  readonly occurredAt: Date; readonly data: T;
}

export abstract class AggregateRoot {
  private pending: DomainEvent[] = [];
  protected constructor(protected _version: number) {}
  get version() { return this._version; }
  protected raise(e: DomainEvent) { this.pending.push(e); }
  pullEvents(): DomainEvent[] { const e = this.pending; this.pending = []; return e; }
}
```

### D2 Payment aggregate — `markPaid` (idempotent for every state)

```ts
markPaid(clock: Clock, grace: Duration, abaApv: string, foundBy: 'callback' | 'sweep' | 'reconcile') {
  switch (this.status) {
    case 'PAID': case 'DISPENSED': case 'DISPENSE_UNKNOWN':
    case 'REFUND_REVIEW': case 'REFUNDED': case 'REFUND_REJECTED':
      return;                                                     // already handled — repeat callbacks are harmless
    case 'EXPIRED': case 'CANCELLED': case 'FAILED':
      // Late payment: never dispense — the customer may have left.
      this.transition('REFUND_REVIEW', `late payment (${foundBy})`);
      this.raise(event('payments.LatePaymentDetected', { tranId: this.tranId.value, foundBy }, clock));
      this.raise(event('payments.RefundReviewOpened',
        { tranId: this.tranId.value, reason: 'LATE_PAYMENT', suggestedAmountMinor: this.price.amountMinor }, clock));
      return;
    case 'PENDING':
      if (clock.now() > this.expiresAt.plus(grace)) {             // treated like late payment
        this.transition('EXPIRED', 'approved after grace');
        return this.markPaid(clock, grace, abaApv, foundBy);
      }
      this.transition('PAID', `aba approved (${foundBy})`);
      this.paidAt = clock.now();
      this.abaApv = abaApv;
      this.nextAbaCheckAt = undefined;
      this.raise(event('payments.PaymentPaid', { tranId: this.tranId.value, machineId: this.machineId.value }, clock));
  }
}
```

### D3 Command handler (transaction + outbox + optimistic lock)

```ts
@CommandHandler(ConfirmPaymentCommand)
export class ConfirmPaymentHandler {
  async execute(cmd: ConfirmPaymentCommand): Promise<void> {
    await this.uow.run(async (tx) => {
      const payment = await this.repo.get(cmd.tranId, tx);
      payment.markPaid(this.clock, this.cfg.grace, cmd.abaApv, cmd.foundBy);
      await this.repo.save(payment, tx);                    // WHERE version = ? → ConflictError
      await this.uow.outbox.add(payment.pullEvents(), tx);  // same transaction
    }, { retryOn: ConflictError, attempts: 3 });
  }
}
```

### D4 Outbox relay (worker)

```ts
// Poll every 250 ms; batch 20 keeps row locks and the transaction short.
await prisma.$transaction(async (tx) => {
  const rows = await tx.$queryRaw<OutboxRow[]>`
    SELECT * FROM outbox
    WHERE dispatched_at IS NULL AND dead_at IS NULL
    ORDER BY occurred_at
    FOR UPDATE SKIP LOCKED
    LIMIT 20`;                                         // partial index outbox_pending
  for (const row of rows) {
    for (const handler of registry.handlersFor(row.event_type)) {
      await queues.outboxDispatch.add(handler.name, { eventId: row.id, handler: handler.name },
                                      { jobId: `${row.id}:${handler.name}` });   // idempotent enqueue
    }
  }
  await tx.$executeRaw`UPDATE outbox SET dispatched_at = now() WHERE id = ANY(${rows.map(r => r.id)})`;
});
```

`dispatched_at` means "handed to BullMQ"; each handler job retries independently. If the process dies after enqueue but before commit, the rows are re-enqueued and the `jobId` dedupes them. No `LISTEN/NOTIFY` (incompatible with poolers; polling is enough at this scale). The outbox stays because BullMQ cannot commit in the same transaction as PostgreSQL.

### D5 `pay/request` — rate limit, status-aware resend, atomic supersede

```ts
@MqttSubscribe('$share/backend/wrm/+/pay/request')
async onPayRequest(@MqttTopicParam(1) machineId: string, @MqttPayload() raw: Buffer) {
  const msg = PayRequestV1.safeParse(parseJson(raw));
  if (!msg.success) return this.replyFailed(machineId, null, 'VALIDATION_FAILED');
  if (!(await this.limiter.consume(`pay:${machineId}`))) {             // Redis token bucket, all instances
    this.metrics.throttled.inc();
    return this.replyFailed(machineId, msg.data.request_id, 'RATE_LIMITED');
  }
  try {
    await this.commands.execute(new CreatePaymentCommand(machineId, msg.data.request_id, msg.data.volume_ml));
  } catch (err) {
    this.replyFailed(machineId, msg.data.request_id, toErrorCode(err));
  }
}

// CreatePaymentHandler
async execute(cmd: CreatePaymentCommand) {
  const existing = await this.repo.findByRequest(cmd.machineId, cmd.requestId);
  if (existing) return this.replayResponse(existing);                  // see table below

  const machine = await this.machines.getForPayment(cmd.machineId);    // NOT_FOUND / DISABLED
  const price = machine.priceFor(Volume.of(cmd.volumeMl));             // PAY_INVALID_VOLUME
  for (let attempt = 1; ; attempt++) {
    const payment = Payment.create(machine.id, cmd.requestId, price, this.tranIds.next(), this.clock, this.cfg.ttl);
    let qr: string;
    try {
      qr = (await this.gateway.createQr(payment.toGatewayInput())).qrString;   // outside DB tx
    } catch (e) {
      if (e instanceof DuplicateTranIdError && attempt < 3) continue;    // ABA 403 → new tran_id
      throw e;
    }
    payment.attachQr(qr);
    try {
      await this.uow.run(async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM machines WHERE id = ${machine.id} FOR UPDATE`;   // serialize per machine
        if (await this.repo.hasPaidOpen(machine.id, tx)) throw new DomainError('PAY_MACHINE_BUSY');
        const superseded = await this.repo.cancelPendingForMachine(machine.id, 'SUPERSEDED', tx);
        await this.repo.insert(payment, tx);
        await this.uow.outbox.add([...superseded.flatMap((p) => p.pullEvents()), ...payment.pullEvents()], tx);
      }, { retryOn: ConflictError, attempts: 3 });
      return;
    } catch (err) {
      if (isUniqueViolation(err, 'payments_machine_id_request_id_key')) {           // duplicate won the race
        return this.replayResponse(await this.repo.findByRequest(cmd.machineId, cmd.requestId));
      }
      if (isUniqueViolation(err, 'payments_pkey') && attempt < 3) continue;         // tran_id collision
      throw err;                         // the ABA QR is unused: it expires; reconcile never sees it (no row) — see F3 Q2
    }
  }
}
```

**Status-aware replay** (`replayResponse`) for a repeated `(machine_id, request_id)`:

| Existing payment | Response |
|---|---|
| PENDING and `now < expires_at` | Re-publish `pay/qr` (same QR, current `expires_at`) |
| PENDING and expired | Run `ExpirePayment` (with final ABA check) → resulting `pay/status` |
| PAID / DISPENSED / DISPENSE_UNKNOWN | `pay/status paid` |
| EXPIRED / CANCELLED / FAILED / REFUND_* | `pay/status` with that terminal status |

**Unused ABA QR risk:** a QR created at ABA whose DB insert then fails has no payment row. The customer cannot see it (it is never published), so it cannot be paid in practice; ABA is asked whether an unregistered `tran_id` can be closed (F3 Q1).

### D6 `transaction` / `error` consumer — outcome with acknowledgement

```ts
@MqttSubscribe('$share/backend/wrm/+/transaction')
async onTransaction(@MqttTopicParam(1) machineId: string, @MqttPayload() raw: Buffer) {
  const json = parseJsonSafe(raw);
  const msg = TransactionV1.safeParse(json);
  if (!msg.success) {
    const tranId = typeof json?.tran_id === 'string' ? json.tran_id : undefined;
    await this.rejections.record(machineId, tranId, 'DSP_MALFORMED', json);       // persist first
    if (tranId) this.ack(machineId, tranId, 'rejected', 'DSP_MALFORMED');
    return;
  }
  try {
    await this.commands.execute(new RecordDispenseCommand(machineId, msg.data));  // idempotent on tran_id
    this.ack(machineId, msg.data.tran_id, 'ok');                                  // after commit
  } catch (err) {
    const code = toErrorCode(err);
    if (['DSP_NOT_PAID', 'DSP_WRONG_MACHINE', 'DSP_UNKNOWN_PAYMENT'].includes(code)) {
      await this.rejections.record(machineId, msg.data.tran_id, code, msg.data);
      return this.ack(machineId, msg.data.tran_id, 'rejected', code);            // permanent
    }
    // infrastructure error: no ack → device retries with backoff (B4.7)
  }
}
```

`error` messages with a `tran_id` are converted to `RecordDispense(result='error', flow_ml=0, fault)` by the same handler path; without `tran_id` they go to Monitoring only.

### D7 PayWay adapter — per-operation code mapping

```ts
export interface PaymentGateway {
  createQr(input: CreateQrInput): Promise<{ qrString: string }>;
  checkTransaction(tranId: TranId): Promise<GatewayStatus>;   // approved | pending | declined | refunded | not_found
  closeTransaction(tranId: TranId): Promise<void>;
  refund(tranId: TranId, amount: Money): Promise<void>;       // REFUND_MODE=auto only
}
```

| Operation | ABA `status.code` | Mapping |
|---|---|---|
| `generate-qr` | `0` | Success |
|  | `403` (duplicated transaction ID) | `DuplicateTranIdError` → regenerate `tran_id` |
|  | `8` (something went wrong), `429` | `GatewayUnavailableError` |
|  | `1`, `6`, `12`, `16`–`19`, `21`, `23`, `32`, `35`, `44`, `47`, `48`, `96`, `102` | `GatewayRejectedError` (config/merchant problem → alert) |
| `check-transaction-2` | `00` / `0` + `payment_status_code` `0` | `approved` |
|  | `00` + `2` | `pending` |
|  | `00` + `3` / `7` | `declined` |
|  | `00` + `4` | `refunded` |
|  | **`6` (transaction not found)** | **`not_found`** (= pending until expiry + grace, B4.8) |
|  | `11`, `429` | `GatewayUnavailableError` |
|  | `5` (invalid hash), `8` (invalid merchant profile) | `GatewayRejectedError` (alert) |

Request formats and signing: **C10**. Codes come from the PayWay docs used by the prototype; each is verified with a recorded sandbox response and documented in **ADR-0009** (with close-transaction and refund once ABA answers). One contract test per code per operation. The adapter also converts `Money` to ABA major units, applies an 8 s timeout and the opossum breaker, and records metrics.

---

# Part E — Phases

| # | Phase | Main result | Est. |
|---|---|---|---|
| 0 | Foundations | Monorepo, tooling, CI, local infra, ADRs | 1 wk |
| 1 | Platform | Config, logging, errors, DB, outbox, sweeps framework, MQTT, queues, rate limiter, health | 2 wk |
| 2 | Payments | Payment aggregate, PayWay adapter, sweeps, reconcile, **minimal outcome recording**, cut-over | 3 wk |
| 3 | Dispensing & refund review | Full outcome handling, UART/NVS acks (firmware), refund cases with claim | 2 wk |
| 3.5 | Early pilot | Minimal production deployment, 1 machine, pilot runs in parallel | 1 wk (+ pilot) |
| 4 | Fleet | Provisioning, prices, `CFG`, online/offline | 1 wk |
| 5 | Monitoring | Alerts (fault codes), dedupe, Telegram | 1 wk |
| 6 | Identity | Auth spike + implementation, RBAC, audit log | 1 wk |
| 7 | Reporting & dashboard | Net revenue views, dashboard incl. refund queue | 2 wk |
| 8 | Observability | Traces, metrics, dashboards, alerts | 1 wk |
| 9 | Production deployment | Full production layout, CI/CD, backups | 2 wk |
| 10 | Hardening | Load/chaos/security; go-live decision with pilot data | 2 wk |
| 11 | OTA (post go-live) | ESP32 + STM32 remote updates | 2 wk |

---

## Phase 0 — Foundations

**Goal:** an empty but production-shaped monorepo where CI enforces every rule from day one.
**Implements:** Architecture §15–16; Deployment §4 (CI); Plan B1–B3, B8.
**Needs before starting:** Node.js 22, pnpm, Docker Desktop running, Git access to the repo.
**Read before starting:** `CLAUDE.md`, `docs/PROGRESS.md`; Architecture §15–16; Deployment §4; Plan B1–B3, B8; current `backend/README.md` and `esp32-gateway/README.md` (paths to move).

**Tasks**
1. Restructure: `backend/` → `backend-prototype/`, `esp32-gateway/` → `firmware/esp32-gateway/`; update READMEs/paths.
2. pnpm workspace + Turborepo; `packages/tsconfig`, `packages/contracts` (empty), `.nvmrc`; re-check and pin versions.
3. `apps/api`: NestJS 11 + Fastify; `main.ts` booting by `RUN_MODE`.
4. ESLint strict, Prettier, dependency-cruiser (4-layer core, 2-layer supporting, context isolation).
5. Vitest + SWC; sample unit test; Testcontainers smoke test.
6. `infra/docker-compose.yml`: postgres 16, redis 7, mosquitto 2 (password + ACL).
7. `ci.yml`: install → lint → typecheck → depcruise → unit → integration → build.
8. `[HUMAN]` Branch protection on `main` (GitHub settings).
9. ADRs: `0001-modular-monolith`, `0002-ddd-core-only-hexagonal`, `0003-transactional-outbox`, `0004-postgres-prisma-only`, `0005-bullmq-and-db-driven-sweeps`, `0006-error-handling-and-idempotency`, `0007-payment-state-machine` (C1 + system invariants A8), `0008-refund-policy-and-mode`, `0011-no-pgbouncer-at-start`.
10. `[HUMAN]` Send the **ABA question list** (F3) to ABA integration support; send **C3 + C8** to the STM32 developer for acceptance. (Agent: prepare the message text.)
11. Update every path changed by task 1: `README.md`, `HANDOFF.md`, `CLAUDE.md`, firmware README, flash command.

**Definition of Done**
- [ ] Clean clone: `pnpm i && pnpm build && pnpm test` passes
- [ ] Local compose starts postgres, redis, mosquitto
- [ ] A deliberate cross-layer import fails CI
- [ ] ADRs merged
- [ ] `[MANUAL CHECK]` ABA questions sent; STM32 developer confirmed C3 rules (or changes merged into C3)
- [ ] Prototype still runs from `backend-prototype/`
- [ ] `PROGRESS.md` updated with handoff note

---

## Phase 1 — Platform

**Goal:** reusable building blocks; no business logic.
**Implements:** Architecture §8, §13 (logs); Plan B4–B6, C5 (framework), C6 (Outbox, Inbox, Heartbeat), D1, D3, D4.
**Needs before starting:** Phase 0 done; Docker running (Testcontainers, local compose). No external accounts (local mosquitto replaces EMQX).
**Read before starting:** Phase 0 handoff note; Architecture §8, §13; Plan B4–B6, C5, C6 (Outbox, Inbox, Heartbeat), D1, D3, D4; `infra/docker-compose.yml`.

**Tasks**
1. **Config:** Zod schema for B5; fail fast; `RUN_MODE`.
2. **Logging:** `nestjs-pino`, trace IDs, redaction.
3. **Errors:** taxonomy + codes (`packages/contracts`); REST filter; `toErrorCode`.
4. **Shared kernel:** `AggregateRoot`, `DomainEvent`, `Clock`/`FakeClock`, UUIDv7, `Money`, `TranIdGenerator`.
5. **Database:** Prisma with `connection_limit`, `directUrl`; `UnitOfWork` (interactive tx + conflict retry); Prisma error mapping (`P2002` with constraint name → `ConflictError`, `P2025` → `NotFoundError`, connection → `InfrastructureError`).
6. **Outbox:** table + partial indexes + writer + relay (D4) + dispatch queue + handler registry + `dead_at`.
7. **Inbox:** `InboxService.record(messageId, source, tx)` (transaction argument required by type).
8. **Sweeps framework:** repeatable job schedulers **upserted at worker boot**; sweep base class (batch, skip-on-error, metrics).
9. **MQTT platform:** TLS/CA, reconnect, `@MqttSubscribe` (shared subscriptions), publish with QoS and **MQTT 5 message expiry**, metrics, graceful shutdown.
10. **Queues:** BullMQ module, defaults (C5), DLQ, graceful shutdown; `maintenance.retention`.
11. **Rate limiter:** Redis-backed (`rate-limiter-flexible`), injectable per key.
12. **Health:** `/health/live`, `/health/ready` (DB, Redis, MQTT). **Telemetry:** OpenTelemetry + Sentry init.

**Tests:** unit (errors, config, `Money` KHR/USD conversion, `TranIdGenerator` length/uniqueness); integration (UoW rollback removes outbox and inbox rows; two relays never double-dispatch; crash after enqueue before commit → no duplicate handler run thanks to `jobId`; sweep schedulers recreated after `FLUSHALL`; retention deletes only old dispatched rows); E2E smoke (event → outbox → MQTT).

**Definition of Done**
- [ ] Worker killed mid-dispatch → each event handled once per handler after restart
- [ ] `FLUSHALL` on Redis → sweeps resume within one interval
- [ ] `/health/ready` accurate; logs carry `traceId`; secrets redacted
- [ ] `RUN_MODE=all` runs API + worker in one process
- [ ] `PROGRESS.md` updated with handoff note

---

## Phase 2 — Payments (+ minimal outcome recording, cut-over)

**Goal:** full payment lifecycle on the new backend, including late-payment detection; dispense outcomes recorded and acknowledged; prototype retired.
**Implements:** Architecture §4, §6, §7, §9, §10.3–10.4, §17 (Pay, Confirm, Expiry, Reconcile); Plan C1 (payment part), C2, C4, C5, C6, C7, D2, D3, D5, D6 (minimal), D7.
**Needs before starting:** Phase 1 done; ABA sandbox keys in `apps/api/.env` (ask the backend owner — never commit); EMQX test user for the backend; for the cut-over, a person with the ESP32 board and the ABA simulator app.
**Read before starting:** Phase 1 handoff note; Architecture §4, §6, §7, §9, §10.3–10.4, §17; Plan C1, C2, C4–C7, **C10**, D2, D3, D5–D7; `backend-prototype/src/payway.js`, `backend-prototype/src/mqtt.js`, `backend-prototype/test/mqtt-flow.test.js`; `firmware/esp32-gateway/src/main.cpp` + README.

**Tasks**
1. **Contracts:** `pay/request`, `pay/cancel`, `pay/qr`, `pay/status`, `transaction`, `transaction/ack` (+ legacy payload).
2. **Domain:** `Payment` per C1 (payment part + late payment); value objects; events; ports (`PaymentRepository`, `PaymentGateway`, `MachinePort` temporary).
3. **Application:** `CreatePayment` (D5), `ConfirmPayment`, `ExpirePayment`, `CancelPayment` (by `tran_id` or `request_id`), `FailPayment`, `ProbePayment` (reconcile); sweep logic `sweep.payments`, `sweep.reconcile` (B4.8).
4. **Infrastructure:** Prisma repositories (`payment_events`, optimistic lock, `cancelPendingForMachine`, `hasPaidOpen`); PayWay gateway with **per-operation mapping (D7)**; mock gateway.
5. **Interface:** consumers `pay/request` (rate-limited), `pay/cancel`; outbox handlers → `pay/qr`, `pay/status` (with message expiry), `payments.close`; jobs `payments.aba-check`, `payments.confirm`; REST callback (queued, always 200), `GET /v1/payments/:tranId`, dev simulate.
6. **Minimal outcome recording:** `transaction` consumer that stores `dispenses`, moves PAID → DISPENSED for `ok`, stores others as pending review data, sends `transaction/ack` (full rules in Phase 3).
7. **Migrations:** machines (incl. `mqtt_username`), machine_prices (+ tier CHECK), payments (+ `one_open_payment_per_machine`), payment_events, dispenses, dispense_rejections, refund_cases; seed WRM-001 / WRM-900.
8. **ABA verification** (needs sandbox keys): record sandbox responses for every D7 code; ADR-0009 (codes, lifetime minutes, close-transaction, duplicate `tran_id`).
9. **ESP32 firmware v0.3** (agent writes code + host tests; `[HUMAN]` flashes the board): `request_id` (hardware RNG) + `v:1`; device retry policy for `pay/request` (B4.7); local cancel + discard stale/foreign `pay/qr`; send remaining seconds in `QR`; `CANCEL`/`CANCELLED`; publish `transaction` from `DONE` with `ts`, wait for `transaction/ack` (NVS queue completed in Phase 3).
10. `[HUMAN]` **Cut-over:** new backend + EMQX test deployment + real ESP32; when the E2E list passes, stop the prototype. (Agent: write the step-by-step cut-over checklist.)

**Error handling (specific)**
- Duplicate `pay/request` → status-aware replay (D5 table), never a second payment.
- New request while PENDING → old CANCELLED (`SUPERSEDED`) in the same transaction; while PAID open → `PAY_MACHINE_BUSY`.
- ABA `generate-qr` unavailable → `failed GATEWAY_UNAVAILABLE`, no row; device retries same `request_id`. Code 403 → new `tran_id` (≤ 3).
- `check-transaction` `not_found` → pending until expiry + grace (D7, B4.8).
- Callback: unknown / duplicate / malformed body → 200 + log; confirmation only through `payments.confirm` job.
- Expiry decided by the sweep after a final ABA check; then close-transaction and reconcile probes.
- Late approval (callback or reconcile) → REFUND_REVIEW + refund case 100 %; machine not told.

**Tests**
- Unit: every payment transition in C1; `markPaid` from every state; grace boundary; replay table; per-operation code mapping.
- Integration: concurrent `pay/request` (same / different `request_id`) → exactly one open payment; PAID open → busy; tran_id collision retry; sweeps drive PENDING → PAID/EXPIRED without any callback; reconcile finds a late approval at +5 min; Redis `FLUSHALL` mid-flow → still correct; rate limiter shared across two API instances.
- Contract: all Phase-2 payloads; recorded ABA responses.
- E2E: request → QR → approve → `paid` → `DONE` → DISPENSED + ack; duplicate request; cancel before QR (ESP32 local cancel); supersede; expiry + late approval found by reconcile (callback dropped); ABA down → `failed`.

**Definition of Done**
- [ ] `[MANUAL CHECK]` Real ESP32: `1` → QR → ABA simulator pay → `PAID` → `DONE` → **`transaction/ack` received**, on the new backend
- [ ] 20 parallel `pay/request` for one machine leave exactly one open payment
- [ ] With the callback endpoint disabled, payments still confirm via sweeps, and a late payment is found by reconcile
- [ ] Killing api/worker or flushing Redis never loses or duplicates `PAID`
- [ ] Prototype stopped; firmware docs updated
- [ ] `PROGRESS.md` updated with handoff note

---

## Phase 3 — Dispensing & refund review

**Goal:** every outcome is recorded even after network loss or reboot; every money problem becomes a claimed, auditable refund decision; never a refund while the outcome is unknown.
**Implements:** Plan C1 (PAID → …), C2, C3 (acks, safety rules 2–4), C4, C5 (`sweep.dispensing`, refund-execute), C6, C7 (refund endpoints), C8, D6.
**Needs before starting:** Phase 2 done (cut-over passed); ESP32 board for device checks; STM32 status from the hardware developer (see `PROGRESS.md` → Hardware status).
**Read before starting:** Phase 2 handoff note; Plan C1 (PAID → … and refund policy), C2, C3 (incl. STM32 safety rules), C4, C5, C6, C7, C8, D6; `firmware/esp32-gateway/src/main.cpp`; `docs/PROGRESS.md` → Hardware status.

**Tasks**
1. Domain: `Dispense` (accuracy `|flow − weight| / volume × 100`, mismatch > 5 %); `Payment.recordOutcome`, `markDispenseUnknown`, `claimRefund`, `markRefunded`, `rejectRefund`, `reopenRefund`; refund policy function (C1).
2. Application: full `RecordDispense` (incl. `error` with `tran_id`, `PAID_NOT_ACCEPTED`, `BOTTLE_TIMEOUT`, late outcomes, clock skew); `sweep.dispensing` (C1 escalation rules using machine `pending_outcomes` and online history); refund case commands; auto refund executor behind `REFUND_MODE=auto`.
3. Interface: complete D6 (rejections persisted, permanent `rejected` acks); `error` consumer; refund-case endpoints (local-only until Phase 6) incl. claim and `REFUND_BLOCKED_PENDING_OUTCOMES`.
4. **ESP32 firmware v0.4** (agent writes code; `[HUMAN]` flashes and runs the device tests): NVS outcome queue (capacity 64, max age 7 d, backoff 5 s → 5 min + jitter), `ACK,<tran_id>` to STM32 after NVS write, `PAID` repeat until `PAID,ACK`/`PAID,REJECT`, heartbeat counters (`pending_outcomes`, `rejected_outcomes`, `dropped_outcomes`), survives reboot.
5. `[HARDWARE]` **STM32 (hardware developer, parallel):** C3 safety rules 1–5; outcome persistence; `PONG` fields; fault codes (C8). Integration test with the ESP32 using the golden fixtures (C9).

**Error handling**
- Non-PAID / wrong machine / unknown payment / malformed → persisted in `dispense_rejections` → permanent `ack rejected` → critical alert.
- Duplicate outcome → `ack ok`.
- Outcome after a refund decision → `late=true` + `ReconciliationNeeded`; payment unchanged.
- Infra failure → no ack → device retries.
- Claim race → second claim `REFUND_ALREADY_CLAIMED`; decision on decided case → `REFUND_ALREADY_DECIDED`.
- Mark refunded while machine `pending_outcomes > 0` → `REFUND_BLOCKED_PENDING_OUTCOMES` unless admin override reason.
- Auto refund failure → 8 retries → case `auto_failed` + alert → operator.

**Tests**
- Unit: accuracy; refund policy (KHR/USD rounding); all outcome transitions; escalation rules.
- Integration: dispensing sweep idempotent; ack only after commit; claim atomic under concurrency.
- E2E: ESP32 offline 2 h after dispense → DISPENSE_UNKNOWN → reconnect replays `DONE` → DISPENSED, no refund case; ESP32 reboot with queued outcome → delivered; corrupted `PAID` line → STM32 still receives a repeat → dispenses; `PAID,REJECT` → refund case; bottle timeout → refund case 100 %; outcome for unknown `tran_id` → rejected, NVS drained.

**Definition of Done**
- [ ] Every PAID payment ends in DISPENSED, REFUNDED or REFUND_REJECTED — none refunded while outcome unknown
- [ ] `[MANUAL CHECK]` Outcomes survive ESP32 reboot, STM32 reboot and 2 h offline
- [ ] No infinite replay: every outcome is acked `ok` or `rejected`, or expires by policy (counted)
- [ ] Two operators cannot refund the same case
- [ ] `PROGRESS.md` updated with handoff note

---

## Phase 3.5 — Early pilot

**Goal:** real-world data from one machine while the remaining phases are built.
**Implements:** Deployment §1 (production environment, minimal layout), §14 (pilot items).
**Needs before starting:** Phase 3 done; `[HUMAN]` VPS with static IP, managed PostgreSQL, EMQX `wrm-prod`, Sentry account, pilot site. The agent prepares scripts and configs; a person creates accounts and runs the deploy.
**Read before starting:** Phase 3 handoff note; Deployment §1, §8, §14; Plan B5 (config + connection budget), C10.1 (live URL, IP whitelist).

**Tasks**
1. `[HUMAN]` (agent writes compose file, Caddyfile, deploy script) Minimal production environment: one VPS (static IP), `RUN_MODE=all`, managed PostgreSQL (smallest plan, ≥ 25 connections), Redis, Caddy, EMQX `wrm-prod`, daily backup, Sentry. Manual deploy script (CI/CD comes in Phase 9).
2. `[HUMAN]` ABA: **live** merchant account if ready (else continue internal pilot on sandbox with the ABA simulator); register the static IP.
3. `[HUMAN]` Provision WRM-001 (manual SQL + EMQX user until Phase 4); install at a friendly site.
4. `[HUMAN]` Pilot operations: daily review of payments, outcomes, refund cases (via REST/SQL until Phase 7), weekly pilot log.

**Definition of Done**
- [ ] `[MANUAL CHECK]` One machine taking real (or simulator) payments end to end on the production environment
- [ ] Pilot log started; issues feed later phases
- [ ] `PROGRESS.md` updated with handoff note

The pilot runs **in parallel with Phases 4–10** (≈ 11 weeks) and is the evidence for the go-live decision.

---

## Phase 4 — Fleet

**Goal:** provision and manage machines remotely; know which are online.
**Implements:** Architecture §4 (Fleet), §17 (Online/offline); Plan C2 (`heartbeat`, `online`, `config`, `config/ack`), C3 (`CFG`, `PONG`), C7 (machines), C8.
**Needs before starting:** Phase 3 done; EMQX management API key (`[HUMAN]` creates it) if automatic credentials are used; ESP32 board; STM32 `CFG` support from the hardware developer.
**Read before starting:** Phase 3 handoff note; Architecture §4 (Fleet), §17; Plan C2 (`heartbeat`, `online`, `config`, `config/ack`), C3 (`CFG`, `PONG`), C6, C7 (machines), C8; `firmware/esp32-gateway/src/main.cpp`.

**Tasks**
1. Fleet service (2-layer): provisioning (`POST /v1/machines`: row + default prices + MQTT username + one-time password; EMQX credential via EMQX management API if available, otherwise documented manual step — verify in this phase), enable/disable, prices (fixed tiers), currency, credential rotation, decommission; replaces temporary `MachinePort`.
2. Consumers `heartbeat` (updates `last_stm32_state`, `pending_outcomes`), `online`, `config/ack`; retained `config` on `MachineConfigChanged`; `sweep.fleet-offline`.
3. **ESP32 firmware v0.5** (`[HUMAN]` flashes): `config` → `CFG` until `CFG,OK` → `config/ack`; resend after STM32 reboot (`PONG` state); full heartbeat.
4. Heartbeat retention (30 days).

**Error handling:** unknown machine heartbeat → warn + metric (no auto-register); `config/ack error` → `fleet.ConfigRejected` alert; price payload missing a tier → `VALIDATION_FAILED`.

**Tests:** unit (provisioning, prices), integration (offline sweep), E2E (price change → STM32 `CFG,OK` → next payment uses new price; credential rotation → old password rejected).

**Definition of Done**
- [ ] New machine provisioned via API and online without manual DB edits (EMQX step documented if manual)
- [ ] `[MANUAL CHECK]` Offline within 3 min of power loss; price change confirmed by `CFG,OK`
- [ ] `PROGRESS.md` updated with handoff note

---

## Phase 5 — Monitoring

**Goal:** operators learn about problems immediately, without alert storms.
**Implements:** Architecture §4 (Monitoring), §13; Plan C4, C5 (`notify.telegram`), C6 (Alert), C7, C8.
**Needs before starting:** Phase 4 done; `[HUMAN]` Telegram bot token + chat ID in `.env`.
**Read before starting:** Phase 4 handoff note; Architecture §4 (Monitoring), §13; Plan C4, C5 (`notify.telegram`), C6 (Alert), C7, C8.

**Tasks**
1. Alert service (2-layer): dedupe key, severity, lifecycle; rules as pure functions.
2. Rules: offline / online (auto-resolve); DispenseOutcomeUnknown; site-check needed; RefundReviewOpened; refund case open > 24 h; ReconciliationNeeded; OutcomeRejected; AccuracyMismatch; LatePaymentDetected; fault codes by C8 severity (`error` topic, `PONG.fault`); `pending_outcomes > 0` for 1 h; ABA circuit open; auto-refund failure; repeated `PAY_MACHINE_BUSY` / `RATE_LIMITED`.
3. Telegram notifier; REST alerts endpoints.

**Error handling:** Telegram failures retried, never block alert creation; identical alerts within 10 min merged.

**Tests:** unit (rules, dedupe), integration (retries), E2E (unplug ESP32 → Telegram within 4 min; reconnect → resolved).

**Definition of Done**
- [ ] One alert per incident for every rule
- [ ] `[MANUAL CHECK]` Critical alerts reach Telegram (unplug-ESP32 test)
- [ ] `PROGRESS.md` updated with handoff note

---

## Phase 6 — Identity

**Goal:** secure dashboard access with roles and a full audit trail.
**Implements:** Architecture §4 (Identity), §14; Deployment §8; Plan C6, C7.
**Needs before starting:** Phase 5 done. No external accounts needed.
**Read before starting:** Phase 5 handoff note; Architecture §4 (Identity), §14; Deployment §8; Plan C6, C7.

**Tasks**
1. **Spike (≤ 2 days):** Better Auth in NestJS + Fastify; else fallback (NestJS guards + Argon2id + `sessions`, HTTP-only cookies) — ADR-0010.
2. Roles `admin`, `operator`, `viewer`; optional TOTP for admin.
3. `@Roles()` on every endpoint (local-only endpoints become role-protected).
4. Users management; audit log for prices, machine changes, credentials, refund claim/decide/reopen, unknown-dispense decisions, user changes.
5. Rate limiting per IP + user on auth/API.

**Error handling:** `AUTH_*`; brute force → `RATE_LIMITED`; generic login errors.

**Tests:** guard matrix (role × endpoint); audit rows; rate limit.

**Definition of Done**
- [ ] Only health, callback and auth reachable without a session
- [ ] Every sensitive action audit-logged
- [ ] `PROGRESS.md` updated with handoff note

---

## Phase 7 — Reporting & dashboard

**Goal:** operators see sales, machines, alerts and the refund queue, and act on them.
**Implements:** Architecture §7 (read side), §4 (Reporting); Plan C7 (reports).
**Needs before starting:** Phase 6 done (login + roles). No external accounts needed.
**Read before starting:** Phase 6 handoff note; Architecture §4 (Reporting), §7; Plan C1 (refund policy), C6, C7 (reports + refund endpoints).

**Tasks**
1. SQL views / materialized views: `sales_daily` (gross, refunds, **net**), `sales_by_machine`, `machine_status_view`, `refund_queue_view`; Prisma TypedSQL; refresh `CONCURRENTLY` every 5 min.
2. Report endpoints (< 300 ms, paginated).
3. Dashboard (Next.js): Overview; Machines (provision, prices, enable/disable, credentials); Payments (search, timeline); **Refund queue** (claim, mark refunded with method/reference/amount, reject, reopen; shows `pending_outcomes` and STM32 state); Unknown dispenses; Alerts; Users; Reports (date range, CSV).
4. Polling every 10 s (SSE later via ADR).

**Tests:** query handlers with seeded KHR + USD data incl. refunds; refund form component tests; Playwright smoke (login → claim → mark refunded).

**Definition of Done**
- [ ] Gross, refunds and net revenue match DB totals for seeded scenarios (both currencies)
- [ ] Refund queue fully operable from the UI and audit-logged
- [ ] `PROGRESS.md` updated with handoff note

---

## Phase 8 — Observability

**Goal:** follow every payment end to end; alerts before customers notice.
**Implements:** Architecture §13; Deployment §10; Plan B6.
**Needs before starting:** Phase 7 done; `[HUMAN]` Grafana Cloud account + OTLP endpoint/token, Sentry DSN, Telegram ops chat.
**Read before starting:** Phase 7 handoff note; Architecture §13; Deployment §10; Plan B6.

**Tasks:** OpenTelemetry traces (traceId through outbox); B6 metrics; `/metrics` internal; Grafana dashboards (Payments, ABA, Machines, Outcomes/Acks, Queues/Outbox/Sweeps, Refunds, Infrastructure); alert rules → Telegram ops; Sentry releases.

**Definition of Done**
- [ ] One payment followed in a single trace
- [ ] All Deployment §10 alerts tested by simulation
- [ ] `PROGRESS.md` updated with handoff note

---

## Phase 9 — Production deployment (full layout)

**Goal:** grow the Phase 3.5 environment into the full Deployment-doc layout with one-click releases.
**Implements:** Deployment §1–§8, §13.
**Needs before starting:** Phase 8 done; `[HUMAN]` staging VPS, EMQX `wrm-staging`, GitHub Environments with secrets, GHCR access, backup storage.
**Read before starting:** Phase 8 handoff note; Deployment §1–§8, §13; Plan B5; `infra/` files from Phase 3.5.

**Tasks**
1. Dockerfiles (multi-stage, non-root, healthchecks): one api image (`RUN_MODE`), dashboard.
2. `docker-compose.prod.yml`: caddy, api ×2 (`RUN_MODE=api`), worker (`RUN_MODE=worker`), dashboard, redis (AOF), otel agent.
3. `[HUMAN]` (agent writes config) Staging VPS + EMQX `wrm-staging` + ABA sandbox (`RUN_MODE=all`).
4. Server hardening; per-device EMQX credentials + ACL; separate backend user.
5. `deploy.yml`: build → GHCR → staging (migrate via `DIRECT_DATABASE_URL`, rolling, smoke) → manual approval → production (backup, migrate, rolling, health, auto-rollback).
6. `[HUMAN]` Secrets in GitHub Environments; backups + monthly restore drill (agent writes the scripts).
7. Verify connection budget (B5) under load; ADR-0011 revisited (PgBouncer only if needed).

**Tests:** broken image → automatic rollback; restore drill; Redis loss in staging → sweeps recover; zero dropped MQTT messages during rolling deploy.

**Definition of Done**
- [ ] Merge to `main` → staging automatically; production after approval
- [ ] `[MANUAL CHECK]` Restore drill passed; connection count within budget at 10× load
- [ ] `PROGRESS.md` updated with handoff note

---

## Phase 10 — Hardening & go-live decision

**Goal:** prove the system under load and failure; decide go-live using pilot evidence.
**Implements:** Architecture §10.6; Deployment §14.
**Needs before starting:** Phase 9 done; pilot running ≥ 8 weeks; ESP32 + STM32 rig for chaos tests; ABA live account.
**Read before starting:** Phase 9 handoff note; Architecture §10.6; Deployment §14; pilot log; Plan A (system invariants), B7.

**Tasks**
1. Load: k6 (API/dashboard), emqtt-bench (1,000 simulated machines), mock ABA with latency + 429.
2. Chaos: kill api/worker; flush Redis; ESP32 offline during/after dispense; ABA outage; UART unplugged mid-dispense (pump stops); STM32 reboot with queued outcome; callback endpoint down (reconcile must find payments).
3. Security: dependency audit, image scan, RBAC review, MQTT ACL test, secrets rotation drill.
4. Remove legacy payload support once all machines run firmware ≥ v0.5.
5. `[HUMAN]` ABA live account confirmed; KHR/USD enabled; IP whitelisted; refund mode decided (ADR-0008).
6. `[HUMAN]` Pilot review (≥ 8 weeks of data; agent prepares the report queries): uptime, refund cases, unknown outcomes, accuracy, customer issues.

**Pass criteria:** at 10× expected peak — QR < 2 s, PAID < 3 s; **zero** lost or duplicate payments; **zero** refunds while outcome unknown; every chaos scenario recovers automatically; pilot uptime ≥ 98 %.

**Definition of Done**
- [ ] Deployment §14 checklist fully checked
- [ ] `[MANUAL CHECK]` Go-live decision recorded with pilot report
- [ ] `PROGRESS.md` updated with handoff note

---

## Phase 11 — OTA firmware updates (post go-live)

**Goal:** update ESP32 and STM32 firmware remotely and safely.
**Implements:** Deployment §9.
**Needs before starting:** Phase 10 done (go-live); `[HUMAN]` R2 bucket; `[HARDWARE]` STM32 UART bootloader support.
**Read before starting:** Phase 10 handoff note; Deployment §9; Plan C2 (`ota/*` reserved), C3; `firmware/esp32-gateway/src/main.cpp`; STM32 bootloader notes from the hardware developer.

**Tasks:** contracts `ota/offer` (version, url, sha256, size, target), `ota/progress`, `ota/result`; firmware registry (R2, signed URLs, SHA-256), staged rollout (canary → 10 % → 100 %), pause/abort, dashboard page; ESP32 signed images + dual partitions + rollback, update only when no open payment and `pending_outcomes = 0`; STM32 flashed by the ESP32 via UART bootloader with checksum and fallback.

**Definition of Done**
- [ ] `[MANUAL CHECK]` Canary rollout and automatic rollback demonstrated for both chips
- [ ] `PROGRESS.md` updated with handoff note

---

# Part F — Timeline, risks, open questions, traceability

## F1 Timeline (one backend developer)

```text
Week:  1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20 | 21  22
P0    ███                                                                             |
P1        ███████                                                                     |
P2                ███████████                                                         |
P3                            ███████                                                 |
P3.5                                  ███                                             |
Pilot                                    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ |
P4                                       ███                                          |
P5                                           ███                                      |
P6                                               ███                                  |
P7                                                   ███████                          |
P8                                                           ███                      |
P9                                                               ███████              |
P10                                                                      ███████      |
Go-live decision                                                                  ▲   |
P11 (after go-live)                                                                   | ███████
```

≈ **20 weeks to go-live** (pilot ≈ 11 weeks in parallel), + 2 weeks OTA. ESP32 firmware work is inside Phases 2–4; STM32 work runs in parallel by the hardware developer from Phase 0 (C3/C8 acceptance) and is integrated in Phase 3.

## F2 Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| ABA has no programmatic KHQR refund | No auto refunds | Manual refund queue with claim (default) |
| ABA close-transaction does not prevent late payment | More late payments | Reconcile + refund review; measure in pilot |
| ABA callbacks lost or delayed | Late payments missed | Sweeps confirm without callbacks; reconcile probes terminal payments |
| Redis data loss | Delayed work | DB-driven sweeps, schedulers re-created at boot |
| UART line loss | No water / wrong refund | Acks both ways, STM32 outcome persistence |
| Machines offline when reporting | Wrong refunds | DISPENSE_UNKNOWN, NVS queue, refund blocked while outcomes pending |
| STM32 developer cannot implement C3 rules in time | Phase 3 slip | C3/C8 sent in Phase 0; golden fixtures; firmware integration in Phase 3 |
| Managed PostgreSQL connection limit | Connection errors | Budget 15 + 2; ADR-0011 trigger for a pooler |
| Better Auth issues | Auth delay | Spike + fallback |
| Dashboard scope creep | Delay | Phase 7 page list fixed |
| Single developer availability | Slip | Independently shippable phases; pilot keeps running |

## F3 Open questions

**For ABA integration support (sent in Phase 0; answers recorded in ADR-0008/0009):**
1. Does close-transaction exist for KHQR, what are its fields, and does it prevent a later payment? Can a `tran_id` that was never paid be closed?
2. Confirm `generate-qr` code 403 for a duplicated `tran_id` (no second transaction created).
3. Is check-transaction-2 limited to 7 days? Is there a settlement/report API by date range for daily reconciliation?
4. Confirm check-transaction code `6` = not found (not paid yet).
5. QR `lifetime`: minutes, minimum 3?
6. Callbacks: retry policy on non-2xx/timeout, source IPs, required response time.
7. Refund API for KHQR: available? full and/or partial? effect on `payment_status_code`?
8. Rate limits for generate-qr and check-transaction (sandbox vs live).

**For the STM32 developer (Phase 0):**
9. Accept C3 safety rules 1–5 (bottle timeout, outcome persistence, `PAID,ACK`/`PAID,REJECT`, `ACK`) and C8 fault codes?
10. Available non-volatile storage on the STM32 for the last outcome?

**Product (defaults applied):**
11. Pilot starts early with 1 machine (Phase 3.5) — **default**.
12. One admin with ABA merchant-portal access handles refunds — **default** (claim state supports more).

## F4 Traceability

| Architecture section | Phase |
|---|---|
| §2 Styles, §15–16 Stack & repo | 0 |
| §8 Outbox & inbox | 1 |
| §5 Layers, §6 Domain, §7 CQRS | 1–3, 7 (read side) |
| §9 Reliability | 1–3 |
| §10 Scalability, concurrency & load | 1–2 (design), 9, 10 (proof) |
| §11 Performance | 2, 7, 10 |
| §12 Quality | 0, every phase |
| §13 Observability | 1 (logs), 8 |
| §14 Security | 4 (credentials), 6, 9, 10 |
| §17 Main flows | 2 (Pay, Confirm, Expiry, Reconcile), 3 (Dispense, Refund review), 4 (Online/offline) |

| Deployment section | Phase |
|---|---|
| §1 Environments | 0 (local), 3.5 (production minimal), 9 (staging, full production) |
| §2–§3 Infrastructure & containers | 3.5 (minimal), 9 |
| §4 CI/CD | 0 (CI), 9 (CD) |
| §5 Zero-downtime | 1, 9 |
| §6 Secrets | 1, 3.5, 9 |
| §7 Backups & DR | 3.5 (daily backup), 9 |
| §8 Security hardening | 6, 9 |
| §9 Firmware OTA | 11 |
| §10 Monitoring & alerting | 5, 8 |
| §14 Go-live checklist | 10 |

---

## Related

- [Backend Architecture](backend-architecture.md)
- [Deployment](../06-Testing-and-Operations/deployment.md)
- [Product Architecture & Roadmap](../01-Project-Overview/product-architecture-roadmap.md)
- [STM32 QR Payment Integration](stm32-qr-payment-integration.md)
- [ESP32 Gateway README](../../esp32-gateway/README.md)
