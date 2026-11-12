# ESP32 Gateway (WROOM-32) — Firmware v0.5.0

Connects the machine to the cloud. The ESP32 talks **MQTT (TLS)** to the EMQX Cloud broker and **UART** to the STM32. It never drives the pump or sensors — that is the STM32's job.

```text
STM32 (control)  <--UART2 (GPIO16/17)-->  ESP32 (this)  <--MQTT/TLS 8883-->  EMQX Cloud  <-->  Backend
```

### v0.5.0 (Phase 4: machine config)
- Subscribes to the **retained** `wrm/<id>/config` (prices, currency, enabled) and sends it to the STM32 as `CFG,<price_500>,<price_750>,<price_1000>,<currency>,<enabled 0|1>`. Prices are **major units** (`0.15`, `500`), like the QR amount.
- Retries the `CFG` line every 5 s until the STM32 answers `CFG,OK` → `config/ack ok`, or `CFG,ERR,<fault>` → `config/ack error <fault>`. After 12 tries without an answer → `config/ack error UNKNOWN` (the backend raises `fleet.ConfigRejected`).
- Re-sends the last config when the UART link comes back after being lost (≥ 15 s without `PONG`). A shorter STM32 restart is not detected — the STM32 should keep its last prices in flash.
- Test without the STM32: after `CONFIG` appears in the monitor, type `cfg,ok` (or `cfg,err,CFG_INVALID`).

### v0.4.1 Fixes (Phase 3 review)
- **STM32 lines keep their case.** v0.4.0 and earlier upper-cased every UART line, so a real `DONE,<tran_id>` (lowercase id) was rejected by the backend. Only the USB test-menu shortcuts are case-insensitive now.
- **v0.4.0 did not compile** (`min()` type mismatch in the retry backoff) — fixed.
- **QR countdown** = `expires_at − now` (NTP), so a re-sent QR shows the real time left. Expired QRs, QRs for another request, and QRs that arrive after a local Cancel are not shown (a late one is cancelled with `pay/cancel`).
- **`pay/status` only for the current payment.** `CANCELLED` for a superseded QR no longer resets the screen. `PAID` is always forwarded; the STM32 accepts it only for the QR it shows.
- **`PONG,<state>,<tran_id|0>,<tank>,<fault>`** is parsed; the heartbeat uses the C2 format (`v`, `stm32: {link, state, tank, fault}`, `ts`).
- **`ERR,<fault>` without a `tran_id`** is only a fault report (`error` topic) — it no longer turns the current payment into a failed dispense.
- **Contract lines:** `FAILED,0` replaces `FAILED,TIMEOUT`; the non-contract `CANCELLED,OK` reply was removed.
- **`pay/request` retry** per Plan B4.7: wait 8 s, resend after 2 s, 5 s, 10 s, then `FAILED,0`.

### v0.4.0 Highlights (Phase 3: Dispensing & Outcome Queue)
- **Non-Volatile Storage (NVS) Outcome Queue**: Outcomes (`DONE`, `PARTIAL`, `ERR` with `tran_id`) are persisted to ESP32 Flash memory before sending `ACK,<tran_id>` to the STM32. Outcomes survive ESP32 reboots and power losses.
- **Application Retry with Backoff**: Outcomes in the NVS queue are retried with exponential backoff (5s to 5min + jitter) until confirmed with `transaction/ack ok` or `rejected`.
- **Periodic `PAID` Repeating**: `PAID,<tran_id>` is repeated every 2s until acknowledged by the STM32 via `PAID,ACK,<tran_id>` or `PAID,REJECT,<tran_id>,<fault>`.
- **Heartbeat Telemetry Counters**: Broadcasts `pending_outcomes`, `rejected_outcomes`, and `dropped_outcomes` every 60s.

## 1. Setup

1. Install **VS Code** + the **PlatformIO IDE** extension.
2. Copy `include/secrets.example.h` to `include/secrets.h` (already done locally) and fill in:
   - `WIFI_SSID`, `WIFI_PASSWORD` — **2.4 GHz** Wi-Fi only
   - `MQTT_USERNAME`, `MQTT_PASSWORD` — the ESP32 user created in EMQX (**Access Control → Authentication**)
   - `MACHINE_ID` — e.g. `WRM-001`

   `secrets.h` is git-ignored. Never commit it.
3. Plug in the ESP32 (USB). If no COM port appears, install the **CP210x** or **CH340** USB driver.
4. Build, upload and open the monitor:
   ```bash
   pio run -t upload
   pio device monitor
   ```
   Or use the PlatformIO toolbar: ✓ Build → → Upload → 🔌 Serial Monitor.

Expected boot log:
```text
=== Water Refill ESP32 gateway v0.1.0 | machine WRM-001 ===
[wifi] connected, IP 192.168.1.x
[time] syncing.. ok
[mqtt] connecting to d41b5d19.ala.asia-southeast1.emqxsl.com:8883 ...
[mqtt] connected
>> STM32: NET,OK
```

## 2. Test without the STM32 (serial monitor = fake STM32)

Flash and open the monitor in one command (PowerShell):
```powershell
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run -d "firmware\esp32-gateway" -t upload -t monitor
```

After `[mqtt] connected` a menu appears. Type a key and press **Enter**:

```text
+--------------- TEST MENU ---------------+
|  1  Pay for 500 mL                      |
|  2  Pay for 750 mL                      |
|  3  Pay for 1000 mL                     |
|  q  Show the last QR again              |
|  d  Report dispense done (after PAID)   |
|  i  Invert QR colours (light/dark theme)|
|  s  Status                              |
|  h  Show this menu                      |
+-----------------------------------------+
```

