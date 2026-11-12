# 📋 Backend Implementation Plan — Notion Backlog Tasks

> **Source:** [`backend-implementation-plan.md`](backend-implementation-plan.md)  
> **Target Notion Database:** `Sprint Tasks` / Backlog  
> **Schema Format:** Matches your Notion columns: `Task` (Title), `Area` (Multi-select), `Priority` (Select). The `Phase` relation column has been removed/omitted as requested, with the backend phase embedded directly into each task name (`[BE-P0]` to `[BE-P11]`).
>
> 📁 **Direct Import File:** [`backend-backlog-notion.csv`](backend-backlog-notion.csv) (Click `...` on your Notion database → `Merge with CSV` to import all 86 tasks automatically).

---

## 1. Quick Notion Import Options

- **Option A (Automated CSV Merge — Recommended):**
  1. Open your Notion **Sprint Tasks** database.
  2. Click the `...` menu (top right of the database view).
  3. Select **Merge with CSV** and choose [`docs/04-Cloud-and-Payment/backend-backlog-notion.csv`](backend-backlog-notion.csv).
  4. Notion will automatically populate `Task`, `Area`, and `Priority` without touching the `Phase` column!
- **Option B (Copy & Paste):**
  Copy rows from the table below and paste directly into your Notion database table view.

---

## 2. Complete Backlog Table

