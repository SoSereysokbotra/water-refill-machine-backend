# Backend Architecture

> Production architecture for the Water Refill Machine backend: **modular monolith** with **DDD**, **Hexagonal architecture**, **CQRS**, and an **event-driven transactional outbox**.

| | |
|---|---|
| **Status** | Target architecture (prototype in `backend/` is the proof of concept) |
| **Goals** | Maintainable · Scalable · Fast · High quality · Reliable with real money |
| **Last updated** | 2026-11-06 |

---

## 1. Principles

| Principle | Meaning |
|---|---|
| **Correctness first** | Never dispense unpaid water, never dispense twice, never lose a payment |
| **Boundaries are enforced** | Modules can only talk through public ports and events — checked by tooling |
| **Domain is pure** | Business rules have no dependency on database, MQTT, ABA or framework |
| **Every message can repeat** | All consumers are idempotent |
| **Everything is observable** | Every log line carries `tran_id` and `machine_id` |
| **Build for production, extract later** | One deployable today; any module can become a service tomorrow |

---

## 2. Architecture styles

| Style | Role in this system | Guarantee |
|---|---|---|
| **Modular monolith** | One deployable app split into bounded contexts | Simple operations; boundaries ready for future services |
| **DDD** | Payments & Dispensing modelled as aggregates with invariants | Business correctness |
| **Hexagonal (ports & adapters)** | Domain/application depend only on interfaces | Maintainability, testability, swappable infrastructure |
| **CQRS (light)** | Commands go through aggregates; queries use optimised SQL/read models | Fast reads as data grows |
| **Event-driven + transactional outbox** | State change and event saved in one DB transaction; relay publishes later | No lost events, even after a crash |

---

## 3. System overview

```text
                               ┌──────────────── API instances (stateless, N copies) ────────────────┐
 ESP32 ⇄ EMQX ⇄ (shared sub) ─▶│  Interface: MQTT consumers · REST controllers · auth                │
                               │  Application: command handlers · query handlers                      │
                               │  Domain: Payments · Dispensing · Fleet · Monitoring (pure TS)        │
                               │  Infrastructure: Prisma repos · PayWay adapter · MQTT publisher      │
                               └───────────────┬───────────────────────────────┬──────────────────────┘
                                               │ one transaction:              │ reads (CQRS)
                                               ▼ state + outbox row            ▼
                                        ┌──────────────┐               ┌───────────────┐
                                        │  PostgreSQL  │──── read ─────│ Read models / │
                                        │ + outbox     │   replicas    │ SQL views     │
                                        └──────┬───────┘   (later)     └───────────────┘
                                               │ outbox relay
                                               ▼
                               ┌──────────── Workers (N copies) ─────────────┐
                               │ BullMQ: publish events → MQTT / Telegram     │──▶ ABA PayWay
                               │ ABA polling · expiry · offline · reports     │──▶ Telegram
                               └──────────────────────────────────────────────┘
       Observability everywhere: structured logs · traces · metrics · error tracking
```

---

## 4. Bounded contexts

