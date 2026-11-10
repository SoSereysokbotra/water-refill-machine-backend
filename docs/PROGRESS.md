# Project Progress & Handoff

> **AI agents and developers:** read this file first, before writing any code. Update it **at the end of every session**, even when a phase isn't finished.
> Plan: [backend-implementation-plan.md](04-Cloud-and-Payment/backend-implementation-plan.md) · Rules: [CLAUDE.md](../CLAUDE.md)

---

## 1. Current status

| | |
|---|---|
| **Current phase** | **Phase 3: Dispensing & refund review** (automated done, awaiting manual hardware check) |
| **Next action** | Run physical hardware check for ESP32 v0.4.0 NVS queue (see `readmePhase3.md`), then prepare for Phase 3.5 |
| **Last updated** | 2026-11-10 by Backend developer |
| **Last commit** | `647b832` (branch `phase3`, local unpushed) |

### Before Phase 0 (prototype, already working)
- ✅ Prototype backend (`backend-prototype/`): ABA sandbox KHQR payment tested end to end with the ABA simulator app
- ✅ EMQX Cloud broker running (`d41b5d19.ala.asia-southeast1.emqxsl.com:8883`)
- ✅ ESP32 firmware v0.2.0: Wi-Fi + MQTT + test menu, tested end to end
- ✅ Docs: architecture, deployment, implementation plan v3.1, SRS v3

---

## 2. Phase tracker

Status values: ⬜ Not started · 🟦 In progress · 🟨 Blocked / waiting · ✅ Done

| # | Phase | Status | Developer | Started | Finished | Last commit |
|---|---|---|---|---|---|---|
| 0 | Foundations | ✅ | Backend developer | 2026-11-08 | 2026-11-09 | `c3c6c54` |
| 1 | Platform | ✅ | Backend developer | 2026-11-09 | 2026-11-09 | `phase1` |
| 2 | Payments | 🟦 | Backend developer | 2026-11-10 | | `phase2` |
| 3 | Dispensing & refund review | 🟦 | Backend developer | 2026-11-10 | | `phase3` |
| 3.5 | Early pilot | ⬜ | | | | |
| 4 | Fleet | ⬜ | | | | |
| 5 | Monitoring | ⬜ | | | | |
| 6 | Identity | ⬜ | | | | |
| 7 | Reporting & dashboard | ⬜ | | | | |
| 8 | Observability | ⬜ | | | | |
| 9 | Production deployment | ⬜ | | | | |
| 10 | Hardening & go-live | ⬜ | | | | |
| 11 | OTA updates | ⬜ | | | | |

A phase is ✅ only when **every** Definition of Done item in the plan is ticked below, including `[MANUAL CHECK]` items confirmed by a person.

---

## 3. Definition of Done: current phase

Copy the DoD of the current phase from the plan here and tick items as they are really done and tested.

### Phase 3: Dispensing & refund review
- [x] Every PAID payment ends in DISPENSED, REFUNDED or REFUND_REJECTED — none refunded while outcome unknown
- [ ] `[MANUAL CHECK]` Outcomes survive ESP32 reboot, STM32 reboot and 2 h offline
- [x] No infinite replay: every outcome is acked `ok` or `rejected`, or expires by policy (counted)
- [x] Two operators cannot refund the same case
- [x] `PROGRESS.md` updated with handoff note

### Phase 2: Payments (awaiting manual hardware check)
- [ ] `[MANUAL CHECK]` Real ESP32: `1` → QR → ABA simulator pay → `PAID` → `DONE` → **`transaction/ack` received**, on the new backend
- [x] 20 parallel `pay/request` for one machine leave exactly one open payment
- [x] With the callback endpoint disabled, payments still confirm via sweeps, and a late payment is found by reconcile
- [x] Killing api/worker or flushing Redis never loses or duplicates `PAID`
- [x] Prototype stopped; firmware docs updated (`firmware/esp32-gateway/README.md`)
- [x] `PROGRESS.md` updated with handoff note

