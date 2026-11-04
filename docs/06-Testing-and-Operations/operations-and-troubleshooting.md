# Operations, Maintenance & Troubleshooting

## 1. Tank Refill Standard Operating Procedure (SOP)

1. **Safety First**: Unlock the lower service door using the operator physical key.
2. **Sanitize Hands & Inlet**: Wipe the tank refill port with food-grade alcohol wipe ($70\%$ isopropyl / ethanol).
3. **Connect Clean Supply**: Attach sanitized refill hose from bulk purified water source to the quick-connect refill port.
4. **Monitor Level Indicator**:
   - As water enters, observe the status LEDs or technician display screen.
   - When the **High Float Switch** trips ($60\text{ Liters}$), an audible beep will sound and the pump fill cutoff indicator will turn solid green.
5. **Secure & Seal**: Disconnect the hose, securely fasten the dust cap on the inlet port, and relock the stainless steel cabinet door.
6. **Reset Status**: Touch "Refill Completed" on the technician UI screen to clear any low-water warnings in the cloud database.

---

## 2. Routine Maintenance Schedule

| Interval | Component | Maintenance Procedure |
|---|---|---|
| **Weekly** | Exterior & Deck | Wipe stainless steel exterior with food-grade stainless cleaner. Empty and clean the drip tray. |
| **Bi-Weekly** | Nozzle & Alcove | Sanitize dispense nozzle with food-safe sanitizing solution. Inspect aerator mesh for scale build-up. |
| **Monthly** | Sensor Calibration | Run a test 1.0L dispense into a graduated cylinder. If deviation $> 15\text{ ml}$, run the calibration routine. |
| **Quarterly** | Inline Pre-Filter | Unscrew 50-mesh stainless pre-filter, rinse sediment, and inspect O-ring seal. |
| **Annually** | Tubing & Diaphragm | Inspect internal silicone tubes for discoloration/hardening. Replace diaphragm pump if flow drops $< 2.5\text{ L/min}$. |

---

## 3. Field Troubleshooting Guide

| Symptom / Error | Probable Cause | Diagnostic & Resolution Steps |
|---|---|---|
| **TFT screen stays dark** | Power supply failure or disconnected 5V cable | 1. Check AC mains input plug.<br>2. Measure PSU output with DMM (should be $+12.0\text{V}$).<br>3. Verify LM2596 buck converter outputs $+5.0\text{V}$ to ESP32 board. |
| **Red LED on / Won't dispense** | Bottle not detected by load cell | 1. Ensure bottle is centered on the platform.<br>2. Check HX711 wiring (GPIO 17/18).<br>3. Check if empty bottle weight is $< 20\text{g}$ threshold. |
| **Water volume is inaccurate** | Flow sensor or load cell out of calibration | 1. Inspect YF-S201 rotor for debris or limescale.<br>2. Recalibrate HX711 scale factor using a certified weight.<br>3. Verify supply tube is not kinked or restricted. |
| **Pump runs but no water flows** | Tank empty or pump lost prime | 1. Verify water level inside 60L tank ($> 5\text{L}$).<br>2. Inspect check valve orientation (arrow must point towards nozzle).<br>3. Check if pre-filter is clogged with sediment. |
| **4G Cellular disconnected** | SIM card expired or antenna detached | 1. Verify SIM card has active data package.<br>2. Check SMA antenna connection on SIM7600 module.<br>3. Check SIM7600 NETLIGHT status LED (blinking every 3s = registered to 4G). |
| **Payment not confirming** | Webhook network delay or gateway timeout | 1. Check cellular signal RSSI on diagnostic screen.<br>2. Confirm customer banking transaction succeeded.<br>3. If persistent, reboot ESP32 via rear service button. |

