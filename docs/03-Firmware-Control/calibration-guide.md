# Sensor Calibration Guide

## 1. Overview

Accurate dual-check dispensing requires calibrating two independent analog-to-digital measurement systems:
1. **Load Cell (HX711)**: Measures bottle weight in grams ($1\text{ ml of pure water} \approx 1.00\text{ gram}$).
2. **Flow Sensor (YF-S201)**: Measures volume by counting Hall-effect rotor pulses.

Both calibration factors are saved to the ESP32-S3 Non-Volatile Storage (NVS) and persist across power cycles.

---

## 2. Load Cell Calibration (HX711)

### Equipment Needed
- A certified calibration weight (e.g., $500\text{g}$ or $1000\text{g}$) or a sealed $500\text{ml}$ bottle of water.

### Calibration Procedure
1. **Zero Point (Tare)**:
   - Ensure the bottle platform on top of the load cell is empty and clean.
   - Run the firmware in Calibration Mode (`CALIB_MODE=1`).
   - The ESP32 takes 20 consecutive readings from the HX711 and calculates the baseline offset:
     $$\text{Offset} = \frac{1}{20} \sum_{i=1}^{20} \text{raw\_reading}_i$$
2. **Known Weight Measurement**:
   - Place the known weight (e.g., $500.0\text{g}$) steadily in the center of the platform.
   - The ESP32 reads 20 samples with the weight applied.
   - The calibration scale factor is computed as:
     $$\text{Calibration Factor} = \frac{\text{raw\_reading}_{\text{loaded}} - \text{Offset}}{\text{Known Weight in Grams}}$$
3. **Save to NVS**:
   - Press the touchscreen "Save" button to write `hx711_offset` and `hx711_scale` to flash memory.
4. **Verification**:
   - Remove and replace the weight 3 times. Verified reading must be within $\pm 2\text{ grams}$.

---

## 3. Flow Sensor Calibration (YF-S201)

### Equipment Needed
- A precision graduated cylinder ($1000\text{ml}$ capacity) or an empty bottle placed on the already-calibrated weight scale.

### Theoretical Baseline
The manufacturer nominal formula for YF-S201 is:
$$F = 7.5 \times Q \quad (\text{Hz and L/min})$$
$$\text{Pulses per Liter} \approx 450 \text{ pulses/Liter} \quad (0.45 \text{ pulses/ml})$$

### Empirical Calibration Procedure
1. Clear the pulse counter: `pulse_count = 0`.
2. Open the Fast Solenoid Valve and run the pump until the graduated cylinder reads exactly $1000\text{ ml}$ (or until the scale reads $+1000\text{ g}$).
3. Record the recorded pulse count $P_{\text{actual}}$.
4. Calculate the empirical pulse factor:
   $$K_{\text{flow}} = \frac{P_{\text{actual}}}{1000\text{ ml}}$$
   *(Typical calibrated value ranges between $0.435$ and $0.465\text{ pulses/ml}$ depending on supply tube diameter and water head).*
5. Repeat the test at low speed through the **Slow Solenoid Valve** to determine $K_{\text{slow}}$ if fine-trim calibration is desired.
6. Write $K_{\text{flow}}$ to ESP32 NVS.

---

## 4. Routine Field Recalibration Schedule
- **Monthly**: Quick check by dispensing a 1.0L cycle into a graduated cylinder. If deviation $> 15\text{ml}$, trigger automated recalibration wizard via the admin maintenance menu.

