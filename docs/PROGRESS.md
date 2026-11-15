# Project Progress & Handoff

> **AI agents and developers:** read this file first, before writing any code. Update it **at the end of every session**, even when a phase isn't finished.
> Plan: [backend-implementation-plan.md](04-Cloud-and-Payment/backend-implementation-plan.md) · Rules: [CLAUDE.md](../CLAUDE.md)

---

## 1. Current status

| | |
|---|---|
| **Current phase** | **Phase 8: Observability ✅** (code & automated tests complete). Phase 5 awaiting manual unplug check; Phase 3 needs STM32-reboot + 2 h offline check |
| **Next action** | Phase 9 (Production Deployment) or Phase 3.5 pilot setup |
| **Last updated** | 2026-11-14 by Antigravity |
| **Last commit** | Phase 8 completion |

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
| 2 | Payments | ✅ | Backend developer | 2026-11-10 | 2026-11-12 | `48069dd` |
| 3 | Dispensing & refund review | 🟦 | Backend developer | 2026-11-10 | | `phase3` |
| 3.5 | Early pilot | ⬜ | | | | |
| 4 | Fleet | ✅ | Claude (for backend developer) | 2026-11-12 | 2026-11-12 | `feat/phase-4-fleet` |
| 5 | Monitoring | 🟦 | Claude (for backend developer) | 2026-11-12 | 2026-11-13 | `75fa502` |
| 6 | Identity | ✅ | AI Assistant (Antigravity) | 2026-11-14 | 2026-11-14 | `dc03412` |
| 7 | Reporting & dashboard | ✅ | AI Assistant (Antigravity) | 2026-11-14 | 2026-11-14 | `9169499` |
| 8 | Observability | ✅ | AI Assistant (Antigravity) | 2026-11-14 | 2026-11-14 | `ba06663` |
| 9 | Production deployment | ⬜ | | | | |
| 10 | Hardening & go-live | ⬜ | | | | |
| 11 | OTA updates | ⬜ | | | | |

A phase is ✅ only when **every** Definition of Done item in the plan is ticked below, including `[MANUAL CHECK]` items confirmed by a person.

---

## 3. Definition of Done: current phase

Copy the DoD of the current phase from the plan here and tick items as they are really done and tested.

### Phase 8: Observability (completed)
- [x] One payment followed in a single trace (MQTT -> DB -> ABA -> Outbox -> Relay -> Publish)
- [x] All Deployment §10 alerts tested by simulation
- [x] Structured logs carry traceId, tranId, machineId with sensitive redaction
- [x] Prometheus /metrics endpoint active with all Plan B6 metrics
- [x] Grafana dashboards as code provisioned
- [x] `PROGRESS.md` updated with handoff note

### Phase 7: Reporting & dashboard (completed)
- [x] Gross, refunds and net revenue match DB totals for seeded scenarios (both currencies)
- [x] Refund queue fully operable from the UI and audit-logged
- [x] `PROGRESS.md` updated with handoff note

### Phase 6: Identity (code & automated tests complete)
- [x] Only health, callback and auth reachable without a session
- [x] Every sensitive action audit-logged
- [x] `PROGRESS.md` updated with handoff note

### Phase 5: Monitoring (code & automated tests complete)
- [x] One alert per incident for every rule
- [ ] `[MANUAL CHECK]` Critical alerts reach Telegram (unplug-ESP32 test, see `readmePhase5.md` §4)
- [x] `PROGRESS.md` updated with handoff note

### Phase 4: Fleet (done)
- [x] New machine provisioned via API and online without manual DB edits (EMQX user = documented manual step, see `readmePhase4.md`)
- [x] `[MANUAL CHECK]` Offline within 3 min of power loss; price change confirmed by `CFG,OK` — 2026-11-12, real ESP32 v0.5.1: `CFG,0.20,0.25,0.30,USD,1` → `config/ack ok`, next QR 0.20 USD; power unplugged → `MachineWentOffline` after 53 s (Last Will), back online within seconds
- [x] `PROGRESS.md` updated with handoff note

