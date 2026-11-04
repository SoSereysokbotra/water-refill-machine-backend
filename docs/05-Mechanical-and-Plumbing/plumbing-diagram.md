# Plumbing Diagram & Water Routing

## 1. Fluid Schematic

The water path follows a pressurized, dual-valved route ensuring rapid flow followed by a non-drip precision finish:

```text
 ┌───────────────┐
 │   60L TANK    │ (Food-grade HDPE/Stainless)
 └───────┬───────┘
         │ 1/2" Tubing
         ▼
 ┌───────────────┐
 │ PRE-FILTER    │ (50-mesh stainless inline particulate strainer)
 └───────┬───────┘
         │
         ▼
 ┌───────────────┐
 │ 12V DC PUMP   │ (Diaphragm, 3.5 L/min self-priming)
 └───────┬───────┘
         │
         ▼
 ┌───────────────┐
 │  CHECK VALVE  │ (1-way backflow preventer)
 └───────┬───────┘
         │
         ├───▶ [ BRANCH SPLIT ] ───────────────────┐
         │                                         │
         ▼                                         ▼
 ┌───────────────┐                         ┌───────────────┐
 │ FAST SOLENOID │ (12V Normally Closed)   │ SLOW SOLENOID │ (12V Normally Closed)
 │  (Main Flow)  │                         │(Fine Orifice) │
 └───────┬───────┘                         └───────┬───────┘
         │                                         │
         └───▶ [ RE-COMBINE TEE ] ◀────────────────┘
                     │
                     ▼
             ┌───────────────┐
             │  FLOW SENSOR  │ (YF-S201 Hall-Effect)
             └───────┬───────┘
                     │ 3/8" Food-grade Silicone
                     ▼
             ┌───────────────┐
             │DISPENSE NOZZLE│ (304 Stainless with aerator / anti-drip mesh)
             └───────┬───────┘
                     │
                     ▼
                 [ BOTTLE ]
```

---

## 2. Plumbing Hardware Specifications

| Component | Size / Type | Food-Grade Standard | Notes |
|---|---|---|---|
| **Tubing** | $1/2"\text{ OD}$ Polyethylene (PE) / Silicone | NSF/ANSI 51 & 61 certified | Flexible, pressure rated up to $0.8\text{ MPa}$ |
| **Fittings** | Quick-connect push-fit (John Guest style) | POM / Food-grade plastic | Leak-proof double O-ring design |
| **Check Valve** | $1/2"$ Spring-loaded inline check valve | Stainless steel spring & silicone seat | Prevents line drainback to pump |
| **Fast Solenoid** | $12\text{V DC}$, $1/2"$ orifice | EPDM diaphragm, food-grade | High flow rate (~3.0 L/min) |
| **Slow Solenoid** | $12\text{V DC}$, restricted $1/4"$ orifice | EPDM diaphragm, food-grade | Low flow rate (~0.8 L/min) |
| **Dispense Nozzle** | $12\text{ mm}$ 304 Stainless Steel curved pipe | Sanitary 304 SS | Includes laminar mesh to eliminate splashing |

