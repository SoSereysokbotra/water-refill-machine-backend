# Phase 3.5: Early Pilot on Oracle Cloud (Always Free)

One free Oracle ARM server in Singapore runs everything:

```text
Internet ──HTTPS──▶ Caddy ──▶ API + worker (Docker)
                               ├─ PostgreSQL (Docker, daily backup)
                               └─ Redis (Docker)
API ──MQTT/TLS──▶ EMQX Cloud ◀── ESP32        API ──HTTPS──▶ ABA PayWay (sandbox)
```

Cost: **$0** (Oracle Always Free). EMQX Serverless and the ABA sandbox stay as they are.

> **No card for Oracle?** Run the same pilot on your own PC instead: [`readmePhase3_5-laptop.md`](readmePhase3_5-laptop.md).

> Tested before writing this guide: the same Docker setup was started from an empty database, all migrations applied, `/health/ready` was OK through HTTPS, `/metrics` and dev routes were hidden, login + secure cookie worked.

---

## Part A: Oracle account and server (about 30 min)

### A1. Create the account
1. Go to **cloud.oracle.com** → **Sign up**.
2. **Home region: choose `Singapore`.** ⚠️ This **cannot be changed later**, and Always Free servers can only be created in the home region.
3. A credit card is needed for identity checks. Always Free resources are not charged.
   - Do **not** click "Upgrade to Pay As You Go" for now.
   - Set a **budget alert** anyway (Billing → Budgets) at $1.

### A2. Create an SSH key (on your laptop, PowerShell)
```powershell
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\wrm-oracle
```
Press Enter twice (no passphrase) or set one. You get `wrm-oracle` (private, never share it) and `wrm-oracle.pub` (public).

### A3. Create the server
Oracle Console → **Compute → Instances → Create instance**:

| Setting | Value |
|---|---|
| Name | `wrm-pilot` |
| Image | **Canonical Ubuntu 24.04** (the aarch64 / ARM one) |
| Shape | **Ampere → VM.Standard.A1.Flex**, **2 OCPU, 12 GB RAM** (inside the free 4 OCPU / 24 GB) |
| Networking | Create new VCN + public subnet, **Assign a public IPv4 address** |
| SSH keys | **Paste public key** → contents of `wrm-oracle.pub` |
| Boot volume | 50 GB (default) |

Click **Create**.
- **"Out of capacity"** is common in Singapore. Try again later, or choose another *Availability Domain* or *Fault Domain*. It usually works within hours or days.

### A4. Make the IP fixed (static) for ABA
- **Networking → IP Management → Reserved public IPs → Reserve**.
- Then go to the instance's **Attached VNICs → IPv4 addresses**, edit, and choose the **reserved** IP.
- Write the IP down, e.g. `152.67.1.23`. ABA must whitelist this IP.

### A5. Open ports 80 and 443 (Oracle firewall)
Instance → **Subnet → Default Security List → Add Ingress Rules**:
- Source `0.0.0.0/0`, TCP, destination port **80**
- Source `0.0.0.0/0`, TCP, destination port **443**

(Port 22 for SSH is already open.)

---

## Part B: Set up the server (about 20 min)

### B1. Connect
```powershell
ssh -i $env:USERPROFILE\.ssh\wrm-oracle ubuntu@<your-ip>
```

### B2. Install Docker and open the Ubuntu firewall
```bash
sudo apt-get update && sudo apt-get install -y git netfilter-persistent
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit
```
Connect again (B1) so the `docker` group applies.

### B3. Get the code
The repository is private, so use a **read-only deploy key**:
```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_wrm -N ""
cat ~/.ssh/github_wrm.pub
```
GitHub → repository → **Settings → Deploy keys → Add deploy key**: paste it, and leave "Allow write access" **off**.
```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github_wrm
EOF
sudo mkdir -p /opt/wrm && sudo chown ubuntu:ubuntu /opt/wrm
cd /opt/wrm && git clone git@github.com:SoSereysokbotra/water-refill-machine-backend.git water-refill-machine
cd water-refill-machine
bash infra/pilot/scripts/open-firewall.sh
```
Oracle's Ubuntu blocks ports with iptables even after A5, which is why `open-firewall.sh` is needed.

### B4. Create the settings file
```bash
cd /opt/wrm/water-refill-machine/infra/pilot
cp .env.pilot.example .env
openssl rand -hex 32     # run once per secret you need, copy each result
nano .env
```
Fill every `<...>`:

| Setting | What to put |
|---|---|
| `PUBLIC_HOST` | your IP with dashes + `.sslip.io`, e.g. `152-67-1-23.sslip.io` (free name, no domain needed) |
| `POSTGRES_PASSWORD`, `AUTH_SECRET`, `ADMIN_API_KEY` | three different `openssl rand -hex 32` values |
| `MQTT_PASSWORD` | the EMQX password of `wrm-backend` (the new one) |
| `PAYWAY_MERCHANT_ID`, `PAYWAY_API_KEY` | from your ABA sandbox (same as `apps/api/.env` on your laptop) |
| `PAYWAY_CALLBACK_URL` | `https://<PUBLIC_HOST>/v1/payway/callback` |

