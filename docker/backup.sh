#!/usr/bin/env bash
set -euo pipefail

# ── Felt Like It — Backup ──────────────────────────────────────────────────────
# Creates timestamped Postgres dump + uploads archive.
# Usage: ./docker/backup.sh
# Backups are saved to ./backups/
# Set BACKUP_RETAIN_DAYS to control retention (default: 7).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/../backups"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-7}"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"

echo "Backing up felt-like-it ($TIMESTAMP)..."

# ── Database dump ──────────────────────────────────────────────────────────────
DB_FILE="$BACKUP_DIR/db-$TIMESTAMP.sql.gz"
echo "  Dumping database..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" exec -T postgres \
  pg_dump -U felt -d felt --no-owner --no-privileges \
  | gzip > "$DB_FILE"
echo "  → $DB_FILE ($(du -h "$DB_FILE" | cut -f1))"

# ── Uploads volume ─────────────────────────────────────────────────────────────
UPLOADS_FILE="$BACKUP_DIR/uploads-$TIMESTAMP.tar.gz"
echo "  Archiving uploads..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" run --rm -T \
  -v felt-like-it_uploads:/uploads:ro \
  --entrypoint "" \
  web tar czf - -C /uploads . > "$UPLOADS_FILE"
echo "  → $UPLOADS_FILE ($(du -h "$UPLOADS_FILE" | cut -f1))"

# ── Prune old backups ─────────────────────────────────────────────────────────
PRUNED=$(find "$BACKUP_DIR" \( -name "db-*.sql.gz" -o -name "uploads-*.tar.gz" \) -mtime +"$RETAIN_DAYS" -delete -print | wc -l)

if [ "$PRUNED" -gt 0 ]; then
  echo "  Pruned $PRUNED backups older than ${RETAIN_DAYS} days."
fi

echo "Backup complete."