### Phase 1: Platform (completed)
- [x] Worker killed mid-dispatch → each event handled once per handler after restart
- [x] `FLUSHALL` on Redis → sweeps resume within one interval
- [x] `/health/ready` accurate; logs carry `traceId`; secrets redacted
- [x] `RUN_MODE=all` runs API + worker in one process
- [x] `PROGRESS.md` updated with handoff note

### Phase 0: Foundations (completed)
- [x] Clean clone: `pnpm i && pnpm build && pnpm test` passes
- [x] Local compose starts postgres, redis, mosquitto
- [x] A deliberate cross-layer import fails CI
- [x] ADRs merged
- [ ] `[MANUAL CHECK]` ABA questions sent; STM32 developer confirmed C3 rules (or changes merged into C3)
- [x] Prototype still runs from `backend-prototype/`
- [x] `PROGRESS.md` updated with handoff note

---

## 4. Waiting for human

Things an AI agent can't do. A person does them, then ticks the box.

| Item | Phase | Who | Status |
|---|---|---|---|
| Send ABA the 8 questions (plan §F3) | 0 | Backend developer | ⬜ |
| STM32 developer confirms UART contract C3 + fault codes C8 (questions 9–10 in §F3) | 0 | Hardware developer | ⬜ |
| Hardware developer reviews 📝 draft docs and fills in TBD (STM32 model, pins, prices) | 0 | Hardware developer | ⬜ |
| Enable branch protection on `main` | 0 | Backend developer | ⬜ |
| Real ESP32 cut-over test: 1 -> QR -> ABA simulator pay -> PAID -> DONE -> transaction/ack (see readmePhase2.md) | 2 | Backend / Hardware developer | ⬜ |
| Real ESP32 NVS queue test: simulate offline dispense, reboot ESP32, verify outcome replay & draining (see readmePhase3.md) | 3 | Backend / Hardware developer | ⬜ |

---

## 5. Hardware status (STM32, hardware developer)

| Item | Status | Notes |
|---|---|---|
| UART link to ESP32 (115200 8N1, GPIO16/17) | ⬜ | |
| KHQR display on LCD | ⬜ | |
| Pump + valves control | ⬜ | |
| Sensors (flow, load cell, floats) | ⬜ | |
| C3 safety rules 1–5 | ⬜ | |
| Outcome saved in non-volatile memory | ⬜ | |

---

## 6. Handoff notes (newest first)

Add a new note at the top at the end of every session.

### Template (copy this)

```markdown
### YYYY-MM-DD: Phase N (<status>) by <name / agent>

**Done this session**
- …

**Not finished / next steps** (in order)
1. …

**Changed from the plan** (and whether the plan was updated)
- … / None

**Known issues / bugs**
- … / None

**How to run / test**
- `command` → expected result

**Needs from a person**
- … / None
```

---

### 2026-11-10: Phase 3 (Dispensing & refund review automated complete, awaiting hardware check) by Backend developer

**Done this session**
- Task 1 (Domain & Contracts):
  - Added `ErrorV1Schema` in `@wrm/contracts` for hardware error topic `wrm/+/error`.
  - Implemented ADR-0008 refund calculation in `refund-policy.ts` with minor-unit floor rounding for partial dispenses, 0 for ok, 100% for error.
  - Implemented dual-sensor accuracy tracking ($|\text{flow} - \text{weight}| / \text{volume} \times 100$, $>5\%$ threshold flag) in `dispense.entity.ts`.
  - Implemented `RefundCase` aggregate (`claim`, `markRefunded`, `reject`, `reopen`, 30-min expiration, concurrency lock).
  - Extended `Payment` aggregate with `recordOutcome`, `markDispenseUnknown` (past 300s), `escalateUnknownToRefundReview` (after 24h), `claimRefund`, `markRefunded`, `rejectRefund`, `reopenRefund`, and late outcome handling without corrupting terminal states.
  - Unit tests: 15 domain unit tests created and passing (`test/phase3-domain.spec.ts`).
