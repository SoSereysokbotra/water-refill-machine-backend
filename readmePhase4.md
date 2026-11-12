# Phase 4: Fleet — Implementation & Verification Guide

Phase 4 lets an operator **provision and manage machines remotely** and lets the backend **know which machines are online**. Prices and the enabled flag reach the STM32 through a retained MQTT `config` message and the UART `CFG` line.

---

## 1. What was built

### 1.1 Machine API (`apps/api/src/contexts/fleet/`)
All routes need `X-Admin-Key` outside `APP_ENV=local` (until Phase 6 login). REST prices are **minor units** (USD cents, KHR riel).

| Route | What it does |
|---|---|
| `POST /v1/machines` | Provision: `{ id: "WRM-001", name, location?, currency, prices: {"500","750","1000"} }`. All three prices are required. Returns the machine + **MQTT username and a one-time password** (shown once, never stored) + the manual EMQX steps |
| `GET /v1/machines`, `GET /v1/machines/:id` | Machines with online, last seen, firmware, STM32 state, pending outcomes, prices |
| `PATCH /v1/machines/:id` | `name`, `location`, `enabled` |
| `PUT /v1/machines/:id/prices` | `{ currency, prices }`: new payments use them; open payments keep their price |
| `POST /v1/machines/:id/rotate-credentials` | New one-time MQTT password (manual EMQX step) |
| `POST /v1/machines/:id/decommission` | Retire: disabled for good (`decommissioned_at`); cannot be re-enabled |

Errors: `FLEET_MACHINE_EXISTS` (409), `FLEET_MACHINE_DECOMMISSIONED` (409), `PAY_MACHINE_NOT_FOUND` (404), `VALIDATION_FAILED` (400, e.g. a missing price tier).

### 1.2 Config to the machine
- Every change that affects the machine (provision, prices, enabled, decommission) writes `fleet.MachineConfigChanged` to the outbox.
- The handler publishes the **retained** `wrm/<id>/config` (QoS 1):
  ```json
  { "v": 1, "prices": { "500": "0.15", "750": "0.20", "1000": "0.25" }, "currency": "USD", "enabled": true }
  ```
  Prices are **major units** (same as the QR amount). The message is built from the database at publish time, so the newest config always wins.
- `config/ack` from the machine: `ok` → logged; `error` → `fleet.ConfigRejected` (alert in Phase 5).

### 1.3 Online / offline
- `heartbeat` and `online=1` → `last_seen_at`, `online = true`; on the offline → online edge: `fleet.MachineCameOnline`.
- `online=0` (Last Will) or **`sweep.fleet-offline`** (every 30 s, silent for `MACHINE_OFFLINE_AFTER_SECONDS` = 180 s) → `online = false` + `fleet.MachineWentOffline`.
- Unknown machines are never auto-registered (warning in the log).
- Heartbeat rows are deleted after 30 days by `maintenance.retention` (already built in Phase 1).

### 1.4 Payments use the Fleet public port
Payments prices a new payment through `FLEET_MACHINE_PRICING` (`fleet/application/public/machine-pricing.port.ts`) instead of reading Fleet's tables. A disabled or decommissioned machine → `PAY_MACHINE_DISABLED`.

### 1.5 ESP32 firmware v0.5.0
- Subscribes to the retained `config` and sends `CFG,<p500>,<p750>,<p1000>,<currency>,<enabled 0|1>` to the STM32.
- Repeats it every 5 s until `CFG,OK` / `CFG,ERR,<fault>` → `config/ack`; after 12 tries → `config/ack error UNKNOWN`.
- Re-sends the last config when the UART link comes back after ≥ 15 s without `PONG`.

### 1.6 EMQX credentials: manual step
The backend generates the username (`wrm-001` for `WRM-001`) and password but **does not call EMQX** (the Serverless management API could not be confirmed). The operator adds or changes the user in the EMQX console. The code can get an EMQX API adapter later.

---

## 2. Automated verification

```bash
docker compose -f infra/docker-compose.yml up -d
pnpm --filter @wrm/api db:deploy
pnpm --filter @wrm/api db:seed
pnpm --filter @wrm/api test          # 26 files, 126 tests
pnpm run typecheck && pnpm run lint && pnpm run depcruise
cd firmware/esp32-gateway && pio run # builds v0.5.0
```

New tests: `test/fleet.integration.spec.ts` (provision, duplicate / bad id / missing tier, retained config payload, price change used by the next payment, disable, rotate, decommission, offline sweep, Last Will, config/ack) and `test/machine-config.spec.ts`.

---

## 3. Manual verification (real ESP32)

### 3.1 Provision a machine (local)
```bash
curl -X POST http://localhost:3000/v1/machines -H "Content-Type: application/json" \
  -d '{"id":"WRM-002","name":"Bench 2","currency":"USD","prices":{"500":15,"750":20,"1000":25}}'
```
On a server add `-H "X-Admin-Key: <ADMIN_API_KEY>"`. Copy `credentials.password` now: it is not shown again.

1. EMQX console → Access Control → Authentication → add user `wrm-002` with that password.
2. `firmware/esp32-gateway/include/secrets.h`: `MACHINE_ID "WRM-002"`, `MQTT_USERNAME "wrm-002"`, `MQTT_PASSWORD "<password>"`.
3. Flash: `pio run -d firmware/esp32-gateway -t upload -t monitor`.
4. Expected: `[mqtt] connected`, then a `CONFIG` banner with `CFG,0.15,0.20,0.25,USD,1`. `GET /v1/machines/WRM-002` shows `online: true`.

### 3.2 Price change confirmed by `CFG,OK` *(DoD manual check)*
```bash
curl -X PUT http://localhost:3000/v1/machines/WRM-002/prices -H "Content-Type: application/json" \
  -d '{"currency":"USD","prices":{"500":20,"750":25,"1000":30}}'
```
1. The monitor shows `CONFIG` → `>> STM32: CFG,0.20,0.25,0.30,USD,1`, repeated every 5 s.
2. Without an STM32 type `cfg,ok` → backend log: `Machine WRM-002 applied its config (CFG,OK)`.
3. Type `1` → the new QR amount is `0.20`.

### 3.3 Offline within 3 minutes *(DoD manual check)*
1. Unplug the ESP32 power.
2. Within ~3.5 min (180 s + 30 s sweep) `GET /v1/machines/WRM-002` shows `online: false`; the backend log shows `Machines went offline: WRM-002`.
3. Plug it back in → `online: true` after the first heartbeat (≤ 60 s).

### 3.4 Disable / decommission
- `PATCH {"enabled": false}` → monitor `CFG,...,0`; pressing `1` gives `FAILED` (`PAY_MACHINE_DISABLED`).
- `POST /v1/machines/WRM-002/decommission` → cannot be enabled again; delete the EMQX user as the response says.

---

## 4. Definition of Done

| Item | Status |
|---|---|
| New machine provisioned via API and online without manual DB edits (EMQX step documented) | ✅ Automated tests; EMQX user is a documented manual step |
| `[MANUAL CHECK]` Offline within 3 min of power loss; price change confirmed by `CFG,OK` | ⬜ Needs the real ESP32 (sections 3.2, 3.3) |
| `PROGRESS.md` handoff note | ✅ |

**Not done in Phase 4 (by decision):** automatic EMQX user creation/rotation (manual step), "credential rotation → old password rejected" test (needs the EMQX API), metrics for unknown-machine heartbeats (Phase 8), audit log for price changes (Phase 6).
