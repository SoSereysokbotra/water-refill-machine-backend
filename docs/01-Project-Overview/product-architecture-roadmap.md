# Product Architecture & Roadmap

> How the IoT Water Refill Machine moves from a desk prototype to a real product: the target architecture, technology stack, product features, and phased roadmap.

| | |
|---|---|
| **Status** | Prototype — payment flow (ABA PayWay sandbox) working end to end |
| **Audience** | Project team, supervisors, partners |
| **Last updated** | 2026-11-05 |

---

## 1. Product goals

A product is not just "it works on the desk". It must be:

| Goal | Meaning |
|---|---|
| **Reliable** | Runs 24/7 unattended, recovers from network and power problems by itself |
| **Secure** | Handles real money; firmware, keys and payments cannot be tampered with |
| **Safe** | Never dispenses unpaid water, never spills, safe drinking water and electrical safety |
| **Maintainable** | Problems are visible remotely; firmware and prices can be updated without a site visit |
| **Repeatable** | New machines can be built and set up quickly from a standard design |

---

## 2. System architecture

```text
┌─────────────────────────── MACHINE (each unit) ───────────────────────────┐
│  STM32 (control, safety)  ◀─UART─▶  ESP32 (gateway)  ◀─▶ 4G module + Wi-Fi  │
│  LCD · sensors · pump · valves · UV lamp · TDS sensor · door switch        │
└──────────────────────────────────────────┬────────────────────────────────┘
                                            │ MQTT over TLS (per-device credentials)
┌───────────────────────────────── CLOUD ───▼────────────────────────────────┐
│  Managed MQTT broker ──▶ Backend API (payments, machines, sales, OTA)       │
│                          ├─ PostgreSQL (data)   ├─ Redis (jobs, cache)      │
│                          ├─ ABA PayWay (KHQR)   ├─ Telegram alerts          │
│                          └─ Admin dashboard (web) + OTA firmware storage    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Two-chip design

| Chip | Role | Responsibilities | Never does |
|---|---|---|---|
| **STM32** | Machine controller | LCD + touch, QR drawing, sensors, pump, valves, dispensing state machine, safety stops | Connect to the internet |
| **ESP32** | Network gateway | Wi-Fi / 4G, MQTT, talking to the backend, relaying messages to/from the STM32, OTA | Drive the pump, valves or sensors |

**Why two chips:** the STM32 handles everything safety-critical in real time. A network crash or firmware bug on the ESP32 can never leave the pump running.

**Key safety rule:** the STM32 dispenses **only** when it receives `PAID` with the **same `tran_id`** it is currently displaying. Late, duplicate or wrong messages are ignored.

### 2.2 Why an MQTT broker

The backend and the machine never connect to each other directly. Both connect **outward** to a broker on the internet, which delivers messages between them (like a group-chat server). Outgoing connections work through home routers and 4G networks, so machines can be anywhere.

```text
 Backend  ──outgoing──▶  MQTT broker (internet)  ◀──outgoing──  ESP32 (Wi-Fi or 4G)
```

---

## 3. Payment flow (production)

```text
 Customer      STM32 (LCD, pump)         ESP32 (gateway)           Backend + ABA
 ────────      ─────────────────         ───────────────           ─────────────
 1. Choose volume
               2. UART: REQ_PAY,500 ───▶
                                         3. MQTT pay/request ─────▶ 4. Create KHQR (ABA)
                                         ◀── 5. MQTT pay/qr ─────── qr_string + tran_id
               ◀── 6. UART: QR,...
               7. Draw QR on LCD
 8. Scan + pay with banking app ─────────────────────────────────▶ 9. Backend polls ABA
                                                                     → APPROVED
                                         ◀── 10. MQTT pay/status ── "paid"
               ◀── 11. UART: PAID,tran_id
               12. tran_id matches → "Place bottle" → dispense
               13. UART: DONE,tran_id,flow_ml,weight_g ──▶
                                         14. MQTT transaction ────▶ 15. Save sale
