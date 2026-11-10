# Phase 3: Dispensing & Refund Review — Implementation & Verification Guide

This document details the completed implementation of **Phase 3: Dispensing & refund review** for the Water Refill Machine monorepo.

Phase 3 guarantees that every dispense outcome is recorded reliably even across network cuts and reboots, provides automated sensor discrepancy detection, enforces the ADR-0008 refund calculation, and provides an operator refund review workflow guarded against premature payouts while machine outcomes remain queued in hardware NVS storage.

---

## 1. Architecture Components Implemented

### 1.1 Contracts (`packages/contracts/src/mqtt.ts`)
- **`ErrorV1Schema`**: Standardized schema for `wrm/<machine_id>/error` topics reporting hardware fault events:
  ```typescript
  { v: 1, tran_id?: string, code: string, message?: string, ts?: number }
  ```
- **Dispense Outcome Contracts**: Validated schemas for `TransactionV1` (`ok`, `partial`, `error`) and `TransactionAckV1` (`ok`, `rejected`).

### 1.2 Domain Layer (`apps/api/src/contexts/payments/domain/`)
- **ADR-0008 Refund Policy (`refund-policy.ts`)**:
  - Implements `calculateSuggestedRefund`:
    - Full dispense (`ok`): 0 refund.
    - Total failure (`error`): 100% refund (`amountMinor`).
    - Partial dispense (`partial`): Proportional refund calculated as:
      $$\text{refundMinor} = \lfloor \text{amountMinor} \times \frac{\text{volumeRequested} - \text{volumeDispensed}}{\text{volumeRequested}} \rfloor$$
    - Respects currency minor units (USD cents vs. KHR).
- **Dual-Sensor Accuracy Tracking (`dispense.entity.ts`)**:
  - Dual-sensor discrepancy formula:
    $$\text{diffPercent} = \frac{|\text{flowMl} - \text{weightG}|}{\text{volumeRequestedMl}} \times 100$$
  - If discrepancy $> 5\%$, the outcome is flagged with `hasSensorDiscrepancy: true` and triggers a `dispensing.AccuracyMismatch` domain event.
- **`RefundCase` Aggregate (`refund-case.entity.ts`)**:
  - State machine: `open` $\rightarrow$ `claimed` $\rightarrow$ `refunded` or `rejected`, and `rejected` $\rightarrow$ `open` (reopened on dispute).
  - Claim concurrency: Single-operator lock (`claimedBy`, `claimedUntil` with default 30-minute expiration).
  - Attempting to claim an already claimed active case raises `ConflictError('REFUND_ALREADY_CLAIMED')` (HTTP 409).
- **`Payment` Aggregate Extensions (`payment.aggregate.ts`)**:
  - `recordOutcome(result, flowMl, weightG, fault, clock)`:
    - Moves `PAID` $\rightarrow$ `DISPENSED` on `ok`.
    - Moves `PAID` $\rightarrow$ `REFUND_REVIEW` on `partial` or `error` and raises `payments.RefundReviewOpened`.
    - Late outcome protection: If an outcome arrives when the payment is already terminal (`DISPENSED`, `REFUNDED`, `REFUND_REJECTED`), state remains unchanged and `payments.ReconciliationNeeded` is raised for operator investigation.
  - `markDispenseUnknown(clock)`: Transitions `PAID` $\rightarrow$ `DISPENSE_UNKNOWN` if no outcome is received within 300 seconds.
  - `escalateUnknownToRefundReview(clock)`: Escalates `DISPENSE_UNKNOWN` $\rightarrow$ `REFUND_REVIEW` after 24 hours.

### 1.3 Infrastructure Layer (`apps/api/src/contexts/payments/infrastructure/`)
- **`PrismaPaymentRepository`**:
  - Added `recordDispense(dispense, tx)`: Upserts dispense records with dual-sensor readings and clock-skew detection.
  - Added `saveRefundCase(case, tx)` & `getRefundCase(tranId, tx)`.
  - Added `findRefundCases(filter)`: Supports filtering by `status` and `machineId`.
  - Added `findDueForDispenseUnknown(cutoff)` & `findDueForUnknownEscalation(cutoff)`.
  - Added `getMachinePendingOutcomes(machineId, tx)`: Reads `pending_outcomes` from the `machines` table to enforce refund safety guards.
