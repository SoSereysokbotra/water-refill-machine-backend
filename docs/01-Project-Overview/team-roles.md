# Team Roles & Responsibilities

> The team has **two developers**. The split follows the two microcontrollers: the **hardware developer** owns the STM32 and everything physical, and the **backend developer** owns the ESP32 gateway and everything in the cloud.

## 1. Project Organization

```text
                 ┌──────────────────────────────┐
                 │  Project supervisor / owner  │
                 │  Sign-off · budget · pilot   │
                 └──────────────┬───────────────┘
                ┌───────────────┴────────────────┐
┌───────────────▼───────────────┐ ┌──────────────▼────────────────┐
│ HARDWARE DEVELOPER (Keil)     │ │ BACKEND DEVELOPER (VS Code)   │
│ STM32 firmware                │ │ ESP32 gateway firmware        │
│ Circuits · wiring · BOM       │ │ Backend (payments, data)      │
│ Sensors · pump · valves · LCD │ │ MQTT broker · ABA PayWay      │
│ Enclosure · plumbing          │ │ Dashboard · deployment        │
└───────────────┬───────────────┘ └──────────────┬────────────────┘
                └──────────── UART contract ─────┘
                     (Implementation Plan §C3)
```

---

## 2. Responsibilities

| Role | Responsibilities | Deliverables |
|---|---|---|
| **Hardware developer** | • STM32 firmware in Keil: screens, buttons, dispensing state machine, two-stage fill<br>• Sensors: HX711 load cell, YF-S201 flow, float switches<br>• Pump and valve driver circuits, power rails (12 V / 5 V / 3.3 V)<br>• **Safety rules** (C3 rules 1–5): stop by itself, bottle timeout, keep the last result<br>• UART side of the STM32 ↔ ESP32 link<br>• Enclosure, plumbing, tank | • STM32 firmware<br>• STM32 pin mapping, wiring diagram, BOM<br>• Calibration routine<br>• Hardware docs (`02-`, `03-`, `05-` folders) |
| **Backend developer** | • ESP32 firmware: Wi-Fi, MQTT, UART bridge, offline result queue<br>• Backend: ABA PayWay KHQR, payment state machine, refunds, monitoring, reports<br>• EMQX Cloud broker, server deployment, CI/CD<br>• Admin dashboard | • ESP32 firmware<br>• Backend + dashboard<br>• Implementation plan, architecture and deployment docs (`04-`, `06-` folders) |
| **Both** | • Agree the **UART contract (C3)** and **fault codes (C8)**; change them only together<br>• End-to-end testing, pilot<br>• SRS, system overview, test checklist, operations guide | • Combined test results<br>• Pilot report |
| **Project supervisor / owner** | • Approves SRS and go-live<br>• ABA merchant account, refunds (ABA portal access)<br>• Budget, pilot site | • Sign-off |

---

## 3. Working Together

| Topic | Rule |
|---|---|
| Shared contracts | UART (§C3), MQTT (§C2) and fault codes (§C8) in the [Implementation Plan](../04-Cloud-and-Payment/backend-implementation-plan.md). **Tell the other person before changing them.** |
| Progress | Tracked in [PROGRESS.md](../PROGRESS.md), including the STM32 status table |
| Testing without the other side | Backend: the ESP32 serial monitor acts as a fake STM32. Hardware: a USB-serial adapter or the ESP32 test menu acts as the network side. |
| Code | One GitHub repo; secrets never committed |
