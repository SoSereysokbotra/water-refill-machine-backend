# Phase 2: Payments — Implementation & Verification Guide

This document details the completed implementation of **Phase 2: Payments (+ minimal outcome recording, cut-over)** for the Water Refill Machine monorepo.

Phase 2 replaces the temporary prototype payment logic with a production-grade, domain-driven payment architecture enforcing transactional idempotency, status-aware resends, dynamic ABA PayWay KHQR generation, database-driven sweep reconciliation, and ESP32 gateway firmware v0.3.0.

---

## 1. Architecture Components Implemented

### 1.1 Contracts (`packages/contracts/src/mqtt.ts`)
- **`PayRequestV1` & `LegacyPayRequest`**: Validates `{ v: 1, request_id, volume_ml, currency? }` with backward-compatible parsing for legacy prototype payloads.
- **`PayCancelV1`**: Validates cancellation requests `{ v: 1, tran_id?, request_id?, reason? }`.
- **`PayQrV1`**: Validates QR broadcast `{ v: 1, request_id, tran_id, qr_string, amount, currency, volume_ml, expires_at }`.
- **`PayStatusV1`**: Standardized payment terminal/active status payload `{ v: 1, tran_id, request_id?, status, reason? }`.
- **`TransactionV1` & `LegacyTransaction`**: Outcome reporting `{ v: 1, tran_id, result: "ok"|"partial"|"error", flow_ml, weight_g, fault?, ts? }`.
- **`TransactionAckV1`**: Outcome acknowledgment `{ v: 1, tran_id, status: "ok"|"rejected", reason? }`.

### 1.2 Database Schema & Migrations (`apps/api/prisma/schema.prisma`)
- **`machines`**: Provisioned machine records with optimistic lock `version`, online heartbeat tracking, and MQTT credentials.
- **`machine_prices`**: Enforces valid vending tiers with PostgreSQL check constraint `CHECK (volume_ml IN (500, 750, 1000))`.
- **`payments`**: Core financial records with optimistic locking `version` and the partial unique index:
  ```sql
  CREATE UNIQUE INDEX one_open_payment_per_machine ON payments(machine_id) WHERE status IN ('PENDING','PAID');
  ```
  Guarantees that a machine cannot hold two open payments simultaneously.
- **`payment_events`**: Immutable audit log of every payment state transition (`fromStatus`, `toStatus`, `reason`, `at`).
- **`dispenses`**: Outcome persistence recording dual-check sensor data (`flow_ml`, `weight_g`), accuracy diff percent (`diff_percent`), and clock-skew detection.
- **`dispense_rejections`**: Stores malformed, wrong-machine, or unpaided dispense outcomes.
- **`refund_cases`**: Tracks late payments and suggested refund cases.
- **Seeds (`apps/api/prisma/seed.ts`)**: Seeds pilot machine `WRM-001` and lab test machine `WRM-900`.

### 1.3 Domain Layer (`src/contexts/payments/domain/`)
- **`Payment` Aggregate Root**: Full state machine implementing Plan §C1:
  - `PENDING`: Initial state upon QR generation.
  - `PAID`: Confirmed within `expires_at + grace` via callback or sweep.
  - `EXPIRED` / `CANCELLED` / `FAILED`: Terminal unpaid states triggering ABA `close-transaction` and scheduling reconcile probes.
  - `REFUND_REVIEW`: Automatically entered if approval arrives after expiry (**Late Payment**), or if dispense reports partial/error.
  - `DISPENSED`: Physical dispense verified successfully by machine sensors.
- **Idempotency & Replay Rules (Plan §D2 / §D5)**:
  - `markPaid` is idempotent across all states.
  - If approval arrives while `PENDING` but past grace -> automatically transitioned to `EXPIRED` then escalated to `REFUND_REVIEW`.
  - Machine is **never** told to dispense water for a late payment.

### 1.4 Infrastructure Layer (`src/contexts/payments/infrastructure/`)
- **`PrismaPaymentRepository`**: Transactional data access, optimistic lock retry support, and state change audit recording.
- **`PrismaMachineAdapter`**: Resolves machine availability and price lists.
- **`PayWayGatewayAdapter` (Plan §D7 / §C10)**:
  - Real ABA PayWay HTTP client with SHA-512 HMAC signatures.
  - **Per-Operation Code Mapping (ADR-0009)**:
    - `generate-qr`: Code `0` -> success; Code `403` -> `DuplicateTranIdError` (regenerates `tran_id` up to 3 times); Code `8` / `429` -> `GatewayUnavailableError`.
    - `check-transaction-2`: Code `00` + `0` -> `approved`; Code `00` + `2` -> `pending`; Code `00` + `3`/`7` -> `declined`; Code `00` + `4` -> `refunded`; **Code `6` -> `not_found` (treated as pending, not error)**.
- **`MockPayWayGateway`**: High-performance mock gateway for deterministic automated tests and offline simulation.

