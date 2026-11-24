#!/usr/bin/env bash
# Nightly Postgres backup. Cron example (host):  0 2 * * *  /opt/codeclub-arena/scripts/backup.sh
# Optional off-box copy: set RCLONE_REMOTE (e.g. b2:club-backups) and configure `rclone config` once.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p backups
FILE="backups/game-$(date +%F).dump"

docker compose exec -T db pg_dump -U game -Fc game > "$FILE"
echo "Wrote $FILE"

# Keep 14 days locally.
find backups -name 'game-*.dump' -mtime +14 -delete

if [[ -n "${RCLONE_REMOTE:-}" ]]; then
  rclone copy "$FILE" "$RCLONE_REMOTE"
  echo "Uploaded to $RCLONE_REMOTE"
fi

# Restore test (do this monthly):
#   docker compose exec -T db pg_restore -U game -d game --clean --if-exists < backups/game-YYYY-MM-DD.dump
