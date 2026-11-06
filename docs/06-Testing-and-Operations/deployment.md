# Deployment

> How the Water Refill Machine backend, dashboard and firmware are deployed: environments, infrastructure, CI/CD, zero-downtime releases, secrets, backups, security and monitoring.

| | |
|---|---|
| **Status** | Target deployment plan |
| **Region** | Singapore (closest to Cambodia) |
| **Last updated** | 2026-11-06 |

---

## 1. Environments

| Environment | Purpose | Payments | MQTT broker | Runs on |
|---|---|---|---|---|
| **Local** | Daily development | ABA **mock** | Mosquitto (Docker) | Laptop — Docker Compose |
| **Staging** | Pre-release testing, demos, ESP32/STM32 integration | ABA **sandbox** | EMQX deployment `wrm-staging` | Small VPS |
| **Production** | Real machines, real money | ABA **live** | EMQX deployment `wrm-prod` | Production VPS + managed PostgreSQL |

Each environment has its **own** database, broker, ABA credentials and secrets. Staging can never reach production money or machines.

**Production grows in two steps** (Implementation Plan Phases 3.5 and 9):

| Step | When | Layout |
|---|---|---|
| **Minimal** (early pilot) | Phase 3.5, ≈ week 9 | 1 VPS (static IP), single process `RUN_MODE=all`, managed PostgreSQL, Redis, Caddy, EMQX `wrm-prod`, daily backup, Sentry; manual deploy script |
| **Full** | Phase 9 | Layout below: api ×2 + worker, dashboard, CI/CD with approval, observability, staging environment |

---

## 2. Production infrastructure

```text
                         Cloudflare (DNS, DDoS protection)
                                     │
                    api.yourdomain.com · dashboard.yourdomain.com
                                     │
┌──────────────── VPS (DigitalOcean / Vultr, Singapore, static IP) ─────────────────┐
│ Firewall: only 80/443 public · SSH key-only · fail2ban                             │
│                                                                                    │
│  Caddy (HTTPS, auto certificates, reverse proxy)                                   │
│    ├── api (x2 containers, rolling update)                                         │
│    └── dashboard (Next.js)                                                         │
│  worker (x1–N)      redis (AOF persistence)                                        │
│  observability agent (logs + metrics → Grafana Cloud)                              │
└──────────────┬──────────────────────────────────────────────────┬──────────────────┘
               │ private network                                  │ outbound
     ┌─────────▼──────────┐                     ┌─────────────────▼────────────────┐
     │ Managed PostgreSQL │                     │ EMQX Cloud (prod) · ABA PayWay   │
     │ daily backup + PITR│                     │ Telegram · Sentry · R2 (OTA)     │
     └────────────────────┘                     └──────────────────────────────────┘
```

| Component | Choice | Why |
|---|---|---|
| Server | 1 VPS, **4 GB RAM**, Singapore, **reserved static IP** | Low latency; static IP required by ABA |
| Database | **Managed PostgreSQL** (plan with ≥ 25 connections) | Automatic backups, point-in-time recovery, patching. No PgBouncer at start: small Prisma pools (≈ 15 connections), migrations via `DIRECT_DATABASE_URL` (ADR-0011) |
| Redis | Container with AOF persistence | Queues survive restarts; money timing lives in PostgreSQL (sweeps), so Redis loss only delays work |
| Reverse proxy / HTTPS | **Caddy** | Automatic TLS certificates |
| DNS / edge | **Cloudflare** | Free, DDoS protection |
| Firmware storage (OTA) | **Cloudflare R2** (or S3) | Cheap, fast downloads for ESP32 |
| Logs + metrics | **Grafana Cloud** (free tier) | No monitoring servers to maintain |
| Errors | **Sentry** (free tier) | Stack traces + context |
| Container registry | **GitHub Container Registry (GHCR)** | Integrated with GitHub Actions |

> ⚠️ **ABA PayWay IP whitelist:** live ABA calls only work from whitelisted IPs. Register the production VPS **static IP** with ABA before go-live, and the staging IP for sandbox.

---

## 3. Containers

