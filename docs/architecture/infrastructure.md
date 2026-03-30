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

### Workspace Packages

```
pnpm-workspace.yaml
├── apps/web              @felt-like-it/web         (SvelteKit app)
├── packages/shared-types @felt-like-it/shared-types (geometry types, zod schemas)
├── packages/geo-engine   @felt-like-it/geo-engine   (validation, coordinate detection)
├── packages/import-engine @felt-like-it/import-engine (format parsers: CSV, GeoJSON, Shapefile, GeoPackage, KML, GPX)
└── services/worker       @felt-like-it/worker       (BullMQ import consumer)
```

**Dependency graph:** `shared-types` ← `geo-engine` ← `import-engine` ← `{web, worker}`

Turbo tasks (`turbo.json`): `build`, `check`, `lint`, `test`, `test:coverage`, `dev`. Build/check/test depend on `^build` (topological order through workspace deps).

**Dockerfile gap:** Both `Dockerfile.web` and `Dockerfile.worker` COPY manifests for `shared-types` and `geo-engine` but **not** `packages/import-engine/package.json`. This will cause Docker builds to fail once import-engine is committed — the pnpm install stage won't see it, and workspace resolution will break.

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

- **Workflow:** `.github/workflows/ci.yml` — two-job pipeline with quality gate
- **Trigger:** Push to `main` or `master` (with `concurrency: ci-${{ github.ref }}`, cancel-in-progress)
- **Job 1 — `quality`:** Checkout → pnpm install → `pnpm run lint` → `pnpm run test` → `pnpm run check` (svelte-check + tsc)
- **Job 2 — `publish`:** `needs: quality` — Checkout → GHCR login → build+push web image → build+push worker image
- **Tags:** `ghcr.io/micahchoo/felt-like-it/{web,worker}:{short-sha}` + `:latest`
- **Quality gate:** lint/test/check must all pass before any image is pushed (resolved prior gap)
- **Remaining gap:** No security scanning (SAST, container scan, dependency audit) in pipeline

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

## Index Fossils (Era Markers)

All code is **modern era** — no era divergence detected:

| Marker | Status | Evidence |
|--------|--------|----------|
| ESM (`import`/`export`) | Uniform | All package.json `"type": "module"`, all source uses ESM imports |
| async/await | Uniform | File parsers, worker processing, DB queries all async |
| TypeScript strict | Uniform | `tsc --noEmit` used as lint; explicit types throughout |
| Node 20+ / 22 | Uniform | `engines: ">=20.0.0"` in root; Docker images use `node:22-alpine` |
| pnpm 9 | Uniform | `packageManager: "pnpm@9.15.4"`, corepack in Dockerfiles |
| Vitest | Uniform | import-engine and web both use vitest for tests |

**import-engine** introduces no era divergence — it follows the same ESM + TypeScript + Vitest patterns as existing packages. One `TYPE_DEBT` marker exists (`vendor.d.ts` for sql.js missing declarations).

**See also:** [ecosystem](ecosystem.md) | [subsystems](subsystems.md)