- **Prisma Schema (`apps/api/prisma/schema.prisma`)**:
  - `Dispense`: Records `flow_ml`, `weight_g`, `diff_percent`, `late`, `fault`, `created_at`.
  - `DispenseRejection`: Records rejected outcomes (`reason`, `payload`).
  - `RefundCase`: Records `suggested_amount_minor`, `refunded_amount_minor`, `status`, `claimed_by`, `claimed_until`, `decided_by`, `decision_reason`.

### 1.4 Application Layer (`apps/api/src/contexts/payments/application/`)
- **`RecordDispenseHandler`**:
  - Validates payment existence (unmatched transactions logged to `dispense_rejections` $\rightarrow$ ack `rejected`).
  - Validates machine ownership (outcomes reported by the wrong machine logged to `dispense_rejections` $\rightarrow$ ack `rejected`).
  - Checks server vs. device clock skew (flags `late` if $> 300\text{s}$ divergence).
  - Outbox integration: Produces `dispensing.DispenseCompleted`, `dispensing.DispenseFailed`, and `dispensing.AccuracyMismatch`.
- **`DispensingSweep` (`sweep.dispensing`)**:
  - Runs every 30 seconds via repeatable BullMQ job.
  - **Rule 1 (Timeout to Unknown)**: Moves `PAID` payments older than 300 seconds without outcome to `DISPENSE_UNKNOWN`.
  - **Rule 2 (Escalation Guarded by NVS Queue)**: Evaluates `DISPENSE_UNKNOWN` payments older than 24 hours. If `pending_outcomes === 0`, escalates to `REFUND_REVIEW` and generates a 100% suggested refund case. **If `pending_outcomes > 0`, escalation is held**, preventing refunding a customer whose machine might have dispensed water while offline!
- **Refund Case Command Handlers**:
  - `ClaimRefundCaseHandler`: Claims a case for 30 minutes.
  - `MarkRefundedHandler`: Marks case refunded; **blocks execution with `REFUND_BLOCKED_PENDING_OUTCOMES` (HTTP 400)** if machine reports `pending_outcomes > 0`, unless an `adminOverrideReason` is explicitly supplied.
  - `RejectRefundHandler`: Rejects refund with reason.
  - `ReopenRefundHandler`: Reopens rejected refund upon dispute.
  - `ResolveUnknownDispenseHandler`: Manual override for payments stuck in `DISPENSE_UNKNOWN`.

### 1.5 Interface Layer (`apps/api/src/contexts/payments/interface/`)
- **MQTT Consumer (`payments.mqtt-consumer.ts`)**:
  - Listens to `wrm/+/transaction` and `wrm/+/error`.
  - Sends immediate `transaction/ack ok` or permanent `transaction/ack rejected`.
- **REST Controller (`refund-cases.controller.ts`)**:
  - `GET /v1/refund-cases`: List refund cases with optional status filter.
  - `GET /v1/refund-cases/:tranId`: Case detail view.
  - `POST /v1/refund-cases/:tranId/claim`: Operator claim lock.
  - `POST /v1/refund-cases/:tranId/mark-refunded`: Record manual refund reference.
  - `POST /v1/refund-cases/:tranId/reject`: Reject refund case.
  - `POST /v1/refund-cases/:tranId/reopen`: Reopen rejected case.
  - `POST /v1/payments/:tranId/resolve-unknown`: Resolve stuck unknown dispense.

### 1.6 ESP32 Gateway Firmware v0.4.0 (`firmware/esp32-gateway/src/main.cpp`)
- **NVS Outcome Queue**:
  - Uses ESP32 `Preferences` non-volatile storage.
  - Ring buffer capacity: 64 outcomes, maximum retention: 7 days.
  - Survives sudden reboots, power cuts, and network outages.
- **Two-Way UART Handshake**:
  - Only sends `ACK,<tran_id>` to STM32 **after** the outcome is safely committed to NVS flash memory.
  - Continuously repeats `PAID,<tran_id>,<volume_ml>` every 2 seconds until the STM32 replies with `PAID,ACK` or `PAID,REJECT`.
