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
| **Fleet** | Supporting | DDD-light | Machines, prices, config, firmware versions, online status |
| **Monitoring** | Supporting | DDD-light | Alert rules, incidents, notifications |
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
│   ├── events/                    PaymentCreated, PaymentPaid, PaymentExpired, RefundRequested
│   ├── errors.ts                  DomainError types
│   └── ports/                     PaymentRepository, PaymentGateway (interfaces)
├── application/                ← use cases (orchestration, transactions)
│   ├── commands/                  CreatePayment, ConfirmPayment, ExpirePayment, RequestRefund
│   └── queries/                   GetPaymentStatus
├── infrastructure/             ← adapters to the outside world
│   ├── prisma-payment.repository.ts
│   └── payway/                    ABA PayWay adapter (signing, generate-qr, check-transaction, refund)
└── interface/                  ← entry points
    ├── mqtt/pay-request.consumer.ts
    ├── http/payments.controller.ts
    └── jobs/check-aba.processor.ts
```

**Dependency rule:** `interface → application → domain ← infrastructure`. The domain depends on nothing; infrastructure implements domain ports.

| Layer | May depend on | Contains |
|---|---|---|
| `domain` | nothing | Aggregates, value objects, domain events, port interfaces |
| `application` | `domain` | Command/query handlers, transactions, publishing events to the outbox |
| `infrastructure` | `domain`, `application` | Prisma, PayWay HTTP client, MQTT publisher |
| `interface` | `application` | MQTT consumers, REST controllers, job processors |

---

## 6. Domain model (core)

### 6.1 Payment aggregate — state machine

```text
              QR created
  ┌─────────▶ PENDING ──── QR timeout ────▶ EXPIRED
  │              │
  │         ABA APPROVED
  │              ▼
  │            PAID ──── machine reports DONE ────▶ DISPENSED ✅
  │              │
  │       no DONE in 5 min / ERR from machine
  │              ▼
  │        REFUND_PENDING ──── operator/auto ────▶ REFUNDED
  │
  └── ABA DECLINED/CANCELLED ──▶ FAILED
```

**Invariants (enforced inside the aggregate):**

1. Only `PENDING → PAID` may emit `PaymentPaid` (the only event that lets a machine dispense).
2. A payment cannot be paid after `expiresAt`.
3. `DONE` is accepted only for a `PAID` payment **from the same machine**.
4. A payment dispenses at most once.
5. Every transition is recorded (`payment_events`) for audit.

```ts
export class Payment {
  private constructor(
    readonly tranId: TranId,
    readonly machineId: MachineId,
    readonly volume: Volume,
    readonly price: Money,
    private status: PaymentStatus,
    private readonly expiresAt: Date,
    private version: number,
    private events: DomainEvent[] = [],
  ) {}

  static create(machineId: MachineId, volume: Volume, price: Money, now: Date): Payment {
    const p = new Payment(TranId.generate(now), machineId, volume, price, 'PENDING',
                          new Date(now.getTime() + 3 * 60_000), 0);
    p.events.push(new PaymentCreated(p.tranId, machineId));
    return p;
  }

  markPaid(now: Date) {
    if (this.status !== 'PENDING') throw new DomainError(`cannot pay a ${this.status} payment`);
    if (now > this.expiresAt)      throw new DomainError('payment expired');
    this.status = 'PAID';
    this.events.push(new PaymentPaid(this.tranId, this.machineId));
  }

  recordDispense(fromMachine: MachineId) {
    if (this.status !== 'PAID')              throw new DomainError('not paid');
    if (!fromMachine.equals(this.machineId)) throw new DomainError('wrong machine');
    this.status = 'DISPENSED';
    this.events.push(new PaymentDispensed(this.tranId));
  }

  pullEvents(): DomainEvent[] { const e = this.events; this.events = []; return e; }
}
```

### 6.2 Value objects

| Value object | Rules |
|---|---|
| `Money` | Amount + currency (`KHR`/`USD`); KHR ≥ 100, USD ≥ 0.01; no floats in arithmetic (store minor units) |
| `TranId` | ≤ 20 chars, unique (ABA limit) |
| `Volume` | One of 500 / 750 / 1000 mL (configurable per machine) |
| `MachineId` | Format `WRM-###` |

### 6.3 Domain events

| Event | Raised by | Consumed by |
|---|---|---|
| `PaymentCreated` | Payments | Fleet (last activity), Reporting |
| `PaymentPaid` | Payments | **MQTT publisher → `pay/status: paid`**, Reporting |
| `PaymentExpired` / `PaymentFailed` | Payments | MQTT publisher, Reporting |
| `DispenseCompleted` | Dispensing | Payments (→ DISPENSED), Reporting |
| `DispenseAccuracyMismatch` | Dispensing | Monitoring (alert) |
| `RefundRequested` / `Refunded` | Payments | Monitoring, Reporting |
| `MachineWentOffline` / `MachineCameOnline` | Fleet | Monitoring |
| `AlertRaised` | Monitoring | Telegram notifier, dashboard |

