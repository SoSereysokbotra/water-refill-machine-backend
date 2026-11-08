# State Machine & Dispensing Logic (STM32)

> 📝 **Draft for the hardware developer to confirm.** This is the **STM32** state machine. The payment states on the backend are in Implementation Plan **§C1**; UART messages are in **§C3**; fault codes are in **§C8**.

## 1. STM32 State Machine

The state names match the `PONG,<state>,…` field in §C3, so the ESP32 and the backend always know what the machine is doing.

```text
 ┌──────────────┐  power on / self-check OK
 │     IDLE     │◀──────────────────────────────────────────────────────┐
 │ Welcome +    │                                                       │
 │ prices       │── NET,DOWN / no PING 15 s ──▶ show "Offline" (stay)   │
 └──────┬───────┘── tank LOW float open ──────▶ ERROR (TANK_EMPTY)      │
        │ button 500 / 750 / 1000                                       │
        │ send REQ_PAY,<ml>                                             │
        ▼                                                               │
 ┌──────────────┐── Cancel → send CANCEL ─────────────────────────────▶ │
 │   WAIT_QR    │── FAILED,0 (service unavailable) ──────────────────▶ │
 └──────┬───────┘                                                       │
        │ QR,<tran_id>,<amount>,<cur>,<sec>,<qr_text>                   │
        ▼                                                               │
 ┌──────────────┐── Cancel → send CANCEL,<tran_id> ──────────────────▶ │
 │      QR      │── EXPIRED / FAILED / CANCELLED,<tran_id> ───────────▶ │
 │ KHQR + timer │                                                       │
 └──────┬───────┘                                                       │
        │ PAID,<tran_id>  (tran_id == QR shown?)                        │
        │   yes → send PAID,ACK,<tran_id>                               │
        │   no  → send PAID,REJECT,<tran_id>,PAID_NOT_ACCEPTED          │
        ▼                                                               │
 ┌──────────────┐── no bottle in 60 s ──▶ PARTIAL,<id>,0,0,BOTTLE_TIMEOUT ┤
 │ WAIT_BOTTLE  │                                                       │
 └──────┬───────┘                                                       │
        │ weight > 20 g and stable → tare                               │
        ▼                                                               │
 ┌──────────────┐── bottle removed / tank empty / sensor fault / 60 s ─▶ │
 │  DISPENSING  │      stop → PARTIAL,<id>,<flow>,<weight>,<fault>      │
 │ fast → slow  │                                                       │
 └──────┬───────┘                                                       │
        │ target reached → stop → dual-check                            │
        │ send DONE,<tran_id>,<flow_ml>,<weight_g>                      │
        ▼                                                               │
 [ "Thank you" 5 s ] ── result kept in flash, resent every 2 s until ACK,<tran_id> ┘

 ┌──────────────┐
 │    ERROR     │  Out of Service (tank empty, pump/valve/sensor fault).
 │              │  Sends ERR,<fault>. Returns to IDLE when the fault clears
 └──────────────┘  (e.g. tank refilled: Low + Mid floats submerged ≥ 5 s).
```

**Maintenance mode** (PIN, from IDLE only) is outside the customer flow. See §5.

---

## 2. Two-Stage Dispensing

### Stage 1: Fast fill (0 % → 90 % of target)
- Pump **ON**, fast valve **OPEN**, slow valve **OPEN** (about 3.2 L/min).
- Volume from the flow-sensor pulse counter.

### Stage 2: Slow finish (90 % → 100 %)
- At **90 %**: fast valve **closes**; pump stays on, slow valve open (about 0.8 L/min).
- Less splash, no overshoot.
- **Stop** when **flow volume ≥ target** OR **weight gain ≥ target grams** (1 mL water ≈ 1 g): close both valves, pump off.

---

## 3. Dual-Check (Flow vs Weight)

1. **Start:** record bottle tare weight W₀; reset pulse counter.
2. **During:** volume V = pulses ÷ K_flow; weight gain ΔW = W − W₀.
   - **Anti-spill:** if water is flowing but the weight isn't rising (ΔW < 20 % of V after the first 50 mL), the bottle is tipped or missing. Stop within 2 s and report `BOTTLE_REMOVED`.
3. **End:** send both values in `DONE,<tran_id>,<flow_ml>,<weight_g>`.
   - The backend flags a **mismatch above 5 %** (AccuracyMismatch alert), and the operator checks calibration.
   - The STM32 doesn't need to decide this.

---

## 4. Safety Rules (non-negotiable, Implementation Plan §C3)

The STM32 applies these **by itself**. It never waits for the ESP32 or the internet.

| # | Condition | Action | Report |
|---|---|---|---|
| 1 | Target reached, bottle removed, sensor fault, tank empty, or **dispense time > 60 s** | Pump off, both valves closed **immediately** | `DONE` or `PARTIAL,…,<fault>` |
| 2 | No bottle **60 s** after `PAID,ACK` | Back to IDLE | `PARTIAL,<tran_id>,0,0,BOTTLE_TIMEOUT` |
| 3 | `PAID,<tran_id>` doesn't match the QR shown, or was already used | Don't dispense | `PAID,REJECT,<tran_id>,PAID_NOT_ACCEPTED` (same `tran_id` already accepted → answer `PAID,ACK` again) |
| 4 | Any result (`DONE`/`PARTIAL`/`ERR` with `tran_id`) | Save in flash; resend every 2 s until `ACK,<tran_id>`, **also after reboot** | — |
| 5 | No `PING` for 15 s | Idle: show "Offline". Dispensing: finish or stop by rule 1, report when the link returns | — |

Extra hardware limits:

| Condition | Action | Fault code |
|---|---|---|
| Low float open (< 5 L) | Never start the pump; Out of Service | `TANK_EMPTY` |
| Mid float open (< 30 L) | Keep selling; warn | `TANK_LOW` (in `PONG` tank field) |
| Volume > target + 10 % | Hard stop | `OVERFLOW` |
| Pump on, no flow pulses for 3 s | Stop | `NO_FLOW` |
| Weight drops ≥ 50 g during fill | Stop within 100 ms | `BOTTLE_REMOVED` |
| Power lost during fill | On reboot report the saved partial result | `POWER_LOSS_RECOVERY` |

---

## 5. Maintenance Mode
- Enter from IDLE with a PIN (button sequence, **TBD (hardware)**).
- Functions: prime pump, open/close each valve, show raw weight and flow pulses, calibrate (see [calibration-guide.md](calibration-guide.md)), self-test.
- While in maintenance mode the STM32 answers `PONG,ERROR,0,<tank>,NONE`, so no payment can start.