- **Reliable Backoff & Telemetry**:
  - Resends queued outcomes using exponential backoff (5s $\rightarrow$ 5min) with randomized jitter.
  - Drains queue item upon receiving `transaction/ack` (`ok` or `rejected`).
  - Broadcasts heartbeat telemetry counters: `pending_outcomes`, `rejected_outcomes`, `dropped_outcomes`.

---

## 2. Automated Verification

Run the full automated test and verification suite:

```bash
# 1. Run all unit, integration, and E2E tests (19 test files, 79 tests)
pnpm test

# 2. Verify strict clean architecture boundaries (0 violations across 109 modules)
pnpm --filter @wrm/api depcruise

# 3. Verify TypeScript types
pnpm run typecheck

# 4. Verify ESLint formatting & rules (0 errors)
pnpm run lint
```

All 79 tests pass consistently.

---

## 3. Manual Testing & Verification Guide

Follow these steps to test Phase 3 behavior locally or with a connected test rig.

### Prerequisites

Ensure the background infrastructure services are running:
```bash
docker compose -f infra/docker-compose.yml up -d
pnpm --filter @wrm/api start:dev
```

---

### Test Scenario 1: Normal Dispense with Dual-Sensor Accuracy Check

Simulate a machine finishing a normal 500 mL dispense where flow sensor measured 502 mL and load cell measured 504 g:

```bash
# Publish dispense outcome via Mosquitto
docker exec -i infra-mosquitto-1 mosquitto_pub -h localhost -p 1883 \
  -t "wrm/WRM-900/transaction" \
  -m '{"v":1,"tran_id":"<PAID_TRAN_ID>","result":"ok","flow_ml":502,"weight_g":504,"ts":1710000000}'
```

**Expected Results:**
1. Backend replies on MQTT topic `wrm/WRM-900/transaction/ack`:
   ```json
   {"v":1,"tran_id":"<PAID_TRAN_ID>","status":"ok"}
   ```
2. Database record in `payments`: `status = 'DISPENSED'`.
3. Database record in `dispenses`:
   - `flow_ml`: 502
   - `weight_g`: 504
   - `diff_percent`: 0.40% ($|502 - 504| / 500 \times 100$)
   - No refund case is created.

---

### Test Scenario 2: Partial Dispense & ADR-0008 Refund Calculation

Simulate a machine fault where a customer purchased 1000 mL (amount = 25 cents), but the bottle was removed early and only 400 mL was dispensed:

```bash
docker exec -i infra-mosquitto-1 mosquitto_pub -h localhost -p 1883 \
  -t "wrm/WRM-900/transaction" \
  -m '{"v":1,"tran_id":"<PAID_TRAN_ID>","result":"partial","flow_ml":400,"weight_g":400,"fault":"BOTTLE_REMOVED","ts":1710000000}'
```

**Expected Results:**
1. Backend sends `transaction/ack` with `status: "ok"`.
2. Payment transitions to `status = 'REFUND_REVIEW'`.
3. A row is created in `refund_cases`:
   - `reason`: `'DISPENSE_PARTIAL'`
   - `status`: `'open'`
   - `suggested_amount_minor`: `15` cents
     $$\lfloor 25 \times \frac{1000 - 400}{1000} \rfloor = \lfloor 25 \times 0.60 \rfloor = 15\text{ cents}$$

---

### Test Scenario 3: Operator Claim & Refund Safety Guard

#### 3.1 Claim the Refund Case
Operator Alice claims the case:
```bash
curl -X POST http://localhost:3000/v1/refund-cases/<TRAN_ID>/claim \
  -H "Content-Type: application/json" \
  -d '{"actorId": "alice", "durationMinutes": 30}'
```
Response: `201 Created` with `status: "claimed"`, `claimedUntil: "<TIMESTAMP>"`.

#### 3.2 Verify Concurrency Lock
Operator Bob tries to claim the same case concurrently:
```bash
curl -X POST http://localhost:3000/v1/refund-cases/<TRAN_ID>/claim \
  -H "Content-Type: application/json" \
  -d '{"actorId": "bob", "durationMinutes": 30}'
```
Response: `409 Conflict`:
```json
{
  "error": {
    "code": "REFUND_ALREADY_CLAIMED",
    "message": "Refund case is already claimed by alice until ..."
  }
}
```

