# Felt Like It — Architecture

Living document describing the **built** system as of Phase 5 (Feb 2026).
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
| `map_collaborators` | `id uuid PK`, `map_id FK CASCADE`, `user_id FK CASCADE`, `role text` (viewer\|commenter\|editor), `invited_by FK SET NULL`; UNIQUE(map_id, user_id) |
| `comments` | `id uuid PK`, `map_id FK CASCADE`, `user_id FK SET NULL`, `author_name text`, `body text`, `resolved bool`, `created_at`, `updated_at` |
| `map_events` | `id uuid PK`, `map_id FK CASCADE`, `user_id FK SET NULL`, `event_type text`, `payload jsonb`, `created_at` |

`maps` also has `is_template bool default false` — template maps are shared across all users and cloned config-only (features are not copied).

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
| maps | list, get, create, update, delete, clone, listTemplates, createFromTemplate | protected |
| layers | list, get, create, update, delete, reorder | protected |
| features | list, upsert, delete | protected |
| styles | update | protected |
| shares | create, update, getByToken | create/update: protected; getByToken: public |
| collaborators | list, invite, remove, updateRole | protected |
| comments | list, create, delete, resolve | protected |
| comments | listForShare, createForShare | public (share token validated against `shares` table) |
| events | list, log | protected |
| geoprocessing | run | protected |

