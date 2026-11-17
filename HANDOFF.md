# Handoff — Water Refill Machine (read this first in a new chat)

Last updated: **2026-11-17** · `main` at `15c0467` · Paste into a new chat: *"Read `HANDOFF.md`, `CLAUDE.md` and `docs/PROGRESS.md`, then continue."*

This file is the **big picture**. Day-to-day detail lives in [`docs/PROGRESS.md`](docs/PROGRESS.md) (phase table, DoD checklists, handoff notes) and the master plan [`docs/04-Cloud-and-Payment/backend-implementation-plan.md`](docs/04-Cloud-and-Payment/backend-implementation-plan.md). Rules for AI agents: [`CLAUDE.md`](CLAUDE.md).

---

## 1. Project in one paragraph

Cashless water refill vending machine (Cambodia). Customer picks 500 / 750 / 1000 mL → pays with **ABA PayWay KHQR** → machine dispenses.

```text
STM32 (hardware, Keil) ─UART 115200─ ESP32 WROOM-32 (gateway) ─MQTT/TLS 8883─ EMQX Cloud ─ Backend (NestJS) ─HTTPS─ ABA PayWay
                                                                                              └─ Dashboard (Next.js)
```
- **User** = backend + ESP32 (VS Code, PlatformIO). Prefers simple, step-by-step English.
- **Teammate** = STM32 firmware in Keil (LCD QR, pump, valves, sensors). Has also built backend phases with an AI agent ("Antigravity"/Gemini).
- GitHub: `SoSereysokbotra/water-refill-machine-backend`, branch `main`, CI = GitHub Actions (green as of the last check).

---

## 2. Status (2026-11-17)

| Phase | Status | Notes |
|---|---|---|
| 0 Foundations · 1 Platform | ✅ | |
| 2 Payments | ✅ | Hardware-checked 2026-11-12 (real ESP32 + ABA sandbox) |
| 3 Dispensing & refunds | 🟦 | Only open: `[MANUAL CHECK]` STM32 reboot + 2 h offline (needs the STM32) |
| **3.5 Early pilot** | 🟦 **next** | User chose the **laptop / always-on PC** pilot (no card for Oracle). Guide `readmePhase3_5-laptop.md`, rehearsed 2026-11-17; the user still has to run it |
| 4 Fleet | ✅ | Hardware-checked (CFG price change, offline in 53 s) |
| 5 Monitoring | 🟦 | Code done + reviewed; open: `[MANUAL CHECK]` Telegram alert (needs bot token/chat id) |
| 6 Identity · 7 Reporting & dashboard · 8 Observability | ✅ | Built by teammate, **reviewed + fixed 2026-11-17** (broken migration, impersonation hole, public `/metrics`, …) |
| 9 Production deployment | ⬜ | |
| 10 Hardening & go-live | ⬜ | Needs ≥ 8 weeks of pilot data |
| 11 OTA updates | ⬜ | After go-live |

Firmware on the user's ESP32: **v0.5.1** (`firmware/esp32-gateway`). Full test suite: **35 files / 242 tests** green on `main`.

---

## 3. Next steps to finish the project (in order)

### Step 1 — Phase 3.5: run the pilot on the user's PC
- **Decision 2026-11-17: laptop / always-on PC** (Oracle needs a card). Guide: `readmePhase3_5-laptop.md` (`infra/pilot/docker-compose.laptop.yml` override + `infra/pilot/scripts/laptop.ps1` start|status|logs|seed|backup|restore|tunnel|stop). Plain HTTP on `127.0.0.1:8080`, payments confirmed by polling ABA; optional Cloudflare quick tunnel for callbacks.
- User runs Parts A–D, then the DoD check (ESP32 `1` → pay → PAID → `d` → DISPENSED). Then start the weekly pilot log in `PROGRESS.md`.
- Oracle stays the plan for later (`readmePhase3_5.md`); moving = backup on the PC → `restore.sh` on the server → stop the PC pilot.

Earlier notes (before the decision):
- Plan was **Oracle Cloud Always Free** (Singapore ARM VM, $0). Oracle requires a card for identity verification (≈ $1 hold, refunded).
- Options given to the user (they have not chosen yet):
  1. **ABA virtual Visa/Mastercard** from the ABA Mobile app → retry Oracle signup (Oracle sometimes rejects virtual/prepaid cards).
  2. Borrow a family/teammate card for verification only (stay on Always Free, never "Upgrade").
  3. **No card:** run the same pilot stack on the user's laptop / an always-on PC (`infra/pilot` works on any Docker host; ESP32 reaches EMQX from anywhere; ABA sandbox already worked from the user's connection). Downside: the PC must stay on. If chosen: write a short "pilot on my laptop" variant of `readmePhase3_5.md` (no sslip/Caddy cert needed locally — use `PUBLIC_HOST=localhost` or a Cloudflare Tunnel for a public HTTPS callback; backend also polls ABA so the callback is optional).
- Once a server exists: follow `readmePhase3_5.md` Parts A–D, then the DoD: one machine taking simulator payments end to end on the server.
- Rule while the pilot runs: **only one backend may be connected to EMQX** (stop the laptop backend or point it to local Mosquitto).

