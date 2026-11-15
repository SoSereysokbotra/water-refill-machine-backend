# Phase 7: Reporting Engine & Operator Dashboard

> **Quick status:** Code and automated test suites for Phase 7 are complete.
> - **Backend API:** CQRS read-side reporting service, materialized views, concurrent 5-minute background sweep, and paginated REST endpoints with CSV export.
> - **Operator Dashboard:** Production Next.js 15 web application (`apps/dashboard`) featuring Overview, Kiosk Fleet Management, Refund Queue Operations, Payment Inspector, Alerts Incident Management, Users/RBAC, and Sales Reports with CSV download.
> - **Verification:** 18 test files, 147/147 unit tests passing across all packages; 0 boundary violations (`depcruise`); 0 errors in `typecheck` and `lint`.

---

## 1. Overview & Architecture

Phase 7 implements **Architecture §7 (CQRS Read Side)**, **Architecture §4 (Reporting)**, and **Plan §C7 (Reports & Dashboard)**:

```
                  ┌────────────────────────────────────────────────────────┐
                  │                 Next.js 15 Dashboard                   │
                  │ (Overview · Machines · Refunds · Alerts · Reports · Users) │
                  └───────────────────────────┬────────────────────────────┘
                                              │ HTTP / JSON or CSV (Session Cookie)
                                              ▼
                  ┌────────────────────────────────────────────────────────┐
                  │             NestJS Fastify API (/v1/reports)           │
                  │   (ReportsController · SessionAuthGuard · RolesGuard)   │
                  └─────────────┬───────────────────────────┬──────────────┘
                                │ Query (< 300 ms)          │ 5-min Repeatable Sweep
                                ▼                           ▼
             ┌─────────────────────────────────────┐   ┌─────────────────────────────────────┐
             │       PostgreSQL Real-Time Views    │   │     PostgreSQL Materialized Views   │
             │   - machine_status_view             │   │   - sales_daily (gross, refunds, net)│
             │   - refund_queue_view               │   │   - sales_by_machine                │
             └─────────────────────────────────────┘   └─────────────────────────────────────┘
```

### Key Highlights
1. **Strict CQRS Separation:** The reporting engine reads solely from indexed SQL views and materialized views (`sales_daily`, `sales_by_machine`, `machine_status_view`, `refund_queue_view`). It never loads domain aggregates or executes write transactions.
2. **Deterministic Net Revenue Formula:** Gross sales, refunds, and net revenue are calculated strictly by:
   $$\text{Net Revenue} = \text{Gross Sales} - \text{Refunds}$$
   Calculated independently for both **USD** (cents) and **KHR** (riels).
3. **Concurrent View Refresh:** Materialized views are refreshed concurrently every 5 minutes (300,000 ms) via BullMQ repeatable sweep `reporting.refresh-views` with unique indexes on `(date, currency)` and `(machine_id, date, currency)`.
4. **RFC 4180 CSV Export:** Direct streamable CSV downloads (`GET /v1/reports/sales?format=csv`) containing both minor and human-readable major amounts.
5. **Full Refund Lifecycle from UI:** The dashboard allows operators to claim open refund cases, disburse payments with gateway references, reject claims with mandatory explanations, or reopen closed disputes—with immediate security audit-logging.
6. **Hardware Safety Guardrail:** The UI surfaces machine `pending_outcomes` and STM32 states directly on refund cases, blocking refunds or requiring explicit justification if physical hardware status is unknown or in flight.

---

## 2. SQL Views & Materialized Views

Created in migration `20261114010000_phase7_reporting_views`:

### `sales_daily` (Materialized View)
Aggregates paid transactions by date and currency:
- **Columns:** `date`, `currency`, `total_payments`, `dispensed_count`, `refunded_count`, `gross_amount_minor`, `refunded_amount_minor`, `net_amount_minor`, `total_volume_ml`.
- **Index:** `sales_daily_date_currency_idx` (`UNIQUE (date, currency)`).

### `sales_by_machine` (Materialized View)
Aggregates paid transactions by kiosk, date, and currency:
- **Columns:** `machine_id`, `date`, `currency`, `total_payments`, `dispensed_count`, `refunded_count`, `gross_amount_minor`, `refunded_amount_minor`, `net_amount_minor`, `total_volume_ml`.
- **Index:** `sales_by_machine_machine_date_currency_idx` (`UNIQUE (machine_id, date, currency)`).

