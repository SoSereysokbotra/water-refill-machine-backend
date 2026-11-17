#!/usr/bin/env bash
# Restore a backup made by backup.sh. THIS REPLACES THE CURRENT DATABASE.
# Usage: bash infra/pilot/scripts/restore.sh /opt/wrm/backups/wrm-YYYYMMDD-HHMM.dump
set -euo pipefail
cd "$(dirname "$0")/.."
file="${1:?usage: restore.sh <backup.dump>}"
[ -s "$file" ] || { echo "Not found or empty: $file"; exit 1; }
read -r -p "Replace the current database with $file ? Type YES: " answer
[ "$answer" = "YES" ] || { echo "Cancelled"; exit 1; }
docker compose -f docker-compose.pilot.yml stop api
docker compose -f docker-compose.pilot.yml exec -T postgres pg_restore -U wrm -d wrm --clean --if-exists < "$file"
docker compose -f docker-compose.pilot.yml start api
echo "Restore done."