| Task | Area | Priority |
|---|---|---|
| `[BE-P0] Monorepo Restructure & Path Migration` | Backend, Firmware | High |
| `[BE-P0] Workspace Setup (pnpm, Turborepo, contracts)` | Backend | High |
| `[BE-P0] Scaffold API Application (NestJS 11 + Fastify)` | Backend | High |
| `[BE-P0] Tooling & Boundary Enforcement (ESLint, depcruise)` | Backend | High |
| `[BE-P0] Test Setup (Vitest, SWC, Testcontainers)` | Backend | High |
| `[BE-P0] Local Infrastructure Compose (Postgres, Redis, Mosquitto)` | Backend | High |
| `[BE-P0] CI Pipeline (GitHub Actions ci.yml)` | Backend | High |
| `[BE-P0] Architecture Decision Records (ADRs 0001–0008, 0011)` | Backend | High |
| `[BE-P0] Partner Coordination (ABA & STM32 Specs)` | Backend, PM | High |
| `[BE-P1] Configuration Module (Zod validation & RUN_MODE)` | Backend | High |
| `[BE-P1] Structured Logging (nestjs-pino & Redaction)` | Backend | High |
| `[BE-P1] Error Taxonomy & Global Exception Filter` | Backend | High |
| `[BE-P1] Shared Kernel Primitives (AggregateRoot, Money, TranId)` | Backend | High |
| `[BE-P1] Database & UnitOfWork (Prisma, retry, conflict mapping)` | Backend | High |
| `[BE-P1] Transactional Outbox Platform (Relay, Registry, DLQ)` | Backend | High |
| `[BE-P1] Idempotent Inbox Service (InboxService.record in tx)` | Backend | High |
| `[BE-P1] Sweeps Scheduling Framework (BullMQ repeatable jobs)` | Backend | High |
| `[BE-P1] MQTT Client Platform (TLS, Reconnect, Expiry, @MqttSubscribe)` | Backend | High |
| `[BE-P1] Queue Service (BullMQ Module, DLQ, retention)` | Backend | High |
| `[BE-P1] Distributed Rate Limiter (Redis rate-limiter-flexible)` | Backend | High |
| `[BE-P1] Health Checks & Telemetry Init (/health, OTel, Sentry)` | Backend | Medium |
| `[BE-P2] Payment & Dispense Contracts (Zod schemas)` | Backend | High |
| `[BE-P2] Payment Aggregate & Domain Logic (State machine & events)` | Backend | High |
| `[BE-P2] Payment Application Commands & Sweeps (pay, cancel, reconcile)` | Backend | High |
| `[BE-P2] Prisma Payment Repositories & Concurrency Guards` | Backend | High |
| `[BE-P2] ABA PayWay Gateway Integration (Per-op mapping D7 & mock)` | Backend | High |
| `[BE-P2] Payment MQTT Consumers & Handlers (pay/request, cancel, qr)` | Backend | High |
| `[BE-P2] PayWay Webhook Callback & Confirm Job Handler` | Backend | High |
| `[BE-P2] Minimal Dispense Outcome Recording (transaction consumer)` | Backend | High |
| `[BE-P2] Database Migrations & Initial Machine/Price Seed` | Backend | High |
| `[BE-P2] ESP32 Firmware v0.3 Update (request_id, retry, local cancel)` | Backend, Firmware | High |
| `[BE-P2] Backend Cut-Over & Prototype Retirement` | Backend | High |
| `[BE-P3] Dispense Domain & Volume/Weight Accuracy Check` | Backend | High |
| `[BE-P3] Dispense Escalation & Reconciliation Sweeps (sweep.dispensing)` | Backend | High |
| `[BE-P3] Refund Case Management & Atomic Claiming` | Backend | High |
| `[BE-P3] Machine-Blocked Refund Guard (REFUND_BLOCKED_PENDING_OUTCOMES)` | Backend | High |
| `[BE-P3] Rejection Handling & Dispense Ack Rules (dispense_rejections)` | Backend | High |
| `[BE-P3] Auto-Refund Executor (Behind REFUND_MODE=auto)` | Backend | Medium |
| `[BE-P3] ESP32 Firmware v0.4 NVS Outcome Queue (capacity 64, 7-day)` | Backend, Firmware | High |
| `[BE-P3] STM32 Integration & Golden Fixture Validation` | Backend, Hardware | High |
| `[BE-P3.5] Pilot Production Infrastructure Setup (VPS, Postgres, Caddy)` | Backend | High |
| `[BE-P3.5] Production Merchant & Static IP Whitelisting (ABA)` | Backend, PM | High |
| `[BE-P3.5] Pilot Machine Provisioning (WRM-001 at pilot site)` | Backend, Hardware | High |
| `[BE-P3.5] Pilot Operations & Daily Log (Daily reviews & audits)` | Backend | Medium |
| `[BE-P4] Fleet Service & Machine Provisioning API (/v1/machines)` | Backend | High |
| `[BE-P4] Machine Pricing Management (300ml, 500ml, 1000ml fixed tiers)` | Backend | High |
| `[BE-P4] Heartbeat & Presence Consumer (MachinePresenceService)` | Backend | High |
| `[BE-P4] Remote Configuration Delivery & Ack (Retained config topic)` | Backend | High |
| `[BE-P4] Offline Detection Sweep (sweep.fleet-offline within 3 min)` | Backend | High |
| `[BE-P4] ESP32 Firmware v0.5 Fleet Sync (CFG/PONG/Heartbeat)` | Backend, Firmware | High |
| `[BE-P4] Heartbeat Telemetry Retention Policy (30-day cleanup)` | Backend | Low |
| `[BE-P5] Alert Domain & Lifecycle Service (Dedupe & 10m merge)` | Backend | High |
| `[BE-P5] Alert Rules Implementation (Offline, dispense, refund, faults)` | Backend | High |
| `[BE-P5] Hardware Fault Code Mapping & Severities (Plan C8)` | Backend | High |
| `[BE-P5] Telegram Notifier Queue & Worker (notify.telegram)` | Backend | High |
| `[BE-P5] Monitoring Sweep (sweep.monitoring for stale cases/pending)` | Backend | High |
| `[BE-P5] Alerts REST API (GET /v1/alerts, ack, resolve with Admin key)` | Backend | Medium |
| `[BE-P6] Authentication Spike & Framework Setup (Argon2id/sessions)` | Backend | High |
| `[BE-P6] Role-Based Access Control (RBAC: admin, operator, viewer)` | Backend | High |
| `[BE-P6] User Management & Multi-Factor Auth (TOTP for admin)` | Backend | Medium |
| `[BE-P6] Security Audit Logging (Immutable audit trail)` | Backend | High |
| `[BE-P6] Login Brute-Force & IP Rate Limiting` | Backend | High |
| `[BE-P7] Sales & Machine Reporting Views (Materialized TypedSQL)` | Backend | High |
| `[BE-P7] Paginated Reporting Endpoints (Sales, revenue, CSV export)` | Backend | Medium |
| `[BE-P7] Next.js Operator Dashboard (Overview, fleet management)` | Backend | High |
| `[BE-P7] Dashboard Refund Queue UI (Claim, refund, reject, reopen)` | Backend | High |
| `[BE-P7] Alerts & Unknown Dispenses Dashboard UI` | Backend | Medium |
| `[BE-P8] OpenTelemetry Distributed Tracing (Trace ID through outbox)` | Backend | High |
| `[BE-P8] Application Metrics Collection (/metrics, payments, queues)` | Backend | High |
| `[BE-P8] Grafana Operational Dashboards (Payments, Fleet, Dispense)` | Backend | Medium |
| `[BE-P8] Sentry Error Tracking & Release Tagging` | Backend | Medium |
| `[BE-P9] Multi-Stage Production Dockerfiles (API, worker, dashboard)` | Backend | High |
| `[BE-P9] Production Docker Compose Topology (Caddy, 2x API, worker)` | Backend | High |
| `[BE-P9] Staging Environment Deployment & Verification` | Backend | High |
| `[BE-P9] Automated CI/CD Release Pipeline (GitHub Actions deploy.yml)` | Backend | High |
| `[BE-P9] Database Backup & Disaster Recovery Drill (Encrypted offsite)` | Backend | High |
| `[BE-P9] Infrastructure Hardening & MQTT Security (ACLs & certs)` | Backend | High |
| `[BE-P10] Load Testing (k6 API benchmarks & emqtt-bench 1k machines)` | Backend | High |
| `[BE-P10] Chaos Engineering & Fault Injection (Process kill, Redis flush)` | Backend | High |
| `[BE-P10] Security Audit & Penetration Testing (RBAC, container scans)` | Backend | High |
| `[BE-P10] Legacy Protocol Deprecation (Remove legacy MQTT formats)` | Backend | Low |
| `[BE-P10] Production Go-Live Readiness Review & Pilot Sign-off` | Backend, PM | High |
| `[BE-P11] OTA Contracts & Firmware Registry (Cloudflare R2, SHA-256)` | Backend | High |
| `[BE-P11] Staged Rollout & Canary Controller (Canary -> 10% -> 100%)` | Backend | High |
| `[BE-P11] ESP32 Dual-Partition OTA Execution (Safe boot rollback)` | Backend, Firmware | High |
| `[BE-P11] STM32 Remote Flashing via ESP32 Gateway (UART bootloader)` | Backend, Firmware, Hardware | High |