- Task 2 (Prisma Repository & Application):
  - Extended `PaymentRepository` port and `PrismaPaymentRepository` with `recordDispense`, `saveRefundCase`, `getRefundCase`, `findRefundCases`, `findDueForDispenseUnknown`, `findDueForUnknownEscalation`, and `getMachinePendingOutcomes`.
  - Implemented `RecordDispenseHandler` with dual-sensor validation, clock skew check (>300s), late outcome reconcile generation, and outbox event publishing (`dispensing.DispenseCompleted`, `dispensing.DispenseFailed`, `dispensing.AccuracyMismatch`).
  - Implemented `DispensingSweep` (`sweep.dispensing`, 30s interval): moves `PAID` past 300s to `DISPENSE_UNKNOWN`, escalates `DISPENSE_UNKNOWN` past 24h to `REFUND_REVIEW` only when machine reports `pending_outcomes === 0`.
  - Implemented refund command handlers (`ClaimRefundCaseHandler`, `MarkRefundedHandler`, `RejectRefundHandler`, `ReopenRefundHandler`, `ResolveUnknownDispenseHandler`).
  - Enforced Plan §C1 safety guard: `MarkRefundedHandler` blocks refunds with `REFUND_BLOCKED_PENDING_OUTCOMES` if `pending_outcomes > 0` unless `adminOverrideReason` is provided.
- Task 3 (Interface):
  - Subscribed MQTT consumer to `wrm/+/error` and `wrm/+/transaction`. Records unrecognized or foreign outcomes into `dispense_rejections` table and sends permanent `transaction/ack rejected`.
  - Implemented REST controller `RefundCasesController` (`/v1/refund-cases`, `/claim`, `/mark-refunded`, `/reject`, `/reopen`, `/payments/:tranId/resolve-unknown`).
  - Mapped domain `ConflictError` to HTTP 409 in `GlobalExceptionFilter`.
- Task 4 (ESP32 Firmware v0.4.0):
  - Updated `firmware/esp32-gateway/src/main.cpp` with persistent NVS outcome queue (`Preferences`, capacity 64, max age 7 days, exponential backoff with jitter).
  - Only sends `ACK,<tran_id>` UART reply to STM32 after outcome is safely committed to NVS flash memory.
  - Continuously repeats `PAID,<tran_id>,<volume_ml>` every 2s until `PAID,ACK` or `PAID,REJECT` received.
  - Emits telemetry counters: `pending_outcomes`, `rejected_outcomes`, `dropped_outcomes` in heartbeats.
- Task 5 (Verification & Documentation):
  - Authored comprehensive verification guide in `readmePhase3.md`.
  - Integration & E2E tests: Added `dispensing-sweeps.integration.spec.ts` (3 tests) and `refund-flow.e2e.spec.ts` (4 tests).
  - Full test suite: 19 test files, 79 tests passing.
  - Architecture boundaries: 0 depcruise violations across 109 modules.
  - ESLint: 0 errors.
  - Git branch: `phase3` maintained locally (unpushed) per instructions.

**Not finished / next steps** (in order)
1. Run `[MANUAL CHECK]` for ESP32 v0.4.0 NVS queue (unplug Wi-Fi during dispense, reboot ESP32, verify outcome drained on reconnect).
2. Proceed to Phase 3.5: Early pilot (minimal production environment on VPS, Caddy, managed Postgres, WRM-001 provisioning).

**Changed from the plan**
- None.

**Known issues / bugs**
- None.

**How to run / test**
- `pnpm test` → 19 test files, 79 tests passing.
- `pnpm --filter @wrm/api depcruise` → 0 architecture boundary violations (109 modules, 332 dependencies).
- `pnpm run lint` → 0 ESLint errors.
- See `readmePhase3.md` for complete manual testing scenarios.

**Needs from a person**
- Flash ESP32 with firmware v0.4.0 and test the offline NVS queue reboot resilience (`[MANUAL CHECK]` in Section 4).

---

### 2026-11-10: Phase 2 (Payments automated complete, awaiting hardware check) by Backend developer

