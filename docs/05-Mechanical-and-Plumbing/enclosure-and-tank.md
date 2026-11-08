# Enclosure & Water Tank Specifications

> 📝 **Draft for the hardware developer to confirm** (electronics bay layout and Wi-Fi antenna position).

## 1. Enclosure Design & Dimensions

The body is **1.2 mm food-grade 304 stainless steel** (brushed) to resist rust and moisture.

### Physical Dimensions
- **Width:** 400 mm
- **Depth:** 350 mm
- **Height:** 1200 mm (floor station)

```text
┌───────────────────────────────────────┐  ▲
│  [2.8" LCD: screens + KHQR]           │  │
│  [500] [750] [1000] [CANCEL] buttons  │  │ TOP SECTION (User Deck)
│  (•) RED LED         (•) GREEN LED    │  │ • Dispensing alcove (H: 320 mm)
│             ┌───────┐                 │  │ • Nozzle assembly
│             │NOZZLE │                 │  │ • Load cell bottle platform
│             └───┬───┘                 │  │ • Drip tray
│              [BOTTLE]                 │  │
│           ┌───────────┐               │  │
│           │ LOAD CELL │               │  │
├───────────┴───────────┴───────────────┤  ▼
│    MIDDLE SECTION (Electronics Bay)   │  ▲
│  • STM32 board (machine controller)   │  │ Sealed from water and moisture
│  • ESP32 WROOM-32 (Wi-Fi gateway)     │  │ Mean Well 12 V PSU + 5 V buck
│  • MOSFET driver board, fuse          │  │ Cable glands between sections
│  • Wi-Fi antenna: see note below      │  │
├───────────────────────────────────────┤  ▼
│     BOTTOM SECTION (Reservoir Bay)    │  ▲
│  • 60 L water tank                    │  │ Lockable front service door
│  • 12 V diaphragm pump, pre-filter    │  │ Quick-disconnect refill inlet
│  • Fast & slow solenoid valves        │  │ Drain valve at the base
│  • Flow sensor, triple float switch   │  │
└───────────────────────────────────────┘  ▼
```

### Wi-Fi Antenna (important)
Stainless steel blocks Wi-Fi. Choose one:
- Mount the ESP32 behind a **plastic window** (e.g. near the LCD bezel), or
- Use an ESP32 board with an **external antenna connector** (WROOM-32U) and mount the antenna outside or on top.

Test the signal (RSSI in the heartbeat) with the door closed. Aim for **better than −70 dBm**.

---

## 2. 60-Liter Water Reservoir

- **Material:** UV-stabilised food-grade HDPE or 304 stainless steel.
- **Capacity:** 60 L (≈ 120 × 0.5 L or 60 × 1.0 L refills per fill).
- **Float switches:** 3 ports for **Low (5 L)**, **Mid (30 L)** and **High (60 L)**.
  - Low = dispensing locked.
  - Mid = "tank low" warning sent to the backend.
- **Vent:** 0.2 µm hydrophobic vent cap, so there's no vacuum when pumping and no dust inside.
- **Cleaning access:** 150 mm threaded inspection port for quarterly cleaning.
