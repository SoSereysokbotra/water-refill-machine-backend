# 💧 Water Refill Machine — Engineering Documentation

A streamlined, production-grade documentation library for the **IoT Cashless Water Refill Vending Machine** (STM32 Machine Controller + ESP32 Gateway + ABA PayWay KHQR + Dual-Check Dispensing).

> **Status legend:** ✅ Current · 📝 Current design, **draft for the hardware developer to confirm** (items marked TBD: STM32 model, pin numbers, prices)
>
> **Start here:** [PROGRESS.md](PROGRESS.md) (current phase and handoff) → [SRS v3](01-Project-Overview/srs.md) → [Implementation Plan](04-Cloud-and-Payment/backend-implementation-plan.md)

---

## 📚 Quick Navigation Index

| Status | Document | Content | Owner |
|---|---|---|---|
| | **Project** | | |
| ✅ | [PROGRESS.md](PROGRESS.md) | Current phase, DoD checklist, handoff notes | Both |
| | **📋 01-Project-Overview** | | |
| ✅ | [srs.md](01-Project-Overview/srs.md) | Software Requirements Specification v3 | Both |
| ✅ | [product-architecture-roadmap.md](01-Project-Overview/product-architecture-roadmap.md) | STM32 + ESP32 + MQTT architecture & roadmap | Backend |
| ✅ | [system-overview.md](01-Project-Overview/system-overview.md) | Executive brief, architecture diagram, user flow | Both |
| ✅ | [team-roles.md](01-Project-Overview/team-roles.md) | Engineering responsibilities & deliverables | Both |
| | **🔧 02-Hardware-Design** | | |
| 📝 | [bill-of-materials.md](02-Hardware-Design/bill-of-materials.md) | BOM with specs, prices & suppliers | Hardware |
| 📝 | [esp32-pin-mapping.md](02-Hardware-Design/esp32-pin-mapping.md) | STM32 + ESP32 pin mapping (STM32 pins TBD) | Hardware |
| 📝 | [circuit-and-wiring.md](02-Hardware-Design/circuit-and-wiring.md) | Schematics, power, driver circuits | Hardware |
| | **💻 03-Firmware-Control** | | |
| 📝 | [state-machine-logic.md](03-Firmware-Control/state-machine-logic.md) | STM32 state machine, 2-stage fill, dual-check, safety rules | Hardware |
| 📝 | [firmware-architecture.md](03-Firmware-Control/firmware-architecture.md) | STM32 + ESP32 firmware structure | Hardware |
| 📝 | [calibration-guide.md](03-Firmware-Control/calibration-guide.md) | HX711 scale & YF-S201 flow calibration | Hardware |
| ✅ | [esp32-gateway/README.md](../esp32-gateway/README.md) | ESP32 WROOM-32 gateway firmware: Wi-Fi, MQTT, UART bridge | Backend |
| | **🌐 04-Cloud-and-Payment** | | |
| ✅ | [backend-implementation-plan.md](04-Cloud-and-Payment/backend-implementation-plan.md) | **Master plan**: contracts, ABA API, schema, phases 0–11 | Backend |
| ✅ | [backend-architecture.md](04-Cloud-and-Payment/backend-architecture.md) | Modular monolith · DDD · Hexagonal · CQRS · Outbox | Backend |
| ✅ | [stm32-qr-payment-integration.md](04-Cloud-and-Payment/stm32-qr-payment-integration.md) | STM32 ↔ ESP32 UART payment guide, QR drawing code, tests | Backend |
| ✅ | [qr-payment-flow.md](04-Cloud-and-Payment/qr-payment-flow.md) | KHQR payment sequence, states, timeouts, prices | Backend |
| ✅ | [api-and-database.md](04-Cloud-and-Payment/api-and-database.md) | Summary of MQTT topics, REST API and database (full spec in Plan) | Backend |
| | **🏗️ 05-Mechanical-and-Plumbing** | | |
| 📝 | [enclosure-and-tank.md](05-Mechanical-and-Plumbing/enclosure-and-tank.md) | Enclosure dimensions, layout & 60 L tank | Hardware |
| ✅ | [plumbing-diagram.md](05-Mechanical-and-Plumbing/plumbing-diagram.md) | Fluid schematic, tubing, pump & valves | Hardware |
| | **✅ 06-Testing-and-Operations** | | |
| ✅ | [deployment.md](06-Testing-and-Operations/deployment.md) | Environments, CI/CD, backups, security | Backend |
| ✅ | [test-checklist.md](06-Testing-and-Operations/test-checklist.md) | QA field test checklist (new tests to be added) | Both |
| ✅ | [operations-and-troubleshooting.md](06-Testing-and-Operations/operations-and-troubleshooting.md) | Refill SOP, maintenance, troubleshooting | Both |

**Not documentation (don't use):** `docs/SRS.md` (old SRS v2 copy) and `docs_archive_all_60/` (legacy archive).

---

## ⚡ Quick Specs Reference
- **Machine Controller**: STM32 (Real-time safety, LCD + touch, sensors, pump, valves, dual-stage dispense)
- **Network Gateway**: ESP32 (Wi-Fi + 4G LTE SIM7600/A7670, MQTT over TLS to EMQX Cloud)
- **Payment Method**: ABA PayWay KHQR (Dynamic QR generated on backend, rendered on STM32 LCD)
- **Dispensing Volumes**: 0.5 L, 0.75 L, 1.0 L (Selectable on 2.8" TFT Touchscreen)
- **Dispensing Accuracy**: $\pm 1\%$ via Dual-Check (YF-S201 Hall Flow + HX711 Load Cell)
- **Reservoir**: 60 Liters Food-Grade Tank with Triple Float Sensors (Low/Mid/High)
- **Actuation**: 12V DC Diaphragm Pump + Fast Solenoid (Bulk) + Slow Solenoid (Trim)
- **Power**: Mean Well 12V/8.5A PSU $\rightarrow$ 5V Buck $\rightarrow$ 3.3V LDO with star-ground isolation
