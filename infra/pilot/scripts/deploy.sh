#!/usr/bin/env bash
# Update and (re)start the pilot: pull the code, rebuild the API image, restart, check health.
# Usage (on the server):  bash infra/pilot/scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."            # infra/pilot
[ -f .env ] || { echo "Missing infra/pilot/.env (copy .env.pilot.example)"; exit 1; }

git -C ../.. pull --ff-only
docker compose -f docker-compose.pilot.yml up -d --build
docker image prune -f >/dev/null

echo "Waiting for the API to become healthy..."
for i in $(seq 1 40); do
  status=$(docker compose -f docker-compose.pilot.yml exec -T api \
    node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>r.text()).then(t=>console.log(t)).catch(()=>console.log('down'))" 2>/dev/null || true)
  if echo "$status" | grep -q '"status":"ok"'; then echo "$status"; echo "Deploy OK"; exit 0; fi
  sleep 5
done
echo "API not healthy. Logs:"; docker compose -f docker-compose.pilot.yml logs --tail 80 api; exit 1
