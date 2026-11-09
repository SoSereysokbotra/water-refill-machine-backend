# Project Progress & Handoff

> **AI agents and developers:** read this file first, before writing any code. Update it **at the end of every session**, even when a phase isn't finished.
> Plan: [backend-implementation-plan.md](04-Cloud-and-Payment/backend-implementation-plan.md) · Rules: [CLAUDE.md](../CLAUDE.md)

---

## 1. Current status

| | |
|---|---|
| **Current phase** | **Phase 0: Foundations** (completed, pending manual checks) |
| **Next action** | Send ABA / STM32 questions, then start Phase 1: Platform |
| **Last updated** | 2026-11-09 by Backend developer |
| **Last commit** | `c3c6c54` |

### Before Phase 0 (prototype, already working)
- ✅ Prototype backend (`backend-prototype/`): ABA sandbox KHQR payment tested end to end with the ABA simulator app
- ✅ EMQX Cloud broker running (`d41b5d19.ala.asia-southeast1.emqxsl.com:8883`)
- ✅ ESP32 firmware v0.2.0: Wi-Fi + MQTT + test menu, tested end to end
- ✅ Docs: architecture, deployment, implementation plan v3.1, SRS v3

---

## 2. Phase tracker

Status values: ⬜ Not started · 🟦 In progress · 🟨 Blocked / waiting · ✅ Done

| # | Phase | Status | Developer | Started | Finished | Last commit |
|---|---|---|---|---|---|---|
| 0 | Foundations | 🟦 | Backend developer | 2026-11-08 | | |
| 1 | Platform | ⬜ | | | | |
| 2 | Payments | ⬜ | | | | |
| 3 | Dispensing & refund review | ⬜ | | | | |
| 3.5 | Early pilot | ⬜ | | | | |
| 4 | Fleet | ⬜ | | | | |
| 5 | Monitoring | ⬜ | | | | |
| 6 | Identity | ⬜ | | | | |
| 7 | Reporting & dashboard | ⬜ | | | | |
| 8 | Observability | ⬜ | | | | |
| 9 | Production deployment | ⬜ | | | | |
| 10 | Hardening & go-live | ⬜ | | | | |
| 11 | OTA updates | ⬜ | | | | |

A phase is ✅ only when **every** Definition of Done item in the plan is ticked below, including `[MANUAL CHECK]` items confirmed by a person.

---

## 3. Definition of Done: current phase

Copy the DoD of the current phase from the plan here and tick items as they are really done and tested.

### Phase 0: Foundations
- [x] Clean clone: `pnpm i && pnpm build && pnpm test` passes
- [x] Local compose starts postgres, redis, mosquitto
- [x] A deliberate cross-layer import fails CI
- [x] ADRs merged
- [ ] `[MANUAL CHECK]` ABA questions sent; STM32 developer confirmed C3 rules (or changes merged into C3)
- [x] Prototype still runs from `backend-prototype/`
- [x] `PROGRESS.md` updated with handoff note

---

## 4. Waiting for human

Things an AI agent can't do. A person does them, then ticks the box.

| Item | Phase | Who | Status |
|---|---|---|---|
| Send ABA the 8 questions (plan §F3) | 0 | Backend developer | ⬜ |
| STM32 developer confirms UART contract C3 + fault codes C8 (questions 9–10 in §F3) | 0 | Hardware developer | ⬜ |
| Hardware developer reviews 📝 draft docs and fills in TBD (STM32 model, pins, prices) | 0 | Hardware developer | ⬜ |
| Enable branch protection on `main` | 0 | Backend developer | ⬜ |

---

## 5. Hardware status (STM32, hardware developer)

| Item | Status | Notes |
|---|---|---|
| UART link to ESP32 (115200 8N1, GPIO16/17) | ⬜ | |
| KHQR display on LCD | ⬜ | |
| Pump + valves control | ⬜ | |
| Sensors (flow, load cell, floats) | ⬜ | |
| C3 safety rules 1–5 | ⬜ | |
| Outcome saved in non-volatile memory | ⬜ | |