```text
┌──────────────────────── Water Refill backend (one NestJS app) ────────────────────────┐
│                                                                                        │
│  ┌── Payments (CORE) ──┐   events   ┌── Dispensing (CORE) ─┐   events   ┌── Monitoring ──┐
│  │ Payment, Refund     │──────────▶│ Dispense, accuracy   │──────────▶│ Alert, rules   │
│  │ KHQR, ABA           │           │ flow vs weight       │           │ Telegram       │
│  └─────────────────────┘           └──────────────────────┘           └────────────────┘
│            ▲                                  ▲                                ▲         │
│            └──────────── Fleet (machines, prices, config, online) ─────────────┘         │
│                                                                                        │
│  Identity (users, roles)  ·  Reporting (read-only views of sales)                      │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

| Context | Kind | Modelling | Owns |
|---|---|---|---|
| **Payments** | Core | Full DDD | Payment aggregate, refunds, KHQR, ABA integration |
| **Dispensing** | Core | Full DDD | Dispense aggregate, accuracy check (flow vs weight) |
| **Fleet** | Supporting | 2-layer module (service + interface) | Machines, prices, config, firmware versions, online status |
| **Monitoring** | Supporting | 2-layer module (service + interface) | Alert rules, incidents, notifications |
| **Identity** | Generic | Library (Better Auth) + RBAC | Users, roles, sessions |
| **Reporting** | Generic | CQRS read side only | Sales views, dashboards, exports |

### Context rules

- A context **never** imports another context's `domain/` or `infrastructure/`.
- Cross-context communication = **domain events** (async) or a **public port** (sync query interface).
- Each context owns its tables; other contexts read them only through ports or read models.
- Enforced by **dependency-cruiser** in CI — a violating import fails the build.

---

## 5. Layers inside a context (Hexagonal)

```text
payments/
├── domain/                     ← pure TypeScript: no NestJS, no Prisma, no MQTT
│   ├── payment.aggregate.ts       Payment + state machine + invariants
│   ├── value-objects/             Money, TranId, Volume, MachineId
│   ├── events/                    PaymentCreated, PaymentPaid, PaymentExpired, RefundReviewOpened, …
│   ├── errors.ts                  DomainError types
│   └── ports/                     PaymentRepository, PaymentGateway (interfaces)
├── application/                ← use cases (orchestration, transactions, sweeps)
│   ├── commands/                  CreatePayment, ConfirmPayment, ExpirePayment, CancelPayment, ProbePayment
│   └── queries/                   GetPayment
├── infrastructure/             ← adapters to the outside world
│   ├── prisma-payment.repository.ts
│   └── payway/                    ABA PayWay adapter (signing, generate-qr, check-transaction, refund)
└── interface/                  ← entry points
    ├── mqtt/pay-request.consumer.ts
    ├── http/payments.controller.ts
    └── jobs/check-aba.processor.ts
```

**Dependency rule:** `interface → application → domain ← infrastructure`. The domain depends only on the `shared-kernel` (base classes, `Money`, `Clock`); infrastructure implements domain ports. Supporting contexts (Fleet, Monitoring, Identity, Reporting) use two layers — see Implementation Plan §B2.

| Layer | May depend on | Contains |
|---|---|---|
| `domain` | `shared-kernel` only | Aggregates, value objects, domain events, port interfaces |
| `application` | `domain` | Command/query handlers, transactions, publishing events to the outbox |
| `infrastructure` | `domain`, `application` | Prisma, PayWay HTTP client, MQTT publisher |
| `interface` | `application` | MQTT consumers, REST controllers, job processors |

---

## 6. Domain model (core)

### 6.1 Payment aggregate — state machine

> Full transition table, guards and refund policy: **[Implementation Plan §C1](backend-implementation-plan.md#c1-payment-state-machine-final)**.

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

**Invariants (enforced in the aggregate, DB constraints and sweeps):**

1. Only `PENDING → PAID` may emit `PaymentPaid` (the only event that lets a machine dispense).
2. A payment cannot be paid after `expiresAt + grace`; a late approval goes to `REFUND_REVIEW`, never to dispensing. `markPaid` is idempotent for every state.
3. An outcome (`DONE`/`PARTIAL`/`ERR`/`PAID,REJECT`) is accepted only for a paid payment **from the same machine**.
4. A payment dispenses at most once.
5. **No automatic refund while the dispense outcome is unknown** — outcomes are persisted on the STM32 and ESP32 and replayed until acknowledged.
6. At most **one open payment (PENDING or PAID) per machine**; a new request supersedes a PENDING one atomically and is refused while one is PAID.
7. **No payment ABA may still accept is left unobserved** — sweeps check pending payments and reconcile probes terminal ones.
8. Every transition is recorded (`payment_events`) for audit.

Reference implementation of the aggregate: Implementation Plan §D2.

### 6.2 Value objects

| Value object | Rules |
|---|---|
| `Money` | Integer minor units + currency: **KHR scale 0** (500 KHR → 500), **USD scale 2** ($0.15 → 15); KHR ≥ 100, USD ≥ 0.01; no floats in arithmetic |
| `TranId` | ≤ 20 chars (ABA limit): `base36(epoch_ms)` + 6 random digits; ABA rejects duplicates (code 403) → regenerate |
| `Volume` | Fixed tiers **500 / 750 / 1000 mL** |
| `MachineId` | Format `WRM-###` |

