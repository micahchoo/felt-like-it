# Felt Like It — Architecture

Living document describing the **built** system as of Phase 2 (Feb 2026).
For the original design vision, see [`OriginalVision.md`](OriginalVision.md).
For architecture decision records, see [`adr/`](adr/).

---

## High-Level Structure

```
felt-like-it/
├── packages/
│   ├── shared-types/    # Zod schemas + inferred TypeScript types (no runtime deps)
│   └── geo-engine/      # Pure TS geo utilities: detect, validate, transform, auto-style
└── apps/
    └── web/             # SvelteKit 2 app (serves UI + API + SSR)
services/
└── worker/              # Standalone BullMQ worker process
docker/                  # docker-compose + Dockerfiles
scripts/                 # migrate.ts, seed.ts
```

**Monorepo tooling:** pnpm workspaces + Turborepo. Build order: `shared-types` → `geo-engine` → `web` (worker depends on shared-types only).

---

## Request Flow

```
Browser
  │  HTTP / WebSocket
  ▼
SvelteKit (apps/web)
  ├── +page.server.ts   → Drizzle ORM → PostgreSQL 16 + PostGIS 3.4
  ├── hooks.server.ts   → Lucia v3 session validation
  └── /api/trpc/[...trpc]
          │  tRPC 11 Fetch adapter
          ▼
      tRPC routers (maps · layers · features · styles · shares)
          │
          ▼
      Drizzle ORM (pg pool)
          │
          ▼
      PostgreSQL 16 + PostGIS 3.4
```

File uploads bypass tRPC:
```
Browser
  │  POST multipart/form-data
  ▼
/api/upload/+server.ts  → writes to /uploads volume
                        → creates import_jobs row
                        → enqueues BullMQ job
                        → returns { jobId }
Browser polls GET /api/job/[jobId]  ←→  worker updates import_jobs.progress
```

---

## Database Schema

**Engine:** PostgreSQL 16 + PostGIS 3.4 (`postgis/postgis:16-3.4-alpine`)
**ORM:** Drizzle ORM with hand-authored initial migration (drizzle-kit cannot emit PostGIS geometry DDL).
**Migration tracking:** `schema_migrations` table with `CREATE OR REPLACE TRIGGER` pattern.

| Table | Key columns |
|---|---|
| `users` | `id uuid PK`, `email unique`, `hashed_password`, `name` |
| `sessions` | `id text PK` (Lucia), `user_id FK`, `expires_at` |
| `maps` | `id uuid PK`, `user_id FK`, `title`, `description`, `viewport jsonb`, `basemap`, `is_archived` |
| `layers` | `id uuid PK`, `map_id FK`, `name`, `type` (point\|line\|polygon\|mixed), `style jsonb`, `visible`, `z_index`, `source_file_name` |
| `features` | `id uuid PK`, `layer_id FK`, `geometry geometry(Geometry,4326)`, `properties jsonb` |
| `shares` | `id uuid PK`, `map_id FK`, `token unique`, `access_level` (public\|unlisted) |
| `import_jobs` | `id uuid PK`, `map_id FK`, `layer_id FK nullable`, `status`, `file_name`, `file_size`, `error_message`, `progress int` |

**Geometry column** uses a Drizzle `customType`:
```typescript
// No WKB round-trip — use raw SQL for spatial ops:
toDriver:   (v) => sql`ST_GeomFromGeoJSON(${JSON.stringify(v)})`
fromDriver: (v) => JSON.parse(v) as GeoJSON.Geometry  // PostGIS returns GeoJSON text via ST_AsGeoJSON
```

**Bulk feature copy** (map clone) skips the ORM entirely:
```sql
INSERT INTO features (layer_id, geometry, properties)
SELECT $newLayerId, geometry, properties FROM features WHERE layer_id = $oldLayerId
```

---

## Authentication

- **Library:** Lucia v3 + `@lucia-auth/adapter-drizzle`
- **Password hashing:** `@node-rs/argon2` (`hash` / `verify`)
- **Session storage:** `sessions` table (text PK, not UUID — Lucia requirement)
- **Session validation:** `hooks.server.ts` reads `lucia.validateSession()` on every request; injects `event.locals.user` + `event.locals.session`
- **CSRF:** SvelteKit built-in (same-origin form actions + `Origin` header check on mutations)

