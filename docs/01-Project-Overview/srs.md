# Software Requirements Specification (SRS)
## Smart IoT Water Refill Machine

| | |
|---|---|
| **Version** | 3.0 |
| **Date** | November 2026 |
| **Status** | Draft for team review |
| **Team** | Hardware & STM32 firmware · Backend & ESP32 gateway |

> **How to read this document:** every section is short on purpose. If you need deep technical detail (message formats, database tables, code), see the [Backend Implementation Plan](../04-Cloud-and-Payment/backend-implementation-plan.md).

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Project Overview](#2-project-overview)
3. [System Architecture](#3-system-architecture)
4. [Users & System Workflows](#4-users--system-workflows)
5. [Functional Requirements](#5-functional-requirements)
6. [External Interfaces](#6-external-interfaces)
7. [Business Rules](#7-business-rules)
8. [Data Requirements](#8-data-requirements)
9. [Non-Functional Requirements](#9-non-functional-requirements)
10. [Error Handling & Recovery](#10-error-handling--recovery)
11. [Testing & Acceptance Criteria](#11-testing--acceptance-criteria)
12. [Deployment & Maintenance](#12-deployment--maintenance)
13. [Traceability Matrix](#13-traceability-matrix)
14. [Approvals & Sign-Off](#14-approvals--sign-off)
15. [Appendix](#appendix)

---

## 1. Introduction

### 1.1 Purpose
This document explains **what the water refill machine must do**. It is the shared agreement between the hardware side and the backend side, so both know what to build and how the parts work together.

### 1.2 Scope
The system includes:
- The **machine**: STM32 (controls the hardware) and ESP32 (connects to the internet).
- The **backend server**: handles payments, records transactions, and monitors machines.
- The **admin dashboard**: a website for the owner and operators.
- **ABA PayWay**: the payment provider (KHQR).

Not included (for now): cash or coin payment, a customer mobile app, custom volumes.

### 1.3 Definitions & Abbreviations

| Term | Meaning |
|---|---|
| **STM32** | Microcontroller that controls the pump, valves, sensors and LCD |
| **ESP32** | Microcontroller that connects the machine to Wi-Fi and the server |
| **UART** | Wired serial connection between the STM32 and the ESP32 |
| **MQTT** | Lightweight messaging used between the ESP32 and the server |
| **EMQX Cloud** | The MQTT broker (message server) we use |
| **Backend** | Our server program that handles payments and data |
| **ABA PayWay** | Bank payment service that creates the KHQR code |
| **KHQR** | Cambodia's standard payment QR code |
| **tran_id** | Unique ID of one payment |
| **Tank** | The water reservoir inside the machine (60 L) |
| **Fault code** | Short error name, e.g. `TANK_EMPTY` |

### 1.4 References
- [Product Architecture & Roadmap](product-architecture-roadmap.md)
- [Backend Architecture](../04-Cloud-and-Payment/backend-architecture.md)
- [Backend Implementation Plan](../04-Cloud-and-Payment/backend-implementation-plan.md)
- [Deployment](../06-Testing-and-Operations/deployment.md)
- [Bill of Materials](../02-Hardware-Design/bill-of-materials.md)
- [ESP32 Gateway README](../../esp32-gateway/README.md)

---

## 2. Project Overview

### 2.1 Business Problem
- Coin and cash water machines often jam, get stolen from, and are not hygienic.
- Many machines fill the wrong amount of water (overflow or underfill).
- Owners do not know when a tank is empty or a machine is broken until someone complains.

### 2.2 Proposed Solution
A water refill machine that:
- Accepts **cashless payment only** (scan KHQR with any banking app).
- Fills an **exact volume** (500 mL, 750 mL or 1000 mL) using a flow sensor and a scale.
- **Stops automatically** if the bottle is removed or something goes wrong.
- Sends **status and sales data** to the server so the owner can see everything online.

### 2.3 Objectives & KPIs

| Goal | Target |
|---|---|
| Volume accuracy | Within ±1 % (±5 mL for 500 mL) |
| Time from payment to water | Under 3 seconds |
| Full customer interaction | Under 35 seconds |
| Emergency stop (bottle removed) | Under 100 ms |
| Machine availability | 99.5 % or more |
| Lost payments | Zero: every paid payment gives water or a refund |

### 2.4 Assumptions & Constraints
- The machine connects to the internet by **Wi-Fi (2.4 GHz)**.
- Payments use **ABA PayWay**; the sandbox (test) account works in **USD** only.
- The ESP32 and STM32 both use **3.3 V** logic (no level shifter needed).
- The team is small (one hardware developer, one backend developer).
- The pilot starts with **1 machine**.

---

## 3. System Architecture

### 3.1 High-Level Architecture

```text
 ┌──────────────┐   UART    ┌──────────────┐   MQTT (secure)  ┌────────────┐        ┌──────────┐       ┌────────────┐
 │    STM32     │◀────────▶│    ESP32     │◀───────────────▶│ EMQX Cloud │◀─────▶│ Backend  │◀────▶│ ABA PayWay │
 │ LCD, pump,   │  wires    │ Wi-Fi gateway│    internet      │  (broker)  │        │  server  │       │   (KHQR)   │
 │ valves,      │           └──────────────┘                  └────────────┘        └────┬─────┘       └────────────┘
 │ sensors      │                                                                        │
 └──────────────┘                                                                  ┌─────▼──────┐
                                                                                   │   Admin    │
                                                                                   │ dashboard  │
                                                                                   └────────────┘
```

### 3.2 STM32 Responsibilities (Hardware team)
- Show screens and the QR code on the LCD.
- Read buttons (volume selection, cancel).
- Control the pump and the two valves.
- Read sensors: flow sensor, load cell (scale), tank float sensors.
- Keep the machine **safe on its own**, even without internet.

### 3.3 ESP32 Responsibilities (Backend team)
- Connect to Wi-Fi and the MQTT broker.
- Pass messages between the STM32 (UART) and the server (MQTT).
- Save dispense results if the internet is down, and send them later.
- Send a heartbeat (machine health) every 60 seconds.

### 3.4 Backend Responsibilities (Backend team)
- Ask ABA for a new KHQR for every purchase.
- Check whether the customer has paid.
- Tell the machine "paid" so it can dispense.
- Record every payment and dispense result.
- Detect problems (machine offline, tank empty) and alert the operator.
- Manage refunds.

### 3.5 Admin Dashboard
- A website to see machines, sales, alerts and refunds.
- Used by the owner/admin and operators.

### 3.6 Communication Flow

| Link | Method | Example |
|---|---|---|
| STM32 ↔ ESP32 | UART text lines | `REQ_PAY,500` |
| ESP32 ↔ Backend | MQTT over TLS (port 8883) | topic `wrm/WRM-001/pay/qr` |
| Backend ↔ ABA | HTTPS API | generate QR, check payment |
| Dashboard ↔ Backend | HTTPS REST API | list transactions |

---

## 4. Users & System Workflows

### 4.1 Customer
Wants cheap, clean drinking water fast, paying by phone. Needs simple screens in **Khmer and English**.

### 4.2 Operator
Refills the tank, cleans the machine and fixes simple problems. Needs alerts when the tank is low and a maintenance mode on the machine.

### 4.3 Administrator
Owner or manager. Watches sales and machine status on the dashboard and handles refunds.

### 4.4 Standard Refill Flow

```text
1. Customer chooses 500 / 750 / 1000 mL on the machine
2. STM32 → ESP32 → Backend: "new payment please"
3. Backend asks ABA for a KHQR, sends it back to the machine
4. STM32 shows the QR and a 3-minute countdown
5. Customer scans and pays with a banking app
6. Backend confirms the payment with ABA → sends "PAID" to the machine
7. STM32 checks that the payment matches the QR shown, then asks for the bottle
8. Customer places the bottle → STM32 fills it (fast, then slow)
9. STM32 reports the result → ESP32 → Backend saves it
10. Screen says "Thank you" and goes back to the start
```

### 4.5 Failed Payment / Dispensing Flow
- **Not paid in 3 minutes:** QR expires, screen goes back to the start. No money taken.
- **Customer presses Cancel:** payment cancelled, back to the start.
- **Paid, but no bottle placed in 60 seconds:** machine stops, reports `BOTTLE_TIMEOUT`, payment goes to **refund review**.
- **Paid, but filling stopped early** (bottle removed, tank empty, sensor fault): machine reports the amount filled, payment goes to **refund review**.
- **Customer paid after the QR expired:** machine does not dispense; payment goes to **refund review**.

### 4.6 Network Failure Flow
- **Internet down while idle:** screen shows "Offline". Customers cannot start a purchase.
- **Internet down during filling:** STM32 finishes or stops safely by itself. The result is saved and sent when the internet returns.
- **No result after 5 minutes:** backend marks the payment "unknown" and alerts the operator. **No automatic refund** until the result is known.

### 4.7 Maintenance Flow
1. Backend alerts the operator: tank low.
2. Machine shows "Out of Service" when the tank is empty.
3. Operator opens maintenance mode (PIN).
4. Operator refills the tank, checks filters, primes the pump, tares the scale.
5. Machine runs a self-check and returns to the start screen.

---

## 5. Functional Requirements

Each requirement has an ID so we can track it and test it.

### 5.1 STM32 Requirements (Hardware team)

**UI**

| ID | Requirement |
|---|---|
| FR-STM-01 | Show three volume choices (500 / 750 / 1000 mL) with prices. |
| FR-STM-02 | Show text in Khmer and English. |
| FR-STM-03 | Draw the KHQR from the text received (about 240 characters), with a white border so phones can scan it. |
| FR-STM-04 | Show a countdown while waiting for payment. |
| FR-STM-05 | Show progress (mL filled) while dispensing. |
| FR-STM-06 | Provide a Cancel button on the QR screen. |

**Container detection**

| ID | Requirement |
|---|---|
| FR-STM-07 | Do not open valves unless a bottle is on the scale (more than 20 g). |
| FR-STM-08 | Tare (zero) the scale with the customer's bottle in place. |
| FR-STM-09 | If no bottle within 60 s after payment, stop and report `BOTTLE_TIMEOUT`. |

**Water dispensing**

| ID | Requirement |
|---|---|
| FR-STM-10 | Fill fast until 90 % of the volume, then slow until 100 %. |
| FR-STM-11 | Dispense **only** when `PAID` matches the QR currently shown, and only once per payment. |
| FR-STM-12 | Report the result (`DONE` or `PARTIAL`) with the measured flow and weight. |

**Sensors**

| ID | Requirement |
|---|---|
| FR-STM-13 | Read the flow sensor (main volume measurement). |
| FR-STM-14 | Read the load cell (second check). Send both values; the backend flags a difference of more than 5 %. |
| FR-STM-15 | Read the tank float sensors (full / medium / low / empty). |

**Safety**

| ID | Requirement |
|---|---|
| FR-STM-16 | Stop the pump and close valves **by itself** (without waiting for the ESP32) when: target reached, bottle removed, sensor fault, tank empty, or filling takes longer than 60 s. |
| FR-STM-17 | Never run the pump when the tank is empty. |
| FR-STM-18 | Hard stop above target + 10 % (`OVERFLOW`), whatever the sensors say. |
| FR-STM-19 | Keep the last result in memory (survives reboot) and resend it until the ESP32 confirms. |
| FR-STM-20 | Provide a maintenance mode (PIN): test pump and valves, see sensor values, calibrate the scale. |

### 5.2 ESP32 Requirements (Backend team)

| ID | Area | Requirement |
|---|---|---|
| FR-ESP-01 | Wi-Fi | Connect to 2.4 GHz Wi-Fi and reconnect automatically. |
| FR-ESP-02 | MQTT | Connect securely (TLS) to EMQX Cloud and reconnect automatically. |
| FR-ESP-03 | MQTT | Announce online/offline status (offline is sent automatically if power is lost). |
| FR-ESP-04 | MQTT | Send a heartbeat every 60 s (signal, uptime, STM32 state, tank level). |
| FR-ESP-05 | UART | Forward messages between the STM32 and the backend. |
| FR-ESP-06 | UART | Send `PING` every 5 s and track the STM32 answer (`PONG`). |
| FR-ESP-07 | UART | Tell the STM32 the network status (`NET,OK` / `NET,DOWN`). |
| FR-ESP-08 | Offline/retry | Save dispense results in flash and resend until the backend confirms (up to 64 results, 7 days). |
| FR-ESP-09 | Offline/retry | Retry a payment request 3 times; if it still fails, tell the STM32 "Service unavailable". |
| FR-ESP-10 | Offline/retry | Throw away an old QR that has already expired. |

### 5.3 Backend Requirements (Backend team)

| ID | Area | Requirement |
|---|---|---|
| FR-BE-01 | Payment | Create a unique KHQR through ABA for each purchase. |
| FR-BE-02 | Payment | Check payment status with ABA until paid or expired. |
| FR-BE-03 | Payment | Accept ABA's payment callback, but always double-check with ABA. |
| FR-BE-04 | Payment | Allow only **one open payment per machine** at a time. |
| FR-BE-05 | Transaction | Make sure one payment can dispense **only once**. |
| FR-BE-06 | Transaction | Save every dispense result sent by the machine. |
| FR-BE-07 | Transaction | Keep checking expired payments for a few days in case ABA reports a late payment. |
| FR-BE-08 | Monitoring | Mark a machine offline after 3 minutes without a heartbeat. |
| FR-BE-09 | Monitoring | Track tank level and faults per machine. |
| FR-BE-10 | Refunds | Put failed or late payments into a **refund review** list. |
| FR-BE-11 | Refunds | Let an operator claim a case, refund it (ABA portal or cash) and record it. |
| FR-BE-12 | Alerts | Send alerts (Telegram) for: tank low/empty, machine offline, faults, unknown dispense results. |
| FR-BE-13 | Config | Send prices and enable/disable to machines remotely. |

### 5.4 Admin Dashboard Requirements

| ID | Requirement |
|---|---|
| FR-DB-01 | Login with roles (admin, operator). |
| FR-DB-02 | See all machines: online/offline, tank level, last fault. |
| FR-DB-03 | See transactions with filters (date, machine, status). |
| FR-DB-04 | Handle the refund review list. |
| FR-DB-05 | Change prices and enable/disable a machine. |
| FR-DB-06 | See daily and monthly sales reports. |

---

## 6. External Interfaces

### 6.1 LCD / Buttons
- LCD shows the screens listed in 6.7.
- Buttons: 500 mL, 750 mL, 1000 mL, Cancel.
- Buzzer: short beep for button press, chime for success, long tone for warnings.

### 6.2 Sensors / Pump / Valves

| Part | Used for |
|---|---|
| Flow sensor (YF-S201) | Measure water volume |
| Load cell + HX711 | Detect the bottle, check the volume by weight |
| Float sensors (3) | Tank level |
| 12 V pump | Push water |
| Fast valve + slow valve | Fast fill, then precise finish |

### 6.3 UART (STM32 ↔ ESP32)
- 115200 baud, 8N1, one text line per message ending with a newline.
- Wiring: ESP32 GPIO17 → STM32 RX, ESP32 GPIO16 ← STM32 TX, **common GND**.

Main messages (full list in Implementation Plan §C3):

| Message | Direction | Meaning |
|---|---|---|
| `REQ_PAY,500` | STM32 → ESP32 | Customer chose 500 mL |
| `QR,<tran_id>,<amount>,<currency>,<seconds>,<qr_text>` | ESP32 → STM32 | Show this QR |
| `PAID,<tran_id>` | ESP32 → STM32 | Customer has paid |
| `PAID,ACK,<tran_id>` | STM32 → ESP32 | OK, waiting for the bottle |
| `DONE,<tran_id>,<flow_ml>,<weight_g>` | STM32 → ESP32 | Filling finished |
| `PARTIAL,<tran_id>,<flow_ml>,<weight_g>,<fault>` | STM32 → ESP32 | Filling stopped early |
| `ACK,<tran_id>` | ESP32 → STM32 | Result saved, you can forget it |
| `EXPIRED` / `FAILED` / `CANCELLED,<tran_id>` | ESP32 → STM32 | Go back to the start screen |
| `ERR,<fault>` | STM32 → ESP32 | Something is wrong |
| `PING` / `PONG,...` | both | "Are you alive?" check |

### 6.4 MQTT (ESP32 ↔ Backend)
- Broker: EMQX Cloud, secure port 8883.
- Topics start with `wrm/<machine_id>/`, e.g. `wrm/WRM-001/pay/request`.
- Main topics: `pay/request`, `pay/qr`, `pay/status`, `transaction`, `heartbeat`, `error`, `online`, `config`.
- Full list in Implementation Plan §C2.

### 6.5 REST API (Dashboard ↔ Backend)
- HTTPS + login token.
- Used for: machines, transactions, refunds, reports, settings.
- Full list in Implementation Plan §C7.

### 6.6 ABA PayWay
- **Generate QR:** create a KHQR for one payment.
- **Check transaction:** ask whether it is paid.
- **Callback:** ABA tells us when a payment happens (we always double-check).
- Requests are signed with our secret key. The live account needs our server's fixed IP address registered with ABA.

### 6.7 Screens

| ID | Screen | Shows |
|---|---|---|
| SCR-01 | Welcome | Three volume buttons with prices |
| SCR-02 | QR Payment | QR, amount, countdown, Cancel |
| SCR-03 | Place Bottle | "Payment received, place your bottle" |
| SCR-04 | Dispensing | Progress bar, mL filled, "Do not remove the bottle" |
| SCR-05 | Complete | "Thank you", returns to SCR-01 after 5 s |
| SCR-06 | Offline | "Machine offline, please try later" |
| SCR-07 | Out of Service | Reason (e.g. tank empty), support contact |

---

## 7. Business Rules

### 7.1 Pricing

| Volume | Price (test) |
|---|---|
| 500 mL | $0.15 |
| 750 mL | $0.20 |
| 1000 mL | $0.25 |

- Only these three volumes are allowed.
- Prices can be changed from the dashboard without reflashing the machine.
- KHR prices will be added when the live ABA account supports them.

### 7.2 Payment Timeout
- A QR is valid for **3 minutes**.
- After that the payment is "expired" and the machine returns to the start.

### 7.3 Refund Rules

| Case | Refund |
|---|---|
| Paid but no water (bottle timeout, error, less than 10 % filled) | 100 % |
| Filled partly | The part not filled |
| Paid after the QR expired | 100 % |
| Result unknown (machine offline) | Operator checks first, **no automatic refund** |

- Refunds are done by an operator (ABA portal or cash) and recorded in the dashboard.

### 7.4 Transaction Rules
- One payment = water **at most once**.
- One machine = **one open payment** at a time.
- No water without a confirmed payment for **that** machine and **that** QR.
- Every paid payment ends with water delivered **or** a refund decision.

### 7.5 Machine Safety Rules
- Stop immediately if the bottle is removed.
- Never run the pump with an empty tank.
- Never fill more than target + 10 %.
- Stop filling after 60 seconds whatever happens.
- The STM32 applies these rules by itself, without the internet.

---

## 8. Data Requirements

What the backend stores (simple view; full tables in Implementation Plan §C6).

### 8.1 Machine
ID (e.g. `WRM-001`), name, location, online/offline, last heartbeat, tank level, enabled/disabled, firmware version.

### 8.2 Payment
`tran_id`, machine, volume, amount, currency, status (pending, paid, expired, cancelled, failed), created time, paid time.

### 8.3 Transaction (Dispense Result)
`tran_id`, result (ok / partial / error), flow mL, weight g, fault code, time.

### 8.4 Refund
`tran_id`, reason, suggested amount, refunded amount, method (ABA / cash), reference, operator, time.

### 8.5 Fault / Alert
Machine, fault code, severity (info / warning / critical), time, resolved or not.

### 8.6 User
Name, email, role (admin / operator), password (stored hashed), last login.

### 8.7 Fault Codes (shared by STM32, ESP32 and backend)

| Code | Meaning |
|---|---|
| `TANK_EMPTY` / `TANK_LOW` | Tank empty / low |
| `NO_FLOW` | Pump on but no water flowing |
| `OVERFLOW` | More water than target + 10 % |
| `BOTTLE_REMOVED` | Bottle taken away while filling |
| `BOTTLE_TIMEOUT` | No bottle within 60 s after payment |
| `DISPENSE_TIMEOUT` | Filling took more than 60 s |
| `LOADCELL_FAULT` / `FLOW_SENSOR_FAULT` | Sensor not working |
| `VALVE_FAULT` / `PUMP_FAULT` | Valve or pump not working |
| `PAID_NOT_ACCEPTED` | "Paid" arrived for a QR no longer shown |
| `POWER_LOSS_RECOVERY` | Machine restarted during filling |
| `UNKNOWN` | Any other problem |

---

## 9. Non-Functional Requirements

### 9.1 Performance
- Payment confirmed to "PAID" on the machine: **under 3 s**.
- QR appears on screen: **under 5 s** after choosing a volume.
- Server handles at least **100 machines** without slowing down.

### 9.2 Reliability
- Machine available **99.5 %** of the time.
- No payment is lost, even if the internet, server or power fails.
- Machine reconnects automatically after Wi-Fi or server problems.

### 9.3 Security
- All internet traffic encrypted (TLS / HTTPS).
- Each machine has its own MQTT username and password.
- Secret keys are never stored in the code repository.
- Dashboard requires login; passwords stored hashed.
- No customer personal data is stored (only payment IDs and amounts).

### 9.4 Scalability
- Adding a machine needs only registration in the dashboard and flashing its settings.
- Backend can run more copies when there are more machines.

### 9.5 Maintainability
- Clear module structure, automatic tests and documentation.
- Shared message formats and fault codes are defined in one place.
- Firmware can be updated remotely later (over-the-air).

### 9.6 Sanitation / Safety
- Food-grade tank, tubing and nozzle.
- Electronics separated from water parts.
- Regular cleaning schedule (see Operations doc).

---

## 10. Error Handling & Recovery

### 10.1 Hardware Errors

| Problem | What happens | Recovery |
|---|---|---|
| Tank empty | Stop; "Out of Service"; alert | Operator refills → machine returns automatically |
| Bottle removed | Stop within 100 ms; report `PARTIAL` | Refund review for the missing part |
| No flow / sensor / pump / valve fault | Stop; report fault; "Out of Service" | Technician fixes, then self-check |
| Power lost during filling | On restart, report `POWER_LOSS_RECOVERY` | Refund review |

### 10.2 Network Errors

| Problem | What happens | Recovery |
|---|---|---|
| Wi-Fi or server down while idle | Screen shows "Offline" | Auto reconnect |
| Down during filling | STM32 finishes or stops safely; result saved | Result sent when back online |
| UART link lost (no `PING` for 15 s) | STM32 shows "Offline" when idle | Auto when the link returns |
| No result after 5 min | Payment marked "unknown"; alert | Wait for the saved result or operator check |

### 10.3 Payment Errors

| Problem | What happens | Recovery |
|---|---|---|
| ABA not responding | Retry; machine shows "Service unavailable" after 3 tries | Customer tries again |
| QR expired | Back to start | Customer starts again |
| Paid after expiry | No water | Refund review |
| ABA callback lost | Backend keeps checking with ABA | Payment found automatically |
| Customer pays twice for the same QR | Dispense once only | Second one refunded |

---

## 11. Testing & Acceptance Criteria

### 11.1 Functional Testing
- Each part tested alone: STM32 (sensors, valves, screens), ESP32 (Wi-Fi, MQTT, UART), backend (payments, rules).

### 11.2 Integration Testing
- STM32 ↔ ESP32 over UART.
- ESP32 ↔ backend over MQTT.
- Backend ↔ ABA sandbox.

### 11.3 End-to-End Testing
- Full purchase with the ABA simulator app: choose → pay → fill → result saved.
- Failure tests: cancel, expiry, bottle removed, tank empty, Wi-Fi unplugged during filling, power cut.

### 11.4 Acceptance Criteria
The system is accepted when:
- [ ] 50 test purchases in a row succeed with correct volume (±1 %).
- [ ] Every failure test ends in a safe stop **and** a correct record (water or refund review).
- [ ] No water is ever dispensed without payment.
- [ ] No payment dispenses twice.
- [ ] Results saved during an internet outage arrive after reconnecting.
- [ ] Dashboard shows correct machine status, sales and alerts.
- [ ] Pilot machine runs 2 weeks without critical problems.

---

## 12. Deployment & Maintenance

### 12.1 Environments

| Environment | Used for |
|---|---|
| **Local** | Development on our laptops (ABA sandbox or mock) |
| **Staging** | Test server, same as production but with test money |
| **Production** | Real server (Singapore) with real ABA account |

### 12.2 Firmware Updates
- Now: flash by USB (ESP32 with PlatformIO, STM32 with Keil).
- Later: ESP32 over-the-air updates from the server.

### 12.3 Maintenance
- Operator: refill the tank and clean the nozzle as needed.
- Weekly: check filters, leaks, and the scale.
- Monthly: calibrate the scale and the flow sensor.
- Server: automatic daily database backups and monitoring.

---

## 13. Traceability Matrix

| Requirement | Workflow | Test |
|---|---|---|
| FR-STM-01 to 06 (UI) | 4.4 | Screen check on device |
| FR-STM-07 to 09 (bottle) | 4.4, 4.5 | Bottle placement and timeout test |
| FR-STM-10 to 12 (dispensing) | 4.4 | Volume accuracy test (50 runs) |
| FR-STM-16 to 19 (safety) | 4.5, 4.6 | Bottle removed, tank empty, power cut tests |
| FR-ESP-01 to 04 (network) | 4.6 | Wi-Fi unplug / broker restart test |
| FR-ESP-08 to 10 (offline/retry) | 4.6 | Internet off during filling test |
| FR-BE-01 to 05 (payment) | 4.4, 4.5 | ABA sandbox purchase, double payment test |
| FR-BE-10 to 11 (refunds) | 4.5 | Refund review test |
| FR-BE-08, 12 (monitoring/alerts) | 4.7 | Offline and tank-low alert test |
| FR-DB-01 to 06 (dashboard) | 4.3 | Dashboard user test |

---

## 14. Approvals & Sign-Off

| Role | Name | Signature | Date |
|---|---|---|---|
| Hardware & STM32 Developer | | | |
| Backend & ESP32 Developer | | | |
| Project Supervisor / Owner | | | |

---

## Appendix

### A. Related Documents
- [Bill of Materials](../02-Hardware-Design/bill-of-materials.md)
- [Circuit & Wiring](../02-Hardware-Design/circuit-and-wiring.md)
- [Calibration Guide](../03-Firmware-Control/calibration-guide.md)
- [Test Checklist](../06-Testing-and-Operations/test-checklist.md)
- [Operations & Troubleshooting](../06-Testing-and-Operations/operations-and-troubleshooting.md)

### B. Open Questions
- **For ABA:** refund API for KHQR, rate limits, callback retry rules, KHR in live account (full list in Implementation Plan §F3).
- **For the hardware team:** confirm the safety rules in 7.5 and the 60 s bottle timeout; confirm the STM32 has memory to keep the last result after reboot.

### C. Revision History

| Version | Date | Change |
|---|---|---|
| 2.0 | Nov 2026 | First SRS (single ESP32-S3 + 4G design) |
| 3.0 | Nov 2026 | Rewritten for STM32 + ESP32 + MQTT design; simplified for easy reading |