### 6.3 Domain events

Main events (full catalog with payloads and subscribers: Implementation Plan §C4):

| Event | Raised by | Consumed by |
|---|---|---|
| `payments.PaymentCreated` | Payments | MQTT notifier (`pay/qr`), Fleet |
| `payments.PaymentPaid` | Payments | **MQTT notifier → `pay/status: paid`**, Reporting |
| `payments.PaymentExpired` / `PaymentCancelled` / `PaymentFailed` | Payments | MQTT notifier, ABA close |
| `payments.LatePaymentDetected` / `RefundReviewOpened` | Payments | Monitoring, refund executor (auto mode) |
| `payments.Refunded` / `RefundRejected` / `RefundReopened` | Payments | Reporting, Monitoring |
| `dispensing.DispenseCompleted` / `DispenseFailed` / `DispenseOutcomeUnknown` | Dispensing | Payments, Reporting, Monitoring |
| `dispensing.AccuracyMismatch` / `OutcomeRejected` / `ReconciliationNeeded` | Dispensing | Monitoring |
| `fleet.MachineWentOffline` / `MachineCameOnline` / `MachineConfigChanged` | Fleet | Monitoring, MQTT notifier (`config`) |
| `monitoring.AlertRaised` / `AlertResolved` | Monitoring | Telegram notifier, dashboard |

---

## 7. CQRS

| Side | Path | Technology |
|---|---|---|
| **Command (write)** | Interface → command handler → aggregate → repository + outbox (one transaction) | Prisma |
| **Query (read)** | Interface → query handler → SQL view / read model | Prisma TypedSQL / `$queryRaw` |

- Commands return only an ID or status, never large objects.
- Queries never load aggregates and never change state.
- Read models (e.g. `sales_daily`, `machine_status_view`) are updated by event handlers or materialized views.
- Later: queries can be pointed at a **read replica** without touching command code.

---

## 8. Transactional outbox & inbox

### 8.1 Why

Without an outbox: the payment is saved as PAID, then the server crashes before publishing `PAID` → the customer paid but the machine never dispenses. The outbox makes the state change and the event **atomic**.

### 8.2 How

```text
Command handler (one DB transaction)
   ├── UPDATE payments SET status='PAID', version=version+1 WHERE tran_id=? AND version=?
   └── INSERT INTO outbox (id, type, payload, occurred_at)    ← same transaction
            │
            ▼ commit
Outbox relay (worker, polls every 250 ms — no LISTEN/NOTIFY, so a connection pooler can be added later)
   ├── SELECT ... FROM outbox WHERE dispatched_at IS NULL ORDER BY occurred_at
   │        FOR UPDATE SKIP LOCKED LIMIT 20           ← safe with many workers, short locks
   ├── enqueue one BullMQ job per handler (jobId = eventId:handler → idempotent)
   └── UPDATE outbox SET dispatched_at = now()
```

**Timers are not events.** Money deadlines (QR expiry, ABA polling, outcome timeout, escalation, reconciliation) are columns in PostgreSQL read by repeatable **sweep** jobs, re-created at every worker boot. A Redis data loss therefore only delays work by one sweep interval (Implementation Plan §C5).

### 8.3 Tables

| Table | Columns |
|---|---|
| `outbox` | `id (uuid)`, `aggregate_type`, `aggregate_id`, `event_type`, `payload (jsonb)`, `occurred_at`, `dispatched_at`, `attempts`, `last_error`, `dead_at` |
| `inbox` | `message_id (pk)`, `source` (mqtt/aba), `received_at` — dedupe for messages **without a natural key**; always written in the same transaction as the state change. `pay/request` uses `payments(machine_id, request_id)` and `transaction` uses `dispenses(tran_id)` instead. |
| `payment_events` | `tran_id`, `from_status`, `to_status`, `reason`, `at` — audit trail |