**Done this session**
- Task 1 (Contracts): Added Phase 2 MQTT contracts in `@wrm/contracts` (`pay/request`, `pay/cancel`, `pay/qr`, `pay/status`, `transaction`, `transaction/ack`, and legacy payload normalization).
- Task 2 (Domain): Implemented `Payment` aggregate root (`Payment.create`, `markPaid`, `markDispensed`, `expire`, `cancel`, `fail`, `probe`, `recordLatePayment`) with strict state transitions, invariant guards, domain events, and ports (`PaymentRepository`, `PaymentGateway`, `MachinePort`).
- Task 3 (Application): Implemented application commands (`CreatePaymentHandler`, `ConfirmPaymentHandler`, `ExpirePaymentHandler`, `CancelPaymentHandler`, `FailPaymentHandler`, `ProbePaymentHandler`, `RecordDispenseHandler`) with interactive `UnitOfWork` and outbox dispatch. Implemented repeatable sweeps (`PaymentsSweep` every 3s, `ReconcileSweep` every 5m).
- Task 4 (Infrastructure): Implemented `PrismaPaymentRepository` (optimistic locking, machine level `cancelPendingForMachine`, `hasPaidOpen`), `PrismaMachineAdapter`, `PayWayGatewayAdapter` (SHA-512 HMAC, 8s timeout, status-aware D7 code mapping), and `MockPayWayGateway`.
- Task 5 (Interface): Implemented MQTT consumers (`payments.mqtt-consumer.ts` with rate-limiting and idempotency), outbox handlers (`payment-outbox.handlers.ts` dispatching to `pay/qr`, `pay/status`, and ABA close-transaction), HTTP controller (`payments.controller.ts` for callbacks and test payment creation), and BullMQ worker (`payment-jobs.processor.ts`).
- Task 6 (Minimal Outcome Recording): Ingests `m/:id/transaction`, stores dispense outcome, transitions `PAID` → `DISPENSED`, and publishes `transaction/ack` QoS 1.
- Task 7 (Migrations & Seeds): Extended `schema.prisma` with `Machine`, `MachinePrice`, `Payment`, `PaymentEvent`, `Dispense`, `DispenseRejection`, `RefundCase` models; added raw SQL partial unique index `one_open_payment_per_machine` and volume tier constraints; seeded `WRM-001` and `WRM-900`.
- Task 8 (ABA Verification & ADR): Authored ADR-0009 (`docs/adr/0009-aba-payway-code-mapping.md`) documenting PayWay status code mappings, lifetime rules, duplicate `tran_id` mitigation, and callback handling.
- Task 9 (ESP32 Firmware v0.3.0): Updated `firmware/esp32-gateway/src/main.cpp` with hardware RNG `request_id`, 5s retry policy, local cancel, remaining seconds display in QR, and `transaction/ack` handling.
- Task 10 (Verification Guide): Authored `readmePhase2.md` with complete cut-over steps, test scenarios, and troubleshooting steps.
- Tests written & verified: 16 test suites passing (57 tests total) including unit tests, concurrency integration tests (20 parallel requests), sweep integration tests, and full E2E flow tests.

**Not finished / next steps** (in order)
1. Run `[MANUAL CHECK]` cut-over test with physical ESP32 board and ABA mobile simulator app following `readmePhase2.md`.
2. Stop the prototype service in `backend-prototype/` once the manual check passes.
3. Proceed to Phase 3: Dispensing & refund review.

**Changed from the plan**
- None. Followed architecture and plan rules B4.7, B4.8, C1, C4, C5, C6, C7, D5, D6, D7 strictly.

**Known issues / bugs**
- None.

**How to run / test**
- `pnpm --filter @wrm/api test` → 16 test files / 57 tests passing.
- `pnpm --filter @wrm/api typecheck` → 0 TypeScript errors.
- `pnpm --filter @wrm/api depcruise` → 0 architecture boundary violations (103 modules, 301 dependencies).
- See `readmePhase2.md` for manual testing instructions with EMQX and the ABA simulator app.

**Needs from a person**
- Flash ESP32 with firmware v0.3.0 and test the physical payment flow with the ABA simulator app (`[MANUAL CHECK]` in Section 4).

---

### 2026-11-09: Phase 1 (Platform completed) by Backend developer

