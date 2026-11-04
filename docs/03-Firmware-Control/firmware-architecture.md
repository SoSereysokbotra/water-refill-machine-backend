# Firmware Architecture

## 1. FreeRTOS Task Layout

The ESP32-S3 firmware is organized into prioritized FreeRTOS tasks running across both Xtensa CPU cores to guarantee that real-time sensor measurements never block user interface rendering or cellular communications:

```text
 ┌────────────────────────────────────────────────────────┐
 │                      CPU CORE 0                        │
 ├─────────────────────────┬──────────────────────────────┤
 │  Telemetry Task (Pri 2) │ • Handles SIM7600 AT Cmds    │
 │                         │ • Sends MQTT/HTTP payloads   │
 ├─────────────────────────┼──────────────────────────────┤
 │  UI & Touch Task (Pri 3)│ • Renders ILI9341 screens    │
 │                         │ • Polls XPT2046 touch input  │
 └─────────────────────────┴──────────────────────────────┘

 ┌────────────────────────────────────────────────────────┐
 │                      CPU CORE 1                        │
 ├─────────────────────────┬──────────────────────────────┤
 │  Dispense Task (Pri 5)  │ • High-priority FSM control  │
 │  [CRITICAL REAL-TIME]   │ • Fast/Slow Solenoid gating  │
 │                         │ • Safety cutoff evaluation   │
 ├─────────────────────────┼──────────────────────────────┤
 │  Sensor Task (Pri 4)    │ • Reads HX711 10Hz/80Hz ADC  │
 │                         │ • Computes filtered weight   │
 │                         │ • Polls tank float switches  │
 └─────────────────────────┴──────────────────────────────┘
```

---

## 2. Inter-Task Communication

- **Sensor Queue (`xSensorQueue`)**: Sensor Task pushes moving-average filtered weight (grams) and tank level status to the Dispense Task at 20Hz.
- **Hardware Interrupt (`gpio_isr_handler`)**: The YF-S201 flow sensor pulse pin directly increments a 32-bit volatile counter (`g_flow_pulse_count`) on every rising edge without FreeRTOS context switch overhead.
- **Dispense Event Semaphore (`xDispenseStopSem`)**: Used for instantaneous emergency cutoffs (bottle removed, low tank level, timeout).
- **Network Queue (`xTelemetryQueue`)**: After every completed refill, the Dispense Task pushes a compact transaction struct (`timestamp`, `volume_ml`, `weight_g`, `payment_id`, `status`) to the Telemetry Task for background transmission.

---

## 3. Recommended Development Stack
- **Framework**: PlatformIO with **Arduino ESP32 Core v2.0+** or **ESP-IDF v5.1+**.
- **Display Library**: `TFT_eSPI` or `LovyanGFX` configured for hardware SPI on Core 0.
- **Weight ADC Driver**: `bogde/HX711` running with dedicated calibration factors stored in Non-Volatile Storage (NVS).
- **Cellular Driver**: `TinyGSM` library interfacing SIM7600 over Hardware UART1 with hardware power-key toggling.