### 8.4 Delivery guarantees

| Direction | Guarantee | Mechanism |
|---|---|---|
| Backend → machine | At least once | Outbox + MQTT QoS 1 + persistent session |
| Machine → backend | At least once | ESP32 retry + QoS 1 |
| Duplicates | Harmless | Natural idempotency keys (`request_id`, `tran_id`) or inbox + `tran_id` checks on the STM32 and in aggregates |
| Dispense outcome machine → backend | At least once, survives offline/reboot | ESP32 stores outcome in NVS and re-sends until `transaction/ack` |

---

## 9. Reliability patterns

| Risk | Pattern |
|---|---|
| Crash between state change and notification | **Transactional outbox** |
| Duplicate MQTT messages | **Idempotent consumers** (natural keys; inbox only inside the state-change transaction) |
| Concurrent updates to the same payment | **Optimistic locking** (`version` column) |
| Machine repeats `REQ_PAY` | **Idempotency key** `(machine_id, request_id)` → status-aware replay (live QR re-sent only while PENDING and unexpired) |
| Callback lost / Redis data lost | **DB-driven sweeps** + **reconcile** probes; no money decision depends on a single message or a Redis timer |
| UART line lost between ESP32 and STM32 | **Acknowledgements both ways** (`PAID,ACK`, `ACK,<tran_id>`); STM32 keeps its outcome until acknowledged |
| ABA slow or down | **Timeouts + retry with backoff + circuit breaker** in the PayWay adapter |
| Paid but no outcome reported | **Process manager:** no outcome within 5 min → `DISPENSE_UNKNOWN` (alert, **no refund**); replayed outcome resolves it; still unknown after 24 h → `REFUND_REVIEW` (operator) |
| Refund needed | **Refund review queue:** operator refunds (ABA portal/cash) and records it; automatic ABA refunds only after ABA confirms the API (`REFUND_MODE`) |
| Invalid payloads | **Zod validation** at every edge (MQTT, REST, ABA responses) |
| Poison messages | Max attempts → **dead-letter queue** + alert |

---

## 10. Scalability, concurrency & load

### 10.1 Expected load

Each machine serves **one customer at a time**, so traffic stays small even with many machines:

| Machines | Busy-hour sales / machine | Payment messages / s | ABA status checks / s* | Dashboard users |
|---|---|---|---|---|
| 10 | 30 / h | ~0.1 | ~1 | 2–3 |
| 100 | 30 / h | ~1 | ~10 | 5–10 |
| 1,000 | 30 / h | ~10 | ~100 | 20+ |

\* Pending payments are checked ~every 3 s for the 30–60 s a customer takes to pay.

One NestJS (Fastify) instance handles thousands of requests per second, so raw throughput is not the risk. **Correctness under concurrency** and **ABA's rate limits** are.

### 10.2 How concurrent requests are handled

```text
 1,000 machines ─▶ EMQX ─(shared subscription)─┬─▶ API #1 ─┐
                                               ├─▶ API #2 ─┼─▶ Prisma pools ─▶ PostgreSQL
                                               └─▶ API #N ─┘        ▲
                                                    │                │
                                               BullMQ queue ─▶ Workers (rate-limited) ─▶ ABA PayWay
```

| Layer | Mechanism |
|---|---|
| Node.js event loop | Non-blocking I/O — thousands of in-flight requests per process |
| Multiple API instances | Caddy (HTTP) and EMQX shared subscriptions (MQTT) spread the load |
| Queues (BullMQ) | Bursts are absorbed and processed at a safe rate instead of rejected |
| Connection pools | Each process uses a small Prisma pool (5); total ≈ 15 connections. PgBouncer only when this budget is exceeded (ADR-0011) |
| Redis cache | Machine config and prices served from memory |

### 10.3 Correctness when things happen at the same time

