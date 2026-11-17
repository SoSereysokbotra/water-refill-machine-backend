#!/usr/bin/env bash
# Daily PostgreSQL backup (custom format), keeps the last 14 days.
# cron (crontab -e):  30 3 * * * /opt/wrm/water-refill-machine/infra/pilot/scripts/backup.sh >> /opt/wrm/backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
BACKUP_DIR=/opt/wrm/backups
mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/wrm-$(date -u +%Y%m%d-%H%M).dump"
docker compose -f docker-compose.pilot.yml exec -T postgres pg_dump -U wrm -d wrm -Fc > "$file"
[ -s "$file" ] || { echo "Backup is empty: $file"; rm -f "$file"; exit 1; }
find "$BACKUP_DIR" -name 'wrm-*.dump' -mtime +14 -delete
echo "$(date -u +%FT%TZ) backup OK: $file ($(du -h "$file" | cut -f1))"