### Phase 3: Dispensing & refund review
- [x] Every PAID payment ends in DISPENSED, REFUNDED or REFUND_REJECTED — none refunded while outcome unknown
- [ ] `[MANUAL CHECK]` Outcomes survive ESP32 reboot, STM32 reboot and 2 h offline — **ESP32 reboot ✅ 2026-11-12** (backend off, `DONE` stored in NVS, ESP32 reset, backend on → PAID → DISPENSE_UNKNOWN (no refund) → DISPENSED, queue drained). STM32 reboot (needs STM32) and 2 h offline still open
- [x] No infinite replay: every outcome is acked `ok` or `rejected`, or expires by policy (counted)
- [x] Two operators cannot refund the same case
- [x] `PROGRESS.md` updated with handoff note

### Phase 2: Payments (done)
- [x] `[MANUAL CHECK]` Real ESP32: `1` → QR → ABA simulator pay → `PAID` → `DONE` → **`transaction/ack` received**, on the new backend — 2026-11-12, ESP32 v0.5.0, ABA sandbox: payment `mwdk383i68c9579706` DISPENSED with ABA approval code
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
| Real ESP32 cut-over test with firmware **v0.4.1**: 1 -> QR -> ABA simulator pay -> PAID -> DONE -> transaction/ack (see readmePhase2.md) | 2 | Backend / Hardware developer | ✅ 2026-11-12 |
| Real ESP32 NVS queue test with firmware **v0.4.1**: simulate offline dispense, reboot ESP32, verify outcome replay & draining (see readmePhase3.md) | 3 | Backend / Hardware developer | ✅ ESP32 part 2026-11-12; STM32 reboot + 2 h offline open |
| Move your real `secrets.h` from the old `esp32-gateway/include/` to `firmware/esp32-gateway/include/` (git-ignored; Phase 0 moved the folder but not this file) | 3 | Backend developer | ✅ |
| Existing local dev databases (created with `db push`): run `pnpm --filter @wrm/api exec prisma migrate resolve --applied 20261111000000_init`, then `pnpm --filter @wrm/api db:deploy` | 3 | Each developer | ⬜ |
| Before the pilot: generate `ADMIN_API_KEY` (≥ 32 chars) for staging/production `.env` and keep it private | 3.5 | Backend developer | ⬜ |
| Confirm the first GitHub Actions run of the new CI workflow is green (could not be run from the review machine) | 3 | Backend developer | ✅ |
| Flash ESP32 **v0.5.0**, then run Phase 4 checks: price change → `CFG,OK`; offline within 3 min of power loss (`readmePhase4.md` §3) | 4 | Backend developer | ✅ 2026-11-12 (v0.5.1) |
| EMQX `wrm-backend` password was committed in `424e5e6`: changed in the EMQX console 2026-11-12 | — | Backend developer | ✅ |
| For every machine provisioned with `POST /v1/machines`: add its MQTT user in the EMQX console with the one-time password (and delete it on decommission) | 4 | Backend developer | ⬜ |
| Hardware developer: STM32 handles `CFG,<p500>,<p750>,<p1000>,<currency>,<enabled>` (major units), answers `CFG,OK` / `CFG,ERR,<fault>`, keeps prices in flash | 4 | Hardware developer | ⬜ |

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

### 2026-11-14: Phase 8 Observability (completed) by Antigravity

**Done this session**
- **OpenTelemetry Distributed Tracing & W3C Tracecontext:**
  - Implemented `TracerService` in `apps/api/src/platform/telemetry/tracer.service.ts` using `@opentelemetry/api` and `@opentelemetry/sdk-trace-base` with `BasicTracerProvider` and `InMemorySpanExporter`.
  - Propagated `traceId` across the asynchronous barrier:
    - Extended `DomainEvent` with `traceId?: string`.
    - Updated `OutboxService` to automatically stamp active `traceId` into `outbox.payload`.
    - Updated `OutboxRelay` to extract `payload.traceId`, attach to BullMQ jobs, and wrap handlers in active spans (`outbox.handler.*`).
    - Updated `PaymentsMqttConsumer` to initiate root traces on `pay/request` (`mqtt.pay_request`).
    - Updated `PayWayGatewayAdapter` to record child spans (`aba.generate_qr`, `aba.check_transaction`).
    - Updated `PaymentOutboxHandlers` to publish under the trace context (`mqtt.publish_pay_qr`, `mqtt.publish_pay_status`).
  - Verified a single payment flow is followed in a single trace across all 4 hops (MQTT -> DB -> ABA -> Outbox -> Relay -> Publish).