| Situation | Risk | Protection |
|---|---|---|
| Customer presses pay twice / ESP32 retries | Two QRs, double charge | **Idempotency key** `(machine_id, request_id)` → status-aware replay; **one open payment per machine** (partial unique index) with a per-machine row lock |
| New payment while the previous one is PAID | Two paid payments on one machine | `PAY_MACHINE_BUSY` until the outcome arrives |
| ABA job and ABA callback both report "paid" | PAID processed twice | **Optimistic locking** (`version`) — second update fails harmlessly |
| `DONE` delivered twice by MQTT | Sale counted twice | `dispenses.tran_id` primary key + aggregate rule "dispense once" |
| Two workers take the same outbox row | Machine told PAID twice | `FOR UPDATE SKIP LOCKED`; STM32 ignores a repeated `tran_id` |
| Payment expires at the moment it is paid | Paid but marked expired | Status + `expires_at` checked in one transaction; ABA re-checked before expiring |
| Two operators edit the same price | Lost update | Optimistic locking → "changed by someone else" |

Rule of thumb: **the database is the referee** — unique constraints, transactions and version checks make the number of simultaneous requests irrelevant to correctness.

```sql
-- At most one open payment (PENDING or PAID) per machine
CREATE UNIQUE INDEX one_open_payment_per_machine
  ON payments (machine_id) WHERE status IN ('PENDING', 'PAID');
```

### 10.4 ABA PayWay is the real bottleneck

| Technique | Effect |
|---|---|
| **ABA callbacks** (production has a public HTTPS URL) | Faster confirmation; the callback only **enqueues** a confirm job (always 200) |
| DB-driven polling of **pending** payments (3 s for 60 s, then 5 s) + **reconcile** probes for terminal payments (+5 min … +6 d) | Works even if every callback is lost |
| **Rate limiter** on the PayWay adapter (BullMQ limiter) | Never exceed ABA limits (`429`); queue instead of fail |
| **Circuit breaker** | ABA down → stop calling; machines show "Payment unavailable" |
| Timeouts + retry with backoff | One slow call cannot block others |

### 10.5 Overload and abuse protection

| Protection | Purpose |
|---|---|
| Rate limiting per machine (`pay/request` token bucket in Redis, shared by all instances) and per dashboard user | A buggy or compromised device cannot flood the server or exhaust ABA limits |
| MQTT ACL per device | A machine can publish only to `wrm/<its id>/#` |
| Payload size limits + Zod validation | Malformed or huge messages rejected early |
| Queue-depth and outbox-lag alerts (backpressure) | Know before the system falls behind |
| Graceful degradation | Under stress, new payments pause; already-paid dispenses continue |

### 10.6 Load testing (before go-live)

| Tool | What it tests |
|---|---|
| **k6** | API/dashboard: e.g. 50 concurrent users, p95 < 300 ms |
| **emqtt-bench** | 1,000 simulated machines sending `pay/request` / `transaction` |
| Mock ABA with delay + `429` responses | Queues, rate limiter, circuit breaker |
| Chaos test (kill API/worker mid-payment) | Outbox still delivers `PAID`; nothing lost or doubled |

**Pass criteria:** at **10× expected peak** — QR < 2 s, PAID < 3 s, **zero** lost or duplicate payments.

### 10.7 Scaling the components

| Part | How it scales |
|---|---|
| API | Stateless → more instances behind the proxy |
| MQTT intake | **EMQX shared subscriptions** `$share/backend/wrm/+/pay/request` — each message to one instance |
| Workers | More copies; BullMQ balances; outbox uses `SKIP LOCKED` |
| Database | Indexes, small Prisma pools → **PgBouncer** when needed (ADR-0011), read replicas for reporting, partitioning/TimescaleDB for heartbeats |
| Hot data | Redis cache (machine config, prices), rate limiting |
| Future | Any context can be extracted into a service — it already talks only through events and ports |

Capacity guide: one 4 GB VPS → hundreds of machines. Consider services only at thousands.

---

## 11. Performance