---

## 3. Phase Descriptions & Acceptance Criteria

### Phase 0 — Foundations
- **Goal:** Production-shaped monorepo with CI enforcing architecture rules.
- **Key Deliverables:** Monorepo paths (`backend-prototype/`, `firmware/esp32-gateway/`), Turborepo, NestJS 11 Fastify scaffold, dependency-cruiser boundary rules, local docker-compose (Postgres, Redis, Mosquitto), CI pipeline, ADRs 0001–0008 & 0011.
- **Definition of Done:**
  - [x] Clean clone: `pnpm i && pnpm build && pnpm test` passes
  - [x] Local compose starts Postgres, Redis, Mosquitto
  - [x] Deliberate cross-layer import fails CI
  - [x] ADRs merged

### Phase 1 — Platform
- **Goal:** Reusable building blocks without domain business logic.
- **Key Deliverables:** Zod config validation, Pino structured logging, standard error taxonomy & global filter, shared kernel (`Money`, `AggregateRoot`, `DomainEvent`), Prisma UoW with conflict retry, transactional outbox & relay, idempotent inbox, BullMQ sweeps framework, resilient MQTT 5 platform, rate limiter, health checks.
- **Definition of Done:**
  - [x] Worker killed mid-dispatch → events handled once after restart
  - [x] `FLUSHALL` on Redis → sweeps resume within one interval
  - [x] `/health/ready` accurate; logs carry `traceId`; secrets redacted
  - [x] `RUN_MODE=all` runs API + worker in one process

### Phase 2 — Payments (+ Minimal Outcome Recording & Cut-Over)
- **Goal:** Full payment lifecycle on the new backend with late-payment detection.
- **Key Deliverables:** Payment domain aggregate & state machine, ABA PayWay gateway integration with per-operation error mapping, MQTT consumers (`pay/request`, `pay/cancel`, `transaction`), BullMQ reconcile sweeps, Prisma repositories, ESP32 firmware v0.3.
- **Definition of Done:**
  - [x] Real ESP32: QR → ABA simulator payment → `PAID` → `DONE` → `transaction/ack` received
  - [x] 20 parallel `pay/request` for one machine leave exactly one open payment
  - [x] Sweeps confirm payments without webhook callback; reconcile finds late payments
  - [x] Killing API/worker or flushing Redis never loses or duplicates `PAID`
  - [x] Prototype decommissioned

### Phase 3 — Dispensing & Refund Review
- **Goal:** Record every outcome even after loss/reboot; auditable refund decisions.
- **Key Deliverables:** Dispense accuracy computation (`|flow - weight| / volume`), dispense escalation sweep, refund case lifecycle with operator claim locking, machine-blocked refund guard (`pending_outcomes > 0`), rejection persistence, ESP32 v0.4 NVS queue.
- **Definition of Done:**
  - [x] Every PAID payment ends in DISPENSED, REFUNDED, or REFUND_REJECTED
  - [ ] Outcomes survive ESP32 reboot, STM32 reboot, and 2 h offline
  - [x] No infinite replay: every outcome is acked `ok` or `rejected`
  - [x] Two operators cannot claim/refund the same case

