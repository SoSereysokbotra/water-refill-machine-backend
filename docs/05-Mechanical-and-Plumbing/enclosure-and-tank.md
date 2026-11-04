# Enclosure & Water Tank Specifications

## 1. Enclosure Design & Dimensions

The machine body is fabricated from **1.2 mm thick food-grade 304 Stainless Steel** (brushed finish) to resist corrosion, rust, and outdoor moisture:

### Physical Dimensions
- **Width**: $400\text{ mm}$
- **Depth**: $350\text{ mm}$
- **Total Height**: $1200\text{ mm}$ (free-standing countertop or floor station)

```text
┌───────────────────────────────────────┐  ▲
│  [2.8" TFT DISPLAY]    [QR CODE AREA] │  │
│                                       │  │ TOP SECTION (User Deck)
│  (•) RED LED         (•) GREEN LED    │  │ • Dispensing alcove (H: 320mm)
│                                       │  │ • Nozzle assembly
│             ┌───────┐                 │  │ • Load cell bottle platform
│             │NOZZLE │                 │  │
│             └───┬───┘                 │  │
│                 │                     │  │
│              [BOTTLE]                 │  │
│           ┌───────────┐               │  │
│           │ LOAD CELL │               │  │
├───────────┴───────────┴───────────────┤  ▼
│    MIDDLE SECTION (Electronics Bay)   │  ▲
│  • ESP32-S3 PCB Board                 │  │ Compartment sealed from moisture
│  • SIM7600 4G Module & Antenna        │  │ Mean Well 12V PSU & Buck converter
│  • Relay / MOSFET Actuator Driver     │  │
├───────────────────────────────────────┤  ▼
│     BOTTOM SECTION (Reservoir Bay)    │  ▲
│  • 60L Water Tank (HDPE / Stainless)  │  │ Lockable front service door
│  • 12V DC Diaphragm Water Pump        │  │ Quick-disconnect refill inlet
│  • Fast & Slow Solenoid Valves        │  │ Drain valve at base
│  • Triple Float Switch Probe          │  │
└───────────────────────────────────────┘  ▼
```

---

## 2. 60-Liter Water Reservoir

- **Material**: Heavy-duty, UV-stabilized food-grade HDPE (High-Density Polyethylene) or 304 Stainless Steel.
- **Capacity**: $60\text{ Liters}$ (equivalent to $120 \times 0.5\text{L}$ refills or $60 \times 1.0\text{L}$ refills per tank refill cycle).
- **Float Switch Ports**: 3 vertical tapped ports for the Low (5L), Mid (30L), and High (60L) float switches.
- **Venting**: 0.2 micron hydrophobic air vent cap at the top to prevent tank vacuum during pumping while preventing airborne dust/contaminant ingress.
- **Cleaning Access**: $150\text{ mm}$ threaded top inspection port for quarterly descaling and sanitization.

