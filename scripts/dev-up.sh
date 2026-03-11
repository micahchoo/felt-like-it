#!/usr/bin/env bash
# Start infrastructure, apply migrations, then launch dev server.
# Usage: pnpm dev:up
set -euo pipefail

COMPOSE_FILE="docker/docker-compose.yml"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# ── 1. Start Postgres + Redis (idempotent — no-ops if already running) ───────
echo "Starting services..."
docker compose -f "$COMPOSE_FILE" up -d postgres redis

# ── 2. Wait for Postgres to be healthy ───────────────────────────────────────
echo -n "Waiting for Postgres"
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -q 2>/dev/null; then
    echo " ready."
    break
  fi
  echo -n "."
  sleep 1
  if [ "$i" -eq 30 ]; then
    echo " timed out!"
    exit 1
  fi
done

# ── 3. Run migrations (idempotent — skips already-applied) ──────────────────
echo "Running migrations..."
pnpm migrate

# ── 4. Start dev server ─────────────────────────────────────────────────────
echo "Starting dev server..."
exec pnpm dev