### Phase 3.5 — Early Pilot
- **Goal:** Real-world payment data from one live machine during development.
- **Key Deliverables:** Minimal production VPS (static IP, Postgres, Redis, Caddy, EMQX), ABA live merchant account activation, WRM-001 deployed to pilot site, daily ops log.
- **Definition of Done:**
  - [ ] One machine taking real (or simulator) payments end to end on production
  - [ ] Pilot log running weekly

### Phase 4 — Fleet Management
- **Goal:** Remote machine provisioning, telemetry, configuration, and online tracking.
- **Key Deliverables:** Fleet provisioning API (`/v1/machines`), price tier validation (300ml, 500ml, 1000ml), heartbeat & presence consumer, retained MQTT config delivery, offline detection sweep (`sweep.fleet-offline`), ESP32 v0.5 firmware.
- **Definition of Done:**
  - [x] New machine provisioned via API and online without manual DB edits
  - [x] Offline within 3 min of power loss; price change confirmed by `CFG,OK`

### Phase 5 — Monitoring & Alerts
- **Goal:** Immediate operator alerting without alert storms.
- **Key Deliverables:** Alert service with dedupe key and 10-minute merge window, pure-function alert rules, C8 fault code severities, Telegram notifier queue (`notify.telegram`), monitoring sweep (`sweep.monitoring`), REST alerts API.
- **Definition of Done:**
  - [x] One alert per incident for every rule
  - [x] Critical alerts reach Telegram (unplug-ESP32 test)

### Phase 6 — Identity & Access Control
- **Goal:** Secure dashboard access with role-based permissions and audit logs.
- **Key Deliverables:** Better Auth / Argon2id session authentication, roles (`admin`, `operator`, `viewer`), `@Roles()` endpoint guards, immutable security audit log, brute-force rate limiting.
- **Definition of Done:**
  - [ ] Only health, callback, and auth reachable without a session
  - [ ] Every sensitive action audit-logged

### Phase 7 — Reporting & Operator Dashboard
- **Goal:** Web interface for operators to view revenue, fleet status, and refund queue.
- **Key Deliverables:** Materialized views for daily sales and machine performance, fast paginated reporting APIs, Next.js dashboard UI (Overview, Machines, Payments, Refund Queue, Alerts).
- **Definition of Done:**
  - [ ] Gross, refunds, and net revenue match DB totals for both KHR and USD
  - [ ] Refund queue fully operable from UI and audit-logged

### Phase 8 — Observability & Telemetry
- **Goal:** End-to-end distributed tracing and proactive alerting before customer notice.
- **Key Deliverables:** OpenTelemetry trace propagation across HTTP/MQTT/BullMQ/Outbox, Prometheus `/metrics`, Grafana dashboards (Payments, ABA, Fleet, Queues), Sentry release tracking.
- **Definition of Done:**
  - [ ] One payment followed in a single trace
  - [ ] All deployment alerts tested by simulation

### Phase 9 — Production Deployment (Full Layout)
- **Goal:** Resilient multi-container deployment with automated zero-downtime releases.
- **Key Deliverables:** Multi-stage Dockerfiles, production docker-compose (Caddy, 2x API, worker, Redis AOF), staging environment, GitHub Actions CI/CD pipeline, automated offsite database backups & restore drill.
- **Definition of Done:**
  - [ ] Merge to `main` deploys to staging automatically; production after approval
  - [ ] Restore drill passed; connection count within budget under load

### Phase 10 — Hardening & Go-Live Verification
- **Goal:** Validate stability under peak load and chaos scenarios; go-live sign-off.
- **Key Deliverables:** k6 load testing & 1,000-machine simulation, chaos engineering (process kills, Redis flushes, network dropouts), security penetration testing, pilot data review.
- **Definition of Done:**
  - [ ] Full deployment checklist passed
  - [ ] Go-live decision recorded with pilot report

### Phase 11 — Over-The-Air (OTA) Updates
- **Goal:** Remote, safe firmware updates for ESP32 gateway and STM32 controller.
- **Key Deliverables:** MQTT OTA contracts, cloud firmware registry with SHA-256 validation, canary rollout controller (1 machine → 10% → 100%), ESP32 dual-partition update with rollback, STM32 UART flashing.
- **Definition of Done:**
  - [ ] Canary rollout and automatic rollback demonstrated for both chips