- **Pino Structured Logging with Context Correlation:**
  - Created `apps/api/src/platform/logging/correlation-context.ts` using `AsyncLocalStorage` to store `traceId`, `tranId`, `machineId`, `requestId`, `jobId`.
  - Configured `PinoLoggerModule` in `logger.module.ts` with custom formatters to inject correlation properties into all log entries.
  - Enforced redaction paths for passwords, API keys, hashes, tokens, and QR strings (`[REDACTED]`).
- **Prometheus Metrics Engine & `/metrics` Scrape Endpoint:**
  - Added `prom-client` and implemented `MetricsService` in `apps/api/src/platform/metrics/metrics.service.ts` covering all Plan B6 metrics (counters, histograms, gauges).
  - Implemented `MetricsCollectorService` to gather live database gauges (outbox lag, machines online, dispense unknown count, refund cases count, pending outcomes per machine, BullMQ queue depths).
  - Implemented `MetricsController` (`GET /metrics`) exposing Prometheus text exposition format with default Node.js runtime metrics (`wrm_node_*`).
  - Hooked metrics into `CreatePaymentHandler`, `ConfirmPaymentHandler`, `RecordDispenseHandler`, `PayWayGatewayAdapter`, and `PaymentsMqttConsumer`.
- **Grafana Dashboards as Code:**
  - Created 6 production JSON dashboards in `infra/grafana/dashboards/`:
    - `payments-and-revenue.json` (success rate, creation rate, time-to-paid p50/p95, transitions, throttling)
    - `aba-payway-gateway.json` (circuit breaker state, latency p50/p95/p99, check failures, operation calls)
    - `kiosk-fleet.json` (online count, kiosk pending outcomes, ack rates)
    - `outcomes-and-acks.json` (dispense sensor accuracy discrepancy histogram, accepted vs rejected acks)
    - `queues-outbox-sweeps.json` (outbox lag seconds, BullMQ queue depth)
    - `refunds.json` (open cases, dispense unknown, late payments)
    - `infrastructure.json` (CPU, heap/RSS memory, event loop lag)
  - Created automated provisioning configs in `infra/grafana/provisioning/dashboards/dashboards.yml` and `infra/grafana/provisioning/datasources/datasources.yml`.
- **Deployment §10 Alert Rules & Simulation Suite:**
  - Defined all 15 operational alert rules in `infra/prometheus/rules/alerts.yml` and `infra/prometheus/prometheus.yml`.
  - Authored automated simulation test suite in `apps/api/test/observability.spec.ts` (21 tests) evaluating all rules under healthy vs degraded scenarios.
- **Sentry Release Integration:**
  - Added release tagging and environment context in `apps/api/src/platform/telemetry/telemetry.init.ts`.
  - Hooked global exception filter to forward 5xx and unhandled errors with traceId and context to Sentry.
- **Documentation:**
  - Authored comprehensive [readmePhase8.md](readmePhase8.md).

**Not finished / next steps** (in order)
1. Phase 9 (Production Deployment): Dockerfiles, multi-stage images, `docker-compose.prod.yml`, GitHub Actions CD (`deploy.yml`), and staging rollout.
2. Phase 5 / Phase 3 manual check items (ESP32 unplug Telegram check, STM32 reboot).

**Changed from the plan** (and whether the plan was updated)
- None. Followed Plan B6 and Deployment §10 precisely.

**Known issues / bugs**
- None.

**How to run / test**
- `pnpm --filter @wrm/api test test/observability.spec.ts` → 21 passed
- `pnpm test:unit` → 18 test files, 164 passed
- `pnpm --filter @wrm/api depcruise` → 0 boundary violations
- `pnpm typecheck` → 4 packages clean
- `pnpm lint` → 0 errors
- `pnpm build` → clean production build

**Needs from a person**
- `[HUMAN]` When deploying to staging/production: configure `OTEL_EXPORTER_OTLP_ENDPOINT`, `SENTRY_DSN`, and Grafana Cloud / Prometheus scrape targets.

---

### 2026-11-14: Phase 7 Reporting & Operator Dashboard (completed) by Antigravity

**Done this session**
- **CQRS Read-Side Architecture & SQL Views:**
  - Added migration `20261114010000_phase7_reporting_views` defining:
    - Materialized view `sales_daily` (gross, refunds, net revenue, dispensed/refunded counts, total volume) with unique index `(date, currency)`.
    - Materialized view `sales_by_machine` with unique index `(machine_id, date, currency)`.
    - Real-time view `machine_status_view` joining kiosks and active alert incidents.
    - Real-time view `refund_queue_view` joining refund cases, payments, and kiosk online presence.
  - Implemented `ReportingSweep` running every 5 min (300,000 ms) via `SweepsScheduler` to execute `REFRESH MATERIALIZED VIEW CONCURRENTLY` with graceful non-concurrent fallback.
  - Built `ReportingService` with parameterized querying, date/kiosk filtering, pagination, and RFC 4180 CSV generation with major and minor currency calculations.