### `machine_status_view` (Real-Time View)
Joins machines and active monitoring alerts to provide instant fleet presence:
- **Columns:** `id`, `name`, `location`, `enabled`, `currency`, `online`, `last_seen_at`, `pending_outcomes`, `pending_outcomes_since`, `last_stm32_state`, `decommissioned_at`, `active_alerts_count`.

### `refund_queue_view` (Real-Time View)
Joins refund cases with payment transaction records and kiosk online status:
- **Columns:** `tran_id`, `machine_id`, `amount_minor`, `currency`, `refund_status`, `refund_reason`, `claimant_id`, `claimed_at`, `expires_at`, `decision_reason`, `machine_online`, `machine_pending_outcomes`, `last_stm32_state`, `created_at`, `updated_at`.

---

## 3. Reporting REST API Endpoints

All endpoints are protected by `SessionAuthGuard` and `RolesGuard`:

| Method & Route | Required Role | Description |
|---|---|---|
| `GET /v1/reports/sales` | `viewer` | Queries sales summaries and breakdown rows. Parameters: `from`, `to`, `machineId`, `groupBy` (`day` \| `machine`), `limit`, `offset`, `format` (`json` \| `csv`). |
| `GET /v1/reports/machines/status` | `viewer` | Returns live fleet status, online indicators, and active alert counts. |
| `GET /v1/reports/refunds` | `operator` | Returns refund queue metrics, summary amounts by currency, and active dispute cases. |
| `POST /v1/reports/refresh` | `admin` | Manually triggers concurrent materialized view refresh. |

### Sample `GET /v1/reports/sales` JSON Response
```json
{
  "data": {
    "summary": {
      "usd": {
        "currency": "USD",
        "totalPayments": 120,
        "dispensedCount": 118,
        "refundedCount": 2,
        "grossAmountMinor": 1800,
        "refundedAmountMinor": 30,
        "netAmountMinor": 1770,
        "totalVolumeMl": 60000
      },
      "khr": {
        "currency": "KHR",
        "totalPayments": 450,
        "dispensedCount": 445,
        "refundedCount": 5,
        "grossAmountMinor": 225000,
        "refundedAmountMinor": 2500,
        "netAmountMinor": 222500,
        "totalVolumeMl": 225000
      }
    },
    "pagination": { "limit": 50, "offset": 0, "total": 2 },
    "rows": [
      {
        "date": "2026-11-14",
        "currency": "USD",
        "totalPayments": 120,
        "dispensedCount": 118,
        "refundedCount": 2,
        "grossAmountMinor": 1800,
        "refundedAmountMinor": 30,
        "netAmountMinor": 1770,
        "totalVolumeMl": 60000
      }
    ]
  }
}
```

---

## 4. Operator Dashboard Application (`apps/dashboard`)

Built with **Next.js 15**, **Tailwind CSS**, and **Lucide React**; configured with monorepo TypeScript paths and Turborepo.

### Dashboard Navigation & Screens

1. **Overview (`/`):**
   - KPI cards for USD and KHR Net Revenue with gross/refund breakdowns.
   - Fleet summary with online/offline counts and stuck outcomes warnings.
   - Action item badges displaying open refund counts and active hardware alerts.
   - Latest kiosk presence and incidents preview table.
2. **Kiosk Fleet (`/machines`):**
   - Live fleet table showing Machine ID, location, online status, STM32 state, and volume tier prices.
   - **Provision Machine Modal:** Registers new machine ID (`WRM-XXX`), currency, and pricing tiers.
   - **One-Time Credentials Modal:** Securely displays the generated MQTT password with one-click clipboard copy.
   - **Price Configuration Modal:** Modifies minor unit pricing for 500, 750, and 1000 mL and emits retained config.
   - **Actions:** Kiosk toggle activation, credential rotation, and decommissioning.
