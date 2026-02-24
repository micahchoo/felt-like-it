# Felt Like It

Self-hostable collaborative GIS platform. Docker Compose deployment with PostGIS spatial analysis, multi-format data import, and team collaboration.

---

## Quickstart

**Prerequisites:** Docker, Docker Compose, and Node.js 20+ with pnpm.

```bash
git clone <repo-url> felt-like-it
cd felt-like-it

# 1. Start all services
cd docker && docker compose up --build -d && cd ..

# 2. Install dependencies (needed for migration + seed scripts)
pnpm install

# 3. Apply database migrations
DATABASE_URL=postgresql://felt:felt@localhost:5432/felt pnpm migrate

# 4. Seed demo account and example map
DATABASE_URL=postgresql://felt:felt@localhost:5432/felt pnpm seed
```

Open **http://localhost:3000** and sign in:

| Field | Value |
|---|---|
| Email | `demo@felt-like-it.local` |
| Password | `demo` |

---

## What you can do

- **Create and share maps** — OSM or satellite basemap, clone from templates, share read-only links
- **Import data** — GeoJSON, CSV (lat/lng columns or address geocoding), Shapefile, KML, GPX, GeoPackage
- **Draw features** — points, lines, polygons directly on the map
- **Style layers** — simple color, categorical (color by attribute), or numeric (graduated)
- **Filter and explore** — attribute data table, text search, click-to-zoom, feature popups
- **Geoprocess** — Buffer, Clip, Intersect, Union, Dissolve, Convex Hull, Centroid via PostGIS
- **Collaborate** — invite editors, leave comment threads, share links for guests to comment
- **Export** — GeoJSON per layer, high-res PNG screenshot

---

## Configuration

Before going to production, edit the environment variables in `docker/docker-compose.yml`:

| Variable | Default | Notes |
|---|---|---|
| `SESSION_SECRET` | `change-me-…` | **Change this.** Generate: `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | `felt` | **Change this** and update `DATABASE_URL` to match |
| `ORIGIN` | `http://localhost:3000` | Set to your public URL. Required for CSRF. |
| `PUBLIC_MARTIN_URL` | `http://localhost:3001` | Browser-facing Martin URL. Set to `""` to disable vector tiles and always use GeoJSON. |
| `NOMINATIM_URL` | _(unset — uses OSM Nominatim)_ | Self-hosted Nominatim for CSV address geocoding. OSM Nominatim: max 1 req/s, no bulk use. |
| `GEOCODING_USER_AGENT` | _(unset)_ | Required alongside `NOMINATIM_URL`. |

---

## Development

```bash
# 1. Start the backing services
cd docker && docker compose up postgres redis martin -d && cd ..

# 2. Install dependencies
pnpm install

# 3. Apply migrations and seed demo data
DATABASE_URL=postgresql://felt:felt@localhost:5432/felt pnpm migrate
DATABASE_URL=postgresql://felt:felt@localhost:5432/felt pnpm seed

# 4. Start the dev server (SvelteKit on http://localhost:5173)
pnpm dev

# 5. Start the background worker (separate terminal)
pnpm --filter @felt-like-it/worker dev
```

### Tests

```bash
pnpm test           # run all packages
```

### Type-check and lint

```bash
pnpm --filter web svelte-check   # expect: 0 errors, 0 warnings
pnpm --filter web lint           # expect: 0 errors, 0 warnings
```

---

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, DB schema, request flow
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — feature status by phase
- [`docs/adr/`](docs/adr/) — key architecture decisions