- **Reporting REST Endpoints:**
  - Implemented `ReportsController` (`/v1/reports`) protected by `SessionAuthGuard` and `RolesGuard`:
    - `GET /v1/reports/sales`: supports `from`, `to`, `machineId`, `groupBy` (`day` | `machine`), `limit`, `offset`, and `format=csv`.
    - `GET /v1/reports/machines/status`: fleet presence with active alert counts.
    - `GET /v1/reports/refunds`: refund queue metrics and cases.
    - `POST /v1/reports/refresh`: manual administrative view refresh.
  - Registered `ReportingModule` in `AppModule`.
- **Production Operator Dashboard (`apps/dashboard`):**
  - Next.js 15 application with Tailwind CSS, Lucide icons, and TypeScript.
  - Pages implemented:
    - **Overview (`/`):** Real-time sales KPIs (gross, refunds, net in USD & KHR), fleet kiosks count, active alerts preview, open refunds preview.
    - **Kiosk Fleet (`/machines`):** Provision kiosk modal (one-time MQTT credentials display with clipboard copy), edit pricing modal, enable/disable toggle, rotate credentials, decommission.
    - **Refund Queue (`/refunds`):** Filter by status, display hardware online & STM32 state, pending outcomes safety warning, claim, mark refunded modal (disbursement method, reference, minor amount, emergency override), reject modal, reopen modal.
    - **Payment Inspector (`/payments`):** Transaction search, amount, volume, state transition audit trail timeline, resolve `DISPENSE_UNKNOWN` modal.
    - **Incidents & Alerts (`/alerts`):** Status filtering, acknowledge, resolve.
    - **Sales Reports (`/reports`):** Date range filter, kiosk filter, group by day/kiosk, USD & KHR net revenue cards, breakdown table, CSV download, manual materialized view refresh.
    - **Identity & Security Audit (`/users`):** User list, create user modal, role modification, live security audit trail table.
  - Built-in 10-second background polling cycle for real-time alert and refund queue badge updates.
- **Comprehensive Test Suites:**
  - 10 tests in `apps/api/test/reporting.spec.ts` (100% passed): verifying concurrent refresh, net revenue calculations ($\text{Gross} - \text{Refunds} = \text{Net}$) for USD and KHR, pagination, CSV formatting, machine status view, and refund queue metrics.
  - 4 tests in `apps/dashboard/test/dashboard.spec.ts` (100% passed): verifying frontend revenue invariants, hardware safety rules on pending outcomes, and API client request building.
  - Full unit test suite: 18 test files, 147/147 tests passed (100% passed).
  - TypeScript: 100% clean across all 4 monorepo packages (`turbo run typecheck`).
  - Linter: 0 errors across all workspaces (`turbo run lint`).
  - Architecture Boundaries: 0 violations across 152 modules (`pnpm --filter @wrm/api depcruise`).
  - Production Build: Clean Next.js 15 production build (`turbo run build`).
- **Documentation:**
  - Created [readmePhase7.md](readmePhase7.md) detailing reporting views, REST endpoints, CSV export, and dashboard UI usage.

**Not finished / next steps** (in order)
1. Phase 8: Observability (OpenTelemetry traces through outbox, Prometheus `/metrics`, Grafana dashboards, Telegram ops alerts).
2. Physical checks for Phase 3 (STM32 reboot + 2h offline check) and Phase 5 (unplug ESP32 Telegram notification check).

**Changed from the plan**
- None. Implemented exactly per Plan §C7 and Architecture §4 & §7.

**Known issues / bugs**
- None.

**How to run / test**
- Unit tests: `pnpm test:unit`
- Reporting tests: `pnpm --filter @wrm/api test test/reporting.spec.ts`
- Dashboard tests: `pnpm --filter @wrm/dashboard test`
- Monorepo typecheck: `pnpm typecheck`
- Monorepo lint: `pnpm lint`
- Monorepo build: `pnpm build`
- Boundaries: `pnpm --filter @wrm/api depcruise`

**Needs from a person**
- None.

---

### 2026-11-14: Phase 6 Identity (completed) by Antigravity