---

## 6. Handoff notes (newest first)

Add a new note at the top at the end of every session.

### Template (copy this)

```markdown
### YYYY-MM-DD: Phase N (<status>) by <name / agent>

**Done this session**
- …

**Not finished / next steps** (in order)
1. …

**Changed from the plan** (and whether the plan was updated)
- … / None

**Known issues / bugs**
- … / None

**How to run / test**
- `command` → expected result

**Needs from a person**
- … / None
```

---

### 2026-11-09: Phase 0 (Done, pending manual checks) by Backend developer

**Done this session**
- Completed Task 1: Restructured folders (`backend/` → `backend-prototype/`, `esp32-gateway/` → `firmware/esp32-gateway/`).
- Completed Task 2: Configured pnpm workspaces, Turborepo, `@wrm/tsconfig`, and `@wrm/contracts`.
- Completed Task 3: Scaffolded `apps/api` with NestJS 11 + Fastify, booting by `RUN_MODE` (`all`, `api`, `worker`).
- Completed Task 4: Configured ESLint strict, Prettier, and `dependency-cruiser` for clean architecture boundaries.
- Completed Task 5: Setup Vitest with SWC, money unit tests, architecture boundary validation test, and Testcontainers smoke test.
- Completed Task 6: Added `infra/docker-compose.yml` for Postgres 16, Redis 7, and Mosquitto 2 with auth and ACL.
- Completed Task 7: Setup GitHub Actions CI workflow in `.github/workflows/ci.yml`.
- Completed Task 9: Authored ADRs 0001–0008 and 0011 in `docs/adr/`.
- Completed Task 10: Prepared message templates in `readmePhase0.md` for ABA support and STM32 developer.
- Completed Task 11: Updated root docs (`README.md`, `CLAUDE.md`, `HANDOFF.md`, firmware README).

**Not finished / next steps** (in order)
1. Send ABA questions (§F3) and STM32 confirmation request (§5 in `readmePhase0.md`).
2. Start Phase 1: Platform (config, logging, errors, Prisma UoW, Outbox relay, sweeps framework, MQTT platform).

**Changed from the plan**
- None.

**Known issues / bugs**
- None.

**How to run / test**
- `pnpm install && pnpm build && pnpm test:unit` → all packages build and test pass (5/5).
- `pnpm run depcruise` → 0 architecture boundary violations.
- `npm --prefix backend-prototype test` → 3/3 prototype tests pass.

**Needs from a person**
- Send ABA and STM32 questions (see Section 4).
- Enable GitHub branch protection on `main`.

---

**Done this session**
- Implementation plan updated to v3.1 for AI-agent handoff (task tags, "Needs before starting", handoff DoD item, commit style).
- Created `CLAUDE.md`, `AGENTS.md` and this file.
- SRS rewritten as v3 (simple version): `docs/01-Project-Overview/srs.md`.

**Not finished / next steps** (in order)
1. Start Phase 0, task 1: restructure folders (`backend/` → `backend-prototype/`, `esp32-gateway/` → `firmware/esp32-gateway/`).
2. Continue Phase 0 tasks 2–11.

**Changed from the plan**
- None (plan v3.1 is current).

**Known issues / bugs**
- All 13 old-design docs were rewritten for STM32 + ESP32. Hardware docs (📝 in `docs/README.md`) are drafts: the hardware developer must fill in the STM32 board model, pin numbers and prices (marked **TBD**).
- ESP32 firmware v0.2.0 doesn't understand `PONG,<fields>` and never sends `ACK,<tran_id>`. STM32 testing notes are in `stm32-qr-payment-integration.md` §6; fixed in firmware v0.3/v0.4.
- `docs/SRS.md` is the old SRS v2 (untracked). Don't commit it.

**How to run / test**
- Prototype backend: `cd backend; npm run dev` → `http://localhost:3000/dev`; `npm test` → 3 tests pass.
- ESP32: see the flash command in `CLAUDE.md`.

**Needs from a person**
- See section 4, *Waiting for human*.
