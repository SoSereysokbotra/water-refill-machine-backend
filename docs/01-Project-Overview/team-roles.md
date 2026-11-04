# Team Roles & Responsibilities

## 1. Project Organization

To ensure seamless execution, the project responsibilities are divided into clear operational domains:

```text
┌────────────────────────────────────────────────────────┐
│                    PROJECT MANAGER                     │
│    (Overall Timeline · Sourcing · Safety & Standards)  │
└───────────┬────────────────────────────────┬───────────┘
            │                                │
┌───────────▼───────────┐        ┌───────────▼───────────┐
│   HARDWARE ENGINEER   │        │   FIRMWARE DEVELOPER  │
│  Schematics · Pinouts │        │ ESP32 State Machine   │
│  Power · Component QA │        │ Sensors · FreeRTOS    │
└───────────┬───────────┘        └───────────┬───────────┘
            │                                │
┌───────────▼───────────┐        ┌───────────▼───────────┐
│  MECHANICAL ENGINEER  │        │   BACKEND DEVELOPER   │
│ Enclosure · Plumbing  │        │ Payment Gateway · API │
│ Tank & Nozzle Fitment │        │ Database · Dashboard  │
└───────────────────────┘        └───────────────────────┘
```

---

## 2. Domain Responsibilities

| Role | Primary Responsibilities | Core Deliverables |
|---|---|---|
| **Project Manager (PM)** | • Project scheduling, milestone tracking, and task priority.<br>• Component sourcing, vendor management, and budget tracking.<br>• Safety guidelines and operational regulatory compliance. | • Project roadmap & budget.<br>• Operations & Maintenance SOPs.<br>• Overall testing sign-off. |
| **Hardware Engineer** | • ESP32-S3 circuit schematics and power supply rail design (12V/5V/3.3V).<br>• Relay / MOSFET switching board integration for pump and solenoid valves.<br>• Sensor signal conditioning (HX711 noise filtering, flow sensor pull-up). | • Wiring schematic diagrams.<br>• Complete Bill of Materials (BOM).<br>• ESP32 GPIO pinout allocation. |
| **Firmware Developer** | • FreeRTOS multi-tasking architecture implementation on ESP32-S3.<br>• Finite State Machine (Idle → Payment → Volume Select → Dual-Check Dispense).<br>• Drivers for HX711, YF-S201, ILI9341 display, and SIM7600 AT commands. | • Production firmware binary.<br>• Sensor calibration routines.<br>• Local error recovery logic. |
| **Mechanical Engineer** | • Stainless steel enclosure design (3-tier compartmentation).<br>• Plumbing layout, food-grade tubing routing, check valves, and fittings.<br>• 60L water tank mounting, drain valve, and float level switch placement. | • Enclosure CAD & dimensions.<br>• Plumbing schematic diagram.<br>• Mechanical assembly guide. |
| **Backend Developer** | • Cloud REST API endpoints for telemetry and machine status.<br>• Payment gateway webhook integration for instant QR payment validation.<br>• PostgreSQL database schema design for transaction and alert history. | • Cloud API service & endpoints.<br>• Payment verification webhook.<br>• Operator web dashboard. |