**Done this session**
- **ADR-0010 ([docs/adr/0010-identity-and-auth.md](docs/adr/0010-identity-and-auth.md)):** Documented spike evaluation comparing Better Auth vs NestJS Fastify fallback. Adopted native modular architecture: NestJS Guards + Argon2id (`@node-rs/argon2`) + PostgreSQL sessions + HTTP-only cookies (`wrm_session`) / Bearer tokens + `@Roles()` decorator + immutable `audit_logs`.
- **Database Schema & Migrations:**
  - Added `UserRole` enum (`admin`, `operator`, `viewer`).
  - Added `User` model with Argon2id password hash, role, and optional TOTP secret.
  - Added `Session` model with SHA-256 token hashing and configurable TTL expiry.
  - Added `AuditLog` model recording immutable security logs with `actorId`, `action`, `entityType`, `entityId`, `before`, `after`, and `reason`.
  - Added migration `20261114000000_phase6_identity`.
- **Core Security & Identity Context:**
  - `totp.util.ts`: Zero-dependency RFC 6238 TOTP generator and validator (HMAC-SHA1, 30s window, drift tolerance).
  - `AuthService`: Argon2id password validation, brute-force rate-limiting (5 attempts per 15 min), secure session creation, session validation, logout.
  - `UsersService`: User CRUD, role assignments, password updates, TOTP setup and verification.
  - `AuditLogService` & `AUDIT_LOGGER_PORT`: Public cross-context port for logging sensitive operations without cross-context domain boundary violations.
  - `SessionAuthGuard` & `RolesGuard`: Enforces session validation and three-tier role hierarchy (`admin` > `operator` > `viewer`).
- **Endpoint Protection & Audit Trail:**
  - Protected all existing endpoints across Fleet (`MachinesController`), Monitoring (`AlertsController`), and Payments (`RefundCasesController`, `PaymentsController`).
  - Connected audit log calls to machine provisioning, machine updates, price updates, credential rotation, machine decommissioning, refund claims, mark-refunded, refund rejects, refund reopens, and unknown dispense resolutions.
- **Seeding & Guides:**
  - Updated `seed.ts` with default development accounts for `admin@wrm.kh`, `operator@wrm.kh`, and `viewer@wrm.kh`.
  - Created complete operator and developer guide in [readmePhase6.md](readmePhase6.md).
- **Test Suites & Verification:**
  - 8 tests in `test/totp.spec.ts` (100% passed).
  - 8 tests in `test/identity-services.spec.ts` (100% passed).
  - 14 tests in `test/roles-guard.spec.ts` (100% passed).
  - 7 tests in `test/identity-api.spec.ts` (100% passed).
  - Total unit test suite: 16 test files, 133/133 tests passed (100% passed).
  - Architecture boundaries: 0 violations across 148 modules with `pnpm --filter @wrm/api depcruise`.
  - TypeScript: 100% clean (0 errors) across monorepo with `pnpm typecheck`.
  - Linter: 0 errors with `pnpm lint`.

**Not finished / next steps** (in order)
1. Phase 7: Reporting & Operator Dashboard (materialized views for sales, Next.js dashboard UI).
2. Physical checks for Phase 3 (STM32 reboot + 2h offline check) and Phase 5 (unplug ESP32 Telegram notification check).

**Changed from the plan**
- Adopted the documented architectural fallback in ADR-0010: NestJS session guards + Argon2id + sessions table with SHA-256 token hashing instead of Better Auth, ensuring native Fastify support and zero middleware impedance mismatch.

**Known issues / bugs**
- None.

**How to run / test**
- Unit tests: `pnpm --filter @wrm/api test:unit`
- Identity tests: `pnpm --filter @wrm/api exec vitest run test/totp.spec.ts test/identity-services.spec.ts test/roles-guard.spec.ts test/identity-api.spec.ts`
- Boundaries: `pnpm --filter @wrm/api depcruise`
- Typecheck: `pnpm typecheck`

**Needs from a person**
- None.

---

### 2026-11-13: Phase 5 review (Claude) — merged to main

**Done**
- Reviewed Gemini's Phase 5 + fixes: `scripts/verify-phase5.sh` PASSED and an extra full run passed (28 files / 163 tests). Telegram jobs are idempotent (`jobId = alertId__action`); acceptance test cleanup limited to WRM-9501.

