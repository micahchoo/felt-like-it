#!/bin/sh
set -e

# ── Parse DATABASE_URL for connection params ─────────────────────────────────
# DATABASE_URL=postgresql://user:pass@host:port/db
if [ -n "${DATABASE_URL:-}" ]; then
  # Strip scheme
  _connstr="${DATABASE_URL#*://}"
  # Extract host (between @ and : or /)
  _hostport="${_connstr#*@}"
  _hostport="${_hostport%%/*}"
  PGHOST="${PGHOST:-${_hostport%%:*}}"
  PGPORT="${PGPORT:-${_hostport##*:}}"
  # Extract user (before :)
  _userpass="${_connstr%%@*}"
  PGUSER="${PGUSER:-${_userpass%%:*}}"
fi

# ── Wait for Postgres ──────────────────────────────────────────────────────────
PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-felt}"

echo "Waiting for Postgres at ${PGHOST}:${PGPORT} (user: ${PGUSER})..."
MAX_RETRIES=60
RETRIES=0
until pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER"; do
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

# ── Seed default admin on first boot ──────────────────────────────────────────
echo "Checking seed..."
node /app/seed.mjs
echo "Seed check done."

# ── Start the app ──────────────────────────────────────────────────────────────
exec "$@"