---

## tRPC API

**Adapter:** tRPC 11 Fetch adapter at `/api/trpc/[...trpc]/+server.ts`
**Context:** `{ db, user, session }` — `user` is `null` for unauthenticated requests
**Procedures:**

| Router | Procedure | Auth |
|---|---|---|
| maps | list, get, create, update, delete, clone | protected |
| layers | list, get, create, update, delete, reorder | protected |
| features | list, upsert, delete | protected |
| styles | update | protected |
| shares | create, update, getByToken | create/update: protected; getByToken: public |

**`maps.clone`** deep-copies map + all layers + all features:
1. Insert new map row (new UUID, `title: "Copy of …"`)
2. For each layer: insert new layer row
3. For each layer pair: `INSERT INTO features SELECT … FROM features WHERE layer_id = $old`

---

## Style System (FSL-Compatible)

Styles are stored as `layers.style jsonb`. The schema lives in `packages/shared-types/src/schemas/style.ts`.

```typescript
LayerStyleSchema {
  version?: string              // FSL schema version e.g. "2.3"
  type: 'simple'                // all features one color
       | 'categorical'          // color-by string attribute
       | 'numeric'              // graduated color by numeric attribute
       | 'graduated'            // deprecated alias for 'numeric'
  config?: {
    labelAttribute?:        string   // drives SymbolLayer text-field
    categoricalAttribute?:  string   // which property drives categorical coloring
    numericAttribute?:      string   // which property drives numeric coloring
    categories?:            string[] // ordered unique category values
    steps?:     [number, string][]   // breakpoints for numeric [value, color]
    showOther?: boolean              // false = hide uncategorized features
  }
  label?: {
    visible?:    boolean
    minZoom?:    number (0–22)
    maxZoom?:    number (0–22)
    color?:      string
    haloColor?:  string
    fontSize?:   number
  }
  attributes?: Record<string, {
    displayName?: string
    format?: { mantissa?: number, thousandSeparated?: boolean }
  }>
  popup?: {
    titleAttribute?: string
    keyAttributes?:  string[]
  }
  filters?: FslFilterExpression[]   // converted to MapLibre filter at render time
  paint:   Record<string, unknown>  // MapLibre GL native paint props
  layout?: Record<string, unknown>  // MapLibre GL native layout props
  legend?: LegendEntry[]
  colorField?:  string
  colorRamp?:   string[]
}
```

### Auto-Styling Pipeline (`packages/geo-engine/src/auto-style.ts`)

```
features → pickBestField() → isCategoricalColumn? → generateCategoricalStyle()
                           → isNumericColumn?      → generateGraduatedStyle()  (outputs type:'numeric')
                           → fallback              → generateSimpleStyle()
```

### MapCanvas Rendering (`apps/web/src/lib/components/map/MapCanvas.svelte`)

Every data layer renders **3 sublayers** from one GeoJSONSource — MapLibre routes geometry natively:
```
GeoJSONSource (layer.id)
  ├── FillLayer    → Polygon geometry
  ├── LineLayer    → LineString + polygon outlines
  └── CircleLayer  → Point geometry
  └── SymbolLayer  → (only if style.config.labelAttribute set)
```

This is unconditional — no `getMaplibreType()` switch. A polygon-typed layer that has drawn Points will show them via CircleLayer.

---

## Import Pipeline

```
POST /api/upload
  → mulitpart write to /uploads/{jobId}/{filename}
  → INSERT import_jobs (status: 'pending')
  → importQueue.add(jobId, { jobId, filePath, mapId, ... })
  → return { jobId }

[BullMQ worker process]
  → UPDATE import_jobs SET status='processing'
  → detect format: GeoJSON | CSV
  → GeoJSON: parse → validate → batch INSERT features (ST_GeomFromGeoJSON)
  → CSV:     papaparse → detect lat/lng columns → build Point GeoJSON → batch INSERT
  → UPDATE import_jobs SET status='done', layer_id=...
  → publish progress events (polled by GET /api/job/[jobId])
```