```

### 3.1 MQTT topics (ESP32 ↔ backend)

| Topic | Direction | Payload example |
|---|---|---|
| `wrm/{machine_id}/pay/request` | ESP32 → server | `{"volume_ml":500}` |
| `wrm/{machine_id}/pay/qr` | server → ESP32 | `{"tran_id":"1793...","qr_string":"000201...","amount":0.15,"currency":"USD","expires_in_s":180}` |
| `wrm/{machine_id}/pay/status` | server → ESP32 | `{"tran_id":"1793...","status":"paid"}` (or `expired` / `failed`) |
| `wrm/{machine_id}/transaction` | ESP32 → server | `{"tran_id":"1793...","flow_ml":498,"weight_g":501,"status":"ok"}` |
| `wrm/{machine_id}/heartbeat` | ESP32 → server | `{"tank":"MEDIUM","rssi":-67,"fw":"1.0.0"}` |
| `wrm/{machine_id}/online` | ESP32 → server | `1` on connect; Last Will publishes `0` on disconnect |
| `wrm/{machine_id}/config` | server → ESP32 | Prices, volumes, settings |
| `wrm/{machine_id}/ota` | server → ESP32 | Firmware URL + hash |

QoS 1 for all payment topics; duplicates are removed by the `tran_id` check.

### 3.2 UART protocol (ESP32 ↔ STM32)

Plain text, one message per line, ending with `\n`. Wiring: ESP32 TX → STM32 RX, ESP32 RX → STM32 TX, common GND (both 3.3 V logic).

| Message | Direction | Meaning |
|---|---|---|
| `REQ_PAY,<volume_ml>` | STM32 → ESP32 | Customer selected a volume |
| `QR,<tran_id>,<amount>,<currency>,<expires_s>,<qr_string>` | ESP32 → STM32 | Draw this QR |
| `PAID,<tran_id>` | ESP32 → STM32 | Payment confirmed — OK to dispense |
| `EXPIRED,<tran_id>` / `FAILED,<tran_id>` | ESP32 → STM32 | Return to welcome screen |
| `DONE,<tran_id>,<flow_ml>,<weight_g>` | STM32 → ESP32 | Dispense finished |
| `ERR,<code>` | STM32 → ESP32 | Fault (tank empty, no flow, sensor error) |
| `NET,OK` / `NET,DOWN` | ESP32 → STM32 | Network status for the LCD |
| `PING` / `PONG` | both ways | Link check every 5 s |

`qr_string` is ~240 characters and contains no commas; it is always the last field. STM32 UART receive buffer: ≥ 512 bytes.

### 3.3 Failure handling

| Failure | Behaviour |
|---|---|
| Network down | ESP32 sends `NET,DOWN`; LCD shows "Offline"; no new payments accepted |
| Network drops while QR is shown | Backend still detects payment; `PAID` is delivered after reconnect, or `expired` if the QR times out |
| ESP32 freezes | STM32 receives no `PONG` → "Service unavailable", pump stays off |
| Power cut while dispensing | Normally-closed valves stop water; on boot the STM32 reports the unfinished `tran_id` |
| Duplicate `PAID` | Ignored — that `tran_id` was already dispensed |
| Paid but dispense failed | Transaction flagged; refund via ABA refund API (automatic or operator-approved) |

---

## 4. Technology stack

### 4.1 Machine hardware

| Part | Prototype | Product |
|---|---|---|
| Electronics | Dev boards + jumper wires | **One custom PCB**: STM32 + ESP32 module + 4G module + power + MOSFET drivers |
| 4G module | SIM7600 | **A7670 / EC200U (LTE Cat-1)** — cheaper, sufficient for MQTT |
| SIM | Personal SIM | **IoT / business data SIM** (Cellcard, Smart, Metfone) |
| Power | Bench supply | **Industrial PSU** (e.g. Mean Well), fuses, surge protection, RCD/RCBO |
| Water safety | Filter | **Filter + UV sterilizer + TDS sensor** |
| Security | — | **Door / tamper switch** with alert |
| Enclosure | Prototype | 304 stainless steel, IP54, locked service panel |

### 4.2 Firmware

| Item | ESP32 (gateway) | STM32 (controller) |
|---|---|---|
| Toolchain | ESP-IDF or Arduino-ESP32 with PlatformIO | STM32 HAL with Keil MDK or STM32CubeIDE |
| Security | Secure boot + flash encryption; credentials in encrypted NVS | Read-out protection (RDP) enabled |
| Updates | Signed OTA over 4G with automatic rollback | Updated **by the ESP32** over UART (STM32 built-in bootloader) |
| Reliability | Watchdog, auto-reconnect, offline message queue | Watchdog, fail-safe outputs (pump off on any fault) |

### 4.3 Cloud

| Component | Choice | Reason |
|---|---|---|
| MQTT broker | **EMQX Cloud** or **HiveMQ Cloud** (AWS IoT Core at large scale) | Managed, TLS, per-device credentials, no server to maintain |
| Backend | **TypeScript (NestJS)** — alternatives: Python (FastAPI), Go | Typed, structured, easy to hire for |
| Database | **PostgreSQL** (managed) | Reliable storage for money and transactions |
| Jobs / cache | **Redis** | ABA status polling, retries, scheduled tasks |
| Hosting | **DigitalOcean or AWS, Singapore region**, Docker | Low latency to Cambodia, easy to scale |
| Dashboard | **Next.js (React)** | Sales, machine status, alerts, remote settings |
| Alerts | **Telegram bot** | Operators already use Telegram |
| Monitoring | Uptime checks + error tracking (e.g. Sentry) | Detect problems before customers do |

### 4.4 Payments (ABA PayWay KHQR)

| Item | Product requirement |
|---|---|
| Account | Move from sandbox to a **production merchant account** (paywaysales@ababank.com); requires business registration |
| One payment = one dispense | Each `tran_id` can dispense only once |
| Refunds | Automatic or operator-approved refund when dispensing fails after payment |
| Reconciliation | Daily comparison of system sales vs ABA settlement report |
| Currency | KHR and USD, configurable per machine |
| Keys | API keys only in server environment variables / secret manager — never in Git or firmware |

---

## 5. Product features

| # | Feature | Description |
|---|---|---|
| 1 | Remote configuration | Change prices, volumes and settings from the dashboard |
| 2 | Fleet management | Register machines, locations, online/offline status |
| 3 | OTA updates | Remote firmware updates for ESP32 and STM32 |
| 4 | Offline mode | Clear "Offline" screen; never take payment without confirmation |
| 5 | Alerts | Tank low, no flow, sensor fault, door opened, machine offline, flow vs weight mismatch |
| 6 | Maintenance tracking | Filter and UV lamp schedules, refill logs, technician visits |
| 7 | Reports | Daily / monthly / per-machine revenue, volume sold, uptime |
| 8 | Audit log | Who changed prices, who issued refunds |
| 9 | Water quality | TDS readings logged; dispensing blocked if quality is out of range |

---

## 6. Team responsibilities

| Area | Owner | Tools |
|---|---|---|
| STM32 firmware (LCD, sensors, pump, valves, UART protocol) | Hardware member | Keil MDK / STM32 HAL |
| Electronics, wiring, PCB | Hardware member | KiCad / EasyEDA |
| ESP32 gateway firmware (Wi-Fi/4G, MQTT, UART bridge, OTA) | Backend member | VS Code + PlatformIO |
| Backend, MQTT, ABA PayWay, database, dashboard | Backend member | Backend stack (Section 4.3) |
| UART protocol (Section 3.2) | **Both — agreed contract** | — |
| Integration and field testing | Both | — |

---

## 7. Roadmap

| Phase | Goal | Main work | Exit criteria |
|---|---|---|---|
| **1. Prototype** *(current)* | Works on the desk | ESP32 ↔ MQTT ↔ backend ↔ ABA sandbox; STM32 LCD + dispensing | Full flow: select → QR → pay (simulator) → dispense → sale recorded |
| **2. MVP** | One complete machine | Enclosure, plumbing, database, dashboard, alerts, OTA | Machine runs 7 days unattended in the lab |
| **3. Pilot** | 1–3 machines at real sites (1–2 months) | ABA live account, refunds, monitoring, field fixes | Uptime ≥ 98 %, zero unpaid dispenses, refunds working |
| **4. Product** | Repeatable build | Custom PCB, production BOM, factory setup tool, documentation | New machine built and online in under 1 day |

### 7.1 Progress

- [x] ABA PayWay sandbox: KHQR generation and payment detection tested end to end
- [x] HTTP payment API + `/dev` test page (Node.js prototype)
- [x] STM32 ↔ backend QR integration guide
- [ ] MQTT broker account (EMQX Cloud / HiveMQ Cloud)
- [ ] Backend: MQTT payment flow (backend polls ABA and publishes `paid`)
- [ ] ESP32 gateway: Wi-Fi + MQTT + UART bridge
- [ ] STM32: UART protocol, QR on LCD, dispensing state machine
- [ ] ESP32 ↔ STM32 integration test
- [ ] Choose final backend language and rebuild with database

---

## 8. Decisions

| Decision | Status | Choice |
|---|---|---|
| Two chips (STM32 + ESP32) | ✅ Decided | STM32 = control, ESP32 = gateway |
| Payment provider | ✅ Decided | ABA PayWay KHQR |
| Device ↔ cloud protocol | ✅ Decided | MQTT over TLS |
| MQTT broker | ⏳ Open | EMQX Cloud or HiveMQ Cloud |
| Backend language | ⏳ Open | Recommended: TypeScript (NestJS) |
| Connectivity | ⏳ Open | Wi-Fi for prototype, LTE Cat-1 for product |
| Currency | ⏳ Open | KHR / USD (KHR needs ABA enablement) |

---

## 9. Business & compliance (to confirm locally)

- Business registration and ABA PayWay merchant agreement for live payments
- Drinking-water quality testing and certification (check requirements with the relevant Cambodian authorities)
- Electrical safety: earthing, RCD/RCBO protection, IP-rated enclosure
- Site agreements for each location (space, power, water supply)

---

## Related documents

- [System Overview](system-overview.md)
- [Team Roles](team-roles.md)
- [STM32 QR Payment Integration](../04-Cloud-and-Payment/stm32-qr-payment-integration.md)
- [API and Database](../04-Cloud-and-Payment/api-and-database.md)
- [Backend README](../../backend/README.md)
