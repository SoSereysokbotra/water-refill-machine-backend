# Circuit Schematic & Wiring Guide

> 📝 **Draft for the hardware developer to confirm.** STM32 pin names are in [esp32-pin-mapping.md](esp32-pin-mapping.md) (pin numbers TBD).

## 1. Power Distribution

```text
  [ AC Mains 110/220 V ]
          │
          ▼
┌─────────────────────────────────┐
│      MEAN WELL LRS-100-12       │
│         (12 V DC, 8.5 A)        │
└───────┬─────────────────────────┘
        │  (5 A fuse)
        ├──▶ 12 V high-current rail ──▶ Pump, fast valve, slow valve (via MOSFETs)
        │
        ▼
┌─────────────────────────────────┐
│   DC-DC BUCK (LM2596), 5 V 3 A  │
└───────┬─────────────────────────┘
        │
        ├──▶ 5 V rail ──▶ STM32 board (5V pin), ESP32 DevKit (VIN), YF-S201 flow sensor
        │
        ▼
┌─────────────────────────────────┐
│ 3.3 V regulators ON each board  │
└───────┬─────────────────────────┘
        │
        └──▶ 3.3 V ──▶ LCD, HX711, LEDs (from the STM32 board's 3.3 V pin)
```

The ESP32 draws up to ~250 mA peaks on Wi-Fi transmit. Keep the 5 V rail at 3 A or more.

---

## 2. STM32 ↔ ESP32 Link

```text
   STM32                      ESP32 WROOM-32
 ┌──────────┐               ┌───────────────┐
 │ USART TX ├──────────────▶│ GPIO16 (RX2)  │
 │ USART RX │◀──────────────┤ GPIO17 (TX2)  │
 │      GND ├───────────────┤ GND           │
 └──────────┘               └───────────────┘
        115200 baud, 8N1, 3.3 V logic (no level shifter)
```

- Keep the 3 wires short (< 30 cm) and away from the pump wires.
- TX goes to RX. **Never connect TX to TX.**

---

## 3. Actuator Driver Circuit (Pump & Valves)

The pump and both valves are coils. They create a voltage spike when switched off.

**Every coil must have a flyback diode** (1N4007 or 1N5819) across its terminals: cathode to +12 V, anode to the MOSFET drain.

```text
               +12 V DC
                 │
                 ├───┬───────────────┐
                 │  ┌┴┐              │
                 │  │ │ Coil        ┌┴┐ Flyback diode
                 │  │ │ (pump/valve)│▲│ (1N4007)
                 │  └┬┘             └┬┘
                 │   └───┬───────────┘
                 │       │ Drain
STM32 GPIO ──[220Ω]──┤  IRLZ44N (logic-level N-MOSFET)
                 │   │   │ Source
              [10kΩ] │   │
                 │   │  GND
                GND ─┘
        (10 kΩ pull-down keeps the pump OFF during STM32 reset)
```

---

## 4. Sensor Wiring

### 4.1 Load Cell + HX711 (weight)
- Load cell → HX711: **Red** E+, **Black** E−, **White** A−, **Green** A+.
- HX711 logic side: VCC → **3.3 V**, GND → GND, DOUT and SCK → STM32 GPIO (TBD).
- Use shielded wire; keep it away from the pump power leads.

### 4.2 YF-S201 Flow Sensor (volume)
- **Red** → 5 V, **Black** → GND.
- **Yellow** (signal) → 4.7 kΩ pull-up to 5 V → divider (1 kΩ series, 2 kΩ to GND) → STM32 timer/EXTI pin. Alternatively, connect directly to a 5 V-tolerant pin with the pull-up.
- Transfer function: **F (Hz) = 7.5 × Q (L/min)**, about **450 pulses per litre** before calibration.

### 4.3 Float Switches (tank level)
- Each float: STM32 GPIO (internal pull-up) → switch → GND.
  - **High** (60 L full), **Mid** (30 L half), **Low** (5 L cut-off).
- Water below the float opens the switch, so the pin reads HIGH.

### 4.4 Buttons & LEDs
- Buttons: STM32 GPIO (pull-up) → button → GND (pressed = LOW).
- LEDs: STM32 GPIO → 220 Ω → LED → GND.

---

## 5. Grounding & Noise Rules
1. **Star ground:** the 12 V pump/valve return goes straight to the PSU ground terminal, separate from the logic/sensor ground. Both meet only at the PSU.
2. **HX711:** shielded cable, short, far from the pump motor.
3. **Decoupling:** 100 µF electrolytic + 0.1 µF ceramic near the 5 V input of each MCU board.
4. **Wi-Fi antenna:** keep the ESP32 antenna end away from the stainless steel walls (or use a board with an external antenna connector). A metal enclosure blocks Wi-Fi.
