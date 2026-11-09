# ESP32 Gateway (WROOM-32)

Connects the machine to the cloud. The ESP32 talks **MQTT (TLS)** to the EMQX Cloud broker and **UART** to the STM32. It never drives the pump or sensors — that is the STM32's job.

```text
STM32 (control)  <--UART2 (GPIO16/17)-->  ESP32 (this)  <--MQTT/TLS 8883-->  EMQX Cloud  <-->  Backend
```

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

| Message | Direction | Meaning |
|---|---|---|
| `REQ_PAY,<volume_ml>` | STM32 → ESP32 | Customer chose 500 / 750 / 1000 mL |
| `QR,<tran_id>,<amount>,<currency>,<expires_s>,<qr_string>` | ESP32 → STM32 | Draw this QR (qr_string ≈ 240 chars, always last) |
| `PAID,<tran_id>` | ESP32 → STM32 | Paid — dispense **only if tran_id matches** the QR shown |
| `EXPIRED,<tran_id>` / `FAILED,<tran_id>` | ESP32 → STM32 | Back to welcome screen (`FAILED,0` = request rejected) |
| `DONE,<tran_id>,<flow_ml>,<weight_g>` | STM32 → ESP32 | Dispense finished |
| `ERR,<code>` | STM32 → ESP32 | Fault (e.g. `TANK_EMPTY`, `NO_FLOW`) |
| `NET,OK` / `NET,DOWN` | ESP32 → STM32 | Network status (show "Offline" when down) |
| `PING` / `PONG` | both | Link check — ESP32 sends `PING` every 5 s; STM32 must answer `PONG` |

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
