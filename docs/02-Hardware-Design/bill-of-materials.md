# Bill of Materials (BOM)

## 1. Raw Materials & Component List

The table below lists all 14 core components required to build one complete unit of the IoT Water Refill Vending Machine:

| Item # | Component | Model / Specs | Purpose | Qty | Est. Unit Price (USD) | Total (USD) | Recommended Supplier |
|---|---|---|---|---|---|---|---|
| **1** | Main Microcontroller | **ESP32-S3 DevKitC-1** (N8R8, 8MB Flash / 8MB PSRAM) | System brain, UI control, sensing, logic | 1 | $8.50 | $8.50 | Espressif / Digikey |
| **2** | Display & Touchscreen | **2.8" SPI TFT LCD (ILI9341)** + Touch (XPT2046) | Customer UI, volume selection & progress | 1 | $12.00 | $12.00 | Waveshare / AliExpress |
| **3** | Cellular Module | **SIMCom SIM7600E / SIM7600G** 4G LTE Breakout | Network connectivity, payment & telemetry | 1 | $26.00 | $26.00 | SIMCom / Waveshare |
| **4** | Flow Sensor | **YF-S201** Hall Effect (1/2" Male Thread, 1–30 L/min) | In-line volumetric flow measurement | 1 | $3.50 | $3.50 | Generic Industrial |
| **5** | Weight Sensor & ADC | **5kg Load Cell Bar** + **HX711 24-bit ADC Module** | Bottle detection, tare, and final weight check | 1 | $5.00 | $5.00 | SparkFun / Generic |
| **6** | Water Pump | **12V DC Diaphragm Pump** (3–4 L/min, 0.48 MPa, 35W) | Draws water from tank to nozzle | 1 | $9.50 | $9.50 | Generic Marine/RV |
| **7** | Solenoid Valve (Fast) | **12V DC Normally Closed Solenoid** (1/2", high flow) | Primary bulk water flow control (~90% target) | 1 | $6.50 | $6.50 | Generic Automation |
| **8** | Solenoid Valve (Slow) | **12V DC Normally Closed Solenoid** (1/4" or restricted) | Precision finish flow control (~10% topping) | 1 | $6.50 | $6.50 | Generic Automation |
| **9** | Tank Level Sensor | **Triple Float Switch Assembly** (High, Mid, Low) | 60L reservoir level detection | 1 | $4.00 | $4.00 | Generic Industrial |
| **10** | Status Indicators | **Dual LED Indicators** (Red / Green, panel mount, 12mm) | Bottle placement & machine status signaling | 2 | $0.75 | $1.50 | Generic Electronics |
| **11** | Power Supply Unit | **Mean Well LRS-100-12** (12V DC, 8.5A, 100W) | Main AC mains to 12V DC conversion | 1 | $14.00 | $14.00 | Mean Well / Mouser |
| **12** | Driver Board | **4-Channel Relay Module / Optocoupled MOSFET Driver** | Safe 12V power switching for pump & valves | 1 | $4.50 | $4.50 | Generic Electronics |
| **13** | Plumbing & Fittings | Food-Grade 1/2" PE/Silicone tubing, quick-connects, check valve | Fluid piping from tank to dispense nozzle | 1 set | $16.00 | $16.00 | Local Plumbing Supply |
| **14** | Enclosure | **Custom 304 Stainless Steel Cabinet** (with lock & drip tray) | Weather-resistant, hygienic body | 1 | $85.00 | $85.00 | Local Sheet Metal Fabricator |
| **Total** | | | | | | **~$198.00** | *(Per prototype unit)* |

---

## 2. Supporting Consumables & Fasteners
- DC-DC Step-Down Buck Converter (12V to 5V, 3A) for ESP32 and logic peripherals.
- Fuse holder & 5A fast-blow inline fuse on the 12V rail.
- M3/M4 stainless steel screws, standoffs, and nylon washers for mounting PCB boards.
- Cable glands (PG7 / PG9) for liquid-tight wire pass-throughs between compartments.

