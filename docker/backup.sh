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

# Auto-detect compose files (base + prod if present)
COMPOSE_CMD="docker compose -f $SCRIPT_DIR/docker-compose.yml"
if [ -f "$SCRIPT_DIR/docker-compose.prod.yml" ] && $COMPOSE_CMD -f "$SCRIPT_DIR/docker-compose.prod.yml" ps --quiet 2>/dev/null | head -1 | grep -q .; then
  COMPOSE_CMD="$COMPOSE_CMD -f $SCRIPT_DIR/docker-compose.prod.yml"
fi

# Derive project-prefixed volume name
PROJECT_NAME="$($COMPOSE_CMD config --format json 2>/dev/null | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)"
PROJECT_NAME="${PROJECT_NAME:-felt-like-it}"
UPLOADS_VOLUME="${PROJECT_NAME}_uploads"

mkdir -p "$BACKUP_DIR"

echo "Backing up felt-like-it ($TIMESTAMP)..."

# ── Database dump ──────────────────────────────────────────────────────────────
DB_FILE="$BACKUP_DIR/db-$TIMESTAMP.sql.gz"
echo "  Dumping database..."
$COMPOSE_CMD exec -T postgres \
  pg_dump -U felt -d felt --no-owner --no-privileges \
  | gzip > "$DB_FILE"
echo "  → $DB_FILE ($(du -h "$DB_FILE" | cut -f1))"

# ── Uploads volume ─────────────────────────────────────────────────────────────
UPLOADS_FILE="$BACKUP_DIR/uploads-$TIMESTAMP.tar.gz"
echo "  Archiving uploads..."
$COMPOSE_CMD run --rm -T \
  -v "${UPLOADS_VOLUME}:/uploads:ro" \
  --entrypoint "" \
  web tar czf - -C /uploads . > "$UPLOADS_FILE"
echo "  → $UPLOADS_FILE ($(du -h "$UPLOADS_FILE" | cut -f1))"

# ── Prune old backups ─────────────────────────────────────────────────────────
PRUNED=$(find "$BACKUP_DIR" \( -name "db-*.sql.gz" -o -name "uploads-*.tar.gz" \) -mtime +"$RETAIN_DAYS" -delete -print | wc -l)

if [ "$PRUNED" -gt 0 ]; then
  echo "  Pruned $PRUNED backups older than ${RETAIN_DAYS} days."
fi

echo "Backup complete."