- NestJS on **Fastify** adapter.
- CQRS read side: dashboard queries hit indexed views, never aggregates.
- **Prisma TypedSQL / `$queryRaw`** against SQL views for heavy reports; Prisma models for writes.
- No N+1 queries (query logging in dev, review in PRs).
- Targets: QR to machine **< 2 s**; `PAID` to machine **< 3 s** after ABA approval; dashboard queries **< 300 ms**.

---

## 12. Quality

| Area | Rule / tool |
|---|---|
| Language | TypeScript **strict**, no `any` |
| Style | ESLint + Prettier (CI enforced) |
| Boundaries | dependency-cruiser rules per context and per layer |
| Unit tests | Domain + application, no I/O, high coverage on Payments & Dispensing |
| Integration tests | **Testcontainers** (real PostgreSQL + Redis) for repositories, outbox, jobs |
| Contract tests | Shared **Zod** schemas for MQTT topics/payloads (backend ↔ ESP32 protocol) |
| End-to-end | Fake ESP32 → MQTT → API → mock ABA → `PAID` → `DONE` |
| CI gates | Lint + typecheck + boundaries + all tests before merge |
| Decisions | **ADRs** in `docs/adr/` (one page per significant decision) |

---

## 13. Observability

| Tool | Purpose |
|---|---|
| **pino** structured JSON logs | Every line includes `tran_id`, `machine_id`, `correlation_id` |
| **OpenTelemetry** traces | Follow one payment: MQTT → handler → DB → ABA → outbox → MQTT |
| **Prometheus / Grafana** metrics | Payments per minute, success rate, ABA latency, machines online, queue depth, outbox lag |
| **Sentry** | Errors with stack traces and context |
| Alerts | Telegram on error spikes, ABA failures, offline machines, outbox lag |

---

## 14. Security

- Per-device MQTT credentials + **ACL** (`wrm/WRM-001/#` only for WRM-001).
- RBAC for dashboard users (admin / operator / viewer) + **audit log** of sensitive actions (prices, refunds).
- Secrets only in a secret manager / environment, never in Git or images.
- Rate limiting on public endpoints; validation of every input.
- ABA keys server-side only; requests signed (HMAC-SHA512); all traffic TLS.

---

## 15. Technology stack

| Layer | Choice |
|---|---|
| Backend | **NestJS (Fastify)**, TypeScript strict |
| Architecture | Modular monolith · DDD · Hexagonal · CQRS-light · Outbox |
| Database | **PostgreSQL** + Prisma (writes, reads via TypedSQL/raw SQL); PgBouncer later if needed |
| Jobs / events | **Redis + BullMQ** (outbox dispatch, DB-driven sweeps, ABA checks, notifications) |
| Messaging | **EMQX Cloud** (shared subscriptions, per-device auth + ACL, MQTT 5 message expiry) |
| Validation | **Zod** schemas in `packages/contracts` (+ generated C header for firmware) |
| Rate limiting / resilience | rate-limiter-flexible (Redis) · opossum circuit breaker |
| Dashboard | **Next.js** + Tailwind + shadcn/ui |
| Auth | Better Auth (after spike) or NestJS guards + Argon2id + sessions; RBAC |
| Observability | pino · OpenTelemetry · Prometheus/Grafana · Sentry |
| Testing | Vitest · Testcontainers · contract tests (incl. firmware golden fixtures) · E2E |
| Delivery | Docker · GitHub Actions — see **Deployment** doc |

---

## 16. Repository structure