#### 3.3 Safety Guard: Machine with Pending Outcomes in NVS
If the machine currently has un-flushed outcomes in its NVS queue (`pending_outcomes > 0`):
```bash
curl -X POST http://localhost:3000/v1/refund-cases/<TRAN_ID>/mark-refunded \
  -H "Content-Type: application/json" \
  -d '{"actorId": "alice", "method": "ABA_PORTAL", "reference": "REF-12345", "amountMinor": 15}'
```
Response: `400 Bad Request`:
```json
{
  "error": {
    "code": "REFUND_BLOCKED_PENDING_OUTCOMES",
    "message": "Machine WRM-900 has 2 pending outcomes in NVS queue. Admin override reason required to refund before queue flush."
  }
}
```

#### 3.4 Admin Override
If an admin override reason is provided:
```bash
curl -X POST http://localhost:3000/v1/refund-cases/<TRAN_ID>/mark-refunded \
  -H "Content-Type: application/json" \
  -d '{
    "actorId": "alice",
    "method": "ABA_PORTAL",
    "reference": "REF-12345",
    "amountMinor": 15,
    "adminOverrideReason": "Customer verified in person at machine"
  }'
```
Response: `201 Created` with `status: "refunded"`. Payment moves to `REFUNDED`.

---

### Test Scenario 4: Malformed Outcomes & Dispense Rejections

Simulate a machine reporting an outcome for a transaction ID that does not exist in the database:

```bash
docker exec -i infra-mosquitto-1 mosquitto_pub -h localhost -p 1883 \
  -t "wrm/WRM-900/transaction" \
  -m '{"v":1,"tran_id":"nonexistent-id-999","result":"ok","flow_ml":500,"weight_g":500}'
```

**Expected Results:**
1. Backend logs a warning and stores the payload in the `dispense_rejections` table.
2. Backend returns `transaction/ack` with `status: "rejected"`:
   ```json
   {"v":1,"tran_id":"nonexistent-id-999","status":"rejected","reason":"DSP_UNKNOWN_PAYMENT"}
   ```
3. The ESP32 drains the rejected item from its NVS queue so it will not retry infinitely.

---

### Test Scenario 5: Offline ESP32 NVS Queue Recovery

1. Disconnect the ESP32 from Wi-Fi or stop the MQTT broker.
2. Simulate a dispense completion via UART from STM32 to ESP32:
   - ESP32 writes the outcome to NVS flash memory.
   - ESP32 immediately returns `ACK,<tran_id>` to STM32.
3. Power cycle the ESP32 board while still offline.
4. Reconnect the MQTT broker / Wi-Fi network.
5. **Observation**:
   - ESP32 boots up, reads the pending outcome from NVS, and transmits it via MQTT.
   - Backend acknowledges with `transaction/ack ok`.
   - ESP32 removes the item from NVS and decrements its `pending_outcomes` telemetry counter to 0.

---

## 4. Phase 3 Definition of Done Checklist

| DoD Requirement | Status | Verification Reference |
|---|---|---|
| Every PAID payment ends in DISPENSED, REFUNDED or REFUND_REJECTED — none refunded while outcome unknown | ✅ Done | Tested in `apps/api/test/refund-flow.e2e.spec.ts` & `apps/api/test/dispensing-sweeps.integration.spec.ts` |
| Outcomes survive ESP32 reboot, STM32 reboot and 2 h offline | 🟨 Ready for Hardware Check | Firmware v0.4.0 NVS queue implemented; awaiting physical bench test |
| No infinite replay: every outcome is acked `ok` or `rejected`, or expires by policy | ✅ Done | Tested in `RecordDispenseHandler` & `test/refund-flow.e2e.spec.ts` |
| Two operators cannot refund the same case | ✅ Done | Atomic claim locking & concurrency test passing (HTTP 409) |
| `docs/PROGRESS.md` updated with handoff note | ✅ Done | Section 6 updated |

> [!NOTE]
> All changes are committed and pushed to git branch `phase3`.
