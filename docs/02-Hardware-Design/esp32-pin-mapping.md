# ESP32-S3 GPIO Pin Mapping

## 1. GPIO Allocation Matrix

The **ESP32-S3** provides 45 physical GPIO pins. The pin assignments below avoid internal boot strapping pins (GPIO 0, 45, 46) and dedicate hardware buses for high-speed SPI display rendering and responsive interrupt-driven flow counting.

| Function Group | Peripheral | Signal Name | ESP32-S3 GPIO | Electrical Level | Notes |
|---|---|---|---|---|---|
| **Display (SPI)** | 2.8" ILI9341 TFT | SCK (Clock) | **GPIO 12** | 3.3V Logic | Shared Hardware SPI2 (FSPI) |
| | | MOSI (Data) | **GPIO 11** | 3.3V Logic | Shared Hardware SPI2 |
| | | MISO (Data In) | **GPIO 13** | 3.3V Logic | Shared Hardware SPI2 |
| | | TFT_CS (Chip Select) | **GPIO 10** | 3.3V Logic | Active LOW |
| | | TFT_DC (Data/Cmd) | **GPIO 9** | 3.3V Logic | LOW = Cmd, HIGH = Data |
| | | TFT_RST (Reset) | **GPIO 46** | 3.3V Logic | Active LOW (or tie to EN) |
| | | TFT_BL (Backlight) | **GPIO 48** | 3.3V PWM | PWM dimming support |
| **Touch Controller** | XPT2046 Resistive | T_CS (Touch Select) | **GPIO 14** | 3.3V Logic | Active LOW |
| | | T_IRQ (Touch Interrupt)| **GPIO 21** | 3.3V Logic | Falling-edge interrupt |
| **Weight Sensor** | HX711 24-bit ADC | DOUT (Data) | **GPIO 17** | 3.3V Logic | Input |
| | | SCK (Clock) | **GPIO 18** | 3.3V Logic | 24–27 clock pulse output |
| **Flow Sensor** | YF-S201 Hall Effect| FLOW_PULSE | **GPIO 4** | 3.3V Logic | Hardware interrupt (rising edge) |
| **Cellular (UART)** | SIM7600 4G LTE | TX (ESP32 $\rightarrow$ SIM)| **GPIO 43** | 3.3V Logic | Hardware UART1 (115200 baud) |
| | | RX (SIM $\rightarrow$ ESP32)| **GPIO 44** | 3.3V Logic | Hardware UART1 |
| | | SIM_PWRKEY | **GPIO 47** | 3.3V Logic | Pulse LOW 1.5s to toggle power |
| **Tank Level** | Triple Float Switch | FLOAT_HIGH | **GPIO 35** | 3.3V Logic | Internal pull-up, LOW when submerged |
| | | FLOAT_MID | **GPIO 36** | 3.3V Logic | Internal pull-up, LOW when submerged |
| | | FLOAT_LOW | **GPIO 37** | 3.3V Logic | Internal pull-up, LOW when submerged |
| **Actuation** | Relay / MOSFET 1 | PUMP_RELAY | **GPIO 5** | 3.3V $\rightarrow$ 12V Driver | Active HIGH: Energizes 12V water pump |
| | Relay / MOSFET 2 | VALVE_FAST | **GPIO 6** | 3.3V $\rightarrow$ 12V Driver | Active HIGH: Opens fast solenoid valve |
| | Relay / MOSFET 3 | VALVE_SLOW | **GPIO 7** | 3.3V $\rightarrow$ 12V Driver | Active HIGH: Opens slow solenoid valve |
| **Status LEDs** | Front Panel LEDs | LED_RED | **GPIO 1** | 3.3V (20mA via $220\Omega$)| HIGH = Waiting / Fault / No Bottle |
| | | LED_GREEN | **GPIO 2** | 3.3V (20mA via $220\Omega$)| HIGH = Bottle Ready / Dispensing |

---

## 2. Design Rules & Pin Constraints
1. **Flow Sensor Voltage**: The YF-S201 operates at 5V. Its signal line requires a resistive voltage divider ($1\text{k}\Omega / 2\text{k}\Omega$) or logic-level shifter before entering **GPIO 4** to prevent 5V overvoltage on the ESP32.
2. **Strapping Pins**: Avoid using GPIO 0 for runtime inputs (it pulls to boot mode during reset).
3. **Internal Pull-Ups**: Pins GPIO 35, 36, and 37 utilize the ESP32 internal pull-up resistors for the mechanical float switches.