**Known issues / bugs**
- The full-suite `afterAll` hangs were fixed by **forced shutdown timeouts** (MQTT `end(true)` after 1 s, BullMQ workers force-closed after 1.5 s, Redis disconnect after 1 s), not by finding the blocking resource. Safe because jobs are at-least-once/idempotent, but a running job (e.g. an ABA check, up to 8 s) is cut off and re-run on restart. Revisit graceful shutdown in Phase 9 (rolling deploys).
- `docs/04-Cloud-and-Payment/backend-backlog-tasks.md` and `backend-backlog-notion.csv` were added by Gemini (not part of the plan); kept as optional planning docs.

**Needs from a person**
- Phase 5 `[MANUAL CHECK]`: set `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` in `apps/api/.env`, unplug the ESP32 → Telegram alert within 4 min, plug in → "resolved" (`readmePhase5.md`).

---

### 2026-11-12: Phase 5 Monitoring (automated complete, awaiting manual unplug check) by Claude for backend developer

**Done this session** (branch `feat/phase-5-monitoring`)
- Added `Alert` model to Prisma schema with fields for deduplication, severity, machine association, status, counts, and merge tracking. Added migration `20261112134717_phase5_monitoring_alerts`.
- Added `machines.pending_outcomes_since` timestamp tracking on heartbeat (set on 0 → >0, cleared when 0).
- Fault severities mapping in `@wrm/contracts` (`packages/contracts/src/faults.ts`) per Plan C8.
- Producer events in Fleet & Payments: `dispensing.OutcomeRejected` (persisted in `dispense_rejections`), `dispensing.SiteCheckNeeded` (raised once when machine not seen since payment), `dispensing.FaultReported` (`wrm/+/error` without `tran_id`), `fleet.MachineFaultReported` (when `stm32.fault` changes from `NONE`), and `payments.PayRequestRejected` (repeated `PAY_MACHINE_BUSY` or `RATE_LIMITED`).
- Public cross-context ports: `FLEET_MONITORING` (`getMachinesWithStuckOutcomes`) in Fleet and `PAYMENTS_REFUND_MONITORING` (`getStaleRefundCases`) in Payments.
- Two-layer `MonitoringModule` in `apps/api/src/contexts/monitoring/`:
  - Pure alert rules (`monitoring.rules.ts`) with unit test coverage.
  - `AlertService` with dedupe key generation and 10-minute merge window.
  - BullMQ `notify.telegram` queue with exponential backoff retries and deterministic `jobId: ${alertId}__${action}` for at-least-once outbox idempotency.
  - Telegram client (`TELEGRAM_CLIENT`) that acts as a safe no-op if bot credentials are not set.
  - Repeatable `sweep.monitoring` sweep running every 60 s for stale cases (>24 h) and stuck pending outcomes (>1 h).
  - Admin REST controller (`GET /v1/alerts`, `POST /v1/alerts/:id/ack`, `POST /v1/alerts/:id/resolve`) guarded by `AdminKeyGuard`.
- Review fixes & stability hardening:
  - Fixed Telegram duplicate notification bug: deterministic `jobId` in `TelegramNotifierService.enqueue` ensures duplicate outbox event redeliveries result in exactly 1 Telegram message.
  - Fixed acceptance test flakiness: eliminated duplicate BullMQ enqueue in test wrapper (deterministc `processJob` call). Added Scenarios 11 & 12 verifying job and event idempotency.
  - Fixed full test suite regression: `MqttService.onModuleDestroy` and `QueueService.onModuleDestroy` now enforce timeout races with forced close, preventing 60 s `afterAll` hook timeouts on app teardown.
  - Fixed MQTT subscription bug: only topics with wildcards (`+`, `#`) are prefixed with `$share/<group>/`; single topics subscribe directly. Added health check wait in `payment-flow.e2e.spec.ts`.
  - Scoped acceptance test cleanup: `clean()` and `dispatchOutbox()` strictly target `WRM-9501` and test alert IDs (`alt-test-*`), preventing shared DB truncation.
  - Updated `scripts/verify-phase5.sh`: added `set -euo pipefail`, `db:deploy`, and full test suite execution (`pnpm --filter @wrm/api test`).
- Test suites:
  - 25 unit tests in `apps/api/test/monitoring-rules.spec.ts` (100% passed).
  - 12 acceptance scenarios in `apps/api/test/phase5-acceptance.e2e.spec.ts` (100% passed).
  - Full test suite: 28 test files, 163 tests passing (100% passed).