---

## 7. CQRS

| Side | Path | Technology |
|---|---|---|
| **Command (write)** | Interface → command handler → aggregate → repository + outbox (one transaction) | Prisma |
| **Query (read)** | Interface → query handler → SQL view / read model | Kysely / raw SQL |

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
Outbox relay (worker, every ~200 ms or LISTEN/NOTIFY)
   ├── SELECT ... FROM outbox WHERE published_at IS NULL ORDER BY occurred_at
   │        FOR UPDATE SKIP LOCKED LIMIT 100          ← safe with many workers
   ├── dispatch to handlers / BullMQ queues (MQTT publish, Telegram, read models)
   └── UPDATE outbox SET published_at = now()
```

### 8.3 Tables

| Table | Columns |
|---|---|
| `outbox` | `id (uuid)`, `aggregate_type`, `aggregate_id`, `event_type`, `payload (jsonb)`, `occurred_at`, `published_at`, `attempts`, `last_error` |
| `inbox` | `message_id (pk)`, `source` (mqtt/aba), `received_at` — dedupe of incoming messages |
| `payment_events` | `tran_id`, `from_status`, `to_status`, `reason`, `at` — audit trail |

### 8.4 Delivery guarantees

| Direction | Guarantee | Mechanism |
|---|---|---|
| Backend → machine | At least once | Outbox + MQTT QoS 1 + persistent session |
| Machine → backend | At least once | ESP32 retry + QoS 1 |
| Duplicates | Harmless | Inbox dedupe + `tran_id` checks on the STM32 and in aggregates |

---

## 9. Reliability patterns

| Risk | Pattern |
|---|---|
| Crash between state change and notification | **Transactional outbox** |
| Duplicate MQTT messages | **Idempotent consumers / inbox** |
| Concurrent updates to the same payment | **Optimistic locking** (`version` column) |
| Machine repeats `REQ_PAY` | **Idempotency key** per request → same QR returned |
| ABA slow or down | **Timeouts + retry with backoff + circuit breaker** in the PayWay adapter |
| Paid but not dispensed | **Process manager (saga):** no `DONE` within 5 min → `REFUND_PENDING` |
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
                                               ├─▶ API #2 ─┼─▶ PgBouncer ─▶ PostgreSQL
                                               └─▶ API #N ─┘        ▲
                                                    │                │
                                               BullMQ queue ─▶ Workers (rate-limited) ─▶ ABA PayWay
```

| Layer | Mechanism |
|---|---|
| Node.js event loop | Non-blocking I/O — thousands of in-flight requests per process |
| Multiple API instances | Caddy (HTTP) and EMQX shared subscriptions (MQTT) spread the load |
| Queues (BullMQ) | Bursts are absorbed and processed at a safe rate instead of rejected |
| PgBouncer | Many requests share a bounded pool of DB connections |
| Redis cache | Machine config and prices served from memory |

### 10.3 Correctness when things happen at the same time

| Situation | Risk | Protection |
|---|---|---|
| Customer presses pay twice / ESP32 retries | Two QRs, double charge | **Idempotency key** + **one PENDING payment per machine** (partial unique index) → repeat returns the same QR |
| ABA job and ABA callback both report "paid" | PAID processed twice | **Optimistic locking** (`version`) — second update fails harmlessly |
| `DONE` delivered twice by MQTT | Sale counted twice | **Inbox dedupe** + aggregate rule "dispense once" |
| Two workers take the same outbox row | Machine told PAID twice | `FOR UPDATE SKIP LOCKED`; STM32 ignores a repeated `tran_id` |
| Payment expires at the moment it is paid | Paid but marked expired | Status + `expires_at` checked in one transaction; ABA re-checked before expiring |
| Two operators edit the same price | Lost update | Optimistic locking → "changed by someone else" |

Rule of thumb: **the database is the referee** — unique constraints, transactions and version checks make the number of simultaneous requests irrelevant to correctness.

```sql
-- At most one open payment per machine
CREATE UNIQUE INDEX one_pending_payment_per_machine
  ON payments (machine_id) WHERE status = 'PENDING';
```

### 10.4 ABA PayWay is the real bottleneck

| Technique | Effect |
|---|---|
| **ABA callbacks** (production has a public HTTPS URL) | Most payments confirmed by push → far less polling |
| Poll only **pending** payments with backoff (3 s → 5 s → 10 s) | Fewer calls for slow payers |
| **Rate limiter** on the PayWay adapter (BullMQ limiter) | Never exceed ABA limits (`429`); queue instead of fail |
| **Circuit breaker** | ABA down → stop calling; machines show "Payment unavailable" |
| Timeouts + retry with backoff | One slow call cannot block others |

