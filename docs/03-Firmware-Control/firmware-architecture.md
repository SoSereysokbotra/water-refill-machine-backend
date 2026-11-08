# Firmware Architecture (STM32 + ESP32)

> Two firmwares, two owners. The **STM32** (Keil, hardware developer) controls the machine; the **ESP32** (PlatformIO, backend developer) connects it to the cloud. They talk only through the **UART contract** (Implementation Plan §C3).
> 📝 The STM32 part is a **draft for the hardware developer to confirm**.

## 1. Overview

```text
┌──────────────────────── STM32 (Keil) ────────────────────────┐      ┌────────── ESP32 WROOM-32 (PlatformIO) ──────────┐
│ ui (LCD screens, QR drawing, buttons, LEDs, buzzer)           │      │ wifi       connect / reconnect (2.4 GHz)        │
│ dispense FSM (§ state-machine-logic)                          │      │ time       NTP sync (needed for TLS + timestamps)│
│ safety (cut-offs, timeouts, overflow)       ◀── highest prio  │ UART │ mqtt       TLS 8883 → EMQX, persistent session, │
│ sensors (HX711, flow pulses, floats)                          │◀────▶│            Last Will on wrm/<id>/online          │
│ link (UART RX ring buffer, line parser, PING/PONG)            │115200│ bridge     UART line ⇄ MQTT JSON (§C2/§C3)       │
│ storage (calibration + last result in flash)                  │ 8N1  │ outbox     NVS queue of results until            │
│ config (prices/currency/enabled from CFG)                     │      │            transaction/ack (firmware v0.4)      │
└───────────────────────────────────────────────────────────────┘      │ heartbeat  every 60 s; test menu on USB serial  │
                                                                       └─────────────────────────────────────────────────┘
```

---

## 2. STM32 Firmware (hardware developer)

### 2.1 Structure
The structure (bare-metal super-loop + interrupts, or FreeRTOS / CMSIS-RTOS2) is **TBD (hardware)**. Whichever is chosen, keep these rules:

| Priority | Module | Runs as | Rule |
|---|---|---|---|
| 1 (highest) | **Safety + dispense control** | Timer interrupt / high-priority task, ≥ 50 Hz | Never blocked by LCD drawing or UART |
| 2 | **Flow counter** | Timer input capture / EXTI | Count every pulse, no processing in the ISR |
| 3 | **Sensors** | 10–20 Hz | HX711 moving average, float debounce |
| 4 | **UART link** | RX interrupt/DMA → ring buffer; parse in main loop | Line buffer ≥ 512 bytes |
| 5 | **UI** | Main loop | QR drawn once per screen, not every loop |

### 2.2 Communication Between Modules
- **Flow ISR** increments a 32-bit `volatile` pulse counter.
- **Sensors → dispense:** filtered weight (g) and tank level, updated 20 times per second.
- **Emergency stop:** any module can set a stop flag; the safety loop closes the valves on its next tick (< 20 ms).
- **Dispense → link:** finished result `{tran_id, result, flow_ml, weight_g, fault}` is saved to flash first, then sent over UART until `ACK,<tran_id>`.

### 2.3 Libraries
| Need | Suggestion |
|---|---|
| HAL / drivers | STM32Cube HAL (CubeMX for pin and clock setup) |
| LCD | ILI9341 SPI driver (any; DMA recommended) |
| QR code | [nayuki QR-Code-generator](https://github.com/nayuki/QR-Code-generator) C version: `qrcodegen.c/.h` (same library as the ESP32) |
| HX711 | Simple bit-bang driver |
| Flash storage | EEPROM emulation in internal flash (calibration + last result) |

Example QR code: [stm32-qr-payment-integration.md](../04-Cloud-and-Payment/stm32-qr-payment-integration.md).

---

## 3. ESP32 Firmware (backend developer)

Source: [`esp32-gateway/`](../../esp32-gateway/README.md), currently **v0.2.0** (tested end to end).

| Area | Implementation |
|---|---|
| Framework | PlatformIO, Arduino core (`espressif32@^6.9`) |
| Libraries | PubSubClient (MQTT 3.1.1), ArduinoJson v7, nayuki qrcodegen (vendored) |
| MQTT | TLS with DigiCert Global Root G2 CA, `cleanSession=false`, Last Will `online=0` (retained) |
| UART | UART2 GPIO16/17, 115200 8N1 |
| Test mode | USB serial menu (1/2/3 pay, q, d, i, s, h) acts as a fake STM32; prints a compact QR in the terminal |
| Secrets | `include/secrets.h` (git-ignored): Wi-Fi, MQTT user, `MACHINE_ID` |

Planned versions (Implementation Plan Part E):

v0.2.0 speaks the simple first protocol (`PONG` without fields, no `ACK`). Compatibility notes for STM32 testing are in [stm32-qr-payment-integration.md §6](../04-Cloud-and-Payment/stm32-qr-payment-integration.md).

| Version | Phase | Adds |
|---|---|---|
| v0.3 | 2 | `request_id`, retry policy, discard stale QR, `CANCEL`, `transaction` publish + wait for ack |
| v0.4 | 3 | NVS result queue (64 items, 7 days), `ACK,<tran_id>` to STM32, `PAID` repeat until `PAID,ACK`, heartbeat counters |
| v0.5 | 4 | `config` → `CFG` → `config/ack`, full heartbeat with STM32 state |
| OTA | 11 | Remote firmware updates (ESP32 and STM32 via UART bootloader) |
