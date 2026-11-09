# Handoff — Water Refill Machine (read this first in a new chat)

Last updated: 2026-11-06. Paste into a new chat: *"Read `HANDOFF.md` and continue."*

## 1. Project in one paragraph

IoT cashless water refill vending machine (Cambodia). Customer picks 500 / 750 / 1000 mL → pays with **ABA PayWay KHQR** → machine dispenses. Two-chip design:

```text
STM32 (hardware control, Keil)  <--UART 115200 8N1-->  ESP32 WROOM-32 (gateway)  <--MQTT/TLS 8883-->  EMQX Cloud  <-->  Backend (Node)  <-->  ABA PayWay
```

- **The user** owns: backend + ESP32 gateway (VS Code + PlatformIO).
- **Teammate** owns: STM32 firmware in Keil (pump, valves, sensors, LCD QR display).
- GitHub: `SoSereysokbotra/water-refill-machine-backend` (branch `main`).

## 2. Current status (what works today)

| Area | Status |
|---|---|
| ABA PayWay sandbox (KHQR) | ✅ Real sandbox payment tested end to end (paid via ABA simulator app) |
| Backend prototype (Express) | ✅ `backend-prototype/` — REST + MQTT bridge, in-memory payments, `/dev` page |
| EMQX Cloud broker | ✅ `d41b5d19.ala.asia-southeast1.emqxsl.com:8883` (Serverless, spend limit $0) |
| ESP32 firmware v0.2.0 | ✅ Flashed, MQTT works end to end, test menu + compact terminal QR |
| STM32 ↔ ESP32 UART wiring | ⏳ Not done yet (teammate side) |
| Production backend (NestJS) | ⏳ In progress — Phase 0 started |
| Docs (architecture, deployment, implementation plan v3) | ✅ Committed and pushed |

Teammate has been told the ESP32 + MQTT test works.

## 3. Repo map

```text
backend-prototype/       Prototype backend (ESM, Express 5, mqtt 5, qrcode). Tests: node --test (3 pass)
  src/payway.js          ABA client: generateQr / checkTransaction, HMAC-SHA512 Base64 signing
  src/server.js          REST API, /dev page (latest payment only, create buttons), callback
  src/mqtt.js            MQTT bridge: pay/request → pay/qr, pushes pay/status every 2.5 s
  .env                   (git-ignored) sandbox merchant, USD prices, MQTT creds
certs/emqxsl-ca.crt      DigiCert Global Root G2 (public)
firmware/esp32-gateway/  PlatformIO project (env esp32dev)
  src/main.cpp           Wi-Fi, NTP, MQTT (persistent session, LWT), UART2 GPIO16/17, test menu, QR print
  include/secrets.h      (git-ignored) Wi-Fi + MQTT creds, MACHINE_ID=WRM-001
  lib/qrcodegen/         nayuki v1.8.0 (vendored)
docs/                    See docs/README.md index
docs_archive_all_60/     Old docs — git-ignored, NEVER commit
docs/SRS.md              Untracked duplicate of docs/01-Project-Overview/srs.md — leave uncommitted
```

Key docs:
- `docs/04-Cloud-and-Payment/backend-implementation-plan.md` (v3) — **the master plan**: invariants, error catalog, state machine (C1), MQTT contract (C2), UART contract (C3), Prisma schema (C6), REST (C7), fault codes (C8), code patterns (D1–D7), Phases 0–11 (Part E), open questions (F3).
- `docs/04-Cloud-and-Payment/backend-architecture.md`, `docs/06-Testing-and-Operations/deployment.md` — synced to v3.
- `docs/01-Project-Overview/product-architecture-roadmap.md` — product roadmap.
- `docs/04-Cloud-and-Payment/stm32-qr-payment-integration.md` — older HTTP-based STM32 guide.
- `firmware/esp32-gateway/README.md`, `backend-prototype/README.md` — setup + run instructions.

## 4. How to run

