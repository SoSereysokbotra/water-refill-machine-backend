# Bill of Materials (BOM)

> 📝 **Draft for the hardware developer to confirm.** Items marked **TBD** (STM32 board model, prices) must be filled in by the hardware developer.

## 1. Component List (one machine)

| # | Component | Model / Specs | Purpose | Qty | Est. Unit Price (USD) | Total (USD) | Supplier |
|---|---|---|---|---|---|---|---|
| **1** | Machine controller | **STM32 board**, model **TBD** (needs: 1 SPI, 2 UART, timer input, ~15 GPIO, flash for settings) | Screens, sensors, pump, valves, safety | 1 | TBD | TBD | TBD |
| **2** | Network gateway | **ESP32 WROOM-32 DevKit** (4 MB flash) | Wi-Fi + MQTT to the cloud, UART bridge | 1 | $5.00 | $5.00 | Espressif / AliExpress |
| **3** | Display | **2.8" SPI TFT LCD (ILI9341)** (touch XPT2046 optional) | Customer screens and KHQR | 1 | $12.00 | $12.00 | Waveshare / AliExpress |
| **4** | Buttons | Panel-mount push buttons (500 / 750 / 1000 mL + Cancel) | Volume selection | 4 | $0.80 | $3.20 | Generic |
| **5** | Flow sensor | **YF-S201** Hall effect (1/2", 1–30 L/min) | Volume measurement | 1 | $3.50 | $3.50 | Generic industrial |
| **6** | Weight sensor | **5 kg load cell** + **HX711 24-bit ADC** | Bottle detection, tare, weight check | 1 | $5.00 | $5.00 | SparkFun / generic |
| **7** | Water pump | **12 V DC diaphragm pump** (3–4 L/min, 35 W) | Pushes water to the nozzle | 1 | $9.50 | $9.50 | Generic marine/RV |
| **8** | Fast valve | **12 V DC normally-closed solenoid** (1/2", high flow) | Bulk fill (to 90 %) | 1 | $6.50 | $6.50 | Generic |
| **9** | Slow valve | **12 V DC normally-closed solenoid** (1/4" or restricted) | Precise finish (90–100 %) | 1 | $6.50 | $6.50 | Generic |
| **10** | Tank level | **Triple float switch** (High / Mid / Low) | 60 L tank level | 1 | $4.00 | $4.00 | Generic industrial |
| **11** | Indicators | Red / Green panel LEDs (12 mm) + piezo buzzer | Status and sounds | 1 set | $2.00 | $2.00 | Generic |
| **12** | Power supply | **Mean Well LRS-100-12** (12 V, 8.5 A) | AC → 12 V | 1 | $14.00 | $14.00 | Mean Well / Mouser |
| **13** | Driver board | Logic-level MOSFET driver (IRLZ44N) ×3, or opto relay module | Switch 12 V pump and valves | 1 | $4.50 | $4.50 | Generic |
| **14** | Plumbing | Food-grade 1/2" silicone/PE tubing, fittings, check valve, pre-filter | Tank → pump → valves → nozzle | 1 set | $16.00 | $16.00 | Local plumbing |
| **15** | Enclosure | **304 stainless steel cabinet** (lock, drip tray) | Hygienic body | 1 | $85.00 | $85.00 | Local fabricator |
| **Total** | | | | | | **~$177 + STM32 board** | *(prototype)* |

Removed from the old design: **ESP32-S3** (replaced by STM32 + ESP32 WROOM-32) and **SIM7600 4G module** (the pilot uses Wi-Fi).

**Optional, later:** a 4G module (SIM7600 / A7670) on the ESP32 for sites without Wi-Fi, about $20–26.

---

## 2. Supporting Parts
- DC-DC buck converter, 12 V → 5 V, 3 A (LM2596), for both MCU boards and the flow sensor.
- Fuse holder + 5 A fast-blow fuse on the 12 V rail.
- Flyback diodes (1N4007 / 1N5819) for the pump and both valves.
- Resistors for the flow-sensor signal divider (1 kΩ / 2 kΩ) and pull-up (4.7 kΩ).
- 3 short wires for STM32 ↔ ESP32 UART (TX, RX, GND).
- M3/M4 stainless screws, standoffs, nylon washers; PG7/PG9 cable glands.
