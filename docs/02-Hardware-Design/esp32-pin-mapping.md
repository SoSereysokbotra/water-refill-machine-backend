# Pin Mapping (STM32 + ESP32)

> 📝 **Draft for the hardware developer to confirm.** All sensors, the LCD, the buttons, the pump and the valves connect to the **STM32**. The **ESP32 only uses UART2** to talk to the STM32. STM32 pin numbers are **TBD** until the board model is chosen.
>
> *The filename stays `esp32-pin-mapping.md` so existing links keep working.*

## 1. ESP32 WROOM-32 (Gateway): Final

| Function | ESP32 pin | Connects to | Notes |
|---|---|---|---|
| UART2 TX | **GPIO17** | STM32 USART RX | ESP32 → STM32 |
| UART2 RX | **GPIO16** | STM32 USART TX | STM32 → ESP32 |
| Ground | **GND** | STM32 GND | **Common ground required** |
| USB | Micro-USB | PC | Flashing + serial monitor (test menu) |
| Power | 5V / VIN | 5 V rail | Or USB during development |

UART settings: **115200 baud, 8N1**, one text line per message ending with `\n` (Implementation Plan §C3). Both boards use 3.3 V logic, so no level shifter is needed.

---

## 2. STM32 (Machine Controller): Signals to Assign

The hardware developer fills in the **STM32 pin** column after choosing the board.

| Group | Peripheral | Signal | STM32 pin | Type needed | Notes |
|---|---|---|---|---|---|
| **ESP32 link** | USART (e.g. USART2) | TX → ESP32 GPIO16 | TBD | USART TX | 115200 8N1 |
| | | RX ← ESP32 GPIO17 | TBD | USART RX | Use interrupt/DMA; line buffer ≥ 512 bytes (QR line ~300 chars) |
| **Display (SPI)** | ILI9341 TFT | SCK | TBD | SPI SCK | |
| | | MOSI | TBD | SPI MOSI | |
| | | MISO | TBD | SPI MISO | Only if reading the display/touch |
| | | CS | TBD | GPIO out | Active LOW |
| | | DC | TBD | GPIO out | LOW = command, HIGH = data |
| | | RST | TBD | GPIO out | Active LOW |
| | | Backlight | TBD | PWM / GPIO | |
| **Touch (optional)** | XPT2046 | T_CS, T_IRQ | TBD | GPIO | Only if touch is used instead of buttons |
| **Buttons** | Push buttons | BTN_500, BTN_750, BTN_1000, BTN_CANCEL | TBD | GPIO in, pull-up | Debounce in firmware |
| **Weight** | HX711 | DOUT | TBD | GPIO in | |
| | | SCK | TBD | GPIO out | |
| **Flow** | YF-S201 | FLOW_PULSE | TBD | **Timer input capture or EXTI** | 5 V signal: use divider or a 5 V-tolerant (FT) pin |
| **Tank level** | Float switches | FLOAT_HIGH, FLOAT_MID, FLOAT_LOW | TBD | GPIO in, pull-up | LOW when submerged |
| **Actuators** | MOSFET drivers | PUMP, VALVE_FAST, VALVE_SLOW | TBD | GPIO out | Active HIGH; **must default LOW at reset** (pump off, valves closed) |
| **Indicators** | LEDs, buzzer | LED_RED, LED_GREEN, BUZZER | TBD | GPIO out / PWM | 220 Ω on LEDs |
| **Debug** | SWD + optional UART | SWDIO, SWCLK | Fixed by board | | For Keil flashing/debug |

---

## 3. Design Rules
1. **Safe at reset:** pump and valve pins must be LOW (off) during reset and boot. Add pull-down resistors on the MOSFET gates.
2. **Flow sensor voltage:** the YF-S201 runs on 5 V. Feed its signal through a 1 kΩ / 2 kΩ divider, or use a 5 V-tolerant STM32 pin.
3. **Flow counting:** use a timer input capture or an external interrupt so no pulses are lost while the LCD is drawing.
4. **UART receive:** use an interrupt or DMA with a ring buffer. A QR line is about 300 characters.
5. **Common ground:** STM32, ESP32, sensors and the 12 V driver ground meet at one point (see [circuit-and-wiring.md](circuit-and-wiring.md)).