### 1.5 Application Layer (`src/contexts/payments/application/`)
- **`CreatePaymentHandler` (Plan §D5)**:
  - Rate-limited per machine token bucket.
  - Status-aware replay table: duplicate `request_id` returns existing payment without creating rows.
  - Atomic supersede: cancels older `PENDING` payment for that machine in the same database transaction.
  - Machine busy check: blocks request with `PAY_MACHINE_BUSY` if another customer's payment is already `PAID`.
- **`ConfirmPaymentHandler`**: Marks payment `PAID` within `UnitOfWork` and emits `payments.PaymentPaid` domain event.
- **`ExpirePaymentHandler`**: Final ABA check before expiry; closes transaction with PayWay; starts reconcile schedule at +5 min.
- **`CancelPaymentHandler`**: Cancels pending payment and closes transaction.
- **`RecordDispenseHandler` (Plan §D6)**:
  - Records sensor flow & weight in `dispenses`.
  - Moves `PAID` -> `DISPENSED` for `ok`.
  - Handles duplicate transaction outcomes idempotently.
- **Sweeps Framework**:
  - `PaymentsSweep` (`sweep.payments`): Runs every 3 seconds; verifies pending payments with PayWay; handles timely approvals and expirations.
  - `ReconcileSweep` (`sweep.reconcile`): Runs every 5 minutes; probes terminal unpaid payments at +5m, +1h, +1d, +3d, +6d; catches dropped callbacks and late payments.

### 1.6 Interface Layer (`src/contexts/payments/interface/`)
- **MQTT Consumer (`payments.mqtt-consumer.ts`)**:
  - Subscribes via shared group `$share/backend/wrm/+/...` to `pay/request`, `pay/cancel`, and `transaction`.
  - Automatically dispatches `pay/status` or `transaction/ack` back to machines.
- **Outbox Handlers (`payment-outbox.handlers.ts`)**:
  - Listens to outbox domain events and publishes `pay/qr` (with MQTT 5 `messageExpiryInterval`), `pay/status`, and `transaction/ack`.
- **REST Controller (`payments.controller.ts`)**:
  - `POST /v1/payway/callback` and `POST /v1/payments/aba/callback`: Always returns 200 immediately; enqueues verification job to BullMQ `payments.confirm`.
  - `GET /v1/payments/:tranId`: Public transaction status query.
  - `POST /v1/payments/dev/simulate`: Offline payment approval simulator.

### 1.7 ESP32 Firmware v0.3.0 (`firmware/esp32-gateway/`)
- Generates 16-character hexadecimal `request_id` using ESP32 hardware RNG (`esp_random()`).
- Application-level retry policy: retries `pay/request` every 5s up to 3 times before timing out.
- Local cancel support: typing `C` or sending UART `CANCEL` sends `pay/cancel` and clears local state.
- Stale/foreign QR guard: discards any incoming `pay/qr` matching a foreign `request_id`.
- Dynamic remaining seconds passed in UART `QR` frame to STM32.
- Emits `transaction` on dispense complete (`DONE`) and listens for `transaction/ack`.

---

## 2. Verification & Automated Test Results

All 16 test suites (57 tests) pass with zero errors and zero architectural boundary violations:

```bash
$ pnpm test
 ✓ test/retention.integration.spec.ts (2 tests)
 ✓ test/payway-code-mapping.spec.ts (10 tests)
 ✓ test/payment-flow.e2e.spec.ts (1 test)
 ✓ test/payment-sweeps.integration.spec.ts (3 tests)
 ✓ test/payment.aggregate.spec.ts (8 tests)
 ✓ test/outbox-relay.integration.spec.ts (2 tests)
 ✓ test/platform.e2e.spec.ts (3 tests)
 ✓ test/payment-concurrency.integration.spec.ts (3 tests)
 ✓ test/unit-of-work.integration.spec.ts (3 tests)
 ✓ src/shared-kernel/money.spec.ts (8 tests)
 ✓ test/errors.spec.ts (4 tests)
 ✓ test/sweeps.integration.spec.ts (1 test)
 ✓ test/shared-kernel.spec.ts (3 tests)
 ✓ test/architecture-boundaries.spec.ts (2 tests)
 ✓ test/config.spec.ts (3 tests)
 ✓ test/testcontainers.smoke.spec.ts (1 test)

Test Files  16 passed (16)
     Tests  57 passed (57)
```

### Key Automated Scenarios Verified:
1. **Concurrency DoD**: 20 parallel `pay/request` calls for one machine leave exactly **one** open payment; all others are cleanly superseded or rejected.
2. **Machine Busy DoD**: While a payment is `PAID` awaiting dispense, new requests are rejected with `PAY_MACHINE_BUSY`.
3. **Sweeps DoD**: With the callback endpoint completely disabled, payments still confirm via `payments.sweep`.
4. **Reconcile DoD**: Late approvals occurring past expiration are discovered by `reconcile.sweep` at +5 min and transitioned to `REFUND_REVIEW`.
5. **End-to-End Pipeline**: Full MQTT flow: `pay/request` -> `pay/qr` -> PayWay callback -> `pay/status paid` -> `transaction DONE` -> `dispenses` recorded + `transaction/ack ok`.

