# System Overview & Architecture

> Current design: **STM32 (hardware control) + ESP32 WROOM-32 (network gateway) + MQTT + ABA PayWay KHQR.**
> Details: [SRS v3](srs.md) · [Product Roadmap](product-architecture-roadmap.md) · [Implementation Plan](../04-Cloud-and-Payment/backend-implementation-plan.md)

## 1. Executive Summary

The **Smart IoT Water Refill Machine** is a cashless drinking-water refill station for Cambodia. A customer chooses **0.5 L, 0.75 L or 1.0 L**, scans a **KHQR** code with any banking app, places a bottle, and the machine fills it accurately.

### Key Highlights
- **Cashless payment:** dynamic KHQR from **ABA PayWay**. A new QR is made for every purchase, and the backend confirms the payment.
- **Two microcontrollers, two jobs:**
  - **STM32** controls everything physical: LCD, buttons, pump, valves, sensors, safety.
  - **ESP32 WROOM-32** handles the internet only: Wi-Fi and MQTT to the cloud.
- **Dual-check dispensing:** a **YF-S201 flow sensor** measures volume, and an **HX711 load cell** checks it by weight. Target accuracy is ±1 %.
- **Two-stage fill:** fast valve to 90 %, then slow valve to 100 %, so there is no splash and no overfill.
- **Safe without internet:** the STM32 stops the pump on its own (bottle removed, tank empty, timeout).
- **No lost payments:** every paid purchase ends with water delivered **or** a refund decision.
- **Remote monitoring:** the backend tracks machine status, tank level, sales and alerts.

---

## 2. High-Level Architecture

```text
┌────────────────────────────────────────────────────────────────────────┐
│                               CLOUD                                    │
│  ┌──────────────┐  HTTPS  ┌───────────────────────┐  HTTPS ┌──────────┐ │
│  │  ABA PayWay  │◀──────▶│ Backend (NestJS)       │◀──────▶│  Admin   │ │
│  │    (KHQR)    │         │ Payments · Fleet ·     │        │ dashboard│ │
│  └──────────────┘         │ Monitoring · Reports   │        └──────────┘ │
│                           └───────────┬───────────┘                    │
│                                       │ MQTT                           │
│                           ┌───────────▼───────────┐                    │
│                           │  EMQX Cloud (broker)  │                    │
│                           └───────────┬───────────┘                    │
└───────────────────────────────────────┼────────────────────────────────┘
                                        │ MQTT over TLS (port 8883), Wi-Fi
┌───────────────────────────────────────┼────────────────────────────────┐
│ MACHINE                    ┌──────────▼──────────┐                     │
│                            │ ESP32 WROOM-32      │  network gateway     │
│                            │ Wi-Fi · MQTT · NVS  │                     │
│                            └──────────┬──────────┘                     │
│                                       │ UART 115200 8N1 (GPIO16/17)    │
│                            ┌──────────▼──────────┐                     │
│                            │ STM32 (Keil)        │  machine controller  │
│                            └──┬───────┬───────┬──┘                     │
│                ┌──────────────┘       │       └───────────────┐        │
│        USER INTERFACE           SENSING INPUTS          ACTUATION      │
│        • LCD (shows KHQR)       • Load cell (HX711)     • 12 V pump    │
│        • Buttons 500/750/1000   • Flow sensor (YF-S201) • Fast valve   │
│          + Cancel               • Float sensors (H/M/L) • Slow valve   │
│        • Red/Green LEDs, buzzer                                        │
└────────────────────────────────────────────────────────────────────────┘
```

| Part | Owner | Job |
|---|---|---|
| STM32 | Hardware developer | Screens, buttons, sensors, pump, valves, safety |
| ESP32 | Backend developer | Wi-Fi, MQTT, UART bridge, saves results when offline |
| Backend | Backend developer | ABA payments, records, refunds, alerts |
| Dashboard | Backend developer | Website for owner and operators |

---

## 3. User Journey

The customer **selects the volume first, then pays**. The price depends on the volume.

```text
 [ Welcome screen: choose 0.5 L / 0.75 L / 1.0 L ]
        │
        ▼
 [ STM32 → ESP32 → Backend: "new payment" ] ──(no network)──▶ [ "Offline, try later" ]
        │
        ▼
 [ Backend asks ABA for a KHQR → STM32 shows QR + 3-minute countdown ]
        │                     └──(Cancel / 3 min, not paid)──▶ [ back to Welcome ]
        ▼
 [ Customer pays with banking app → Backend confirms with ABA → "PAID" ]
        │
        ▼
 [ STM32 checks the payment matches the QR shown → "Place your bottle" ]
        │                     └──(no bottle in 60 s)──▶ [ stop, refund review ]
        ▼
 [ Bottle detected (> 20 g) → tare scale → Green LED ]
        │
        ▼
 [ Stage 1: pump + fast valve to 90 % ] → [ Stage 2: slow valve to 100 % ]
        │                     └──(bottle removed / tank empty / fault)──▶ [ safe stop, refund review ]
        ▼
 [ Stop pump, close valves → dual-check (flow vs weight) → "Thank you" ]
        │
        ▼
 [ STM32 → ESP32 → Backend: result saved (kept and resent if offline) ] → [ Welcome ]
```

---

## 4. Key Technical Specifications

| Parameter | Specification | Notes |
|---|---|---|
| **Machine controller** | STM32 (model **TBD by hardware developer**) | Programmed in Keil |
| **Network gateway** | ESP32 WROOM-32 (DevKit) | PlatformIO, Arduino framework |
| **Connectivity** | Wi-Fi 2.4 GHz → MQTT over TLS to EMQX Cloud | 4G (SIM7600/A7670 on the ESP32) is an option for later, not in the pilot |
| **Payment** | ABA PayWay KHQR | Sandbox: USD only; live: USD/KHR |
| **Dispensing volumes** | 0.5 L, 0.75 L, 1.0 L (fixed tiers) | Prices set remotely from the dashboard |
| **Dispense accuracy** | ±1 % (±5 mL on 500 mL) | Flow sensor + load cell cross-check |
| **Reservoir** | 60 L food-grade tank | High / Mid / Low float switches |
| **User interface** | LCD (2.8" SPI TFT, ILI9341 planned) + buttons | Touch input optional, **TBD (hardware)** |
| **Indicators** | Red / Green LEDs, buzzer | |
| **Power** | AC → Mean Well 12 V PSU → 5 V buck → 3.3 V | Both MCUs use 3.3 V logic |
| **Enclosure** | 304 stainless steel, lockable | 400 W × 350 D × 1200 H mm |
| **Operating temperature** | 5 °C to 45 °C | Indoor or sheltered outdoor |
