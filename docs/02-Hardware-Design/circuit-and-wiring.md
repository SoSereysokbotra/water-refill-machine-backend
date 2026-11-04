# Circuit Schematic & Wiring Guide

## 1. Power Distribution Network

The machine receives 110V/220V AC mains and steps it down through a single industrial switching power supply into three distinct voltage domains:

```text
  [ AC Mains 110/220V ]
          │
          ▼
┌─────────────────────────────────┐
│     MEAN WELL LRS-100-12        │
│        (12V DC, 8.5A)           │
└───────┬─────────────────────────┘
        │
        ├──▶ 12V High-Current Rail ──▶ Water Pump, Solenoid Valves
        │
        ▼
┌─────────────────────────────────┐
│   DC-DC BUCK CONVERTER (LM2596) │
│         (5V DC, 3A)             │
└───────┬─────────────────────────┘
        │
        ├──▶ 5V Rail ──────────────▶ ESP32-S3 (5V Pin), YF-S201 Sensor, SIM7600 VBUS
        │
        ▼
┌─────────────────────────────────┐
│     ON-BOARD LDO REGULATOR      │
│        (3.3V DC, 1A)            │
└───────┬─────────────────────────┘
        │
        └──▶ 3.3V Rail ────────────▶ TFT LCD, XPT2046 Touch, HX711 ADC, Status LEDs
```

---

## 2. Actuator Driver Circuit (Relay / MOSFET)

The 12V water pump and the two solenoid valves generate substantial inductive kickback when switched off. 

### Inductive Kickback Protection
Every coil (Pump, Fast Valve, Slow Valve) **must** have a flyback diode (**1N4007** or **1N5819 Schottky**) placed antiparallel across its terminals (Cathode to +12V, Anode to Ground / Switch Collector).

```text
               +12V DC
                 │
                 ├───┬───────────────┐
                 │   │               │
                 │  ┌┴┐              │
                 │  │ │ Inductive   ┌┴┐ Flyback Diode
                 │  │ │ Coil        │▲│ (1N4007)
                 │  └┬┘ (Pump/Valve)└┬┘
                 │   │               │
                 │   └───┬───────────┘
                 │       │
                 │     ──┴── (Collector / Drain)
                 │    │     │
ESP32 GPIO ────[1kΩ]──┤ NPN │ (or Logic-Level N-Channel MOSFET IRLZ44N)
                      │     │
                       ──┬── (Emitter / Source)
                         │
                        GND
```

---

## 3. Sensor Wiring Details

### 3.1 Load Cell & HX711 (Weight Detection)
- **Excitation & Signals**: 4 wires from the load cell bridge connect directly to the HX711 module:
  - **Red**: $E+$ (Excitation Positive)
  - **Black**: $E-$ (Excitation Negative / Ground)
  - **White**: $A-$ (Signal Negative)
  - **Green**: $A+$ (Signal Positive)
- **Logic Side**: Connect VCC to **3.3V**, GND to **GND**, DOUT to **GPIO 17**, and SCK to **GPIO 18**.
- *Note*: Running the HX711 on 3.3V avoids needing logic level conversion to the ESP32-S3.

### 3.2 YF-S201 Flow Sensor (Volumetric Measurement)
- **VCC (Red)**: Connect to **5V DC** (the sensor requires 5V for stable Hall-effect operation).
- **GND (Black)**: Connect to **Common Ground**.
- **Signal (Yellow)**: Connect to **GPIO 4** via a 5V-to-3.3V voltage divider ($1\text{k}\Omega$ series, $2\text{k}\Omega$ to GND) and a $4.7\text{k}\Omega$ pull-up resistor to 5V.
- *Transfer Function*: $F = 7.5 \times Q$, where $F$ is frequency in Hz, and $Q$ is flow rate in L/min.

### 3.3 Tank Level Float Switches (High, Mid, Low)
- 3 independent vertical reed-switch floats installed inside the 60L reservoir:
  - **High Float (60L Full)**: GPIO 35 $\rightarrow$ Switch $\rightarrow$ GND.
  - **Mid Float (30L Half)**: GPIO 36 $\rightarrow$ Switch $\rightarrow$ GND.
  - **Low Float (5L Empty Cutoff)**: GPIO 37 $\rightarrow$ Switch $\rightarrow$ GND.
- When water level drops below the float, the switch opens, pulling the pin HIGH via internal pull-up.

---

## 4. Grounding & Noise Suppression Rules
1. **Star Grounding**: Connect the high-current 12V pump/valve ground return directly to the PSU ground terminal, separate from the ESP32 analog/sensor ground.
2. **HX711 Shielding**: Keep the 4 load cell wires shielded and run them away from the 12V pump motor power leads to prevent electrical noise in weight readings.
3. **Decoupling Capacitors**: Place a $100\mu\text{F}$ electrolytic capacitor in parallel with a $0.1\mu\text{F}$ ceramic capacitor near the 5V power input of the ESP32.