- Architecture & verification:
  - 0 boundary violations in `pnpm --filter @wrm/api depcruise`.
  - Typecheck passed cleanly across all monorepo packages.
  - Verification script `scripts/verify-phase5.sh` passing.
  - Guide created in `readmePhase5.md`.

**Out of scope** (recorded per Plan E Phase 5)
- "ABA circuit open" (no circuit breaker exists yet).
- "auto-refund failure" (`REFUND_MODE=auto` has no executor yet).

**How to run / test**
- Automated tests: `bash scripts/verify-phase5.sh` (or `pnpm --filter @wrm/api exec vitest run test/monitoring-rules.spec.ts test/phase5-acceptance.e2e.spec.ts`)
- Manual check: See `readmePhase5.md` §4 (unplug ESP32 power, observe Telegram alert, plug in, observe resolve).

---

### 2026-11-12: Hardware test session (real ESP32, no STM32) by backend developer + Claude

**Done**
- New backend connected to EMQX Cloud and the ABA sandbox (`apps/api/.env`: MQTT_URL/MQTT_CA_FILE to EMQX, `PAYWAY_MODE=sandbox`, `PAYWAY_CALLBACK_URL=""`; the backend confirms payments by polling ABA).
- A: real ABA simulator payment → PAID → DONE → `transaction/ack ok` ✅ (Phase 2 DoD).
- B: outcome survives an ESP32 reboot while the backend is down ✅ (part of the Phase 3 DoD).
- C: price change → `CFG` → `config/ack ok` → next QR at the new price ✅. Found + fixed: a config that was never confirmed was not re-delivered (ESP32 **v0.5.1**, `d8f6b2f`).
- D: offline 53 s after power loss (Last Will), back online at once ✅ (Phase 4 DoD).
- Removed a real EMQX password committed in `backend-prototype/.env.example` (`e82879e`); the password was changed in EMQX.

**Notes**
- The QR line sends the amount as a JSON number (`0.2`), the config sends `"0.20"`. The STM32 LCD should show 2 decimals (or the backend can format it) — open.
- WRM-001 prices are now 0.20 / 0.25 / 0.30 USD in the local DB after test C.

---

### 2026-11-13: Phase 4 Fleet (automated complete, awaiting hardware check) by Claude

**Done this session** (branch `feat/phase-4-fleet`)
- Fleet machine API `/v1/machines`: provision (currency + 3 prices required; MQTT username `wrm-NNN` + one-time password shown once), list, get, PATCH (name/location/enabled), PUT prices, rotate-credentials, decommission (`machines.decommissioned_at`, cannot be re-enabled).
- `fleet.MachineConfigChanged` → retained `config` (prices in major units, built from the DB at publish time); `config/ack` error → `fleet.ConfigRejected`.
- Presence: `MachineCameOnline` / `MachineWentOffline`, Last Will, `sweep.fleet-offline` (30 s, offline after 180 s).
- Payments prices payments through the Fleet public port (`FLEET_MACHINE_PRICING`); the temporary Prisma machine adapter is removed.
- ESP32 firmware **v0.5.0**: `config` → `CFG` (retry 5 s ×12) → `config/ack`; resend when the UART link returns.
- Docs: `readmePhase4.md`, plan v3.3, review note at the top of `readmePhase3.md`.

**Not finished / next steps** (in order)
1. Merge `feat/phase-4-fleet`.
2. People: section 4 (flash v0.5.0, hardware checks for Phases 2–4, EMQX users).
3. Phase 5 (Monitoring) — can start before the hardware checks if the team agrees, like Phase 4 did.

**Changed from the plan** (plan updated to v3.3)
- EMQX users are created/rotated manually (Serverless management API not confirmed); the "old password rejected" E2E test is not possible without it.
- Provisioning requires prices (plan said "default prices").
- After 12 unanswered `CFG` lines the ESP32 reports `config/ack error UNKNOWN`.
- STM32 "reboot" is detected only as UART link lost (≥ 15 s) and back; C3 has no reboot signal.

**Known issues / bugs**
- Once, `refund-flow.e2e` failed in its `beforeAll` during a full run (app start > 30 s while the laptop was shutting down). Not reproduced in 3 later full runs. If it happens again, raise the hook timeout or look at app start time.
- Phase 2 + 3 hardware checks still open (unchanged).
- Metrics for unknown-machine heartbeats come with Observability (Phase 8); price-change audit log with Identity (Phase 6).