```text
water-refill-machine/
├── apps/
│   ├── api/                          NestJS app (one image; RUN_MODE = all | api | worker)
│   │   └── src/
│   │       ├── contexts/
│   │       │   ├── payments/         domain · application · infrastructure · interface (core)
│   │       │   ├── dispensing/       domain · application · infrastructure · interface (core)
│   │       │   ├── fleet/            application · interface
│   │       │   ├── monitoring/       application · interface
│   │       │   ├── identity/         application · interface
│   │       │   └── reporting/        queries only
│   │       ├── shared-kernel/        DomainEvent, AggregateRoot, Money, Clock, base errors
│   │       ├── platform/             config, db, outbox, inbox, sweeps, mqtt, queue, ratelimit, logging
│   │       └── main.ts               boots API, worker or both by RUN_MODE
│   │   └── prisma/                   schema.prisma + migrations + TypedSQL
│   └── dashboard/                    Next.js admin
├── packages/
│   └── contracts/                    Zod: MQTT topics & payloads, REST DTOs, error + fault codes; generated C header
├── firmware/
│   └── esp32-gateway/
├── infra/                            Docker Compose, Caddy, scripts, load tests
├── docs/
│   └── adr/
└── pnpm-workspace.yaml
```

---

## 17. Main flows

| Flow | Path |
|---|---|
| **Pay** | `pay/request` (rate-limited) → existing `(machine, request_id)`? status-aware replay : PayWay adapter (KHQR) → one transaction (machine lock, busy check, supersede old PENDING, save PENDING + outbox) → relay → publish `pay/qr` (with message expiry) |
| **Confirm** | Payments sweep (every 3 s) picks payments whose `next_aba_check_at` is due → `check-transaction` → `ConfirmPayment` → `markPaid` → save + outbox → publish `pay/status: paid`; callbacks only enqueue the same confirm job |
| **Reconcile** | Reconcile sweep probes EXPIRED / CANCELLED / FAILED payments at +5 min, +1 h, +1 d, +3 d, +6 d → late approval → `REFUND_REVIEW` |
| **Dispense** | STM32 outcome (kept until `ACK`) → ESP32 NVS queue → `transaction` → `RecordDispense` (idempotent on `tran_id`) → accuracy check → `DispenseCompleted` → Payments → DISPENSED → `transaction/ack`; mismatch > 5 % → alert |
| **Expiry** | Payments sweep: `expires_at + grace` passed → final ABA check → `ExpirePayment` → outbox → `pay/status: expired` + ABA close |
| **Outcome timeout** | Dispensing sweep: PAID without outcome for 5 min → DISPENSE_UNKNOWN (alert, no refund); 24 h and machine online with no pending outcomes → REFUND_REVIEW |
| **Refund review** | PARTIAL / ERR / `PAID,REJECT` / late payment / escalated unknown → `REFUND_REVIEW` + refund case → operator claims and refunds (or auto when enabled) → REFUNDED / REFUND_REJECTED (reopenable) |
| **Online/offline** | `online` (Last Will) + heartbeats → Fleet → offline after 3 min → `MachineWentOffline` → alert |

---

## 18. Build order

The detailed, phase-by-phase build order (Phases 0–11, incl. the early pilot) is in the **[Implementation Plan](backend-implementation-plan.md#part-e--phases)**. Summary:

| Phase | Deliverable |
|---|---|
| 0–1 | Monorepo, CI, platform (outbox, sweeps, MQTT, queues, logging) |
| 2 | Payments (incl. reconcile and minimal outcome recording) — prototype cut-over |
| 3 | Dispensing + refund review; UART/NVS acknowledgements |
| 3.5 | Early pilot on a minimal production environment (runs in parallel) |
| 4–7 | Fleet, Monitoring, Identity, Reporting + dashboard |
| 8–10 | Observability, full production deployment, hardening, go-live decision |
| 11 | OTA (after go-live) |

---

## 19. Decisions not taken (yet)

| Not now | Reason |
|---|---|
| Microservices | Network failures, distributed transactions and ops cost without real benefit at this scale |
| Kubernetes | Docker Compose on a VPS covers hundreds of machines |
| Event sourcing | Audit needs are covered by `payment_events` + outbox |
| NoSQL main database | Money needs ACID transactions and SQL reporting |

---

## Related

- [Deployment](../06-Testing-and-Operations/deployment.md)
- [Product Architecture & Roadmap](../01-Project-Overview/product-architecture-roadmap.md)
- [STM32 QR Payment Integration](stm32-qr-payment-integration.md)
- [ESP32 Gateway README](../../esp32-gateway/README.md)