1. Start the backend first (`npm run dev` in `backend-prototype/`, log must show `[mqtt] connected`).
2. Type **`1`** → a compact QR (~61 × 31 characters) and a **SCAN TO PAY** banner appear.
3. Scan it with the ABA app / simulator.
   - Not scanning? Type **`i`** to invert colours (for light terminal themes), make the terminal font larger, or open `http://localhost:3000/dev`.
   - **mock mode:** open `/dev` and click **Simulate payment** instead.
4. A **PAID** banner appears (`>> STM32: PAID,<tran_id>`).
5. Type **`d`** → sends `DONE,<tran_id>,<flow>,<weight>` to the backend, as the STM32 will.

Typing is sent only when you press Enter. Backspace works; arrow keys are ignored. Full STM32 commands also work: `REQ_PAY,500`, `DONE,<tran_id>,498,501`, `ERR,TANK_EMPTY`, `PING`.

## 3. Wiring to the STM32 (later)

| ESP32 (WROOM-32) | STM32 | Note |
|---|---|---|
| GPIO17 (TX2) | USART RX | ESP32 → STM32 |
| GPIO16 (RX2) | USART TX | STM32 → ESP32 |
| GND | GND | **Common ground required** |

Both are 3.3 V logic — no level shifter. UART: **115200 baud, 8N1**.

## 4. UART protocol

One text line per message, ending with `\n`.

Full contract: [Implementation Plan §C3](../../docs/04-Cloud-and-Payment/backend-implementation-plan.md). Summary of what v0.4.1 implements:

| Message | Direction | Meaning |
|---|---|---|
| `REQ_PAY,<volume_ml>` | STM32 → ESP32 | Customer chose 500 / 750 / 1000 mL |
| `CANCEL` / `CANCEL,<tran_id>` | STM32 → ESP32 | Customer pressed Cancel (no reply line; the STM32 is already idle) |
| `QR,<tran_id>,<amount>,<currency>,<remaining_s>,<qr_string>` | ESP32 → STM32 | Draw this QR (qr_string ≈ 240 chars, always last; may contain commas) |
| `PAID,<tran_id>` | ESP32 → STM32 | Paid — repeated every 2 s until answered. Dispense **only if tran_id matches** the QR shown |
| `PAID,ACK,<tran_id>` / `PAID,REJECT,<tran_id>,<fault>` | STM32 → ESP32 | Payment accepted / refused (refused = outcome `error`) |
| `EXPIRED,<tran_id>` / `FAILED,<tran_id>` / `CANCELLED,<tran_id>` | ESP32 → STM32 | Back to welcome screen — only for the current QR; check the tran_id |
| `FAILED,0` | ESP32 → STM32 | Request failed after retries ("Service unavailable") |
| `DONE,<tran_id>,<flow_ml>,<weight_g>` | STM32 → ESP32 | Dispense finished |
| `PARTIAL,<tran_id>,<flow_ml>,<weight_g>,<fault>` | STM32 → ESP32 | Stopped early |
| `ERR,<fault>[,<tran_id>]` | STM32 → ESP32 | Fault. With `tran_id` = dispense outcome `error`; without = fault report only |
| `ACK,<tran_id>` | ESP32 → STM32 | Outcome saved in NVS — the STM32 may forget it |
| `CFG,<price_500>,<price_750>,<price_1000>,<currency>,<enabled 0\|1>` | ESP32 → STM32 | Prices (major units) and enabled flag; repeated every 5 s until answered |
| `CFG,OK` / `CFG,ERR,<fault>` | STM32 → ESP32 | Config applied / rejected |
| `NET,OK` / `NET,DOWN` | ESP32 → STM32 | Network status (show "Offline" when down) |
| `PING` → `PONG,<state>,<tran_id\|0>,<tank>,<fault>` | both | Link check every 5 s (plain `PONG` also accepted) |

`tran_id`s are lowercase — never change their case on either side.

## 5. MQTT topics used

| Topic | Direction |
|---|---|
| `wrm/<MACHINE_ID>/pay/request` | ESP32 → backend |
| `wrm/<MACHINE_ID>/pay/qr` | backend → ESP32 |
| `wrm/<MACHINE_ID>/pay/status` | backend → ESP32 |
| `wrm/<MACHINE_ID>/transaction` | ESP32 → backend |
| `wrm/<MACHINE_ID>/error` | ESP32 → backend |
| `wrm/<MACHINE_ID>/heartbeat` | ESP32 → backend (every 60 s) |
| `wrm/<MACHINE_ID>/online` | `1` on connect, `0` via Last Will (retained) |

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| Wi-Fi never connects | Use a 2.4 GHz network; check SSID/password |
| `[mqtt] failed, state=-2` | TLS/network problem: check `MQTT_HOST`, port 8883, and that `[time] syncing ... ok` |
| `[mqtt] failed, state=4` or `5` | Wrong MQTT username/password, or user not created in EMQX |
| `REQ_PAY` → `NET,DOWN` | MQTT not connected yet |
| QR arrives but never `PAID` | Backend not running / not connected to MQTT, or payment not completed |

## Notes / limits (prototype)

- PubSubClient publishes at QoS 0; subscriptions are QoS 1 with a persistent session, so `PAID` sent while the ESP32 is briefly offline is delivered on reconnect.
- QR drawing in the monitor assumes a **dark** terminal theme. Set `PRINT_QR_TO_USB 0` in `src/main.cpp` to turn it off.
- Libraries: PubSubClient, ArduinoJson, and [nayuki QR-Code-generator](https://github.com/nayuki/QR-Code-generator) (MIT, vendored in `lib/qrcodegen/`).
