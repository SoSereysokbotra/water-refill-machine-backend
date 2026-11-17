# Phase 3.5: Early Pilot on Your Laptop / PC (no cloud server, no card)

Same pilot as [`readmePhase3_5.md`](readmePhase3_5.md), but the "server" is your own Windows PC with Docker Desktop.

```text
ESP32 ──MQTT/TLS──▶ EMQX Cloud ◀──MQTT/TLS── API + worker (Docker on your PC)
                                              ├─ PostgreSQL (Docker, daily backup)
                                              ├─ Redis (Docker)
                                              └─ Caddy → http://localhost:8080 (only this PC)
API ──HTTPS──▶ ABA PayWay (sandbox)
```

Cost: **$0**. The ESP32 can be anywhere with Wi-Fi: it only talks to EMQX, never to your PC directly.

**What is different from the server version**
- No HTTPS certificate and no open ports. The pilot answers on `http://localhost:8080`, only on this PC.
- ABA cannot call your PC back, so payments are confirmed by **polling ABA every 3–5 s** (already built in, same as your dev setup).
- The PC must stay **on, awake and online**, and Docker Desktop must be running. If the PC is off, the machine can't take payments.

> Tested before writing this guide (2026-11-17): empty database → all migrations applied, health OK through Caddy on port 8080, `/metrics` and `/dev` 404, protected routes 401 without login, first admin via `X-Admin-Key` → login → 200, seed, backup, restore and the optional tunnel all worked.

---

## Part A: Prepare the PC (10 min, once)

### A1. Keep the PC awake (PowerShell)
```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```
This means "never sleep while plugged in". On a laptop also go to **Control Panel → Power Options → Choose what closing the lid does → When plugged in: Do nothing**.

### A2. Docker Desktop starts by itself
Docker Desktop → **Settings → General → tick "Start Docker Desktop when you sign in"**.
The pilot containers restart automatically when Docker starts. Docker Desktop only starts after you **sign in to Windows**, so after a restart (e.g. Windows Update) sign in once.

### A3. Use the `main` branch
The pilot is built from the code that is checked out right now:
```powershell
cd "D:\Water Refill Machine"
git switch main
git pull
```

---

## Part B: Settings file (10 min, once)

### B1. Create `.env`
```powershell
cd "D:\Water Refill Machine\infra\pilot"
Copy-Item .env.laptop.example .env
notepad .env
```

### B2. Fill every `<...>`
Make a random secret with this PowerShell line. Run it once for each secret and copy each result:
```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { '{0:x2}' -f $_ })
```

| Setting | What to put |
|---|---|
| `POSTGRES_PASSWORD`, `AUTH_SECRET`, `ADMIN_API_KEY` | three **different** secrets from the line above |
| `MQTT_PASSWORD` | the EMQX password of `wrm-backend` (same as in `apps/api/.env`) |
| `PAYWAY_MERCHANT_ID`, `PAYWAY_API_KEY` | your ABA sandbox values (same as in `apps/api/.env`) |

Leave the other lines as they are. Save and close Notepad. The file is git-ignored, so it is never committed.

### B3. Only ONE backend on EMQX ⚠️
While the pilot runs, nothing else may connect to EMQX as `wrm-backend`. Otherwise the ESP32's messages are split between two backends.
Open `apps/api/.env` and point it back to the local Mosquitto:
```
MQTT_URL="mqtt://localhost:1883"
MQTT_USERNAME="wrm-backend"
MQTT_PASSWORD="password123"
```
This affects both your **dev backend** (`pnpm --filter @wrm/api dev`) and the **test suite**: both would otherwise connect to EMQX.

---

## Part C: Start and first use (15 min)

All commands use one helper script. Short form used below:
```powershell
cd "D:\Water Refill Machine"
$wrm = "infra\pilot\scripts\laptop.ps1"
```

### C1. Start
```powershell
powershell -ExecutionPolicy Bypass -File $wrm start
```
The first build takes 5–10 minutes. Expected output at the end:
```
{"status":"ok","checks":{"database":"up","redis":"up","mqtt":"up"}}
Pilot OK -> http://localhost:8080
```
If it says `"mqtt":"down"`, check `MQTT_PASSWORD` in `infra\pilot\.env`.

### C2. Add the machines WRM-001 / WRM-900
```powershell
powershell -ExecutionPolicy Bypass -File $wrm seed
```
This creates only the machines (prices 0.15 / 0.20 / 0.25 USD), **no** test users.