**CSV coordinate detection** (`packages/geo-engine/src/detect.ts`):
- Header name heuristics: `lat/latitude/y` + `lng/lon/longitude/x`
- Fallback: scan column values for WGS84-range numbers

---

## Module Boundaries (ESLint enforced)

| From | Cannot import |
|---|---|
| `lib/components/**` | `lib/server/**` |
| `lib/stores/**` | `lib/components/**` |
| `lib/server/**` | `lib/stores/**`, `lib/components/**` |
| `routes/(public)/**` | `lib/server/auth/**` |
| `packages/geo-engine/**` | `apps/**` |
| `packages/shared-types/**` | `apps/**`, `packages/geo-engine/**` |

---

## Drawing Tools (Terra Draw v1)

```typescript
const draw = new TerraDraw({
  adapter: new TerraDrawMapLibreGLAdapter({ map }),  // no 'lib' param since ≥1.25
  modes: [PointMode, LineStringMode, PolygonMode, SelectMode, ModifyMode],
});
draw.on('finish', (id: string | number) => {
  const feature = draw.getSnapshotFeature(id);  // GeoJSON feature
  draw.removeFeatures([id]);                     // clear from Terra Draw overlay
  // → features.upsert tRPC mutation → POST to PostGIS
});
```

---

## Known Quirks & Hard-Won Fixes

| Symptom | Root Cause | Fix |
|---|---|---|
| MapLibre 5 empty paint crash | `{}` passed to FillLayer paint | `PAINT_DEFAULTS` fallback constants |
| Terra Draw finish event | API changed: was `(ids[])`, now `(id)` | `draw.getSnapshotFeature(id)` |
| Points invisible on polygon layer | `getMaplibreType` only added FillLayer | Remove switch; always render 3 sublayers |
| GeoJSON source update lag | svelte-maplibre-gl `firstRun` guard | Call `source.setData()` directly after load |
| Popup never shows after toolbar use | click blocked for tool≠null | Only block for draw tools, not `null`/`select` |
| vite@6 + vitest@2 type conflict | vitest ships vite@5 types | `import { defineConfig } from 'vite'` + `/// <reference types="vitest" />` |
| exactOptionalPropertyTypes + bind:map | prop type `map?: Map` ≠ `Map \| undefined` | `onload={(e) => { mapInstance = e.target }}` |

---

## Testing Strategy

| Package | Test files | Runner env |
|---|---|---|
| `shared-types` | `schemas.test.ts` | node (Vitest) |
| `geo-engine` | `detect.test.ts`, `auto-style.test.ts`, `validate.test.ts`, `filters.test.ts`, `interpolators.test.ts` | node (Vitest) |
| `web` | `password.test.ts`, `import-*.test.ts`, `maps.test.ts`, `layers.test.ts`, `layers-store.test.ts`, `undo-store.test.ts` | node + jsdom (Vitest) |

**Drizzle mock pattern:** `vi.mock('$lib/server/db/index.js', ...)` with `drizzleChain<T>(value)` helper.
**Critical:** `vi.resetAllMocks()` in `beforeEach` (not `clearAllMocks`) — clears pending `mockReturnValueOnce` queues.

---

## Docker Compose

```
web      → SvelteKit (port 3000), adapter-node
worker   → standalone BullMQ process (pnpm --filter worker deploy)
postgres → postgis/postgis:16-3.4-alpine  (volume: postgres_data)
redis    → redis:7-alpine                 (volume: redis_data)
```

Volumes: `postgres_data`, `redis_data`, `/uploads` (bind mount).
All services on `felt-network`. Health-check: `wget -qO- http://127.0.0.1:3000/` (Alpine: use 127.0.0.1, not localhost).

---

## Environment Variables

| Variable | Default (compose) | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://felt:felt@postgres:5432/felt` | PostgreSQL connection |
| `REDIS_URL` | `redis://redis:6379` | Redis (BullMQ) |
| `UPLOAD_DIR` | `/uploads` | File upload directory |
| `ORIGIN` | `http://localhost:3000` | SvelteKit CSRF origin |