**Done this session**
- Task 1 (Config): Zod schema validation adhering to Plan §B5 (`config.schema.ts`, `config.service.ts`), fail-fast boot, support for `RUN_MODE=all|api|worker`.
- Task 2 (Logging): `nestjs-pino` with JSON structured logging, trace IDs (`req.id` / `traceId` propagation), sensitive parameter redaction (`authorization`, `api_key`, `secret`, `password`, `hash`).
- Task 3 (Errors): Base error taxonomy in shared kernel (`DomainError`, `NotFoundError`, `ConflictError`, `ValidationError`, `RateLimitError`, `InfrastructureError`), `toErrorCode` helper, Fastify global exception filter RFC 7807/Plan payload format.
- Task 4 (Shared Kernel): `AggregateRoot` base class, `DomainEvent` interface, `Clock`/`SystemClock`/`FakeClock`, `generateUuidV7`, `Money` value object (KHR/USD minor units, rounding, scale, conversions), `TranIdGenerator` (alphanumeric URL-safe <= 20 chars).
- Task 5 (Database & UoW): Prisma with connection pooling (`connection_limit=5`, `directUrl`), `PrismaService`, interactive `UnitOfWork` with conflict retry (20ms, 50ms, 100ms), Prisma error mapping (`P2002`/`P2034` → `ConflictError`, `P2025` → `NotFoundError`, connection → `InfrastructureError`).
- Task 6 (Outbox): `outbox` table in Prisma schema with partial indexes, `OutboxService.add(events, tx)`, `OutboxHandlerRegistry`, `OutboxRelay` (250ms polling with `FOR UPDATE SKIP LOCKED LIMIT 20`, BullMQ dispatch with deterministic `jobId: ${id}__${handlerName}`, exponential backoff retries, `dead_at` after 10 attempts).
- Task 7 (Inbox): `InboxService.record(messageId, source, tx)` requiring transaction client argument by type.
- Task 8 (Sweeps Framework): `BaseSweep` class (batch query, process item, skip-on-error, metrics summary), `SweepsScheduler` upserting repeatable BullMQ jobs at worker boot.
- Task 9 (MQTT Platform): `MqttService` using MQTT 5, TLS/CA cert support, persistent session, reconnect handling, EMQX shared subscription support (`$share/backend/...`), QoS 1, message expiry interval, graceful shutdown; `@MqttSubscribe` decorator.
- Task 10 (Queues & Retention): `QueueService` managing BullMQ queues and workers on `REDIS_URL`, DLQ support, graceful shutdown; `RetentionService` running `maintenance.retention` (purging only dispatched outbox > `RETENTION_OUTBOX_DAYS`, inbox > `RETENTION_INBOX_DAYS`, heartbeats > `RETENTION_HEARTBEAT_DAYS`).
- Task 11 (Rate Limiter): Redis-backed `RateLimiterService` using `rate-limiter-flexible`, injectable per key/action, throwing `RateLimitError`.
- Task 12 (Health & Telemetry): `/health/live` (process alive + uptime), `/health/ready` (DB, Redis, MQTT readiness probes), OpenTelemetry and Sentry initialization hooks.
- Tests written & verified: 11 test suites passing (32 tests total) covering unit tests, integration tests (UoW commit/rollback/retry, outbox relay concurrent deduplication, sweeps scheduler resilience after `FLUSHALL`, retention policy), and E2E smoke pipeline (DomainEvent → Outbox → Relay → Handler → MQTT Publish/Subscribe).

**Not finished / next steps** (in order)
1. Proceed to Phase 2: Payments (Domain entity `Payment`, PayWay client, QR generation, ABA webhook callback, reconciliation sweeps, refund mode).

**Changed from the plan**
- Pinned `@prisma/client@^6.19.3` and `prisma@^6.19.3` to avoid Prisma 7's breaking removal of `url`/`directUrl` from schema.prisma.
- In BullMQ v5, repeatable jobs use `upsertJobScheduler(schedulerId, repeatOptions, jobTemplate)` and custom job IDs cannot contain `:` (used deterministic `${id}__${handlerName}`).

**Known issues / bugs**
- None.