---

## 3. How to Test & Run Locally

### Step 1: Ensure Local Infrastructure Is Running
```powershell
docker compose -f infra/docker-compose.yml up -d
```
Verifies PostgreSQL (port 5434), Redis (port 6379), and Mosquitto (port 1883).

### Step 2: Push Database Schema & Seed Machines
```powershell
pnpm --filter @wrm/api db:push
pnpm --filter @wrm/api db:seed
```
Seeds `WRM-001` and `WRM-900` with pricing tiers (500 mL, 750 mL, 1000 mL).

### Step 3: Run the Test Suites
```powershell
# Run all unit, integration, and E2E tests
pnpm test

# Run dependency-cruiser architecture boundary checks
pnpm --filter @wrm/api depcruise
```

### Step 4: Boot the Backend in Development Mode
```powershell
pnpm --filter @wrm/api dev
```
Starts NestJS Fastify on `http://localhost:3000` with Outbox Relay and Sweeps active.

### Step 5: Test via HTTP Endpoints
- **Check Readiness**:
  ```powershell
  curl http://localhost:3000/health/ready
  ```
- **Simulate Payment Approval**:
  ```powershell
  curl -X POST http://localhost:3000/v1/payments/dev/simulate `
    -H "Content-Type: application/json" `
    -d '{"tranId":"<TRAN_ID>"}'
  ```
- **Query Payment Status**:
  ```powershell
  curl http://localhost:3000/v1/payments/<TRAN_ID>
  ```

### Step 6: Visual UI Testing Tools

You can test Phase 2 end-to-end visually using any of the following graphical interfaces:

1. **Interactive Payment & QR Test Dashboard (Built-in Web UI)**:
   - Navigate to **`http://localhost:3000/dev`** in any web browser.
   - Choose a machine (`WRM-001` or `WRM-900`) and water volume (500 mL, 750 mL, or 1000 mL).
   - Click **"Generate Dynamic KHQR"** to trigger a real payment request.
   - Scan the rendered QR code directly on screen with the ABA Mobile Sandbox app, or click **"Simulate Pay Approval"** to simulate an instant webhook confirmation.
   - Click **"Simulate Dispense Complete"** to simulate the physical machine completing water dispensation.
   - Watch the live status badge poll and transition seamlessly: `PENDING` 🟡 -> `PAID` 🟢 -> `DISPENSED` 💧.

2. **Prisma Studio (Database GUI)**:
   - Run in a terminal:
     ```powershell
     pnpm --filter @wrm/api db:studio
     ```
   - Open **`http://localhost:5555`** to visually inspect, search, and browse:
     - `payments` table (amounts, QR strings, status, timestamps)
     - `payment_events` (audit log of every state transition)
     - `dispenses` (flow meter & load cell sensor accuracy recordings)
     - `refund_cases` & `dispense_rejections`

3. **MQTT Explorer**:
   - Connect to `localhost:1883` and subscribe to `wrm/#`.
   - Observe live MQTT messages on `wrm/WRM-001/pay/request`, `wrm/WRM-001/pay/qr`, `wrm/WRM-001/pay/status`, `wrm/WRM-001/transaction`, and `wrm/WRM-001/transaction/ack`.

4. **Production Operator Dashboard (Phase 7)**:
   - Note that the full customer/operator management portal is slated for Phase 7 as a dedicated Next.js application.

---

## 4. Hardware & Prototype Cut-Over Checklist `[HUMAN]`

Follow these steps when testing with physical hardware:

1. **Flash ESP32 Gateway Firmware v0.3.0**:
   ```powershell
   & "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run -d "firmware\esp32-gateway" -t upload -t monitor
   ```
2. **Verify USB Serial Menu**:
   - ESP32 connects to Wi-Fi and EMQX broker.
   - Press `1` in serial monitor to request 500 mL.
   - Terminal prints dynamic KHQR code and passes `QR,<tran_id>,...` to STM32 UART.
3. **Simulate / Pay with ABA Sandbox App**:
   - Scan QR with ABA Mobile Sandbox simulator.
   - Backend receives PayWay callback -> emits `pay/status paid`.
   - ESP32 serial monitor prints `PAID` banner and outputs `PAID,<tran_id>` to STM32.
4. **Report Dispense Outcome**:
   - Press `D` in ESP32 serial monitor (or STM32 sends `DONE,<tran_id>,502,504`).
   - Backend receives `transaction`, saves dispense to PostgreSQL, and returns `transaction/ack`.
   - ESP32 serial monitor confirms `transaction/ack for <tran_id>: ok`.
5. **Stop Prototype Backend**:
   - Once the manual hardware verification passes on the new backend, decommission and stop the Node.js prototype in `backend-prototype/`.
