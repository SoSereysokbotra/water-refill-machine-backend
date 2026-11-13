# Phase 5: Monitoring — Implementation & Verification Guide

Phase 5 introduces real-time incident alerting with deduplication, a 10-minute merge window, hardware fault severities, and Telegram bot notification without alert storms.

---

## 1. What was built

### 1.1 Alerting System (`apps/api/src/contexts/monitoring/`)
Two-layer context (`application/`, `interface/`) reacting to domain events via `OutboxHandlerRegistry`. Pure alert rules define whether an event raises or resolves an incident.

| Component | Responsibility |
|---|---|
| `AlertService` | Manages alerts lifecycle (`active`, `acknowledged`, `resolved`), generates deduplication keys, enforces the 10-minute merge window, and emits `monitoring.AlertRaised` / `monitoring.AlertResolved` in the same transaction. |
| `MonitoringSweep` | Repeatable sweep (`sweep.monitoring`, runs every 60 s) checking stale refund cases (> 24 h) and machines with pending outcomes stuck (> 1 h). Auto-resolves stuck alerts once pending outcomes return to 0. |
| `TelegramNotifierService` | Consumes BullMQ `notify.telegram` queue (5 retries, exponential backoff) and formats human-readable incident messages. |
| `TelegramClient` | Direct integration with Telegram Bot API (`sendMessage`). Operates as a safe no-op if `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` are not configured. |
| `AlertsController` | Admin REST endpoints (`GET /v1/alerts`, `POST /v1/alerts/:id/ack`, `POST /v1/alerts/:id/resolve`) guarded by `AdminKeyGuard`. |

### 1.2 Alert Rules & Mapping

| Trigger Event / Source | Alert Type | Severity | Auto-Resolved By |
|---|---|---|---|
| `fleet.MachineWentOffline` | `MACHINE_OFFLINE` | `critical` | `fleet.MachineCameOnline` |
| `dispensing.DispenseOutcomeUnknown` | `DISPENSE_UNKNOWN` | `warning` | Manual / Reconcile |
| `dispensing.SiteCheckNeeded` | `SITE_CHECK_NEEDED` | `critical` | Manual resolve |
| `payments.RefundReviewOpened` | `REFUND_REVIEW_OPENED` | `warning` | `Refunded` / `RefundRejected` |
| `sweep.monitoring` (Refund case open > 24 h) | `REFUND_STALE` | `warning` | Case decision |
| `dispensing.ReconciliationNeeded` | `RECONCILIATION_NEEDED` | `critical` | Manual resolve |
| `dispensing.OutcomeRejected` | `OUTCOME_REJECTED` | `critical` | Manual resolve |
| `dispensing.AccuracyMismatch` (> 5%) | `ACCURACY_MISMATCH` | `warning` | Manual resolve |
| `payments.LatePaymentDetected` | `LATE_PAYMENT` | `warning` | Refund review decision |
| `fleet.ConfigRejected` | `CONFIG_REJECTED` | `critical` | Config ack ok |
| Machine fault (`TANK_EMPTY`, `PUMP_FAILURE`, etc.) | `FAULT_<CODE>` | Per C8 severity | Heartbeat fault `NONE` |
| `sweep.monitoring` (`pending_outcomes > 0` for 1 h) | `PENDING_OUTCOMES_STUCK` | `warning` | Heartbeat `pending_outcomes = 0` |
| Repeated pay rejects (≥ 5 within 10 min) | `PAY_REQUEST_REJECTED_BURST` | `warning` | 10-minute window expiry |

### 1.3 Out of Scope (Plan E Phase 5)
- **ABA Circuit Open**: Circuit breaker (e.g. Opossum) has not yet been introduced.
- **Auto-Refund Failure**: Automated refund worker behind `REFUND_MODE=auto` has not yet been built.

---

## 2. Configuration (`.env`)

Add your Telegram bot credentials to `apps/api/.env`:

```env
TELEGRAM_BOT_TOKEN="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"
TELEGRAM_CHAT_ID="-100123456789"
```

If these environment variables are omitted, the backend logs Telegram alerts at `debug` level without throwing errors or blocking business logic.

---

## 3. Automated Verification

Run the full verification script:

```bash
bash scripts/verify-phase5.sh
```

Or run individual suites:

```bash
# 1. Typecheck across monorepo
pnpm run typecheck

# 2. Dependency cruiser boundaries (0 violations required)
pnpm --filter @wrm/api depcruise

# 3. Lint across all packages
pnpm run lint

# 4. Phase 5 Unit & Acceptance Test Suites (35 tests)
pnpm --filter @wrm/api exec vitest run test/monitoring-rules.spec.ts test/phase5-acceptance.e2e.spec.ts
```

---

## 4. Manual Verification (Real ESP32)

### 4.1 Unplug-ESP32 Telegram Test *(DoD manual check)*

1. Start API and worker in one process:
   ```bash
   RUN_MODE=all pnpm --filter @wrm/api start:dev
   ```
2. Power on the ESP32 gateway. Ensure it connects to MQTT and sends a heartbeat (machine becomes online).
3. **Unplug the ESP32 power.**
4. Observe:
   - Within 3 minutes, the Last Will message or `sweep.fleet-offline` detects the disconnection.
   - Database creates one `MACHINE_OFFLINE` critical alert.
   - Telegram ops chat receives:
     ```
     [CRITICAL] MACHINE_OFFLINE on WRM-001: Machine WRM-001 is offline
     ```
5. **Plug the ESP32 back in.**
   - Once the ESP32 sends `online=1` or a heartbeat, `fleet.MachineCameOnline` fires.
   - The alert status transitions to `resolved`.
   - Telegram receives:
     ```
     [RESOLVED] MACHINE_OFFLINE on WRM-001: Machine WRM-001 is back online
     ```

