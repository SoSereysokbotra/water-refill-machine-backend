# 💧 Water Refill Machine — Engineering Documentation

A streamlined, production-focused documentation library for the **IoT Cashless Water Refill Vending Machine** (ESP32-S3 + SIM7600 4G + Dual-Check Dispensing).

---

## 📚 Quick Navigation Index (13 Essential Docs)

```text
📁 docs/
│
├── 📋 01-Project-Overview/
│   ├── system-overview.md             ← Executive brief, architecture diagram, user flow, specs
│   ├── team-roles.md                  ← Engineering responsibilities & deliverables
│   └── product-architecture-roadmap.md ← STM32 + ESP32 + MQTT product architecture, stack & roadmap
│
├── 🔧 02-Hardware-Design/
│   ├── bill-of-materials.md           ← Complete 14-part BOM with specs, prices & suppliers
│   ├── esp32-pin-mapping.md           ← Full GPIO pin table (SPI, UART, Relays, Sensors)
│   └── circuit-and-wiring.md          ← Schematics, 12V/5V/3.3V power, driver circuits & noise rules
│
├── 💻 03-Firmware-Control/
│   ├── state-machine-logic.md         ← State machine transitions, 2-stage dispensing & dual-check
│   ├── firmware-architecture.md       ← FreeRTOS core allocation, tasks & queues
│   └── calibration-guide.md           ← HX711 scale & YF-S201 flow calibration procedures
│
├── 🌐 04-Cloud-and-Payment/
│   ├── qr-payment-flow.md             ← Cashless QR payment lifecycle & timeouts
│   ├── api-and-database.md            ← REST API endpoints & PostgreSQL schema
│   ├── stm32-qr-payment-integration.md ← STM32 ↔ backend QR payment guide
│   ├── backend-architecture.md        ← Modular monolith · DDD · Hexagonal · CQRS · Outbox
│   └── backend-implementation-plan.md ← Phase-by-phase build plan, contracts, errors, DoD
│
├── 🏗️ 05-Mechanical-and-Plumbing/
│   ├── enclosure-and-tank.md          ← Stainless 304 dimensions, layout & 60L tank
│   └── plumbing-diagram.md            ← Fluid schematic, tubing, pump & dual-solenoid valves
│
└── ✅ 06-Testing-and-Operations/
    ├── test-checklist.md              ← 12-point Quality Assurance field test checklist
    ├── operations-and-troubleshooting.md ← Refill SOP, maintenance schedule & troubleshooting
    └── deployment.md                  ← Environments, CI/CD, zero-downtime, backups, security
```

---

## ⚡ Quick Specs Reference
- **Core Controller**: ESP32-S3 (Dual-Core 240MHz, 8MB Flash)
- **Telemetry**: SIM7600 4G LTE Breakout (UART)
- **Dispensing Volumes**: 0.5 L, 0.75 L, 1.0 L (Selectable on 2.8" TFT Touchscreen)
- **Dispensing Accuracy**: $\pm 1\%$ via Dual-Check (YF-S201 Hall Flow + HX711 Load Cell)
- **Reservoir**: 60 Liters Food-Grade Tank with Triple Float Sensors (Low/Mid/High)
- **Actuation**: 12V DC Diaphragm Pump + Fast Solenoid (Bulk) + Slow Solenoid (Trim)
- **Power**: 110V/220V AC input $\rightarrow$ Mean Well 12V/8.5A PSU $\rightarrow$ 5V Buck $\rightarrow$ 3.3V LDO

