# Sensor Calibration Guide (STM32)

> Calibration runs on the **STM32** in maintenance mode. The values are saved in the STM32's internal flash (EEPROM emulation) and survive power cycles.

## 1. Overview

Dual-check dispensing needs two calibrated sensors:
1. **Load cell (HX711):** weight in grams (1 mL of water ≈ 1.00 g).
2. **Flow sensor (YF-S201):** volume from counting rotor pulses.

| Value | Saved as | Used for |
|---|---|---|
| Scale offset | `hx711_offset` | Zero point of the empty platform |
| Scale factor | `hx711_scale` | Raw counts → grams |
| Flow factor | `k_flow` (pulses per mL) | Pulses → mL |
| Slow-valve factor (optional) | `k_slow` | Better accuracy in stage 2 |

---

## 2. Load Cell Calibration (HX711)

**Equipment:** a known weight (500 g or 1000 g) or a sealed 500 mL water bottle.

1. **Zero (tare)**
   - Platform empty and clean.
   - Maintenance mode → *Calibrate scale*.
   - The STM32 averages 20 readings: **Offset = average of 20 raw readings**.
2. **Known weight**
   - Place the weight in the centre of the platform.
   - The STM32 averages 20 readings: **Scale factor = (loaded reading − Offset) ÷ known grams**.
3. **Save:** press *Save* (button), and the values are written to flash.
4. **Check:** remove and replace the weight 3 times. Each reading must be within **±2 g**.

---

## 3. Flow Sensor Calibration (YF-S201)

**Equipment:** a 1000 mL measuring cylinder, or an empty bottle on the already-calibrated scale.

**Starting value:** F (Hz) = 7.5 × Q (L/min) → about **450 pulses per litre** (0.45 pulses/mL).

1. Maintenance mode → *Calibrate flow* (pulse counter resets to 0).
2. Run pump + fast valve until the cylinder reads exactly **1000 mL** (or the scale shows +1000 g).
3. Note the pulse count **P**.
4. **k_flow = P ÷ 1000** (usually 0.435–0.465 pulses/mL, depending on tubing and water level).
5. Optional: repeat through the **slow valve only** to get `k_slow`.
6. Press *Save*.

---

## 4. Field Check Schedule
- **Monthly:** dispense 1.0 L into a measuring cylinder. If it's off by more than **15 mL**, recalibrate.
- **Also recalibrate:** after replacing the flow sensor, load cell, pump or tubing.
- **Hint from the backend:** repeated `AccuracyMismatch` alerts (flow vs weight differ by more than 5 %) mean one of the sensors needs calibration.