### 10.5 Overload and abuse protection

| Protection | Purpose |
|---|---|
| Rate limiting per machine and per dashboard user | A buggy or compromised device cannot flood the server |
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
| Database | Indexes, **PgBouncer** pooling, read replicas for reporting, partitioning/TimescaleDB for heartbeats |
| Hot data | Redis cache (machine config, prices), rate limiting |
| Future | Any context can be extracted into a service — it already talks only through events and ports |

Capacity guide: one 4 GB VPS → hundreds of machines. Consider services only at thousands.

---

## 11. Performance

- NestJS on **Fastify** adapter.
- CQRS read side: dashboard queries hit indexed views, never aggregates.
- **Kysely / SQL** for heavy reports; Prisma for writes.
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
| Database | **PostgreSQL** + Prisma (writes) + Kysely/SQL (reads) + PgBouncer |
| Jobs / events | **Redis + BullMQ** (outbox relay, ABA polling, sagas, schedules) |
| Messaging | **EMQX Cloud** (shared subscriptions, per-device auth + ACL) |
| Validation | **Zod** schemas in `packages/shared` |
| Dashboard | **Next.js** + Tailwind + shadcn/ui |
| Auth | Better Auth + RBAC |
| Observability | pino · OpenTelemetry · Prometheus/Grafana · Sentry |
| Testing | Vitest/Jest · Testcontainers · contract tests · E2E |
| Delivery | Docker · GitHub Actions — see **Deployment** doc |

---

## 16. Repository structure

```text
water-refill-machine/
├── apps/
│   ├── api/                          NestJS app (API + worker entry points)
│   │   └── src/
│   │       ├── contexts/
│   │       │   ├── payments/         domain · application · infrastructure · interface
│   │       │   ├── dispensing/
│   │       │   ├── fleet/
│   │       │   ├── monitoring/
│   │       │   ├── identity/
│   │       │   └── reporting/        queries only
│   │       ├── shared-kernel/        DomainEvent, AggregateRoot, Result, base errors
│   │       ├── platform/             outbox, inbox, mqtt client, bullmq, logging, config
│   │       ├── main.api.ts           HTTP + MQTT consumers
│   │       └── main.worker.ts        outbox relay + job processors
│   │   └── prisma/                   schema.prisma + migrations
│   └── dashboard/                    Next.js admin
├── packages/
│   └── shared/                       Zod schemas: MQTT topics & payloads, enums
├── firmware/
│   └── esp32-gateway/
├── infra/                            Docker Compose, Caddy, scripts
├── docs/
│   └── adr/
└── pnpm-workspace.yaml
```

---

## 17. Main flows

| Flow | Path |
|---|---|
| **Pay** | `pay/request` → inbox dedupe → `CreatePayment` → PayWay adapter (KHQR) → save PENDING + outbox → relay → publish `pay/qr` |
| **Confirm** | BullMQ job checks ABA every 3 s → `ConfirmPayment` → aggregate `markPaid` → save + outbox → relay → publish `pay/status: paid` |
| **Dispense** | `transaction` → inbox → `RecordDispense` → accuracy check → `DispenseCompleted` → Payments → DISPENSED; mismatch > 5 % → alert |
| **Expiry** | Scheduled job → `ExpirePayment` → outbox → `pay/status: expired` |
| **Refund saga** | PAID without DONE for 5 min (or `ERR`) → `REFUND_PENDING` → auto/operator → PayWay refund → REFUNDED |
| **Online/offline** | `online` (Last Will) + heartbeats → Fleet → offline after 3 min → `MachineWentOffline` → alert |

---

## 18. Build order

| Step | Deliverable | Done when |
|---|---|---|
| 1 | Monorepo, NestJS (Fastify), Prisma, Docker Compose (Postgres, Redis, Mosquitto), lint/boundaries, CI | Empty app builds and tests run in CI |
| 2 | Platform: outbox, inbox, MQTT client, BullMQ, logging | Outbox relay publishes test events |
| 3 | **Payments** context (aggregate, PayWay adapter, consumers, jobs) | Existing ESP32 works unchanged against the new backend |
| 4 | **Dispensing** context + saga to refund | DONE recorded; missing DONE → REFUND_PENDING |
| 5 | **Fleet** + **Monitoring** (Telegram) | Offline and accuracy alerts arrive in Telegram |
| 6 | **Identity** + **Reporting** + Next.js dashboard | Operators log in and see sales/machines |
| 7 | Staging + production deployment | See **Deployment** doc |

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