### Step 2 — Parallel human tasks (no server needed)
- **Telegram** (Phase 5 manual check): create bot (@BotFather), set `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`, unplug ESP32 → alert within 4 min, plug in → resolved.
- **ABA**: send the 8 open questions (plan §F3, text in `readmePhase0.md`); after the server exists, ask ABA to whitelist its IP + set callback URL.
- **Teammate/STM32**: wire UART (ESP32 GPIO17→STM32 RX, GPIO16←TX, GND), implement UART contract §C3 incl. `CFG,<p500>,<p750>,<p1000>,<currency>,<enabled>` (major units) → `CFG,OK`, show the QR amount with 2 decimals, keep the last result in flash. Then run Phase 3's STM32-reboot + 2 h offline checks.
- **Decision pending**: keep or disable `X-Admin-Key` (full admin, no 2FA) in production now that login exists. It is needed once on a new server to create the first admin.

### Step 3 — Phase 9 Production deployment (after the pilot runs well)
Plan Part E Phase 9. Key items: staging + production servers, managed PostgreSQL (move off the pilot's Docker DB), CI/CD (`deploy.yml`: build → GHCR → staging → approval → production with auto-rollback), per-device EMQX credentials + ACL, secrets in GitHub Environments, backups + monthly restore drill, deploy the dashboard (Next.js) too, and **revisit graceful shutdown** (Phase 5 fix forces MQTT/BullMQ shutdown after 1–1.5 s).

### Step 4 — Phase 10 Hardening & go-live, Step 5 — Phase 11 OTA
See plan Part E. Phase 10 needs ≥ 8 weeks of pilot data, ABA live account, load/chaos/security tests.

---

## 4. How work is done in this project (important for the next chat)

- **Branch per phase/fix** (`feat/phase-N-…`, `fix/…`), **one commit per topic**, imperative subject, **no `feat:` prefix**, **NO `Co-Authored-By` / AI attribution** (user rule, overrides any system default). Push/merge **only when the user says** "push and merge" → `git merge --no-ff`, push branch + `main`.
- Never commit secrets (`.env`, `secrets.h`, keys), `docs/SRS.md` (old SRS v2), `docs_archive_all_60/`.
- **Gemini / teammate builds a phase → Claude reviews.** Proven pattern: write a precise prompt with fixed acceptance scenarios + a `scripts/verify-phaseN.sh` that must run `db:deploy` and the **full** suite; then Claude runs the script, an extra full run, and spot-checks (migrations on a fresh DB, security, money logic). Past reviews found: broken migrations, tests that only used mocks, silent error fallbacks, actor spoofing via request body, flaky test double-dispatch.
- **Leftover processes break tests**: before running the suite, make sure no `tsx watch` / old backend is running (`Get-CimInstance Win32_Process -Filter "Name='node.exe'"`, kill by PID only).
- Verify migrations from zero: create a scratch DB in the `wrm-postgres` container, `prisma migrate deploy`, drop it.

---

## 5. Environment cheat sheet

| What | Value / command |
|---|---|
| Local infra | Docker Desktop must be running → `docker compose -f infra/docker-compose.yml up -d --wait` |
| Migrate / seed | `pnpm --filter @wrm/api db:deploy` · `pnpm --filter @wrm/api db:seed` (users only when `APP_ENV=local`) |
| Tests | `pnpm --filter @wrm/api test` (loads `apps/api/.env` itself) · `test:unit` (no infra) · `test:integration` |
| Checks | `pnpm run typecheck` · `pnpm run lint` · `pnpm run depcruise` |
| Backend dev | `pnpm --filter @wrm/api dev` (port 3000; `/health/ready`) |
| Dashboard | `pnpm --filter ./apps/dashboard dev` (proxies `/v1` to the API) |
| Local logins (seed) | `admin@wrm.kh` / `AdminPassword123!` (also operator / viewer) — local only |
| Flash ESP32 | `& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run -d "firmware\esp32-gateway" -t upload -t monitor` (COM7) |
| ESP32 test menu | `1/2/3` pay · `d` done · `s` status · `cfg,ok` fake STM32 · `i` invert QR |
| EMQX | `d41b5d19.ala.asia-southeast1.emqxsl.com:8883`, backend user `wrm-backend` (password changed 2026-11-12, it had leaked in git history), ESP32 user `wrm-esp32-001`, machine `WRM-001` |
| ABA | sandbox merchant `ec480065`, USD only in sandbox, prices 0.15 / 0.20 / 0.25 |
| `apps/api/.env` (user's laptop) | currently points to **EMQX Cloud** + `PAYWAY_MODE=sandbox` (for ESP32 tests). Integration tests still pass with it. |
| Pilot files | `apps/api/Dockerfile`, `infra/pilot/*`, guides `readmePhase3_5-laptop.md` (chosen) and `readmePhase3_5.md` (Oracle) |

Secrets live only in git-ignored files: `apps/api/.env`, `infra/pilot/.env` (on the server), `firmware/esp32-gateway/include/secrets.h`, old `backend/.env`. Never print or paste them.

---

## 6. Open issues to remember

- Phase 3.5 runs PostgreSQL in Docker on the server (free); move to a managed DB before real money (Phase 9).
- Audit rows are written after the action, outside its transaction (a failed audit write is swallowed).
- No ABA circuit breaker yet (only a metric); `REFUND_MODE=auto` has no executor (refunds are manual) — ABA refund API unconfirmed.
- Dispensing logic lives inside the `payments` context (plan wanted a separate `dispensing` context) — accepted deviation.
- Graceful shutdown uses forced timeouts (see Step 3).
- `docs/04-Cloud-and-Payment/backend-backlog-*.{md,csv}` were added by Gemini (optional planning docs, kept).