3. **Refund Queue (`/refunds`):**
   - Status filters (`open`, `claimed`, `refunded`, `rejected`, `all`).
   - Displays kiosk online presence, STM32 state, and pending outcomes count.
   - **Hardware Safety Guardrail:** Displays an amber warning if `pending_outcomes > 0` requiring explicit operator override.
   - **Actions:** Atomic Claim, Mark Refunded (with disbursement method, transaction reference, and minor amount), Reject (with required reason), and Reopen.
4. **Payment Inspector (`/payments`):**
   - Transaction ID lookup tool.
   - Displays payment amount, volume, status badge, and paid timestamp.
   - **State Transition Audit Trail:** Chronological visual timeline of all `payment_events`.
   - **Resolve Unknown Dispense Modal:** Enables operators to resolve `DISPENSE_UNKNOWN` payments as either `dispensed` or `refund`.
5. **Incidents & Alerts (`/alerts`):**
   - Active, acknowledged, and resolved alert listings.
   - Filter by status and inspect raw error payload data.
   - Actions to Acknowledge or Resolve incidents.
6. **Sales Reports (`/reports`):**
   - Date range selector (`from`, `to`).
   - Filter by machine ID and group by `day` or `machine`.
   - USD & KHR Revenue summary cards showing Gross, Refund Deductions, and Net Total.
   - Paginated breakdown table.
   - **Download CSV Button:** Generates RFC 4180 CSV file with major unit calculations.
   - **Refresh Views Button:** Directly triggers database materialized view refresh.
7. **Users & Security Audit (`/users`):**
   - User account management table with roles (`admin`, `operator`, `viewer`) and 2FA status.
   - Create user modal and role assignment dropdown.
   - Live Security & Operational Audit Log table (last 50 actions).
8. **10-Second Polling (`src/components/dashboard-shell.tsx`):**
   - Automatically polls the backend every 10 seconds to refresh active alert badges and refund queue metrics without manual page reloads.

---

## 5. Verification & Testing

### Running the Tests

```bash
# Run backend reporting unit tests
pnpm --filter @wrm/api test test/reporting.spec.ts

# Run dashboard client unit tests
pnpm --filter @wrm/dashboard test

# Run all unit tests across monorepo (18 test files, 147 tests)
pnpm test:unit

# Run full monorepo typecheck
pnpm typecheck

# Verify zero architecture boundary violations
pnpm --filter @wrm/api depcruise

# Run linter across all workspaces
pnpm lint

# Build all production assets (API & Next.js dashboard)
pnpm build
```

### Test Results Summary
- **Backend Reporting Tests (`test/reporting.spec.ts`):** 10/10 passed in 17ms.
  - Concurrent materialized view refresh & fallback handling.
  - Net revenue invariance verification: $\text{Gross} - \text{Refunds} = \text{Net}$ for both USD and KHR.
  - Machine and date filtering with pagination.
  - RFC 4180 CSV export generation.
  - Machine status view and refund queue view query mappings.
- **Dashboard Tests (`apps/dashboard/test/dashboard.spec.ts`):** 4/4 passed in 16ms.
  - Invariance checks for USD & KHR net revenue formulas.
  - Refund safety check: enforcing emergency override on machines with `pending_outcomes > 0`.
  - API client query parameter encoding and CSV streaming.
- **Total Monorepo Unit Test Suite:** 18 test files, 147/147 tests passing.
- **Architecture Boundaries:** 0 violations across 152 modules cruised by `dependency-cruiser`.
- **TypeScript:** 100% clean (0 errors) across monorepo (`@wrm/api`, `@wrm/contracts`, `@wrm/dashboard`, `@wrm/tsconfig`).
- **Production Build:** Successfully produced standalone Next.js 15 static routes and compiled NestJS API bundle.

---

## 6. How to Run the Dashboard Locally

1. **Start the Backend API:**
   ```bash
   pnpm --filter @wrm/api dev
   ```
   API runs on `http://localhost:3000`.

2. **Start the Operator Dashboard:**
   ```bash
   pnpm --filter @wrm/dashboard dev
   ```
   Dashboard opens on `http://localhost:3001`.

3. **Log in with Seeded Development Credentials:**
   - **Admin:** `admin@wrm.kh` / `AdminSecret123!`
   - **Operator:** `operator@wrm.kh` / `OperatorSecret123!`
   - **Viewer:** `viewer@wrm.kh` / `ViewerSecret123!`
