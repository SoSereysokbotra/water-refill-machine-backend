# API & Database Summary

> A short overview. **The full specification is in the [Implementation Plan](backend-implementation-plan.md):** database **§C6**, REST API **§C7**, MQTT **§C2**, ABA PayWay **§C10**. If this page and the plan disagree, the plan is right.

## 1. Two Backends (for now)

| | Prototype (running today) | Production backend (being built) |
|---|---|---|
| Folder | `backend/` | `apps/api/` (from Phase 0) |
| Stack | Node.js, Express, mqtt.js | NestJS 11 (Fastify), PostgreSQL 16 + Prisma, Redis + BullMQ |
| Storage | In memory (lost on restart) | PostgreSQL |
| Machine link | MQTT (+ old HTTP endpoints) | MQTT only |
| Status | Used for testing; stops at Phase 2 cut-over | Phases 0–11 |

---

## 2. Machine ↔ Backend: MQTT (both backends)

Topics: `wrm/<machine_id>/…` on EMQX Cloud (TLS, port 8883).

| Topic | Direction | Purpose |
|---|---|---|
| `pay/request` | machine → backend | Customer chose a volume |
| `pay/qr` | backend → machine | KHQR text, amount, expiry |
| `pay/status` | backend → machine | `paid` / `expired` / `failed` / `cancelled` |
| `pay/cancel` | machine → backend | Customer pressed Cancel |
| `transaction` | machine → backend | Dispense result (flow, weight, fault) |
| `transaction/ack` | backend → machine | Result stored (production backend) |
| `heartbeat` | machine → backend | Health every 60 s |
| `error` | machine → backend | Fault codes |
| `online` | machine → backend | `1` / `0` (Last Will) |
| `config` / `config/ack` | both | Prices, currency, enabled |

Payload fields: §C2.

---

## 3. REST API

### 3.1 Prototype (`backend/`, today)
| Method & path | Purpose |
|---|---|
| `POST /api/payment/create` | Create a payment (header `X-API-Key`) |
| `GET /api/payment/status/:tranId` | Payment status (also syncs with ABA) |
| `POST /api/payment/callback` | ABA callback (re-checked with ABA) |
| `POST /api/dev/pay/:tranId` | Simulate payment (mock mode only) |
| `GET /dev` | Test page: latest payment + "Create test payment" buttons |
| `GET /health` | Health + MQTT state |

### 3.2 Production (`/v1`, by phase)
| Area | Main endpoints | Phase |
|---|---|---|
| Health | `/health/live`, `/health/ready` | 1 |
| Payments | `POST /v1/payway/callback`, `GET /v1/payments/:tranId` | 2 |
| Refunds | `/v1/refund-cases` (list, claim, mark-refunded, reject, reopen) | 3 |
| Machines | `/v1/machines` (provision, prices, enable/disable, credentials) | 4 |
| Alerts | `/v1/alerts` | 5 |
| Auth & users | `/v1/auth/*`, `/v1/users` | 6 |
| Reports | `/v1/reports/sales`, `/v1/reports/machines/status` | 7 |

Full table with roles: §C7.

---

## 4. Database (production, PostgreSQL)

| Table | Holds |
|---|---|
| `machines` | Machine ID, name, location, enabled, MQTT user, last heartbeat, STM32 state, pending results |
| `machine_prices` | Price per volume tier (500 / 750 / 1000) and currency |
| `payments` | `tran_id`, machine, volume, amount, currency, status, timestamps, version (optimistic lock) |
| `payment_events` | History of every state change |
| `dispenses` | Results: ok / partial / error, flow mL, weight g, fault |
| `dispense_rejections` | Results that couldn't be applied (unknown payment, wrong machine) |
| `refund_cases` | Reason, suggested and refunded amount, claim, method, reference |
| `outbox` / `inbox` | Reliable event delivery and duplicate protection |
| `heartbeats` | Machine health history (kept 30 days) |
| `alerts` | Faults and incidents with severity and status |
| `audit_logs` | Who changed what (prices, refunds, users) |
| `users` / `sessions` | Dashboard users and roles (Phase 6) |

Money is stored as an **integer** (`amount_minor`): USD in cents (0.15 → `15`), KHR in riel (500 → `500`).

**Key database rules:**
- One open payment per machine.
- `tran_id` is unique.
- `(machine_id, request_id)` is unique (prevents duplicate payments).

Full Prisma schema: §C6.