Backend prototype:
```powershell
cd backend-prototype; npm run dev     # http://localhost:3000/dev
npm test
```
ESP32 flash + monitor (board on COM7):
```powershell
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run -d "firmware\esp32-gateway" -t upload -t monitor
```
Menu: `1/2/3` pay 500/750/1000, `q` reshow QR, `d` dispense done, `i` invert QR, `s` status, `h` help.

If port 3000 is stuck: find PID with `netstat -ano | findstr :3000` and kill that PID only (killing all node.exe is blocked).

## 5. Decisions already made (don't re-litigate)

- **ABA:** sandbox `https://checkout-sandbox.payway.com.kh`; currency **USD** (sandbox rejects KHR, code 12); prices 0.15/0.20/0.25; `lifetime` minutes ≥ 3; check hash = `req_time + merchant_id + tran_id`; empty optional fields omitted from body but hashed as `""`. Codes: check `6` = not paid yet, generate `403` = duplicate tran_id. `payment_status_code` 0 approved, 2 pending, 3 declined, 4 refunded, 7 cancelled. Production needs IP whitelisting (static IP).
- **MQTT:** EMQX Cloud, TLS 8883, QoS 1, persistent sessions, Last Will on `wrm/<id>/online`. ESP32 uses PubSubClient (MQTT 3.1.1 → no v5 expiry; ESP32 discards stale QRs itself). Backend user `wrm-backend`, ESP32 user `wrm-esp32-001`.
- **Production stack:** TypeScript, NestJS (Fastify), PostgreSQL + Prisma, Redis + BullMQ, Next.js dashboard. Modular monolith; DDD + Hexagonal for core (Payments, Dispensing), 2-layer for supporting (Fleet, Monitoring, Identity, Reporting); CQRS-light; transactional outbox (250 ms relay, batch 20, `FOR UPDATE SKIP LOCKED`); DB-driven sweeps; idempotency `(machine_id, request_id)`; one open payment per machine; `REFUND_MODE` manual|auto; `RUN_MODE` all|api|worker.
- **Deployment:** Docker Compose on Singapore VPS (static IP) + Caddy + managed Postgres, no PgBouncer at start; GitHub Actions + GHCR; local/staging/production; Phase 3.5 early pilot with 1 machine.
- Volume tiers fixed at 500/750/1000 mL. One admin with ABA portal access handles refunds.

## 6. User rules (must follow)

- **Git commits:** separate commit per topic (never one commit for everything). **Do NOT add any `Co-Authored-By: Claude ...` line** to commit messages. Short imperative subject, e.g. `Add backend implementation plan (v3)`.
- Never commit secrets: `backend-prototype/.env`, `firmware/esp32-gateway/include/secrets.h`. Never commit `docs_archive_all_60/` or `docs/SRS.md`.
- Don't ask the user to paste passwords in chat. Sandbox ABA credentials were exposed earlier → rotate before production.
- The user prefers simple, step-by-step explanations (English is not their first language).
- Commit/push only when the user asks.

## 7. Next steps (pick up here)

1. **Send ABA the 8 open questions** in plan §F3 (and teammate questions 9–10 there).
2. **Teammate:** read plan §C3 (UART contract v1) and §C8 (fault codes) on GitHub; implement UART on STM32, wire GPIO17→RX, GPIO16←TX, common GND.
3. **Update ESP32 firmware to UART contract v1** when STM32 side is ready (`PAID,ACK`/`PAID,REJECT`, `ACK,<tran_id>`, `CFG`, `PONG,<state>,<tran_id>,<tank>,<fault>`, `transaction/ack`, `config/ack`). Current firmware uses the simpler v0 protocol in `firmware/esp32-gateway/README.md` §4.
4. **Start Phase 0 — Foundations** of the implementation plan (new NestJS repo layout per §B1 "Target repository layout") when the user says go. Then Phase 1 Platform → Phase 2 Payments (cut-over from prototype) → Phase 3 → Phase 3.5 pilot. Go-live ≈ week 20.
5. Optional/abandoned: Notion workspace ("Water Refill Machine — Project Workspace", page id `40c58ff48cda8187bd0eee17adcc341a`) has Phases, Milestones, Sprint Tasks, BOM, Test Cases, Meetings, and 30/60 Documentation pages. Not continued.