Save with `Ctrl+O`, `Enter`, then exit with `Ctrl+X`. The file is git-ignored.

### B5. Start
```bash
cd /opt/wrm/water-refill-machine
bash infra/pilot/scripts/deploy.sh
```
The first build takes 5–10 minutes. Expected output at the end:
```
{"status":"ok","checks":{"database":"up","redis":"up","mqtt":"up"}}
Deploy OK
```
From your laptop, open `https://<PUBLIC_HOST>/health/ready` in a browser and you should see the same text, with a valid HTTPS lock.

---

## Part C: First use (about 15 min)

### C1. Only ONE backend on EMQX
**Stop the backend on your laptop**, or point your laptop's `apps/api/.env` back to the local Mosquitto (`MQTT_URL="mqtt://localhost:1883"`). Two backends on the same EMQX would split the ESP32's messages between them.

### C2. Create your admin account (on the server)
```bash
cd /opt/wrm/water-refill-machine/infra/pilot
KEY=$(grep ^ADMIN_API_KEY .env | cut -d= -f2)
HOST=$(grep ^PUBLIC_HOST .env | cut -d= -f2)
curl -X POST "https://$HOST/v1/users" -H "X-Admin-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"<strong password>","name":"Owner","role":"admin"}'
```

### C3. Add the machine WRM-001
Your ESP32 already uses machine `WRM-001` and its own EMQX user, so create the same machine on the server:
```bash
docker compose -f docker-compose.pilot.yml exec api node_modules/.bin/tsx prisma/seed.ts
```
On a server this creates **only** the machines WRM-001 / WRM-900 (prices 0.15 / 0.20 / 0.25 USD), **not** the test users. Change prices later with `PUT /v1/machines/WRM-001/prices`.

### C4. ABA
Email the ABA integration team:
- Please **whitelist the server IP** `<your IP>` for merchant `<merchant id>` (sandbox).
- Callback / pushback URL: `https://<PUBLIC_HOST>/v1/payway/callback`

Until ABA confirms the whitelist, QR creation from the server may fail with an ABA error.

### C5. Test with the ESP32
Nothing changes on the ESP32: same Wi-Fi, same EMQX.
1. Serial monitor → type `1` → scan with the ABA simulator → pay → **PAID** → type `d`.
2. On the server: `docker compose -f docker-compose.pilot.yml logs -f api` shows the payment.

---

## Part D: Daily backup (5 min)
```bash
sudo mkdir -p /opt/wrm/backups && sudo chown ubuntu:ubuntu /opt/wrm/backups
crontab -e
```
Add this line, which backs up every day at 03:30 UTC and keeps 14 days:
```
30 3 * * * /opt/wrm/water-refill-machine/infra/pilot/scripts/backup.sh >> /opt/wrm/backups/backup.log 2>&1
```
Test it once now: `bash infra/pilot/scripts/backup.sh`.

Restore, only if needed: `bash infra/pilot/scripts/restore.sh /opt/wrm/backups/<file>.dump`

> Backups stay on the same server. If the server is deleted, they are lost too. Copy one to your laptop from time to time:
> `scp -i $env:USERPROFILE\.ssh\wrm-oracle ubuntu@<ip>:/opt/wrm/backups/<file>.dump .`

---

## Updating after new code is merged
```bash
cd /opt/wrm/water-refill-machine && bash infra/pilot/scripts/deploy.sh
```
It pulls `main`, rebuilds, applies new migrations and checks health.

## Useful commands
| Task | Command (in `infra/pilot`) |
|---|---|
| Status | `docker compose -f docker-compose.pilot.yml ps` |
| API logs | `docker compose -f docker-compose.pilot.yml logs -f api` |
| Restart API | `docker compose -f docker-compose.pilot.yml restart api` |
| Stop everything | `docker compose -f docker-compose.pilot.yml down` (data stays) |

## Troubleshooting
| Problem | Fix |
|---|---|
| Browser can't open `https://…sslip.io` | Check A5 (security list 80/443) and B3 `open-firewall.sh`; `docker compose … logs caddy` |
| Caddy log: certificate error | Port 80 must be open to the internet (Let's Encrypt checks it); wait a minute and retry |
| `mqtt: down` in health | Wrong `MQTT_PASSWORD`, or EMQX user `wrm-backend` changed |
| QR creation fails (ABA error) | ABA has not whitelisted the server IP yet (C4) |
| ESP32 gets two answers / random failures | A second backend (your laptop) is connected to EMQX (C1) |

## Definition of Done (Phase 3.5)
- [ ] `[MANUAL CHECK]` One machine taking (simulator) payments end to end on the server
- [ ] Pilot log started (weekly notes in `docs/PROGRESS.md`)
- [ ] `PROGRESS.md` updated with handoff note
