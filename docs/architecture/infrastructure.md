# Infrastructure

## Container Topology

```
┌─────────────────────────────────────────────────────┐
│  Docker Compose (bridge: felt-network)              │
│                                                     │
│  ┌──────────┐  ┌───────┐  ┌────────┐  ┌─────────┐ │
│  │ postgres │  │ redis │  │ martin │  │ traefik │ │
│  │ :5432    │  │ :6379 │  │ :3001  │  │ :80/443 │ │
│  │ PostGIS  │  │ 7-alp │  │ MVT    │  │ (prod)  │ │
│  └────┬─────┘  └───┬───┘  └────┬───┘  └────┬────┘ │
│       │            │           │            │      │
│  ┌────┴────────────┴───┐  ┌───┴──┐         │      │
│  │       web :3000     │  │      │    routes│      │
│  │  SvelteKit + tRPC   ├──┤martin│◄─────────┘      │
│  │  + REST API v1      │  │      │   /tiles        │
│  └────────┬────────────┘  └──────┘                 │
│           │                                         │
│  ┌────────┴────────────┐                           │
│  │   worker (×2 prod)  │                           │
│  │   BullMQ consumer   │                           │
│  │   Import processing │                           │
│  └─────────────────────┘                           │
│                                                     │
│  Volumes: postgres_data, redis_data, uploads,      │
│           acme_data (prod)                          │
└─────────────────────────────────────────────────────┘
```

### Services

| Service | Image | Port | Healthcheck |
|---------|-------|------|-------------|
| postgres | postgis/postgis:16-3.4-alpine | 5432 | `pg_isready -U felt -d felt` (5s, 10 retries) |
| redis | redis:7-alpine | 6379 | `redis-cli ping` |
| web | custom (Dockerfile.web) | 3000 | `wget http://127.0.0.1:3000/` (15s interval, 30s start) |
| worker | custom (Dockerfile.worker) | none | none |
| martin | ghcr.io/maplibre/martin:latest | 3001→3000 | depends: postgres |
| traefik | traefik:v3.3 (prod only) | 80, 443 | Let's Encrypt ACME |

### Production Overlay
- All service ports reset to `[]` (Traefik routes all traffic)
- Worker scaled to `replicas: 2`
- Redis requires password (`--requirepass`, AOF persistence)
- Traefik: HTTP→HTTPS redirect, Let's Encrypt HTTP challenge

## Database

- **Engine:** PostgreSQL 16 + PostGIS 3.4
- **Extensions:** PostGIS geometry types, GiST spatial index on `features.geometry`
- **ORM:** Drizzle ORM (config: `apps/web/drizzle.config.ts`)
- **Migrations:** Output to `apps/web/src/lib/server/db/migrations/`; run by `migrate.mjs` at container startup (idempotent)
- **Note:** drizzle-kit cannot emit PostGIS DDL — initial migration is hand-authored
- **Supplemental:** `scripts/migrations/add-api-key-scope.sql` (manual application unclear)
- **Seed:** `seed.mjs` creates default admin (`admin@felt-like-it.local` / `admin`) if users table is empty; overridable via env vars

## Queue System

- **Backend:** Redis 7 (alpine), dev: no auth, prod: password + AOF persistence
- **Library:** BullMQ 5 + ioredis
- **Queue:** `importQueue` — single job type (file import processing)
- **Flow:** Upload → write `/uploads/{jobId}/{filename}` → INSERT `import_jobs` → queue → worker parses → batch INSERT features → update status
- **Polling:** Frontend polls `GET /api/job/[jobId]` for progress

## Tile Server

- **Engine:** Martin (MapLibre vector tile server)
- **Config:** `docker/martin.yaml` — auto-discovers PostGIS geometry tables
- **URL pattern:** `{table}/{z}/{x}/{y}` (MVT)
- **Activation:** Layers > 10K features; disabled when `PUBLIC_MARTIN_URL` is empty (GeoJSON fallback)
- **Prod routing:** `https://{DOMAIN}/tiles` via Traefik `PathPrefix('/tiles')`

## CI/CD

- **Workflow:** `.github/workflows/ci.yml` — single `publish` job
- **Trigger:** Push to `main` or `master`
- **Steps:** Checkout → GHCR login → build+push web image → build+push worker image
- **Tags:** `ghcr.io/micahchoo/felt-like-it/{web,worker}:{short-sha}` + `:latest`
- **Gap:** No test, lint, svelte-check, or security gate — only builds and pushes images

## Deployment

- **Strategy:** Docker Compose + Traefik + Let's Encrypt
- **Command:** `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`
- **Registry:** GHCR (`ghcr.io/micahchoo/felt-like-it/`)
- **Portainer:** Supported via `IMAGE_TAG` env var for pinning specific image SHAs
- **TLS:** Traefik handles Let's Encrypt via HTTP challenge

## Environment Architecture

### Development (`apps/web/.env`)
- `DATABASE_URL`, `REDIS_URL`, `UPLOAD_DIR`, `ORIGIN`, `SESSION_SECRET`
- `PUBLIC_MARTIN_URL` (optional; empty = GeoJSON mode)
- `NOMINATIM_URL` (optional; defaults to OSM Nominatim)
- `API_RATE_LIMIT` (default 100000 for local stress testing)

### Production (`docker/.env`)
- `DOMAIN`, `ACME_EMAIL` — Traefik/TLS (required)
- `POSTGRES_PASSWORD`, `SESSION_SECRET`, `REDIS_PASSWORD` — generated via `openssl rand -hex 32`
- `ORIGIN` — must match `https://{DOMAIN}`
- `IMAGE_TAG` — optional Portainer pin
- `LOG_LEVEL` — debug/info/warn/error

### Secrets Management
- Plain env files (no vault/secrets manager)
- `setup.sh` auto-generates random secrets
- Prod compose uses `:?required` syntax for fail-fast on missing vars

## Development Setup

1. `pnpm dev:up` → `scripts/dev-up.sh`
2. Starts postgres + redis via Docker Compose (idempotent)
3. Waits for postgres healthcheck
4. Runs Drizzle migrations
5. Starts SvelteKit dev server (port 5173, Vite HMR)

**Note:** Worker not started by `dev-up.sh` — must be started separately for import testing. Martin also not started by default; GeoJSON fallback active.

**See also:** [ecosystem](ecosystem.md) | [subsystems](subsystems.md)
