# System Overview & Architecture

## 1. Executive Summary

The **IoT Water Refill Vending Machine** is a standalone, automated, cashless water dispensing station built around the **ESP32-S3** microcontroller. It is designed to provide public drinking water refills at accurate, predetermined volumes (**0.5 L**, **0.75 L**, and **1.0 L**) with high precision, remote telemetry, and zero cash handling.

### Key Highlights
- **Cashless Mobile Payment**: Instant QR code scanning (PromptPay, GCash, Maya, or standard payment gateway) with real-time verification.
- **Dual-Check Dispensing Precision**: Combines an in-line **YF-S201 Hall-effect flow sensor** with an under-platform **HX711 load cell weight sensor** to guarantee exact fill levels (accuracy within $\pm 5\text{ ml}$).
- **Two-Stage Flow Control**: Utilizes a **Fast Solenoid Valve** for rapid bulk dispensing (up to ~90% volume) and a **Slow Solenoid Valve** for precision topping without splash or overflow.
- **4G LTE Cellular Telemetry**: Powered by the **SIM7600** module to log transactions, alert operators on tank refill levels, and report machine health without requiring local Wi-Fi.
- **Durable Construction**: Food-grade 304 stainless steel enclosure housing a 60L internal water reservoir.

---

## 2. High-Level Architecture

The **ESP32-S3** serves as the central processing unit coordinating all user interactions, sensing, actuation, and cloud communications.

```text
┌─────────────────────────────────────────────────────────────────┐
│                          CLOUD SERVER                           │
│           (Payment Gateway · Telemetry · Admin API)             │
└────────────────────────────────┬────────────────────────────────┘
                                 │ 4G LTE (UART via SIM7600)
┌────────────────────────────────▼────────────────────────────────┐
│                       ESP32-S3 CONTROLLER                       │
├───────────────────┬─────────────────────────┬───────────────────┤
│    USER INTERFACE │      SENSING INPUTS     │ ACTUATION OUTPUTS │
├───────────────────┼─────────────────────────┼───────────────────┤
│ • 2.8" SPI TFT    │ • Load Cell (HX711)     │ • 12V DC Pump     │
│   Touchscreen     │ • Flow Sensor (YF-S201) │ • Fast Solenoid   │
│ • QR Display      │ • Float Sensor (H/M/L)  │ • Slow Solenoid   │
│ • Red/Green LEDs  │                         │ • Power Relays    │
└───────────────────┴─────────────────────────┴───────────────────┘
```

---

## 3. User Journey & Dispensing Flowchart

The operational cycle follows a strict fail-safe sequence:

```text
   [ Start ]
       │
       ▼
 [ Display QR Code ] ──(Customer scans & pays via mobile)
       │
       ▼
 [ Verify Payment ] ──(Failed/Timeout)──▶ [ Show Error & Loop ]
       │ (Success)
       ▼
 [ Select Volume ] ──(0.5 L / 0.75 L / 1.0 L on Touchscreen)
       │
       ▼
 [ Bottle Placement ] ──▶ [ Red LED Active ]
       │
       ▼
 [ Check Weight Sensor ] ──(No bottle / < 20g)──▶ [ Prompt Placement ]
       │ (Bottle Detected: Weight > 20g)
       ▼
 [ Tare Load Cell & Green LED ON ]
       │
       ▼
 [ Stage 1: Fast Refill ] ──(Pump ON + Fast Valve OPEN until 90% target)
       │
       ▼
 [ Stage 2: Slow Precision Refill ] ──(Slow Valve OPEN until target reached)
       │
       ▼
 [ Dual Verification Check ] ──(Flow pulse count matches $\Delta$Weight)
       │
       ▼
 [ Stop Pump & Close Valves ] ──▶ [ Green LED Blink / Tone ]
       │
       ▼
 [ Upload Transaction Telemetry via 4G ]
       │
       ▼
    [ End ]
```

---

## 4. Key Technical Specifications

| Parameter | Specification | Notes |
|---|---|---|
| **Microcontroller** | ESP32-S3 (Xtensa Dual-Core 240MHz, 8MB Flash) | Supports FreeRTOS multitasking |
| **Connectivity** | 4G LTE (SIM7600) + fallback Wi-Fi (2.4GHz) | Real-time transaction & status reporting |
| **Dispensing Volumes** | 0.5 L (500 ml), 0.75 L (750 ml), 1.0 L (1000 ml) | User selectable via touchscreen |
| **Dispense Accuracy** | $\pm 1\%$ by volume ($\pm 5\text{ ml}$ typical) | Validated via Dual Sensor Cross-Check |
| **Reservoir Capacity** | 60 Liters | Food-grade HDPE/Stainless with H/M/L float switches |
| **User Interface** | 2.8" TFT SPI (ILI9341) + Resistive Touch (XPT2046) | Color graphical interactive menu |
| **Indicators** | Dual LED (Green = Ready/Dispensing, Red = Waiting/Alert) | High-visibility status |
| **System Power** | 12V DC (5A) primary input, regulated 5V & 3.3V rails | Powered via AC-to-DC internal supply |
| **Enclosure** | Food-grade 304 Stainless Steel, lockable access door | 400 mm (W) × 350 mm (D) × 1200 mm (H) |
| **Operating Temperature** | $5^\circ\text{C}$ to $45^\circ\text{C}$ | Indoor or sheltered outdoor rating |

