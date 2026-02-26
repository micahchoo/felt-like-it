#!/usr/bin/env bash
set -euo pipefail

# ── Felt Like It — Restore ─────────────────────────────────────────────────────
# Restores from a backup created by backup.sh.
# Usage: ./docker/restore.sh <timestamp>
#   e.g.: ./docker/restore.sh 20260226-143000
# Or pass full path: ./docker/restore.sh ./backups/db-20260226-143000.sql.gz

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/../backups"

# Auto-detect compose files (base + prod if present)
COMPOSE_CMD="docker compose -f $SCRIPT_DIR/docker-compose.yml"
if [ -f "$SCRIPT_DIR/docker-compose.prod.yml" ] && $COMPOSE_CMD -f "$SCRIPT_DIR/docker-compose.prod.yml" ps --quiet 2>/dev/null | head -1 | grep -q .; then
  COMPOSE_CMD="$COMPOSE_CMD -f $SCRIPT_DIR/docker-compose.prod.yml"
fi

# Derive project-prefixed volume name
PROJECT_NAME="$($COMPOSE_CMD config --format json 2>/dev/null | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)"
PROJECT_NAME="${PROJECT_NAME:-felt-like-it}"
UPLOADS_VOLUME="${PROJECT_NAME}_uploads"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <timestamp|path>"
  echo ""
  echo "Available backups:"
  if [ -d "$BACKUP_DIR" ]; then
    ls -1 "$BACKUP_DIR"/db-*.sql.gz 2>/dev/null | sed 's|.*db-||;s|\.sql\.gz||' | sort -r
  else
    echo "  (none)"
  fi
  exit 1
fi

INPUT="$1"

# Resolve timestamp vs full path
if [ -f "$INPUT" ]; then
  DB_FILE="$INPUT"
  TS="$(basename "$DB_FILE" | sed 's/db-//;s/\.sql\.gz//')"
  UPLOADS_FILE="$BACKUP_DIR/uploads-$TS.tar.gz"
elif [ -f "$BACKUP_DIR/db-$INPUT.sql.gz" ]; then
  TS="$INPUT"
  DB_FILE="$BACKUP_DIR/db-$TS.sql.gz"
  UPLOADS_FILE="$BACKUP_DIR/uploads-$TS.tar.gz"
else
  echo "ERROR: No backup found for '$INPUT'"
  exit 1
fi

echo "Restoring from backup $TS..."
echo "  DB:      $DB_FILE"
echo "  Uploads: $UPLOADS_FILE"
echo ""

read -rp "This will DROP the current database. Continue? [y/N] " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# ── Stop app containers (keep postgres + redis running) ───────────────────────
echo "Stopping web + worker..."
$COMPOSE_CMD stop web worker martin || true

# ── Restore database ──────────────────────────────────────────────────────────
echo "Restoring database..."
$COMPOSE_CMD exec -T postgres \
  psql -U felt -d postgres -c "DROP DATABASE IF EXISTS felt;"
$COMPOSE_CMD exec -T postgres \
  psql -U felt -d postgres -c "CREATE DATABASE felt;"

gunzip -c "$DB_FILE" | $COMPOSE_CMD exec -T postgres \
  psql -U felt -d felt --quiet

echo "  Database restored."

# ── Restore uploads ───────────────────────────────────────────────────────────
if [ -f "$UPLOADS_FILE" ]; then
  echo "Restoring uploads..."
  $COMPOSE_CMD run --rm -T \
    -v "${UPLOADS_VOLUME}:/uploads" \
    --entrypoint "" \
    web sh -c "rm -rf /uploads/* && tar xzf - -C /uploads" < "$UPLOADS_FILE"
  echo "  Uploads restored."
else
  echo "  No uploads backup found — skipping."
fi

# ── Restart everything ────────────────────────────────────────────────────────
echo "Starting services..."
$COMPOSE_CMD up -d

echo ""
echo "Restore complete. Migrations will run automatically on startup."
