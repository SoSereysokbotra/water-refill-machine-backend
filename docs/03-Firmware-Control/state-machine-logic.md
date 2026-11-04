# State Machine & Dispensing Logic

## 1. System State Machine

The firmware runs a deterministic Finite State Machine (FSM) implemented in FreeRTOS to manage all user interactions and machine safety:

```text
 ┌──────────────┐
 │     IDLE     │◀──────────────────────────────────────────────────┐
 └──────┬───────┘                                                   │
        │ Customer touches screen or scans QR                       │
        ▼                                                           │
 ┌──────────────┐                                                   │
 │ PAYMENT_WAIT │──(Timeout 90s / Cancel)──▶ [ Show Timeout ]───────┤
 └──────┬───────┘                                                   │
        │ Payment Confirmed (Webhook / Polling)                     │
        ▼                                                           │
 ┌──────────────┐                                                   │
 │ VOLUME_SELECT│──(User chooses 0.5L, 0.75L, or 1.0L)              │
 └──────┬───────┘                                                   │
        ▼                                                           │
 ┌──────────────┐                                                   │
 │ BOTTLE_CHECK │◀──(Weight < 20g: Prompt placement / Red LED ON)   │
 └──────┬───────┘                                                   │
        │ Bottle Detected (Weight >= 20g) & Tare Recorded           │
        ▼                                                           │
 ┌──────────────┐                                                   │
 │  DISPENSING  │──(Tank Empty or Bottle Removed)──▶ [ E-STOP / ALARM ]
 └──────┬───────┘                                                   │
        │ 90% reached: Fast Valve OFF                               │
        │ 100% reached: Slow Valve OFF + Pump OFF                   │
        ▼                                                           │
 ┌──────────────┐                                                   │
 │ DUAL_VERIFY  │──(Error > 5%: Log mismatch warning)               │
 └──────┬───────┘                                                   │
        │ Done (Success Screen + Green LED Blink)                   │
        ▼                                                           │
 ┌──────────────┐                                                   │
 │  REPORTING   │──(Send telemetry via SIM7600)─────────────────────┘
 └──────────────┘
```

---

## 2. Two-Stage Dispensing Algorithm

To combine **rapid dispensing speed** with **milliliter-level precision**, the system uses a coordinated two-stage valve actuation strategy:

### Stage 1: Bulk Fast Fill (0% to 90% Target)
- **Actuators**: Pump = `ON`, Fast Solenoid = `OPEN`, Slow Solenoid = `OPEN`.
- **Flow Rate**: ~3.2 L/min.
- **Duration**: Fills the bottle rapidly up to $90\%$ of the selected target volume (e.g., $450\text{ ml}$ for a $0.5\text{L}$ bottle).
- **Monitoring**: Real-time interrupt pulse counter on YF-S201.

### Stage 2: Precision Slow Finish (90% to 100% Target)
- **Transition**: When $V_{\text{current}} \ge 0.90 \times V_{\text{target}}$, the **Fast Solenoid Valve closes immediately**.
- **Actuators**: Pump = `ON` (or reduced duty cycle), Slow Solenoid = `OPEN`.
- **Flow Rate**: ~0.8 L/min.
- **Benefit**: Eliminates dynamic fluid head pressure, reduces splash, and eliminates over-dispensing inertia.
- **Cutoff**: As soon as target volume or target weight is reached:
  $$\text{Target Reached} \iff V_{\text{flow}} \ge V_{\text{target}} \quad\text{OR}\quad \Delta W_{\text{bottle}} \ge W_{\text{target}}$$
  Both valves immediately snap shut and the pump is de-energized.

---

## 3. Dual-Check Sensor Cross-Verification

The machine does not rely on a single sensor. It cross-validates volumetric flow against gravimetric weight:

$$\text{Dual-Check Rule:}\quad \left| V_{\text{dispensed}} (\text{ml}) - \Delta W_{\text{dispensed}} (\text{grams}) \right| \le \text{Threshold} \; (25\text{ ml/g})$$

1. **At Start of Dispense**:
   - Record initial bottle tare weight $W_0$.
   - Reset flow interrupt pulse counter $P = 0$.
2. **During Dispense**:
   - In-flight volume $V = \frac{P}{K_{\text{flow}}}$.
   - In-flight weight gain $\Delta W = W_{\text{current}} - W_0$.
   - **Anti-Spill Safety Guard**: If during dispensing $\Delta W < 0.2 \times V$ (meaning water is flowing through the nozzle, but not accumulating on the scale), the machine triggers an **Emergency Overflow Stop** within 2 seconds (bottle tipped over or moved).
3. **At End of Dispense**:
   - Compare final $V_{\text{final}}$ and $\Delta W_{\text{final}}$.
   - If within $\pm 3\%$, mark transaction as **Verified Success**.
   - If discrepancy $> 5\%$, log a warning flag (`SENSOR_DRIFT_ALERT`) and notify the operator via 4G telemetry.

---

## 4. Safety Interlocks & Cutoffs

| Safety Condition | Trigger | Machine Action |
|---|---|---|
| **Dry-Run / Empty Tank** | Low float switch opens (water $< 5\text{L}$) | Immediately lock dispensing, show "Out of Water" on TFT, send alert to cloud. |
| **Bottle Removal During Fill** | Load cell reading drops below $W_0 + 10\text{g}$ | Shut both valves in $< 50\text{ms}$, stop pump, display "Bottle Removed Error". |
| **Dispense Timeout Guard** | Fill time exceeds 45s for 0.5L or 90s for 1.0L | Hard timeout cutoff to prevent flood even if sensors fail. |
| **Over-weight Guard** | Weight exceeds $1.15 \times \text{Target Weight}$ | Immediate hardware cut-off. |

