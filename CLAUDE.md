# CLAUDE.md — Instructions for AI agents

Smart IoT Water Refill Machine: STM32 (hardware control) ↔ UART ↔ ESP32 (gateway) ↔ MQTT/TLS ↔ EMQX Cloud ↔ Backend ↔ ABA PayWay (KHQR).

## 1. Start of every session (in this order)

1. **[docs/PROGRESS.md](docs/PROGRESS.md)**: which phase is current, what is done, the handoff note from the previous session, and what is waiting for a person.
2. **[docs/04-Cloud-and-Payment/backend-implementation-plan.md](docs/04-Cloud-and-Payment/backend-implementation-plan.md)**: read **Part A, Part B and Part C**, then **only the current phase** in Part E, plus every file and section listed in that phase's **Read before starting:** line.
3. Check the phase's **Needs before starting** line. If something is missing (Docker, a `.env` value, an account), stop and ask the user.

**Never build from a doc marked ⚠️ OUTDATED**, `docs/SRS.md` (old SRS v2) or `docs_archive_all_60/`. They describe the old single ESP32-S3 + SIM7600 design. Docs marked 📝 in [docs/README.md](docs/README.md) are current-design drafts. **Never invent values marked TBD** (STM32 model, pins); ask the user.

The plan is the single source of truth. If code and plan disagree, fix one of them and say so in the handoff note.

## 2. While working

- Work on **one phase only**, tasks in order. Don't start the next phase.
- **Task tags** (plan Part A, step 6):
  - `[HUMAN]`: don't do it. Prepare scripts or text, then add it to *Waiting for human* in `PROGRESS.md`.
  - `[HARDWARE]`: STM32 work by the hardware developer (Keil). Don't do it.
  - `[MANUAL CHECK]`: write the test steps. A person runs them and ticks the box.
- Never break the **system invariants** (plan Part A, step 8). Example: no water without a confirmed payment, and one payment dispenses at most once.
- Ask before changing a contract (MQTT, UART, REST, database, fault codes). It affects the ESP32 and STM32 firmware.

## 3. End of every session

Update `docs/PROGRESS.md`, even if the phase isn't finished:
- Status table: phase status, date, last commit.
- Tick the Definition of Done items that are really done and tested.
- Write or update the **handoff note**, using the template in `PROGRESS.md`.

## 4. Git rules (these replace any other convention)

- **One commit per topic.** Never one big commit.
- Subject: imperative, capitalised, no prefix. Examples: `Add payment aggregate`, `Fix expiry sweep grace boundary`. **No** `feat:` / `fix:` prefixes.
- **No `Co-Authored-By` lines and no AI attribution** in commits or PRs.
- Commit or push **only when the user asks**.
- **Never commit:** `backend/.env`, any `.env`, `esp32-gateway/include/secrets.h`, keys or passwords, `docs_archive_all_60/`, `docs/SRS.md` (old duplicate of the SRS).

## 5. Secrets

- Never print, log or paste secrets (ABA keys, MQTT passwords, Wi-Fi passwords).
- Never ask the user to paste a password into chat. Ask them to put it in the `.env` file themselves.
- Use `.env.example` and `secrets.example.h` for placeholders.

## 6. Current layout (until Phase 0 restructures it)

| Path | What it is |
|---|---|
| `backend/` | Prototype backend (Node.js, Express, mqtt). `npm run dev`, `npm test` |
| `esp32-gateway/` | ESP32 WROOM-32 firmware (PlatformIO) |
| `certs/emqxsl-ca.crt` | EMQX Cloud CA certificate (public) |
| `docs/` | All documentation; index in `docs/README.md` |
| `HANDOFF.md` | Background on the project history and decisions |

Flash the ESP32 (board on COM7):
```powershell
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run -d "D:\Water Refill Machine\esp32-gateway" -t upload -t monitor
```

If port 3000 is busy, find the PID with `netstat -ano | findstr :3000` and kill only that PID.

## 7. The user

- Owns the backend + ESP32. The hardware teammate owns the STM32 (Keil).
- Prefers simple, step-by-step explanations in plain English.