| Service | Image | Replicas | Notes |
|---|---|---|---|
| `caddy` | caddy | 1 | Routes `api.*` → api, `dashboard.*` → dashboard |
| `api` | `ghcr.io/<org>/wrm-api:<sha>`, `RUN_MODE=api` | 2 | HTTP + MQTT consumers (shared subscription) |
| `worker` | same image, `RUN_MODE=worker` | 1–N | Outbox relay, sweeps (payments, reconcile, dispensing, fleet), ABA checks, notifications |
| `dashboard` | `ghcr.io/<org>/wrm-dashboard:<sha>` | 1 | Next.js |
| `redis` | redis:7 | 1 | AOF on, not exposed publicly |
| `otel-agent` | Grafana Alloy / OTel collector | 1 | Ships logs, metrics, traces |

All containers run as **non-root**, with health checks and restart policy `unless-stopped`.

---

## 4. CI/CD (GitHub Actions)

```text
Push / Pull Request
   │
   ▼
① CI: install → lint → typecheck → boundary check → unit tests
       → integration tests (Testcontainers) → contract + E2E tests → image scan
   │  (PR cannot merge unless all green)
   ▼
Merge to main
   ▼
② Build Docker images (api — also used as worker via RUN_MODE — and dashboard), tag = git commit SHA
   → push to GHCR
   ▼
③ Deploy to STAGING automatically
   → run DB migrations → rolling restart → smoke tests
   ▼
④ Manual approval (GitHub Environment "production")
   ▼
⑤ Deploy to PRODUCTION
   → DB backup → migrations → rolling restart → health checks → smoke tests
   → health checks fail → automatic rollback to previous image
```

| Rule | Why |
|---|---|
| Images tagged with **commit SHA** | Exact traceability; rollback to any version in seconds |
| **Same image** for staging and production | What was tested is what ships |
| **Manual approval** for production | No accidental releases |
| Protected `main` + required reviews + required checks | Quality gate |

---

## 5. Zero-downtime releases

| Concern | Approach |
|---|---|
| API restart | 2 API containers updated one at a time (rolling / blue-green); Caddy routes only to healthy instances |
| MQTT during deploy | Shared subscriptions + QoS 1 + persistent sessions → no lost messages |
| Workers | Graceful shutdown (finish current job); BullMQ retries anything unfinished |
| Outbox | Undispatched rows stay in the table and are sent after restart |
| Sweeps | Job schedulers are re-created at every worker boot; deadlines live in PostgreSQL, so a restart only delays one sweep interval |
| Machines during deploy | ESP32 retries `pay/request` with the same `request_id`; outcomes stay in NVS until acknowledged |
| DB migrations | **Expand → migrate → contract** (never a breaking schema change in one release) |
| Health checks | `/health/live` (process) and `/health/ready` (DB, Redis, MQTT connected) |

---

## 6. Secrets

| Secret | Storage |
|---|---|
| ABA API key, DB URL, MQTT passwords, auth secret, Sentry DSN | **GitHub Environment secrets** (staging/production) written to the server at deploy, or a secret manager (**Doppler / Infisical**) |
| ESP32 device credentials | Unique per machine, in **encrypted NVS**, provisioned at the factory |
| Rules | Never in Git or Docker images · separate per environment · rotate immediately on any leak |

---

## 7. Backups & disaster recovery

| Item | Policy |
|---|---|
| PostgreSQL | Managed daily backups + **point-in-time recovery (7 days)** + weekly logical export to R2 |
| Before each production deploy | On-demand DB backup |
| Redis | AOF; loss acceptable — outbox rows are re-dispatched and all money deadlines are re-read from PostgreSQL by the sweeps (tested in Phase 1/9) |
| Infrastructure | Compose files, Caddyfile, scripts in Git → server rebuildable from the repo |
| **Restore drill** | Restore latest backup into staging **every month** |
| Targets | **RPO ≤ 5 min**, **RTO ≤ 1 hour** |

---

## 8. Security hardening

- SSH key-only, no root login, non-default user, **fail2ban**.
- Firewall: only **80/443** public; PostgreSQL and Redis never exposed.
- Automatic OS security updates (unattended-upgrades).
- Containers: non-root, minimal base images, **Trivy** scan in CI.
- EMQX: per-device username + **ACL** (`wrm/<machine_id>/#` only); separate backend user.
- API: rate limiting, input validation, RBAC, audit log.
- TLS everywhere (Caddy, MQTT 8883, ABA HTTPS).

---

## 9. Firmware deployment (OTA)