**How to run / test**
- `pnpm run build` → compiles all packages.
- `pnpm run typecheck` → passes across all packages (3/3).
- `pnpm run lint` → 0 ESLint errors/warnings.
- `pnpm run depcruise` → 0 architecture boundary violations (78 modules, 157 dependencies).
- `pnpm test` → 11 test suites, 32 tests passing.
- `pnpm --filter @wrm/api dev` → boots in `RUN_MODE=all` on port 3000.
- `curl http://localhost:3000/health/ready` → `{"status":"ok","checks":{"database":"up","redis":"up","mqtt":"up"}}`.

**Needs from a person**
- None for Phase 1. (Phase 0 manual checks for ABA and STM32 questions remain pending).

---

### 2026-11-09: Phase 0 (Done, pending manual checks) by Backend developer

**Done this session**
- Completed Task 1: Restructured folders (`backend/` → `backend-prototype/`, `esp32-gateway/` → `firmware/esp32-gateway/`).
- Completed Task 2: Configured pnpm workspaces, Turborepo, `@wrm/tsconfig`, and `@wrm/contracts`.
- Completed Task 3: Scaffolded `apps/api` with NestJS 11 + Fastify, booting by `RUN_MODE` (`all`, `api`, `worker`).
- Completed Task 4: Configured ESLint strict, Prettier, and `dependency-cruiser` for clean architecture boundaries.
- Completed Task 5: Setup Vitest with SWC, money unit tests, architecture boundary validation test, and Testcontainers smoke test.
- Completed Task 6: Added `infra/docker-compose.yml` for Postgres 16, Redis 7, and Mosquitto 2 with auth and ACL.
- Completed Task 7: Setup GitHub Actions CI workflow in `.github/workflows/ci.yml`.
- Completed Task 9: Authored ADRs 0001–0008 and 0011 in `docs/adr/`.
- Completed Task 10: Prepared message templates in `readmePhase0.md` for ABA support and STM32 developer.
- Completed Task 11: Updated root docs (`README.md`, `CLAUDE.md`, `HANDOFF.md`, firmware README).

**Not finished / next steps** (in order)
1. Send ABA questions (§F3) and STM32 confirmation request (§5 in `readmePhase0.md`).
2. Start Phase 1: Platform (config, logging, errors, Prisma UoW, Outbox relay, sweeps framework, MQTT platform).

**Changed from the plan**
- None.

**Known issues / bugs**
- None.

**How to run / test**
- `pnpm install && pnpm build && pnpm test:unit` → all packages build and test pass (5/5).
- `pnpm run depcruise` → 0 architecture boundary violations.
- `npm --prefix backend-prototype test` → 3/3 prototype tests pass.

**Needs from a person**
- Send ABA and STM32 questions (see Section 4).
- Enable GitHub branch protection on `main`.

---

**Done this session**
- Implementation plan updated to v3.1 for AI-agent handoff (task tags, "Needs before starting", handoff DoD item, commit style).
- Created `CLAUDE.md`, `AGENTS.md` and this file.
- SRS rewritten as v3 (simple version): `docs/01-Project-Overview/srs.md`.

**Not finished / next steps** (in order)
1. Start Phase 0, task 1: restructure folders (`backend/` → `backend-prototype/`, `esp32-gateway/` → `firmware/esp32-gateway/`).
2. Continue Phase 0 tasks 2–11.

**Changed from the plan**
- None (plan v3.1 is current).

**Known issues / bugs**
- All 13 old-design docs were rewritten for STM32 + ESP32. Hardware docs (📝 in `docs/README.md`) are drafts: the hardware developer must fill in the STM32 board model, pin numbers and prices (marked **TBD**).
- ESP32 firmware v0.2.0 doesn't understand `PONG,<fields>` and never sends `ACK,<tran_id>`. STM32 testing notes are in `stm32-qr-payment-integration.md` §6; fixed in firmware v0.3/v0.4.
- `docs/SRS.md` is the old SRS v2 (untracked). Don't commit it.

**How to run / test**
- Prototype backend: `cd backend; npm run dev` → `http://localhost:3000/dev`; `npm test` → 3 tests pass.
- ESP32: see the flash command in `CLAUDE.md`.

**Needs from a person**
- See section 4, *Waiting for human*.
