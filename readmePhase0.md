# Phase 0: Foundations — Completion Report

## 1. Executive Summary

Phase 0 establishes an empty but production-shaped TypeScript monorepo where architecture rules, context boundaries, and quality checks are strictly enforced by CI from day one.

The existing prototype backend was preserved and moved to `backend-prototype/` and verified to run without regressions.

---

## 2. Tasks Completed in Phase 0

### Task 1: Directory Restructuring
* Renamed `backend/` → `backend-prototype/` (remains active for testing until Phase 3 cutover).
* Renamed `esp32-gateway/` → `firmware/esp32-gateway/`.
* Updated git ignore rules, PlatformIO upload paths, and quickstart documentation.
* Verified `backend-prototype/` tests pass (`3 pass, 0 fail`).

### Task 2: Monorepo & Tooling Setup
* Configured `pnpm-workspace.yaml` covering `apps/*` and `packages/*`.
* Configured Turborepo (`turbo.json`) with pipeline tasks for `build`, `typecheck`, `lint`, `depcruise`, `test`, `test:unit`, and `test:integration`.
* Pinned Node.js 22 LTS in `.nvmrc` and `package.json` engines.
* Created `@wrm/tsconfig` workspace package with strict compiler options:
  * `base.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `target: ES2022`, `module: NodeNext`.
  * `nest.json`: Adds `emitDecoratorMetadata` and `experimentalDecorators` for NestJS.
* Created `@wrm/contracts` workspace package exporting shared error codes (`ERROR_CODES`), fault codes (`FAULT_CODES`), and MQTT topic definitions (`MQTT_TOPICS`).

### Task 3: Applications Scaffold (`apps/api`)
* Initialized `apps/api` with **NestJS 11** and **Fastify** (`@nestjs/platform-fastify`).
* Implemented `src/main.ts` with runtime role booting based on `RUN_MODE`:
  * `all` (default): boots both HTTP API server and background workers.
  * `api`: boots only Fastify HTTP API server.
  * `worker`: boots only background workers / outbox relay.
* Scaffolded domain directories according to Part B1 & B2 rules:
  * **Core contexts (4 layers):**
    * `src/contexts/payments/` (`domain`, `application`, `infrastructure`, `interface`)
    * `src/contexts/dispensing/` (`domain`, `application`, `infrastructure`, `interface`)
  * **Supporting contexts (2 layers):**
    * `src/contexts/fleet/` (`application`, `interface`)
    * `src/contexts/monitoring/` (`application`, `interface`)
    * `src/contexts/identity/` (`application`, `interface`)
    * `src/contexts/reporting/` (`application`, `interface`)
  * **Shared kernel & platform:**
    * `src/shared-kernel/` (DomainEvent, AggregateRoot, Id, Money, Clock, base errors)
    * `src/platform/` (Config, DB, Outbox, Inbox, MQTT, Queue, RateLimit, Logging, Telemetry)

### Task 4: Linting, Formatting & Architecture Boundaries
* Configured ESLint (`eslint.config.mjs`) with `@typescript-eslint` strict rules.
* Configured Prettier (`.prettierrc` and `.prettierignore`).
* Configured `dependency-cruiser` (`.dependency-cruiser.cjs`) enforcing:
  * Core `domain` layer may only import `shared-kernel` (no framework, DB, or outer layers).
  * `application` layer cannot import `infrastructure` or `interface`.
  * `infrastructure` cannot import `interface`.
  * `interface` cannot import `domain` internals or `infrastructure` directly.
  * Context boundary isolation: no context may import internals of another context.
* Added automated boundary verification test asserting clean architecture and proving deliberate cross-layer imports fail with an error.

### Task 5: Testing Framework
* Configured **Vitest 3** with `unplugin-swc` for fast native TypeScript execution.
* Unit test: `src/shared-kernel/money.spec.ts` testing KHR (scale 0) and USD (scale 2) minor units arithmetic.
* Architecture test: `test/architecture-boundaries.spec.ts` testing zero boundary violations on source code and verifying cross-layer import rejection.
* Smoke test: `test/testcontainers.smoke.spec.ts` validating Docker / Testcontainers integration with a containerized Redis instance.

### Task 6: Local Infrastructure (`infra/docker-compose.yml`)
* Created `infra/docker-compose.yml` defining:
  * **PostgreSQL 16** (`postgres:16-alpine`) on port `5434:5432` with healthcheck (`pg_isready`).
  * **Redis 7** (`redis:7-alpine`) on port `6379:6379` with healthcheck (`redis-cli ping`).
  * **Mosquitto 2** (`eclipse-mosquitto:2`) on port `1883:1883` with password file generation (`mosquitto_passwd`) and ACL rules (`infra/mosquitto/acl.txt`).
* Verified all 3 containers start and reach `healthy` status cleanly.

### Task 7: GitHub Actions CI Workflow
* Created `.github/workflows/ci.yml` running on push/PR to `main`:
  `checkout` → `setup-node (22)` → `pnpm install` → `lint` → `typecheck` → `depcruise` → `test:unit` → `test:integration` → `build`.

### Task 8: `[HUMAN]` Branch Protection
* Requirements documented in Section 4 below for GitHub repository settings.

### Task 9: Architecture Decision Records (ADRs)
* Authored and committed foundational ADRs in `docs/adr/`:
  1. `0001-modular-monolith.md`
  2. `0002-ddd-core-only-hexagonal.md`
  3. `0003-transactional-outbox.md`
  4. `0004-postgres-prisma-only.md`
  5. `0005-bullmq-and-db-driven-sweeps.md`
  6. `0006-error-handling-and-idempotency.md`
  7. `0007-payment-state-machine.md`
  8. `0008-refund-policy-and-mode.md`
  9. `0011-no-pgbouncer-at-start.md`

### Task 10: `[HUMAN]` External Communications
* Ready-to-send messages for ABA integration support and the STM32 developer prepared in Section 5 below.

---

## 3. Definition of Done Verification

| Criteria | Status | Details |
|---|---|---|
| Clean clone: `pnpm i && pnpm build && pnpm test` | ✅ Passed | All workspace packages build, typecheck, and pass tests cleanly. |
| Local compose starts postgres, redis, mosquitto | ✅ Passed | Tested and verified healthy with `docker compose -f infra/docker-compose.yml up -d`. |
| A deliberate cross-layer import fails CI | ✅ Passed | Verified by `test/architecture-boundaries.spec.ts` using deliberate fixture. |
| ADRs merged | ✅ Passed | ADRs 0001–0008 and 0011 created in `docs/adr/`. |
| Prototype still runs from `backend-prototype/` | ✅ Passed | Verified with `cd backend-prototype; npm test` (3/3 pass). |
| `[MANUAL CHECK]` ABA questions & STM32 acceptance | ⏳ Ready | Message texts prepared below for human developer to send. |

---

## 4. Human Task: Enable GitHub Branch Protection on `main`

Go to your GitHub repository: **Settings → Branches → Add branch protection rule** for `main`:
1. Check **Require a pull request before merging** (Require approvals: 1).
2. Check **Require status checks to pass before merging**:
   * Status checks: `Build, Lint & Test`.
   * Check **Require branches to be up to date before merging**.
3. Check **Do not allow bypassing the above settings**.
4. Save changes.

---

## 5. Human Task: Ready-to-Send External Messages

### A. Message for ABA Integration Support
**Subject:** Technical Questions regarding ABA PayWay KHQR Integration (Merchant: [Insert Merchant Name])

> Dear ABA PayWay Integration Support Team,
>
> We are integrating ABA PayWay KHQR into an unattended IoT vending machine system in Cambodia. We have successfully tested the KHQR sandbox generation and status check flow. To finalize our production architecture, we would appreciate your clarification on the following technical questions:
>
> 1. **Close Transaction:** Does a Close-Transaction API exist for KHQR transactions? What are its request fields and endpoints? Does closing a transaction prevent a customer from paying a displayed QR afterwards, and can an unpaid `tran_id` be safely closed?
> 2. **Duplicate `tran_id` Handling:** In the `generate-qr` endpoint, does submitting an existing `tran_id` always return error code `403` without creating a duplicate charge or changing existing payment status?
> 3. **Check-Transaction Date Window & Settlement Reports:** Is `check-transaction-2` strictly limited to transactions created within the last 7 days? Is there an automated daily settlement/report API by date range for accounting reconciliation?
> 4. **Check-Transaction Status Code `6`:** Does status code `6` definitively mean "transaction not found / not paid yet"?
> 5. **QR Lifetime:** What is the allowed range and unit for the `lifetime` field in `generate-qr` (e.g. integer minutes, minimum 3 minutes)?
> 6. **Pushback Callbacks:** What is ABA's callback retry policy when our webhook endpoint is temporarily unreachable? What are ABA's webhook source IP addresses for firewall whitelisting, and what is the expected HTTP response timeout?
> 7. **Refund API for KHQR:** Is there an API endpoint available for programmatic KHQR refunds (full and/or partial)? If so, what is the API specification and what does `payment_status_code` become after a refund?
> 8. **Rate Limits:** What are the official request rate limits (requests per second/minute) for `generate-qr` and `check-transaction-2` in sandbox and live environments?
>
> Thank you for your support and guidance.
>
> Best regards,  
> Backend Engineering Team

---

### B. Message for STM32 Hardware Developer
**Subject:** Review & Acceptance of UART Contract v1 (C3) and Fault Codes (C8)

> Hi,
>
> We have completed Phase 0 of the cloud backend and established the formal UART and fault code contracts between STM32 and ESP32.
>
> Please review and confirm acceptance of the following:
>
> 1. **UART Contract v1 (Plan §C3):**
>    * Baud rate: `115200 8N1`, text lines ending with `\n`.
>    * Flow:
>      * Customer selects volume: STM32 sends `REQ_PAY,<volume_ml>` (tiers: 500, 750, 1000).
>      * ESP32 receives QR from cloud and sends `QR,<tran_id>,<amount>,<currency>,<remaining_s>,<qr_string>`.
>      * Once customer pays, ESP32 sends `PAID,<tran_id>` (repeated every 2 s until acknowledged).
>      * STM32 acknowledges with `PAID,ACK,<tran_id>` when ready to dispense, or `PAID,REJECT,<tran_id>,<fault>` if unable.
>      * After dispensing, STM32 reports outcome: `DONE,<tran_id>,<flow_ml>,<weight_g>` or `PARTIAL,<tran_id>,<flow_ml>,<weight_g>,<fault>`.
>      * ESP32 stores outcome in non-volatile storage (NVS) and responds `ACK,<tran_id>`.
> 2. **STM32 Safety Rules (Non-negotiable):**
>    * **Autonomous Cut-off:** STM32 must stop pump/valves immediately on target volume reached, bottle removed, dispense timeout (60 s), or tank empty. Never wait for ESP32.
>    * **Bottle Timeout:** After `PAID,ACK`, if customer does not place a bottle within 60 s, STM32 sends `PARTIAL,<tran_id>,0,0,BOTTLE_TIMEOUT` and returns to idle.
>    * **Shown QR Matching:** STM32 accepts `PAID,<tran_id>` only if `tran_id` matches the QR currently on screen.
>    * **Outcome Persistence:** STM32 must persist the last outcome in non-volatile memory (EEPROM/Flash) and resend every 2 s until `ACK,<tran_id>` is received (persisting across reboots).
>    * **Link Loss:** If no `PING` from ESP32 for 15 s, show "Offline" when idle.
> 3. **Fault Codes (Plan §C8):**
>    * Valid codes: `NONE`, `TANK_EMPTY`, `TANK_LOW`, `NO_FLOW`, `OVERFLOW`, `BOTTLE_REMOVED`, `BOTTLE_TIMEOUT`, `DISPENSE_TIMEOUT`, `LOADCELL_FAULT`, `FLOW_SENSOR_FAULT`, `VALVE_FAULT`, `PUMP_FAULT`, `PAID_NOT_ACCEPTED`, `POWER_LOSS_RECOVERY`, `CFG_INVALID`, `UNKNOWN`.
>
> **Questions for you:**
> 1. Do you accept the C3 safety rules and C8 fault codes as specified?
> 2. What non-volatile storage (internal flash sector, EEPROM, FRAM) will the STM32 use to retain the last outcome across power loss?
>
> Thanks!

---

## 6. How to Run & Verify Locally

```bash
# 1. Install dependencies
pnpm install

# 2. Run linting & typecheck
pnpm run lint
pnpm run typecheck

# 3. Check architecture boundaries
pnpm run depcruise

# 4. Run unit tests
pnpm run test:unit

# 5. Run integration tests (requires Docker Desktop)
pnpm run test:integration

# 6. Build all workspace packages
pnpm run build

# 7. Start local infrastructure (Postgres, Redis, Mosquitto)
docker compose -f infra/docker-compose.yml up -d

# 8. Check infrastructure health
docker compose -f infra/docker-compose.yml ps

# 9. Verify prototype backend
cd backend-prototype
npm test
```

Phase 0 is complete. The repository is ready for **Phase 1: Platform**.