```text
Release firmware v1.2.0
  → CI builds + signs the ESP32 image → uploads to R2
  → Dashboard: roll out to 1 test machine (canary)
  → watch 24 h (errors, payments OK)
  → roll out to 10 % → 100 % of machines
  → any failure: ESP32 automatic rollback (dual OTA partitions)
```

- ESP32: secure boot + flash encryption, signed images, version reported in heartbeats.
- STM32: updated **by the ESP32** over UART (STM32 built-in bootloader).
- OTA only when the machine is idle: no open payment and `pending_outcomes = 0` (never during a payment or dispense).

---

## 10. Monitoring & alerting

| Signal | Alert when |
|---|---|
| API uptime | Down > 1 min |
| Payment success rate | < 95 % over 15 min |
| ABA errors / latency | Error spike or p95 > 5 s |
| Outbox lag | Oldest undispatched event > 30 s |
| Queue depth | Growing for > 5 min |
| Sweeps | A sweep has not completed for 3 × its interval |
| ABA check failures | > 5 % of checks failing over 10 min |
| Late payments | Any late payment detected (reconcile/callback) |
| Machines offline | Any machine offline > 3 min |
| Pending outcomes | A machine reports `pending_outcomes > 0` for > 1 h |
| Dispense unknown | Any payment in DISPENSE_UNKNOWN |
| Refund cases | Any case open > 24 h |
| Rejected / dropped outcomes | Any `transaction/ack rejected` or device `dropped_outcomes` increase |
| Host resources | CPU / memory / disk > 80 % |

Alerts → **Telegram group** (team) + Grafana / Sentry dashboards.

---

## 11. Monthly cost (starting point)

| Item | Approx. |
|---|---|
| Production VPS (4 GB) | $24 |
| Managed PostgreSQL (smallest) | $15 |
| Staging VPS (2 GB, includes its own Postgres) | $12 |
| EMQX Cloud Serverless | Free tier → small usage fees as machines grow |
| Cloudflare, Grafana Cloud, Sentry, GHCR | Free tiers |
| Domain | ~$1 |
| **Total** | **≈ $50 / month** |

---

## 12. Growth path

| Stage | Machines | Deployment |
|---|---|---|
| Start | 1–100 | 1 VPS + managed PostgreSQL (no pooler) |
| Growth | 100–1,000 | 2–3 VPS behind a load balancer, dedicated worker server, **PgBouncer / managed pooler**, DB read replica |
| Scale | 1,000+ | Managed Kubernetes; extract busy contexts into services |

The architecture (stateless API, outbox, shared subscriptions) supports each step without a rewrite.

---

## 13. Repository files

```text
infra/
├── docker-compose.yml          local dev: postgres, redis, mosquitto
├── docker-compose.prod.yml     api x2, worker, dashboard, redis, caddy, otel-agent
├── Caddyfile
└── scripts/
    ├── deploy.sh               pull images, migrate, rolling restart, health check, rollback
    ├── backup.sh
    └── restore-test.sh
.github/workflows/
├── ci.yml                      lint, typecheck, boundaries, tests, image scan
└── deploy.yml                  build → staging → approval → production
```

---

## 14. Go-live checklist

- [ ] Production VPS with static IP; firewall + SSH hardening done
- [ ] Managed PostgreSQL created; backups + PITR verified with a restore drill
- [ ] Domain + Cloudflare DNS + HTTPS working
- [ ] EMQX `wrm-prod` deployment; per-device credentials + ACL
- [ ] ABA PayWay **live** merchant account; production IP whitelisted; KHR/USD enabled
- [ ] Secrets in GitHub Environments / secret manager (none in Git)
- [ ] CI/CD green; staging deploy + manual production approval tested
- [ ] Monitoring dashboards + Telegram alerts tested
- [ ] Rollback tested (deploy a previous image)
- [ ] Refund flow tested end to end (claim → refund in ABA portal → mark refunded)
- [ ] Redis loss and callback loss tested in staging (sweeps and reconcile recover)
- [ ] Early pilot ran ≥ 8 weeks; pilot report reviewed (uptime ≥ 98 %, refund cases, unknown outcomes, accuracy)

---

## Related

- [Backend Architecture](../04-Cloud-and-Payment/backend-architecture.md)
- [Product Architecture & Roadmap](../01-Project-Overview/product-architecture-roadmap.md)
- [Operations & Troubleshooting](operations-and-troubleshooting.md)
