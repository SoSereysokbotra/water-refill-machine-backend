# Software Requirements Specification (SRS)
# Smart IoT Water Refill Machine

---

**Project Name:** Automated Cashless Water Refill Vending Kiosk  
**Document Version:** 2.0.0 (Comprehensive Functional Baseline)  
**Status:** Under Client Review  
**Date:** November 2026  
**Target System:** Embedded Kiosk Controller (Firmware) & Cloud Payment/Telemetry Platform (Backend)  

---

## Executive Summary

The **Smart IoT Water Refill Machine** is an autonomous, cashless, commercial-grade drinking water vending kiosk. The system allows everyday consumers to refill personal reusable water bottles (0.5 L, 0.75 L, and 1.0 L) by scanning a mobile banking QR code (ABA PayWay KHQR / national standard), placing their container, and receiving purified water with high accuracy ($\pm 1\%$).

This Software Requirements Specification (SRS) establishes the complete functional behavior, business logic, user experience flows, system interfaces, data schemas, and operational safeguards. Unlike a low-level hardware circuit schematic, this document defines **what the system does from the user, operational, and software perspective**, providing an authoritative guide for software developers, UI designers, QA testers, product managers, and business stakeholders.

---

## Table of Contents
1. [Project Overview & Business Objectives](#1-project-overview--business-objectives)
2. [User Personas & Stakeholder Classes](#2-user-personas--stakeholder-classes)
3. [User Journeys & Operational Workflows](#3-user-journeys--operational-workflows)
4. [Comprehensive Use Case Specifications](#4-comprehensive-use-case-specifications)
5. [Detailed Functional Requirements](#5-detailed-functional-requirements)
   - 5.1 Kiosk User Interface & Screen Behaviors
   - 5.2 Cashless Payment Processing & KHQR Lifecycle
   - 5.3 Container Safety, Weight Validation & Anti-Spill Protection
   - 5.4 Precision Two-Stage Dispensing Engine
   - 5.5 Dual-Sensor Integrity & Quality Cross-Validation
   - 5.6 Water Reservoir Inventory & Dry-Run Safeguards
   - 5.7 Telemetry Reporting, Accounting & Remote Fleet Monitoring
   - 5.8 Field Maintenance & Calibration Mode
6. [Business Rules & Financial Policies](#6-business-rules--financial-policies)
7. [Screen-by-Screen UI/UX Specification](#7-screen-by-screen-uiux-specification)
8. [Data Dictionary & Information Architecture](#8-data-dictionary--information-architecture)
9. [Non-Functional Requirements (Quality Attributes)](#9-non-functional-requirements-quality-attributes)
10. [Error Handling, Exception Matrix & Recovery](#10-error-handling-exception-matrix--recovery)

---

## 1. Project Overview & Business Objectives

### 1.1 Business Problem
Traditional public water vending stations suffer from high failure rates, security vulnerabilities, and poor hygiene due to physical coin/cash bill validators (jamming, vandalism, theft, dirty contact surfaces). Furthermore, traditional dispensers lack volume accuracy, often overflowing small bottles or underfilling large ones, and provide zero remote inventory visibility, leading to unnotified empty tanks and lost revenue.

### 1.2 System Solution
The Smart IoT Water Refill Machine solves these challenges through:
- **100% Cashless Operation**: Dynamic KHQR code generation via ABA PayWay, eliminating mechanical coin/bill acceptors entirely.
- **Dual-Sensor Smart Dispensing**: Combines real-time gravimetric (load cell scale) and volumetric (in-line flowmeter) monitoring to deliver exact liquid volumes while preventing accidental spills.
- **Two-Stage Fluid Dynamics**: Fast bulk fill (90%) transitioning smoothly to precision low-speed top-off (10%) to prevent water splashing and inertia overfill.
- **Autonomous Cellular Telemetry**: 4G LTE communication sending real-time stock levels, transaction audits, and machine alerts directly to cloud databases.

### 1.3 Key Performance Indicators (KPIs)
- **Dispense Volumetric Accuracy:** Target volume $\pm 1\%$ ($\pm 5\text{ ml}$ on $500\text{ ml}$).
- **Customer Transaction Time:** $< 35\text{ seconds}$ total interaction (selection to fill completion).
- **Payment Latency:** QR scan-to-dispense reaction $< 3.0\text{ seconds}$.
- **Spill Prevention:** Automatic nozzle shutoff within $< 100\text{ ms}$ if bottle moves or tips.
- **Kiosk Uptime Availability:** $\ge 99.5\%$ operational readiness.

---

## 2. User Personas & Stakeholder Classes

| Persona Class | Representative Profile | Core Goals & Expectations | Pain Points Addressed |
|---|---|---|---|
| **End-Customer (Consumer)** | **Sokha**, 22, University student / commuter carrying a reusable tumbler. | • Fast, cheap drinking water refill.<br>• Clean, hygienic station with zero cash hassle.<br>• Wants to pay with ABA mobile app in seconds.<br>• Expects bottle not to overflow or get wet on outside. | No need for coins or exact change. Clear on-screen instructions in Khmer & English. Visual timer and status feedback. |
| **Field Operator (Route Refiller)** | **Dara**, 34, Logistics & replenishment technician managing 15 kiosks. | • Needs immediate notice when water reservoir drops below 20%.<br>• Fast refill procedure ($< 10\text{ min}$) with clear sanitization SOP.<br>• On-kiosk maintenance screen to verify valve/pump operation without opening code. | Remote low-water alerts via cloud. Built-in maintenance mode to prime pump, test valves, and tare load cell. |
| **Business Owner / Fleet Admin** | **Sophea**, 41, Operations Manager overseeing kiosk network. | • Real-time sales tracking & revenue analytics.<br>• Automated reconciliation between ABA PayWay deposits and dispensed volumes.<br>• Immediate notification of system faults or tampering. | Centralized cloud dashboard. Detailed transaction records with volume, amount, and timestamp. |
| **Service Technician** | **Vireak**, 29, Electro-mechanical maintenance engineer. | • Clear diagnostic error codes for rapid troubleshooting.<br>• Modular component replacement without whole-machine recalibration. | Structured error codes (`ERR_LOW_WATER`, `ERR_FLOW_MISMATCH`, etc.) and automated self-test on reboot. |

---

## 3. User Journeys & Operational Workflows

### 3.1 Primary Customer Journey: Standard Refill Flow
```text
[ 1. Approach Kiosk ] ──▶ Kiosk displays "Welcome - Select Refill Size" (0.5L / 0.75L / 1.0L)
           │
           ▼
[ 2. Touch Volume ] ─────▶ Kiosk contacts Backend, generates unique ABA PayWay KHQR on screen
           │
           ▼
[ 3. Scan & Pay ] ───────▶ Customer scans QR with mobile banking app and confirms payment
           │
           ▼
[ 4. Payment Detected ] ─▶ Screen shows "Payment Confirmed! Please place your bottle" + Red LED
           │
           ▼
[ 5. Place Container ] ──▶ Platform detects weight (> 20g), auto-tares scale, turns Green LED ON
           │
           ▼
[ 6. Two-Stage Fill ] ───▶ Stage 1: Fast fill to 90% (pump + fast valve)
                           Stage 2: Precision top-off to 100% (slow valve)
           │
           ▼
[ 7. Completion ] ───────▶ Valves shut, pump stops, completion chime sounds, Green LED blinks
           │
           ▼
[ 8. Take Bottle ] ──────▶ Customer takes container; machine uploads telemetry and returns to Idle
```

### 3.2 Exception Journey: Container Removal Mid-Dispense (Anti-Spill)
1. Customer initiates a 1.0L refill. Water begins dispensing.
2. At 450 ml, the customer's child accidentally knocks or grabs the bottle off the platform.
3. The load cell detects an immediate weight drop ($> 50\text{ g}$ within $50\text{ ms}$).
4. **Safety System Action:** The microcontroller immediately de-energizes the pump and snaps both solenoid valves shut within $< 100\text{ ms}$.
5. The screen flashes an emergency alert: *"Container Removed — Dispensing Paused"*.
6. A 15-second grace window begins. If the bottle is returned, dispensing may resume; if not, the transaction terminates safely, recording the exact partial volume dispensed to prevent water waste and flood damage.

### 3.3 Operator Journey: Tank Replenishment & Sanitize
1. Cloud server detects tank level has reached `FLOAT_LOW` ($< 5\text{L}$) and sends SMS/Telegram alert to Operator.
2. Kiosk locks customer UI and displays *"Temporary Out of Service — Refilling Soon"*.
3. Operator arrives, unlocks side panel, scans maintenance RFID badge or enters 6-digit PIN on touchscreen.
4. Kiosk opens **Operator Maintenance Mode**.
5. Operator refills the 60L internal food-grade reservoir and inspects filters.
6. Operator presses *"Prime & Purge Lines"* to eliminate air pockets.
7. Operator presses *"Tare Balance & Test Dispense"* to ensure accurate zero.
8. Operator locks door; kiosk runs automated Built-In Self-Test (BIST) and returns to public `IDLE` state.

---

## 4. Comprehensive Use Case Specifications

### Use Case UC-01: Select Volume & Request Payment
- **Primary Actor:** Customer.
- **Preconditions:** Kiosk is in `IDLE` state; water reservoir has $\ge 5\text{L}$ of water; cloud connectivity is active.
- **Trigger:** Customer touches one of the three volume buttons on the touchscreen.
- **Main Success Scenario:**
  1. Customer selects volume tier: **0.5 L** ($500\text{ ml}$), **0.75 L** ($750\text{ ml}$), or **1.0 L** ($1000\text{ ml}$).
  2. System highlights selected tier and displays pricing in USD/KHR.
  3. System sends request to backend: `POST /api/payment/create` with `machine_id` and `volume_ml`.
  4. Backend generates ABA PayWay transaction and returns raw KHQR text payload.
  5. Kiosk renders crisp QR code on 2.8" TFT screen, displays price, and starts 180-second countdown.
  6. System enters `PAYMENT_WAIT` state and begins polling transaction status.
- **Alternative Flow A (Customer cancels):**
  - Customer taps "Cancel" on screen $\rightarrow$ System cancels session and returns to Welcome screen.
- **Alternative Flow B (Network offline):**
  - Backend does not respond within 5 seconds $\rightarrow$ System shows *"Payment Gateway Offline — Please try again shortly"*, retries twice, and reverts to Welcome screen.

---

### Use Case UC-02: Customer Payment Verification
- **Primary Actor:** Customer Mobile Banking App & Backend Gateway.
- **Preconditions:** Kiosk is displaying active KHQR on screen in `PAYMENT_WAIT` state.
- **Trigger:** Customer scans QR code and confirms payment in their banking app.
- **Main Success Scenario:**
  1. Bank processes transfer and updates ABA PayWay status to approved.
  2. Kiosk background polling (`GET /api/payment/status/:tran_id`) receives `status: "paid"`.
  3. Kiosk screen immediately clears QR code and switches to *"Payment Successful!"* with checkmark icon.
  4. Audio buzzer emits confirmation chime (2 short beeps).
  5. System transitions to `BOTTLE_CHECK` state.
- **Exception Flow (Payment Expiration):**
  - 180 seconds elapse with status remaining `"pending"`.
  - System clears QR, displays *"Payment Expired — Transaction Cancelled"*, and returns to Welcome screen.

---

### Use Case UC-03: Container Placement & Tare Calibration
- **Primary Actor:** Customer.
- **Preconditions:** Payment verified (`status: "paid"`).
- **Trigger:** System enters `BOTTLE_CHECK` state.
- **Main Success Scenario:**
  1. Front panel Red LED turns ON; screen displays visual animation showing bottle placed on the nozzle platform.
  2. Customer places empty bottle on the platform.
  3. System reads load cell weight. When reading stabilizes and exceeds $20\text{ grams}$ over tare, bottle presence is confirmed.
  4. Red LED turns OFF, Green LED turns ON.
  5. System records current gross weight as empty container tare: $W_{\text{empty\_bottle}}$.
  6. Screen updates: *"Container Ready — Dispensing Starting..."*.
  7. System transitions to `DISPENSING` state after a 1.0-second stabilization pause.
- **Exception Flow (No Container Placed):**
  - If no bottle is placed within 45 seconds, screen beeps and displays flashing reminder: *"Please place your bottle under the nozzle"*.
  - If no bottle placed after 90 seconds, system aborts, logs timeout, and registers an operator credit coupon/ticket.

---

### Use Case UC-04: Automated Precision Two-Stage Dispensing
- **Primary Actor:** Microcontroller Dispense Engine.
- **Preconditions:** Bottle detected and zeroed; water level adequate.
- **Trigger:** System enters `DISPENSING` state.
- **Main Success Scenario:**
  1. System initializes flow meter pulse counter to zero ($P = 0$).
  2. System engages 12V diaphragm pump and opens **both** Solenoid Valve 1 (Fast) and Solenoid Valve 2 (Slow).
  3. Water dispenses at high speed (~$3.2\text{ L/min}$).
  4. Screen displays real-time progress bar, volume count (e.g., `350 ml / 500 ml`), and animated pouring graphic.
  5. When dispensed volume reaches exactly $90\%$ of target (e.g., $450\text{ ml}$ for a $0.5\text{L}$ refill):
     - System snaps Solenoid Valve 1 (Fast) CLOSED.
     - Water continues flowing through Solenoid Valve 2 (Slow) at precision speed (~$0.8\text{ L/min}$).
  6. When dispensed volume reaches $100\%$ ($500\text{ ml}$):
     - System snaps Solenoid Valve 2 (Slow) CLOSED.
     - System de-energizes 12V pump relay.
  7. Dispensing halts with zero dripping. Total cycle time is $< 15\text{ s}$ for 0.5L and $< 25\text{ s}$ for 1.0L.
  8. System transitions to `VERIFY` state.

---

### Use Case UC-05: Dual-Sensor Quality Cross-Check & Verification
- **Primary Actor:** Firmware Quality Assurance Engine.
- **Preconditions:** Dispensing cycle completed; valves shut.
- **Trigger:** System enters `VERIFY` state.
- **Main Success Scenario:**
  1. System pauses $500\text{ ms}$ for liquid settling on scale platform.
  2. System reads final gravimetric weight gain: $\Delta W = W_{\text{final}} - W_{\text{empty\_bottle}}$.
  3. System reads total volumetric flow from pulse interrupts: $V_{\text{flow}} = \frac{\text{Pulses}}{K_{\text{factor}}}$.
  4. System computes discrepancy: $\text{Error} = |V_{\text{flow}} - \Delta W|$.
  5. If $\text{Error} \le 25\text{ ml}$ (within allowable fluid tolerance), system marks transaction `dual_check_passed = true`.
  6. Screen displays *"Refill Complete! Thank you"* with green celebration banner.
  7. Green LED flashes 3 times; buzzer plays pleasant completion melody.
  8. System transitions to `REPORT` state.
- **Alternative Flow (Discrepancy Warning):**
  - If $\text{Error} > 25\text{ ml}$ (e.g., small leak, foam aeration, or scale disturbance), system still completes transaction so customer gets their water, but flags `dual_check_passed = false` with warning details in telemetry log for technician inspection.

---

### Use Case UC-06: Telemetry Reporting & Transaction Logging
- **Primary Actor:** Cloud Telemetry Task.
- **Preconditions:** Dispense finished; audit record generated.
- **Trigger:** System enters `REPORT` state.
- **Main Success Scenario:**
  1. Microcontroller packages transaction metadata: `machine_id`, `tran_id`, `volume_ml`, `dispensed_flow_ml`, `dispensed_weight_g`, `duration_seconds`, `dual_check_passed`, `tank_level`, and `timestamp`.
  2. System transmits payload to cloud backend via HTTP POST to `/api/transaction`.
  3. Backend verifies API key, writes record into PostgreSQL `transactions` table, updates machine inventory statistics, and replies with `{ "acknowledged": true }`.
  4. System returns to `IDLE` state, ready for the next customer.
- **Exception Flow (Cellular Disconnection):**
  - If 4G signal is unavailable, microcontroller writes transaction record to onboard non-volatile flash storage (spool buffer holds up to 250 offline transactions).
  - Kiosk continues normal customer operations offline and automatically flushes buffered transactions when cellular signal reconnects.

---

### Use Case UC-07: Low Water Level Lockout & Operator Alert
- **Primary Actor:** Reservoir Float Sensors.
- **Preconditions:** Machine in normal operation.
- **Trigger:** Liquid level in 60L internal reservoir drops below 5-liter safety threshold (`FLOAT_LOW` opens).
- **Main Success Scenario:**
  1. Firmware debounces float switch over 3 consecutive seconds to filter out fluid sloshing.
  2. System transitions from current state to `LOCKOUT` state.
  3. Kiosk immediately deactivates volume buttons and displays on-screen notice: *"Temporarily Out of Water — Restocking in Progress"*.
  4. Kiosk sends priority alert to backend: `POST /api/machine/:id/alert` (`alert_type: "LOW_WATER_LOCKOUT"`).
  5. Backend logs critical alert and sends automated notification (SMS/Telegram/Email) to route operator.
  6. Machine rejects all payment requests until reservoir is physically replenished.

---

## 5. Detailed Functional Requirements

### 5.1 Kiosk User Interface & Screen Behaviors
- **`[REQ-UI-001]` Language Presentation:** The user interface SHALL present all on-screen customer prompts in both **Khmer** and **English** simultaneously or via a single-tap language toggle button.
- **`[REQ-UI-002]` Volume Tier Buttons:** The Welcome screen SHALL feature three distinct, large touch buttons corresponding to:
  1. **Small Bottle (0.5 L / 500 ml)**
  2. **Medium Bottle (0.75 L / 750 ml)**
  3. **Large Bottle (1.0 L / 1000 ml)**
- **`[REQ-UI-003]` Pricing Display:** Each volume button SHALL clearly display the volume in liters and milliliters along with the exact price in both KHR and USD (e.g., `500 mL — 500 KHR / $0.15`).
- **`[REQ-UI-004]` Live Progress Feedback:** During active dispensing, the screen SHALL render a dynamic progress bar updated at $\ge 10\text{ Hz}$, showing current milliliters dispensed, percentage complete, and an animated water droplet graphic.
- **`[REQ-UI-005]` Acoustic Signals:** The kiosk SHALL provide clear audio tones via the piezo buzzer:
  - *Short Click (50 ms, 1.5 kHz)*: Valid touch button press.
  - *Success Chime (2 beeps, 2.7 kHz)*: Payment verified / Bottle detected / Refill finished.
  - *Warning Buzzer (Long tone, 800 Hz)*: Invalid action / Bottle removed / Low water.

---

### 5.2 Cashless Payment Processing & KHQR Lifecycle
- **`[REQ-PAY-010]` Server-Driven QR Creation:** The kiosk SHALL NOT generate static, unverified QR codes. Every payment session MUST create a unique transaction record on the backend via ABA PayWay, binding `machine_id`, `volume_ml`, `price`, and a unique 16–20 digit `tran_id`.
- **`[REQ-PAY-011]` Raw Text Payload:** The backend SHALL return the standard raw EMVCo KHQR string (approx. 200–240 characters). The kiosk firmware SHALL render the QR matrix on the screen locally, ensuring zero image transmission over 4G cellular data.
- **`[REQ-PAY-012]` Sizing and Quiet Zone:** The rendered QR code on the 320×240 TFT LCD SHALL have a minimum module size of 3×3 pixels per module and a continuous white quiet zone border of at least 4 modules on all sides to guarantee 100% scan reliability on standard smartphone cameras.
- **`[REQ-PAY-013]` Active Polling Cadence:** While on the payment screen, the firmware SHALL poll `GET /api/payment/status/:tran_id` every $2.5\text{ seconds}$ ($\pm 0.3\text{ s}$).
- **`[REQ-PAY-014]` Expiration Safeguard:** Every transaction SHALL have an exact 180-second lifetime from generation. The screen SHALL display a real-time countdown timer (`Expires in: MM:SS`). When the countdown reaches 00:00, the session terminates immediately.
- **`[REQ-PAY-015]` Payment Idempotency:** The backend SHALL verify that each `tran_id` can only trigger dispensing exactly once. Subsequent duplicate status queries on an already completed transaction MUST return `"status": "paid"` without re-triggering dispensing.

---

### 5.3 Container Safety, Weight Validation & Anti-Spill Protection
- **`[REQ-SAF-020]` Minimum Weight Gate:** The kiosk SHALL NOT open water valves if the platform scale measures $< 20\text{ grams}$ above tare baseline. This prevents dispensing water onto an empty tray or when a customer forgets to place their container.
- **`[REQ-SAF-021]` Dynamic Tare Offset:** The system SHALL tare the scale *with the customer's specific container in place*, enabling accurate dispensing into containers of any weight (from lightweight plastic single-use bottles to heavy vacuum-insulated stainless steel flasks up to $1.5\text{ kg}$).
- **`[REQ-SAF-022]` Anti-Spill Instant Stop:** During dispensing, the firmware SHALL sample the load cell at $20\text{ Hz}$ ($50\text{ ms}$ intervals). If the measured weight gain ceases to accumulate while water is flowing:
  $$\Delta W(t) < 0.20 \times V_{\text{flow}}(t) \quad (\text{after initial } 50\text{ ml})$$
  or if container weight suddenly decreases by $\ge 50\text{ g}$, the system SHALL trigger an **Instant Valve Cutoff** within $\le 100\text{ ms}$, halt the pump, and illuminate the Red warning LED.
- **`[REQ-SAF-023]` Maximum Volume Hard Stop:** Independent of sensor readings, the firmware SHALL implement a hard volumetric ceiling of $115\%$ of selected target volume. If neither sensor signals a stop by $115\%$, the firmware forces all valves shut to eliminate any possibility of tank overflow.

---

### 5.4 Precision Two-Stage Dispensing Engine
- **`[REQ-DSP-030]` Two-Stage Valve Control Architecture:** The hydraulic dispensing path SHALL utilize two parallel solenoid valves:
  - **Solenoid Valve 1 (Fast Valve):** High-flow aperture (~$2.4\text{ L/min}$).
  - **Solenoid Valve 2 (Slow Valve):** Precision-metered aperture (~$0.8\text{ L/min}$).
- **`[REQ-DSP-031]` Stage 1 (Fast Bulk Phase):** From $0\%$ to $90\%$ of target volume, both Fast and Slow valves SHALL remain energized (combined flow rate ~$3.2\text{ L/min}$).
- **`[REQ-DSP-032]` Stage 2 (Precision Finishing Phase):** At exactly $90\%$ of target volume, the Fast Valve SHALL close. Dispensing continues exclusively through the Slow Valve (~$0.8\text{ L/min}$) until $100\%$ target is achieved.
- **`[REQ-DSP-033]` Splash & Foam Suppression:** The two-stage transition SHALL eliminate nozzle hydraulic hammer and dynamic fluid frothing, ensuring smooth liquid landing even in narrow-mouth bottles.
- **`[REQ-DSP-034]` Accuracy Target:** The combined two-stage algorithm SHALL achieve an end-dispense accuracy within $\pm 1\%$ of target volume:
  - 500 ml target: $500 \pm 5\text{ ml}$ ($495\text{ to }505\text{ ml}$).
  - 750 ml target: $750 \pm 8\text{ ml}$ ($742\text{ to }758\text{ ml}$).
  - 1000 ml target: $1000 \pm 10\text{ ml}$ ($990\text{ to }1010\text{ ml}$).

---

### 5.5 Dual-Sensor Integrity & Quality Cross-Validation
- **`[REQ-INT-040]` Primary & Secondary Sensor Roles:** The system SHALL use the in-line Hall-effect turbine flowmeter (YF-S201) as primary volumetric counter and the under-platform 24-bit strain-gauge load cell (HX711) as secondary gravimetric validator.
- **`[REQ-INT-041]` Cross-Check Verification Rule:** Upon valve closure, the system SHALL evaluate the parity formula:
  $$\text{Discrepancy} = \left| V_{\text{flow}} (\text{ml}) - \Delta W_{\text{scale}} (\text{grams}) \right|$$
  - If $\text{Discrepancy} \le 25\text{ units}$, the transaction is recorded as **VALID** (`dual_check_passed = true`).
  - If $\text{Discrepancy} > 25\text{ units}$, the transaction is recorded as **DISCREPANT** (`dual_check_passed = false`), triggering a diagnostic log entry.
- **`[REQ-INT-042]` Self-Calibrating Drift Offset:** The system SHALL track resting platform tare weight between sessions. If baseline tare drifts by more than $\pm 15\text{ g}$ (due to dust or accumulated condensation), the firmware SHALL recalibrate the zero baseline automatically when idle for $> 5\text{ minutes}$.

---

### 5.6 Water Reservoir Inventory & Dry-Run Safeguards
- **`[REQ-RES-050]` 3-Tier Float Switch Monitoring:** The 60-liter internal food-grade storage reservoir SHALL incorporate three magnetic reed float sensors:
  1. **`FLOAT_HIGH` ($60\text{ L}$):** Indicates tank is fully replenished.
  2. **`FLOAT_MID` ($30\text{ L}$):** Indicates tank is half-depleted; emits low-priority inventory notice to fleet cloud.
  3. **`FLOAT_LOW` ($5\text{ L}$):** Critical reserve threshold.
- **`[REQ-RES-051]` Immediate Dry-Run Lockout:** If `FLOAT_LOW` opens ($< 5\text{L}$ remaining), the firmware SHALL:
  1. Inhibit all new transaction requests immediately.
  2. Post emergency alert `LOW_WATER_LOCKOUT` to cloud backend.
  3. Disallow 12V pump activation under any circumstance to prevent dry-run diaphragm burnout.
  4. Display out-of-service message on screen with maintenance contact QR code.
- **`[REQ-RES-052]` Automatic Recovery:** When fresh water is replenished and submerges `FLOAT_LOW` and `FLOAT_MID` continuously for $\ge 5\text{ seconds}$, the kiosk SHALL clear the lockout state, report `ONLINE` status to backend, and return to public Welcome mode.

---

### 5.7 Telemetry Reporting, Accounting & Remote Fleet Monitoring
- **`[REQ-TEL-060]` Post-Transaction Telemetry:** Following every dispense cycle, the kiosk SHALL upload a complete audit log via `POST /api/transaction` containing:
  - Unique machine hardware identifier (`machine_id`).
  - Payment transaction reference (`tran_id`).
  - Target requested volume vs. actual dispensed flow volume vs. actual dispensed weight.
  - Dispense cycle duration in seconds.
  - Dual-sensor pass/fail boolean flag.
  - Reservoir stock status (`HIGH`, `MID`, `LOW`).
  - Network signal quality (RSSI in dBm).
- **`[REQ-TEL-061]` Heartbeat Cadence:** When idle, the kiosk SHALL transmit an automated health ping (`POST /api/machine/:id/heartbeat`) every $15\text{ minutes}$, reporting uptime, internal temperature, and sensor health status.
- **`[REQ-TEL-062]` Offline Resilience & Buffer Ring:** If cellular communication fails (tower outage, SIM disconnect), transaction records SHALL be appended to a non-volatile flash ring buffer holding up to 250 records. Buffered logs SHALL be automatically transmitted in FIFO order upon network re-establishment.

---

### 5.8 Field Maintenance & Calibration Mode
- **`[REQ-MNT-070]` Maintenance Menu Access:** Field operators SHALL be able to access the restricted maintenance menu by tapping a hidden screen target 5 times and entering a secure 6-digit PIN.
- **`[REQ-MNT-071]` Diagnostic Manual Controls:** The maintenance interface SHALL provide manual override toggles to:
  - Prime and purge the pump motor.
  - Open/close Fast Solenoid Valve individually.
  - Open/close Slow Solenoid Valve individually.
  - View real-time raw load cell weight reading in grams.
  - View real-time flowmeter pulse counter.
- **`[REQ-MNT-072]` Two-Point Calibration Routine:** The maintenance software SHALL guide the technician through a 2-point load cell calibration using known certified test weights ($500\text{g}$ and $1000\text{g}$), saving calibration constants directly into EEPROM/NVS flash.

---

## 6. Business Rules & Financial Policies

| Rule ID | Rule Name | Business Policy Specification |
|---|---|---|
| **`BR-001`** | **Fixed Volume Tiers** | Only three standard refill volumes are permitted: **0.5 L**, **0.75 L**, and **1.0 L**. Custom or unmetered continuous flow is strictly prohibited to maintain financial control. |
| **`BR-002`** | **Pricing Structure** | • **0.5 L Refill:** 500 KHR ($0.15 USD)<br>• **0.75 L Refill:** 700 KHR ($0.20 USD)<br>• **1.0 L Refill:** 1,000 KHR ($0.25 USD)<br>*(Prices are configurable via remote cloud API without firmware re-flashing).* |
| **`BR-003`** | **Payment Window** | Customers have exactly **180 seconds** (3 minutes) to complete payment once the QR code appears. If unpaid, the transaction is marked `expired` by the backend, releasing kiosk availability. |
| **`BR-004`** | **Partial Dispense Policy** | If dispensing is interrupted prematurely (e.g., bottle removed mid-cycle and not returned, or power failure):<br>1. System logs the exact milliliters dispensed vs. paid.<br>2. Cloud backend creates an automated customer service credit voucher linked to `tran_id` if delivered volume is $< 80\%$ of target. |
| **`BR-005`** | **Reservoir Safety Margin** | Dispensing SHALL be locked when reservoir volume drops below $5\text{ Liters}$ (8.3% of total 60L capacity). This reserve protects the pump against sediment intake and air entrapment. |
| **`BR-006`** | **Payment Provider** | The primary payment gateway for the Cambodian market is **ABA PayWay (KHQR)**, supporting instant inter-bank payments via the National Bank of Cambodia's Bakong payment system in both KHR and USD. |

---

## 7. Screen-by-Screen UI/UX Specification

### Screen 1: Welcome & Volume Selection (`SCR-01`)
- **Header:** "Smart Pure Water Refill" + Live Reservoir Indicator (Green dot: "Ready").
- **Body:** Prompt: *"Select your bottle refill size / សូមជ្រើសរើសចំណុះ"*.
- **Interactive Elements:**
  - `[ Button 1 ]`: **0.5 Liter (500 ml)** — `500 KHR / $0.15`
  - `[ Button 2 ]`: **0.75 Liter (750 ml)** — `700 KHR / $0.20`
  - `[ Button 3 ]`: **1.0 Liter (1000 ml)** — `1,000 KHR / $0.25`
- **Footer:** Status bar: *"Tap size to pay with KHQR · Cashless & Hygienic"*.

### Screen 2: QR Payment (`SCR-02`)
- **Header:** *"Scan to Pay / ស្កេនទូទាត់"* + Refill tier tag (`1.0 L`).
- **Center:** High-contrast, sharp 195×195 pixel KHQR Code with clean white quiet-zone border.
- **Below QR:** Display Amount: **`1,000 KHR`** (`$0.25 USD`) + Bank logos (ABA PayWay / KHQR).
- **Timer Banner:** Animated countdown clock: *"Expires in: 02:45"*.
- **Controls:** `[ Cancel Button ]` at bottom-left corner to abandon session.

### Screen 3: Container Placement (`SCR-03`)
- **Header:** *"Payment Received! / ការទូទាត់បានជោគជ័យ"* (Green banner).
- **Center Graphic:** Animated graphic showing a water bottle placed onto the dispensing platform.
- **Instructional Text:** *"Please place your bottle under the nozzle / សូមដាក់ដបទឹករបស់អ្នក"*.
- **Status Indicator:** Red LED active; transitions to Green LED as soon as scale detects bottle ($> 20\text{g}$).
- **Auto-Advance:** Screen automatically advances to Dispensing within 1.0 second of stable container detection.

### Screen 4: Active Dispensing (`SCR-04`)
- **Header:** *"Dispensing Water... / កំពុងចាក់ទឹក..."*.
- **Center:**
  - Large digital volume readout: `450 ml / 500 ml`.
  - Color horizontal progress bar (0% to 100%).
  - Stage indicator: *"Stage 1: Fast Fill"* (0-90%) $\rightarrow$ *"Stage 2: Precision Finish"* (90-100%).
- **Safety Prompt:** *"Do not remove container during refill"*.
- **Hardware Status:** Green LED solid ON.

### Screen 5: Dispense Complete (`SCR-05`)
- **Header:** *"Refill Complete! / ការចាក់ទឹកបានបញ្ចប់"* (Vibrant green checkmark icon).
- **Body:**
  - *"Target Delivered: 500 ml (Accuracy: 100%)"*.
  - *"Thank you for reducing plastic waste! / សូមអរគុណ"*.
- **Audio/Visual Signals:** 2-beep completion chime, Green LED blinks 3 times.
- **Timeout:** Displays for 5.0 seconds before automatically resetting to Screen 1 (Welcome).

### Screen 6: Out of Service / Error (`SCR-06`)
- **Header:** *"Temporarily Out of Service / ផ្អាកដំណើរការបណ្តោះអាសន្ន"* (Amber warning triangle).
- **Body Message:** *"Water reservoir is currently being replenished. Please check back shortly."*.
- **Error Code:** Bottom footer displays system code (e.g., `Code: ERR_LOW_WATER_05L`).
- **Support Contact:** QR code linking to Telegram/WhatsApp customer support helpline.
- **Hardware Status:** Red LED solid ON.

---

## 8. Data Dictionary & Information Architecture

### 8.1 Primary Data Entities

#### Entity 1: `Machine` (Kiosk Registry)
| Attribute | Type | Nullable | Description / Constraints |
|---|---|:---:|---|
| `id` | String (32) | NO | Unique kiosk identifier (e.g., `"WRM-001"`). PRIMARY KEY. |
| `name` | String (100) | NO | Human-readable name (e.g., `"RUPP Campus 1 Kiosk"`). |
| `location_name` | String (150) | YES | Physical site description (e.g., `"Building A, 1st Floor Lobby"`). |
| `latitude` | Decimal (9,6) | YES | GPS latitude coordinate. |
| `longitude` | Decimal (9,6) | YES | GPS longitude coordinate. |
| `tank_capacity_l`| Integer | NO | Nominal reservoir capacity (Default: `60`). |
| `tank_level` | Enum | NO | Current stock: `'HIGH'`, `'MID'`, `'LOW'`. |
| `status` | Enum | NO | Operating status: `'ONLINE'`, `'OFFLINE'`, `'LOCKOUT'`, `'MAINTENANCE'`. |
| `last_heartbeat` | Timestamp | YES | Timestamp of most recent telemetry ping. |

#### Entity 2: `Transaction` (Financial & Dispense Audit Log)
| Attribute | Type | Nullable | Description / Constraints |
|---|---|:---:|---|
| `id` | String (64) | NO | ABA PayWay transaction ID (`tran_id`). PRIMARY KEY. |
| `machine_id` | String (32) | NO | Foreign Key referencing `Machine.id`. |
| `volume_tier_ml` | Integer | NO | Requested volume: `500`, `750`, or `1000`. |
| `dispensed_flow_ml`| Integer | NO | Exact volume measured by YF-S201 flowmeter in ml. |
| `dispensed_weight_g`| Integer | NO | Exact weight gained by HX711 load cell in grams. |
| `amount` | Decimal (8,2)| NO | Paid monetary amount (e.g., `1000.00` or `0.25`). |
| `currency` | String (3) | NO | Currency ISO code: `'KHR'` or `'USD'`. |
| `payment_status` | Enum | NO | `'pending'`, `'paid'`, `'expired'`, `'failed'`. |
| `dispense_status`| Enum | NO | `'COMPLETED'`, `'PARTIAL_ABORT'`, `'FAILED'`. |
| `duration_sec` | Decimal (5,2)| NO | Total dispensing duration from valve open to shut. |
| `dual_check_passed`| Boolean | NO | `true` if $|V_{\text{flow}} - \Delta W| \le 25\text{ ml}$; else `false`. |
| `created_at` | Timestamp | NO | Transaction initiation timestamp. |
| `completed_at` | Timestamp | YES | Transaction completion timestamp. |

#### Entity 3: `OperatorAlert` (Incident & Failure Queue)
| Attribute | Type | Nullable | Description / Constraints |
|---|---|:---:|---|
| `id` | Serial (Int) | NO | Auto-incrementing alert ID. PRIMARY KEY. |
| `machine_id` | String (32) | NO | Foreign Key referencing `Machine.id`. |
| `alert_type` | Enum | NO | `'LOW_WATER'`, `'SPILL_ABORT'`, `'SENSOR_MISMATCH'`, `'TAMPER'`. |
| `severity` | Enum | NO | `'INFO'`, `'WARNING'`, `'CRITICAL'`. |
| `message` | Text | NO | Detailed diagnostic explanation. |
| `resolved` | Boolean | NO | Default `false`; set to `true` when operator clears issue. |
| `created_at` | Timestamp | NO | Alert generation timestamp. |

---

## 9. Non-Functional Requirements (Quality Attributes)

### 9.1 Usability & Accessibility Requirements
- **`[NFR-USE-01] Sunlight Readability:`** The 2.8" TFT display SHALL utilize a high-luminance LED backlight ($> 300\text{ nits}$) with an anti-glare protective acrylic bezel to ensure full legibility in bright daytime conditions.
- **`[NFR-USE-02] Intuitive Self-Explanation:`** A first-time user SHALL be able to successfully complete a water refill without verbal assistance or written manual in $< 45\text{ seconds}$.
- **`[NFR-USE-03] Ergonomic Nozzle Height:`** The dispensing alcove and bottle platform SHALL be positioned at $850\text{ mm}$ above ground level, accommodating both standing adults and wheelchair-seated individuals.

### 9.2 Reliability & Availability Requirements
- **`[NFR-REL-01] 24/7 Availability:`** The system SHALL operate continuously 24 hours per day, 7 days per week, achieving an uptime availability of $\ge 99.5\%$, excluding authorized scheduled filter replacement.
- **`[NFR-REL-02] Power Outage Safe-State:`** In the event of a sudden municipal power cut, all normally-closed solenoid valves SHALL shut mechanically in $< 15\text{ ms}$, ensuring zero uncontrolled flooding. Upon power restoration, the system SHALL automatically boot, run self-tests, and resume operation without requiring manual technician intervention.

### 9.3 Performance & Timing Requirements
- **`[NFR-PER-01] Touch Response Latency:`** Visual response to any button press SHALL be rendered on the display in $< 100\text{ ms}$.
- **`[NFR-PER-02] Flow Delivery Rate:`** The dispensing system SHALL deliver drinking water at an average rate of $\ge 2.5\text{ Liters per minute}$, achieving a full 1.0-liter refill in $< 26\text{ seconds}$.
- **`[NFR-PER-03] Anti-Spill Sensor Loop Time:`** The safety load cell monitoring loop SHALL execute every $50\text{ ms}$ or faster to catch container tipping immediately.

### 9.4 Security & Data Privacy Requirements
- **`[NFR-SEC-01] Zero Customer PII Storage:`** The kiosk and cloud server SHALL NOT store customer bank account numbers, names, phone numbers, or credit card details. Payment authentication is delegated completely to the regulated ABA PayWay KHQR infrastructure.
- **`[NFR-SEC-02] Authenticated API Endpoints:`** All machine-to-cloud communications MUST be authenticated via a cryptographically random, 64-character secret API Key transmitted via HTTPS header (`X-API-Key`).
- **`[NFR-SEC-03] Enclosure Physical Security:`** The 304 Stainless Steel service door SHALL be secured by a dual tubular cam-lock mechanism with an internal digital tamper switch that sends an alert to the cloud if opened without authorized maintenance mode.

### 9.5 Sanitary & Material Compliance
- **`[NFR-SAN-01] Food-Grade Water Contact:`** All fluid-conveying elements (internal reservoir, food-grade silicone/polyethylene tubing, diaphragm pump chamber, stainless steel nozzle) MUST comply with **NSF/ANSI 51 & 61** or FDA 21 CFR 177 standards for potable liquid contact.
- **`[NFR-SAN-02] Anti-Bacterial UV Protection:`** The internal 60L reservoir MAY incorporate an in-tank submerged low-power 254nm UV-C germicidal lamp cycling 15 minutes every 4 hours to prevent biofilm buildup during prolonged idle periods.

---

## 10. Error Handling, Exception Matrix & Recovery

The table below defines every system error condition, on-screen customer message, automated machine action, and recovery procedure:

| Error Code | Trigger Condition | Customer On-Screen Message | Kiosk Automated Action | Recovery Procedure |
|---|---|---|---|---|
| **`ERR_01_LOW_WATER`** | Reservoir float switch `FLOAT_LOW` is open ($< 5\text{L}$). | *"Temporarily Out of Water. Maintenance has been alerted."* | Inhibit payment buttons; disable pump; send alert to cloud backend. | Operator replenishes 60L reservoir; system auto-clears on float trigger. |
| **`ERR_02_PAY_TIMEOUT`** | Payment not confirmed within 180 seconds. | *"Payment Expired. Please select size to try again."* | Cancel active polling; clear QR code; return to Welcome screen. | Customer taps volume button to generate fresh QR. |
| **`ERR_03_BOTTLE_MISSING`**| No container detected on scale within 60s of payment. | *"No container detected. Please place bottle under nozzle."* | Beep buzzer; flash Red LED; pause dispensing. | Customer places bottle $\ge 20\text{g}$; system auto-detects and dispenses. |
| **`ERR_04_SPILL_ABORT`** | Bottle removed mid-dispense or weight drops $> 50\text{g}$. | *"Dispensing Paused: Bottle moved. Return bottle to resume."* | Shut Fast & Slow valves in $< 100\text{ ms}$; stop pump; start 15s grace timer. | If bottle returned in 15s, resume. If not, finalize partial transaction. |
| **`ERR_05_FLOW_MISMATCH`** | Flowmeter volume and scale weight differ by $> 25\text{ ml}$. | *"Refill Finished (Quality Check Logged)."* | Complete refill for customer; set `dual_check_passed = false` in telemetry. | Flagged in cloud dashboard; technician inspects for filter clogging or scale calibration. |
| **`ERR_06_CELL_OFFLINE`** | SIM7600 loses 4G cellular tower signal for $> 60\text{ s}$. | (None during idle; shows *"Offline"* if payment creation fails). | Store pending transaction telemetry into local flash memory ring buffer. | Auto-retries 4G reconnection; flushes offline queue immediately once online. |
| **`ERR_07_VALVE_FAIL`** | Current draw indicates failed valve solenoid or relay stuck. | *"Hardware Issue Detected. Please use another station."* | Disengage pump; trip internal relay isolation; notify cloud immediately. | Field technician service call required to replace valve module. |

---

## 11. Document Approvals & Baseline Sign-Off

This document constitutes the agreed Software Requirements Specification for the Smart IoT Water Refill Machine project.

| Role | Name | Signature / Status | Date |
|---|---|:---:|:---:|
| **Product Manager** | Project Lead | PENDING CLIENT APPROVAL | 2026-11-05 |
| **Lead Software Architect** | Backend & Cloud Lead | PENDING CLIENT APPROVAL | 2026-11-05 |
| **Firmware Lead** | Embedded Systems Lead | PENDING CLIENT APPROVAL | 2026-11-05 |
| **Lead QA & Testing** | Quality Assurance Lead | PENDING CLIENT APPROVAL | 2026-11-05 |
