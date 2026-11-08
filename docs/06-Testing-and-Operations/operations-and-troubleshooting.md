# Operations, Maintenance & Troubleshooting

> For operators and technicians. Machine status, alerts and refunds are on the **admin dashboard** (from Phase 7; before that, the backend developer checks them). Alerts arrive on **Telegram** (from Phase 5).

## 1. Tank Refill Procedure

1. **Alert:** the backend sends "Tank low" (Mid float) or "Tank empty" (Low float, machine locked).
2. **Open:** unlock the lower service door with the key.
3. **Sanitise:** wipe the refill inlet with a 70 % alcohol wipe.
4. **Fill:** connect the clean hose from the purified water source to the quick-connect inlet. Fill until the **High float** is reached (60 L).
5. **Close:** disconnect the hose, refit the dust cap, lock the door.
6. **Automatic recovery:** once the Low and Mid floats stay submerged for 5 s, the STM32 clears "Out of Service" by itself, the backend resolves the alert, and the machine returns to the Welcome screen.

---

## 2. Maintenance Schedule

| Interval | Component | Procedure |
|---|---|---|
| **Weekly** | Exterior & deck | Clean the stainless exterior; empty and clean the drip tray. |
| **Bi-weekly** | Nozzle & alcove | Sanitise the nozzle; check the aerator mesh for scale. |
| **Monthly** | Calibration | Dispense 1.0 L into a measuring cylinder. More than 15 mL off → recalibrate ([calibration guide](../03-Firmware-Control/calibration-guide.md)). |
| **Quarterly** | Pre-filter, tank | Rinse the 50-mesh pre-filter, check the O-ring; clean the tank via the inspection port. |
| **Annually** | Tubing & pump | Replace hard or discoloured tubing; replace the pump if flow < 2.5 L/min. |

---

## 3. Troubleshooting

### 3.1 Machine & hardware

| Symptom | Likely cause | What to do |
|---|---|---|
| **Screen dark** | Power problem | Check the AC plug and fuse. PSU output should be 12.0 V; buck output 5.0 V to both boards. |
| **"Out of Service: tank empty"** | Low float open | Refill the tank (§1). |
| **Won't dispense after payment ("Place your bottle" stays)** | Bottle not detected | Centre the bottle; empty bottles under 20 g aren't detected; check the HX711 wiring. After 60 s the machine gives up (`BOTTLE_TIMEOUT`) and the payment goes to refund review. |
| **Volume wrong** | Calibration or dirty flow sensor | Clean the YF-S201 rotor; recalibrate the scale and flow. Repeated "accuracy mismatch" alerts point to this. |
| **Pump runs, no water (`NO_FLOW`)** | Tank empty, pump lost prime, filter clogged | Check the water level, check-valve direction (arrow to nozzle), clean the pre-filter, prime the pump in maintenance mode. |
| **Stops mid-fill (`BOTTLE_REMOVED`)** | Bottle moved or tipped | Normal safety stop; the partial amount goes to refund review. |

### 3.2 Network & payment

| Symptom | Likely cause | What to do |
|---|---|---|
| **Screen shows "Offline"** | Wi-Fi down, broker unreachable, or ESP32 ↔ STM32 link broken | Check the site Wi-Fi (2.4 GHz). On the dashboard, is the machine offline? Power-cycle the machine. Check the 3 UART wires (TX→RX, RX→TX, GND). |
| **"Service unavailable" after pressing a button** | Backend or ABA not reachable | Check backend health; try again in a minute. Nobody was charged. |
| **Weak Wi-Fi (RSSI worse than −75 dBm in heartbeat)** | Metal enclosure blocks signal | Move the antenna or router; use an external-antenna ESP32 ([enclosure](../05-Mechanical-and-Plumbing/enclosure-and-tank.md)). |
| **Customer paid, no water** | Expired QR paid late, bottle timeout, fault | Find the payment on the dashboard (by time or `tran_id`). It's in the **refund queue**: claim it, refund via the ABA portal or cash, record the reference. |
| **Payment shows `DISPENSE_UNKNOWN`** | Machine was offline after payment | **Don't refund yet.** Wait for the machine to reconnect; it resends the saved result. After 24 h online with no result, the case moves to refund review. |
| **Machine offline alert** | Power cut or network | Visit the site if it doesn't recover within an hour. |

### 3.3 Fault codes (shown on screen and on the dashboard)

| Code | Meaning |
|---|---|
| `TANK_EMPTY` / `TANK_LOW` | Refill the tank |
| `NO_FLOW` | Pump on but no water |
| `OVERFLOW` | Filled more than target + 10 %, so it stopped |
| `BOTTLE_REMOVED` / `BOTTLE_TIMEOUT` | Customer action, safe stop |
| `DISPENSE_TIMEOUT` | Fill took over 60 s |
| `LOADCELL_FAULT` / `FLOW_SENSOR_FAULT` | Check sensor wiring, then recalibrate |
| `VALVE_FAULT` / `PUMP_FAULT` | Check the driver board, diode and coil |
| `POWER_LOSS_RECOVERY` | Power was cut during a fill |

Full list: Implementation Plan §C8.