### C3. Create your admin account
Put your own email and a strong password in the body:
```powershell
$key = (Select-String -Path infra\pilot\.env -Pattern '^ADMIN_API_KEY=(.+)').Matches[0].Groups[1].Value
Invoke-RestMethod -Method Post http://localhost:8080/v1/users -Headers @{ 'X-Admin-Key' = $key } -ContentType 'application/json' `
  -Body '{"email":"you@example.com","password":"<strong password>","name":"Owner","role":"admin"}'
```

### C4. Test with the ESP32
Nothing changes on the ESP32: same Wi-Fi, same EMQX.
1. Open the logs in a second PowerShell window: `powershell -ExecutionPolicy Bypass -File $wrm logs`
2. Serial monitor → type `1` → scan with the ABA simulator → pay → **PAID** (within about 5 s) → type `d`.
3. The logs show the payment, and it ends as `DISPENSED`.

✅ That is the Phase 3.5 Definition of Done item *"One machine taking (simulator) payments end to end"*.

---

## Part D: Daily backup (5 min, once)

Test once by hand:
```powershell
powershell -ExecutionPolicy Bypass -File $wrm backup
```
Backups go to `C:\Users\<you>\wrm-backups`, and the last 14 days are kept.

Run it every day at 10:30 with Windows Task Scheduler (PowerShell, from the repo folder):
```powershell
$script = (Resolve-Path infra\pilot\scripts\laptop.ps1).Path
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-ExecutionPolicy Bypass -File `"$script`" backup"
$trigger = New-ScheduledTaskTrigger -Daily -At 10:30am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName 'WRM pilot backup' -Action $action -Trigger $trigger -Settings $settings
```
`-StartWhenAvailable` runs a missed backup later, e.g. if the PC was off at 10:30.

> The backups are on the same PC. Copy one to Google Drive or a USB stick from time to time.

Restore, only if needed. **This replaces the database:**
```powershell
powershell -ExecutionPolicy Bypass -File $wrm restore "$env:USERPROFILE\wrm-backups\wrm-YYYYMMDD-HHMM.dump"
```

---

## Optional: test ABA callbacks with a free public URL

You don't need this, because polling already confirms payments. Use it only if you want to see ABA's callback arrive.
```powershell
powershell -ExecutionPolicy Bypass -File $wrm tunnel
```
It prints something like `https://random-words.trycloudflare.com`. Put `PAYWAY_CALLBACK_URL=https://random-words.trycloudflare.com/v1/payway/callback` into `infra\pilot\.env`, then run `start` again.
- The URL **changes every time the tunnel restarts** (also after a PC restart). An old URL does no harm, because polling still works.
- While the tunnel runs, the API can be reached from the internet. Login is required, and `/metrics` and the dev routes stay hidden.
- To stop the tunnel: `docker compose -f infra\pilot\docker-compose.pilot.yml -f infra\pilot\docker-compose.laptop.yml stop tunnel`

---

## Everyday commands
| Task | Command |
|---|---|
| Status + health | `powershell -ExecutionPolicy Bypass -File $wrm status` |
| API logs | `powershell -ExecutionPolicy Bypass -File $wrm logs` |
| Update after new code is merged | `git switch main; git pull` then `... $wrm start` |
| Stop everything (data stays) | `powershell -ExecutionPolicy Bypass -File $wrm stop` |

## Troubleshooting
| Problem | Fix |
|---|---|
| `Missing infra\pilot\.env` | Part B1 |
| `"mqtt":"down"` | Wrong `MQTT_PASSWORD`, or EMQX user `wrm-backend` changed |
| ESP32 gets two answers / random failures | Another backend is on EMQX: your dev backend or the test suite (B3) |
| QR creation fails (ABA error) | Check `PAYWAY_MERCHANT_ID` / `PAYWAY_API_KEY`. ABA sandbox worked from your home connection before; if your internet provider changed your IP, ask ABA |
| Port 8080 is busy | Set `LAPTOP_HTTP_PORT=8081` in `.env` (and change `PAYWAY_CALLBACK_URL` to match), then `start` |
| Nothing works after a PC restart | Sign in to Windows and wait for Docker Desktop, then `status` |

## Moving to a real server later
Nothing in the code changes. Make a backup here (Part D), create the server with [`readmePhase3_5.md`](readmePhase3_5.md), copy the `.dump` file to it, run `restore.sh`, then **stop the laptop pilot** (only one backend on EMQX).

## Definition of Done (Phase 3.5)
- [ ] `[MANUAL CHECK]` One machine taking (simulator) payments end to end on the pilot (C4)
- [ ] Pilot log started (weekly notes in `docs/PROGRESS.md`)
- [ ] `PROGRESS.md` updated with handoff note