**Embed route** (`/embed/[token]`): same token lookup as `/share/[token]` but renders `MapEditor` with `embed={true}` — no toolbar, no layer panel, no basemap picker, no side panels. Sets `Content-Security-Policy: frame-ancestors *` via `setHeaders` so the page can be framed from any origin. The share viewer (`/share/[token]`) provides a "Embed" button that copies the `<iframe src="/embed/[token]" ...>` snippet to the clipboard.

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
       | 'heatmap'              // deck.gl HeatmapLayer (point layers only, no MapLibre paint)
  config?: {
    labelAttribute?:        string   // drives SymbolLayer text-field
    categoricalAttribute?:  string   // which property drives categorical coloring
    numericAttribute?:      string   // which property drives numeric coloring
    categories?:            string[] // ordered unique category values
    steps?:     [number, string][]   // breakpoints for numeric [value, color]
    showOther?:              boolean              // false = hide uncategorized features
    classificationMethod?:  'equal_interval' | 'quantile' // choropleth
    nClasses?:              number               // 2–9 (choropleth)
    colorRampName?:         string               // ColorBrewer ramp name (choropleth)
    heatmapRadius?:         number               // 1–200 px (heatmap kernel)
    heatmapIntensity?:      number               // 0.1–5 (heatmap brightness)
    heatmapWeightAttribute?: string              // feature property as weight (heatmap)
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

**Exception — `style.type === 'heatmap'`**: layers are skipped entirely by MapLibre and rendered instead by `DeckGLOverlay.svelte`. The overlay uses `@deck.gl/mapbox`'s `MapboxOverlay` (an `IControl`, `interleaved: false`) to mount a separate deck.gl canvas above the MapLibre canvas. `HeatmapLayer` (from `deck.gl@9`) receives the GeoJSON Point features and is re-synced via `setProps` whenever layers or their config change.

**Tiles fallback** (>10,000 features): the Martin VectorTileSource path also skips heatmap layers — `isHeatmap` check gates both the GeoJSON and vector-tile branches in the `{#each}` loop.

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
  → detect format: GeoJSON | CSV | Shapefile | KML | GPX | GeoPackage
  → GeoJSON:     parse → validate → batch INSERT features (ST_GeomFromGeoJSON)
  → CSV:         papaparse → detect lat/lng columns (or geocode address column) → batch INSERT
  → Shapefile:   shpjs (.shp/.zip) → GeoJSON → batch INSERT
  → KML/GPX:     @tmcw/togeojson + @xmldom/xmldom → GeoJSON → batch INSERT
  → GeoPackage:  sql.js WASM SQLite → OGC binary header parse → ST_GeomFromWKB + ST_Transform → batch INSERT
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

## Collaboration (Phase 3)

### Granular Permissions

`map_collaborators` records users invited to a map with a role (`viewer`, `commenter`, `editor`). Roles are enforced on all tRPC procedures and the editor page load via `requireMapAccess()` in `$lib/server/geo/access.ts`.

```
collaborators.invite({ mapId, email, role })
  → ownership check → find user by email → self-invite guard → duplicate check → insert
collaborators.remove({ mapId, userId })     → ownership check → delete
collaborators.updateRole({ mapId, userId, role }) → ownership check → update + returning
```

### Comment Threads

`comments` table stores all comments with `author_name` denormalized at insert time (survives user deletion). Map owner can resolve/unresolve. Guests can comment via share links using public procedures:

- `comments.createForShare({ shareToken, authorName, body })` — validates share token, inserts with `userId: null`
- `comments.listForShare({ shareToken })` — no auth required

### Activity Feed

`map_events` records client-side events (imports, viewport saves) for display in `ActivityFeed.svelte`. Written via `events.log` from `MapEditor.svelte` after key actions.

---

## Geoprocessing (Phase 4)

Seven PostGIS operations available via `geoprocessing.run({ op, mapId })`:

| Operation | SQL | Inputs |
|---|---|---|
| Buffer | `ST_Buffer(::geography, distM)::geometry` | single layer + `distanceKm` |
| Convex Hull | `ST_ConvexHull(ST_Collect(...))` | single layer |
| Centroid | `ST_Centroid(geometry)` | single layer |
| Dissolve | `ST_Union(geometry)` grouped by optional `field` | single layer |
| Union | `ST_Union(geometry)` whole layer | single layer |
| Intersect | `ST_Intersection` with `ST_Intersects` guard | two layers |
| Clip | `ST_Intersection` cross join | two layers |

Output layers always get `type: 'mixed'` — safe for geometry-type-changing ops like Buffer. The `GeoprocessingOpSchema` discriminated union in `packages/shared-types` is the single source of truth for op validation and UI labels.

The `geoprocessing.run` mutation:
1. Verifies ownership of all input layers (one `SELECT` per layer — avoids Drizzle `inArray` column inspection)
2. Inserts the output layer row
3. Calls `runGeoprocessing(op, newLayerId)` — exhaustive switch via `assertNever`
4. Rolls back output layer on error

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
martin   → ghcr.io/maplibre/martin (port 3001 external, 3000 internal)
```

Martin auto-discovers PostGIS geometry tables and serves vector tiles. Layers with >10,000 features switch from `GeoJSONSource` to `VectorTileSource` automatically. Set `PUBLIC_MARTIN_URL=""` to disable and always use GeoJSON.

Volumes: `postgres_data`, `redis_data`, `uploads`.
All services on `felt-network`. Health-check: `wget -qO- http://127.0.0.1:3000/` (Alpine resolves `localhost` to `::1` — use `127.0.0.1`).

---

## Environment Variables

| Variable | Default (compose) | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://felt:felt@postgres:5432/felt` | PostgreSQL connection |
| `REDIS_URL` | `redis://redis:6379` | Redis (BullMQ) |
| `UPLOAD_DIR` | `/uploads` | File upload directory |
| `ORIGIN` | `http://localhost:3000` | SvelteKit CSRF origin |
| `SESSION_SECRET` | _(must set)_ | 32-byte hex secret for session signing. `openssl rand -hex 32` |
| `PUBLIC_MARTIN_URL` | `http://localhost:3001` | Browser-facing Martin vector tile URL. Set to `""` to disable. |
| `NOMINATIM_URL` | _(unset)_ | Self-hosted Nominatim for address geocoding. Defaults to OSM Nominatim. |
| `GEOCODING_USER_AGENT` | _(unset)_ | User-agent string sent with Nominatim requests. Required when geocoding is used. |

---

## Current State (Phase 5 complete, Feb 2026)

**Tests:** 570 (web: 296 · geo-engine: 178 · shared-types: 96) · **Migrations:** 0000–0008 · **Services:** 5 · **svelte-check:** 0 errors · 0 warnings

| Capability | Status |
|---|---|
| Auth: email/password + API Bearer keys (`flk_` prefix, SHA-256 hash-only storage) | ✅ |
| Map dashboard: create, archive, clone, templates | ✅ |
| MapLibre editor + 3 drawing tools (Point / LineString / Polygon) + undo/redo | ✅ |
| Layer panel: reorder, toggle visibility, style editor, delete | ✅ |
| Auto-styling: simple / categorical / numeric / choropleth / heatmap (deck.gl) | ✅ |
| Import: GeoJSON, CSV, Shapefile, KML, GPX, GeoPackage (BullMQ background jobs) | ✅ |
| Address geocoding via Nominatim (CSV `address` column → point layer) | ✅ |
| PostGIS geoprocessing: Buffer, Convex Hull, Centroid, Dissolve, Union, Intersect, Clip | ✅ |
| Spatial joins: point-in-polygon, nearest neighbor | ✅ |
| Aggregation: count / sum / avg point-to-polygon | ✅ |
| Measurement tools: distance, area, perimeter (Turf.js geodesic; ephemeral — no DB write) | ✅ |
| Attribute data table: search, sort, filter, click-to-zoom | ✅ |
| Ephemeral attribute filters per layer (MapLibre filter + DataTable sync) | ✅ |
| FSL-compatible style schema (filters, interpolators, label blocks, choropleth, popup) | ✅ |
| Rich annotation suite: text / emoji / GIF / image / link / IIIF NavPlace | ✅ |
| Share via link (public / unlisted token; read-only viewer) | ✅ |
| Embeddable maps (`/embed/[token]`; `frame-ancestors *`; iframe snippet copy button) | ✅ |
| Comment threads: owner + collaborators + guest commenting via share token | ✅ |
| Activity feed (`map_events` table; client-side logging) | ✅ |
| Collaborator invitations: viewer / commenter / editor roles (enforced on all tRPC routers + editor page) | ✅ |
| Audit log: tamper-evident BIGSERIAL hash chain; `appendAuditLog` on 11 mutations | ✅ |
| GeoJSON export per layer (streaming `ST_AsGeoJSON`) | ✅ |
| High-res PNG screenshot export (`pixelRatio: 2`) | ✅ |
| Martin vector tiles: layers > 10 K features → `VectorTileSource` | ✅ |
| Docker Compose: 5 services (web · worker · postgres · redis · martin) | ✅ |
| Real-time collaboration (Yjs CRDT, presence, cursors) | ⬜ Phase 6 |
| Team library (shared dataset repository) | ⬜ Phase 6 |
| pino structured logging | ⬜ Phase 5b |
| Rate limiting | ⬜ Phase 5b |
| Export: GeoPackage / Shapefile / PDF | ⬜ Phase 5b |
| Admin panel / `admin-cli.ts` | ⬜ Phase 5b |
| S3 / MinIO file storage | ⬜ Phase 5b |
| Tippecanoe tile pipeline | ⬜ Phase 5b |
| CI pipeline (GitHub Actions) | ⬜ Phase 5b |
| Playwright E2E tests | ⬜ Phase 5b |
| SSO / SAML | ⬜ Phase 7 |
| Raster support (GeoTIFF / COG) | ⬜ Phase 7 |
| Helm chart | ⬜ Phase 7 |
| Plugin system | ⬜ Phase 7 |

---

## Delta from Original Vision

Compares `OriginalVision.md` to what was actually built. See `docs/plans/2026-02-24-roadmap-restructure-design.md` for the restructure rationale.

### Deferred / Not Built

| Feature | Original Phase | Target Phase |
|---|---|---|
| Yjs CRDT real-time editing | Phase 3 | Phase 6 |
| Presence indicators / multiplayer cursors | Phase 3 | Phase 6 |
| Team library (shared dataset repository) | Phase 3 | Phase 6 |
| Tippecanoe tile pipeline | Phase 2 | Phase 5b |
| pino structured JSON logging | Vision | Phase 5b |
| Rate limiting in `hooks.server.ts` | Vision | Phase 5b |
| CI pipeline (GitHub Actions) | Vision | Phase 5b |
| Playwright E2E tests | Vision | Phase 5b |
| Vitest coverage thresholds | Vision | Phase 5b |
| GeoPackage / Shapefile / PDF export | Vision | Phase 5b |
| Admin panel + `admin-cli.ts` | Vision | Phase 5b |
| S3 / MinIO file storage | Vision | Phase 5b |
| ADRs 004–006 | Vision | Phase 5b |
| SSO / SAML (Arctic OIDC + SAML2) | Phase 5 | Phase 7 |
| Raster support (GeoTIFF + COG) | Phase 5 | Phase 7 |
| Helm chart (Kubernetes) | Phase 5 | Phase 7 |
| Plugin system | Phase 5 | Phase 7 |
| Regional hosting docs | Phase 5 | Phase 7 |

### Implementation Divergences

Where the final implementation differs from what `OriginalVision.md` specified.

| Area | Vision | Actual |
|---|---|---|
| tRPC transport | `trpc-sveltekit` with WebSocket support | tRPC 11 native Fetch adapter (no WebSocket) |
| `db/` package location | Standalone `packages/db/` package | Merged into `apps/web/src/lib/server/db/` |
| Martin tile server | Custom `services/tile-server/` service | Stock `ghcr.io/maplibre/martin` Docker image |
| Application logging | pino structured JSON | `console.warn/error` with `[INF/WRN/ERR]` prefix |
| File storage | Local disk + S3/MinIO | Local disk volume only |
| Rate limiting | `hooks.server.ts` rate limiter | Not implemented |
| ESLint TypeScript rules | `no-explicit-any: error`; `no-unsafe-*`; `parserOptions.project` | `parserOptions.project` removed (TypeScript OOM); `no-unsafe-*` omitted |
| Test coverage gates | `vitest.config.ts` thresholds enforced in CI | No thresholds; CI not configured |
| Migration authoring | `drizzle-kit generate` + testcontainers integration tests | Hand-authored SQL (PostGIS geometry DDL); no testcontainers |
| ADRs | 6+ decision records | 3 ADRs written (001–003); 004–006 planned for Phase 5b |
| Comments access | Collaborator roles from day one | Initially owner-only; fixed in Phase 5 bug-squash |

### Added Scope

Features built that were not in `OriginalVision.md`.

| Feature | Added in |
|---|---|
| FSL-compatible style schema (`version`, `config`, `label`, `filters`, `attributes`, `popup` blocks, zoom interpolators) | Phase 2 |
| Choropleth styling with 9 ColorBrewer ramps + quantile / equal-interval classification | Phase 4 |
| deck.gl heatmap overlay (`MapboxOverlay` + `HeatmapLayer`; `style.type === 'heatmap'`) | Phase 4 |
| Rich annotation suite (text / emoji / GIF / image / link / IIIF NavPlace; PostGIS Point anchor) | Phase 4 |
| Undo / redo store (command history for drawn features) | Phase 2 |
| Tamper-evident audit log (BIGSERIAL hash chain with `pg_advisory_xact_lock` serialisation) | Phase 5 |
| API keys (`flk_` prefix; SHA-256 hash-only storage; `hooks.server.ts` Bearer auth) | Phase 5 |
| Dashboard "Shared with me" section (`maps.listCollaborating`) | Phase 5 |
