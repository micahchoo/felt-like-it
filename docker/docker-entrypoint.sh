#!/bin/sh
set -e

# ── Wait for Postgres ──────────────────────────────────────────────────────────
echo "Waiting for Postgres..."
MAX_RETRIES=30
RETRIES=0
until pg_isready -h "${PGHOST:-postgres}" -p "${PGPORT:-5432}" -U "${PGUSER:-felt}" -q 2>/dev/null; do
  RETRIES=$((RETRIES + 1))
  if [ "$RETRIES" -ge "$MAX_RETRIES" ]; then
    echo "ERROR: Postgres not ready after ${MAX_RETRIES}s"
    exit 1
  fi
  sleep 1
done
echo "Postgres is ready."

# ── Run migrations ─────────────────────────────────────────────────────────────
echo "Running migrations..."
node /app/migrate.mjs
echo "Migrations done."

# ── Start the app ──────────────────────────────────────────────────────────────
exec "$@"