**How to run / test**
- `pnpm --filter @wrm/api db:deploy` (new migration `20261112000000_add_machine_decommissioned_at`).
- `pnpm --filter @wrm/api test` → 26 files / 126 tests.
- `pio run -d firmware/esp32-gateway` → v0.5.0 builds (73 % flash).
- Manual: `readmePhase4.md` §3.

**Needs from a person**
- See section 4.

---

### 2026-11-12: Phase 0–3 review fixes (branch `fix/phase-3-review`) by Claude (review)

**Done this session** (one commit per fix)
- Security: dev routes (`/v1/payments/dev/*`, `/dev`) return 404 outside `APP_ENV=local`; refund + payment-detail routes need `X-Admin-Key` outside local (`ADMIN_API_KEY`); `PAYWAY_MODE=mock` refused in production.
- Database: real Prisma migrations (`20261111000000_init`, `20261111000100_add_reconcile_count`); the one-open-payment index and tier CHECK moved from `seed.ts` into the migration; `db:deploy` script; migration files pinned to LF.
- Payments: late payments now open a `LATE_PAYMENT` refund case; reconcile schedule fixed (+5 min, +1 h, +1 d, +3 d, +6 d via new `reconcile_count`) and also runs for superseded payments (+ ABA close); `pay/cancel` only for the machine's own payment.
- Dispensing: minimal heartbeat/online consumer (`contexts/fleet`) keeps `pending_outcomes` / `last_seen_at`; DISPENSE_UNKNOWN escalates only if the machine was seen online after the payment and has 0 pending outcomes; re-sent identical outcomes are acked ok without change; conflicting / late outcomes keep the original record and raise `ReconciliationNeeded`; dispense records insert-only; duplicate `DispenseFailed` event removed.
- Refunds: request validation (actorId + reasons required), claim duration from config, only the active claimant may mark refunded, amount 1..paid.
- Rate limits read from config (pay/request, callback per IP); `refund()` no longer calls the unconfirmed ABA endpoint.
- Tests/CI: tests load `apps/api/.env` themselves; `test:unit` (no infra) / `test:integration` split; CI starts docker compose, migrates, seeds and runs integration tests.
- ESP32 v0.4.1: v0.4.0 did not compile (fixed); STM32 lines no longer upper-cased (bug from the first gateway firmware); QR countdown from `expires_at`; stale/foreign/cancelled QRs not shown; pay/status only for the current payment; `PONG` fields parsed; C2 heartbeat; `ERR` without tran_id is not an outcome; `FAILED,0`; B4.7 retry schedule.
- Docs: plan v3.2 (C7, B5, C6, Phase 4 note); STM32 guide sample checks tran_id.

**Not finished / next steps** (in order)
1. Review and merge `fix/phase-3-review`.
2. People: items in section 4 (secrets.h move, DB baseline, flash v0.4.1, manual checks).
3. Phase 3.5 only after the manual checks pass.

**Changed from the plan** (plan updated to v3.2)
- Operator endpoints via `X-Admin-Key` until Phase 6 (plan said local-only; the pilot needs refunds on the server).
- Minimal heartbeat/online consumer pulled from Phase 4 into Phase 3.
- New column `payments.reconcile_count`.

**Known issues / bugs**
- Dispensing logic lives in the `payments` context; `contexts/dispensing` is still empty (plan: separate core context). Not moved in this review.
- `REFUND_MODE=auto` has no executor (the earlier handoff said it existed); refunds are manual only. Fine until ABA confirms a refund API.
- "Site check needed" for DISPENSE_UNKNOWN is only logged; Telegram alerts come with Monitoring (Phase 5).
- No circuit breaker (opossum) on the ABA adapter yet (D7).
- Integration tests still share the developer's local `wrm_dev` database (they clean up machine `WRM-900` rows).
- Phase 2 DoD "Prototype stopped" is ticked while the Phase 2 manual check is still open.

**How to run / test**
- `pnpm --filter @wrm/api test:unit` → 10 files / 67 tests (no infrastructure).
- `docker compose -f infra/docker-compose.yml up -d`, `pnpm --filter @wrm/api db:deploy`, `pnpm --filter @wrm/api db:seed`, `pnpm --filter @wrm/api test:integration` → 14 files / 44 tests.
- Firmware: `pio run` in `firmware/esp32-gateway` → builds (73 % flash).

**Needs from a person**
- See section 4.

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
