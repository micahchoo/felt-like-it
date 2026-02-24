# Felt Like It — Roadmap

Self-hostable collaborative GIS platform. One `docker compose up` deployment.

---

## Phase 1 — Foundation (MVP) ✅ COMPLETE

**Goal:** A working map editor you can self-host in five minutes.

| Feature | Status |
|---|---|
| Email/password auth (Lucia v3 + argon2id) | ✅ |
| Map dashboard (create, rename, delete, **clone**) | ✅ |
| MapLibre GL map editor with OSM / satellite basemaps | ✅ |
| GeoJSON import (FeatureCollection + single Feature) | ✅ |
| CSV import (auto-detect lat/lng columns, skip bad rows) | ✅ |
| BullMQ background import jobs with progress polling | ✅ |
| PostGIS feature storage (`geometry(Geometry,4326)`) | ✅ |
| Mixed-geometry rendering (FillLayer + LineLayer + CircleLayer per source) | ✅ |
| Auto-styling (point → circle, line → line, polygon → fill + outline) | ✅ |
| Drawing tools: Point, LineString, Polygon (Terra Draw v1) | ✅ |
| Layer panel: toggle, reorder (drag), delete | ✅ |
| Attribute data table with text search + click-to-zoom | ✅ |
| Feature popup on click (properties display) | ✅ |
| Share-via-link (public/unlisted token, read-only viewer) | ✅ |
| GeoJSON export per layer (streaming `ST_AsGeoJSON`) | ✅ |
| PNG screenshot export (MapLibre `getCanvas().toDataURL`) | ✅ |
| Layer style editor (color, opacity, size sliders) | ✅ |
| Docker Compose: web + worker + postgres + redis | ✅ |
| Seed script: demo user + SF Parks GeoJSON | ✅ |
| Drizzle migrations (hand-authored for PostGIS geometry column) | ✅ |
| Test suite: 295 tests (shared-types 40 + geo-engine 134 + web 121) | ✅ |

**Tech:** SvelteKit 2 + Svelte 5 runes · MapLibre GL 4 · Terra Draw 1 · PostgreSQL 16 + PostGIS 3.4 · Drizzle ORM · Lucia v3 · tRPC 11 · BullMQ 5 · Tailwind CSS 4

---

## Phase 2 — Power Features 🚧 IN PROGRESS

**Goal:** Handle real-world datasets and common GIS workflows.

| Feature | Status |
|---|---|
| **Map clone** (deep-copy map + layers + features via `INSERT … SELECT` preserving geometry binary) | ✅ |
| **FSL-compatible style schema** (`version`, `config.labelAttribute/categoricalAttribute/numericAttribute`, `label` block) | ✅ |
| **Feature labels** (FSL `labelAttribute` → MapLibre SymbolLayer with `text-field`, `haloColor`, `fontSize`) | ✅ |
| **`numeric` visualization type** (renamed from `graduated`; FSL-aligned; backward-compat alias kept) | ✅ |
| **FSL `config.categories`/`steps`/`showOther`** (store detected category list + breakpoints; showOther toggles fallback color) | ✅ |
| **FSL `isClickable`** (per-layer click enable/disable in style schema + MapCanvas guard) | ✅ |
| **FSL `attributes` block** (displayName + format overrides for DataTable + popup + legend) | ✅ |
| **FSL `popup` block** (`titleAttribute`, `keyAttributes` → drives FeaturePopup) | ✅ |
| **FSL `filters` block** (infix filter expressions → MapLibre filter; applied to all sublayers) | ✅ |
| **FSL zoom interpolators** (`{ linear }`, `{ step }`, `{ exp }`, `{ cubicbezier }` → MapLibre expressions) | ✅ |
| **FSL `highlightColor`** (MapLibre `['case', ['==', ['id'], selectedId], highlightColor, base]` expression; reactive to selectionStore) | ✅ |
| **FSL `isSandwiched`** (polygon fills render below basemap label layers via `beforeId`; conditional spread to satisfy `exactOptionalPropertyTypes`) | ✅ |
| **Martin tile server integration** (large layers >10K features → vector tiles via `VectorTileSource`; `featureCount` subquery in `layers.list`; `PUBLIC_MARTIN_URL` env var; always-on Martin service in Docker Compose) | ✅ |
| **Shapefile import** (.shp/.zip via `shpjs`; BullMQ worker + dispatcher) | ✅ |
| **Attribute filters** (ephemeral UI filters per layer; `filterStore` with `toMapLibreFilter` + `applyToFeatures`; `FilterPanel.svelte`; map + DataTable updated simultaneously) | ✅ |
| **Batch insert performance** (single multi-row `INSERT…VALUES` via `sql.join` in both queries.ts + worker; one DB round-trip per 500 features) | ✅ |
| **Import retry cleanup** (`cleanupPreviousAttempt` deletes partial layer before each BullMQ retry; cascade deletes features) | ✅ |
| **Geocoding** (CSV `address`/`location`/`place_name` column → Nominatim → point layer; `geocodeBatch` with 1.1 s/req rate limit; `NOMINATIM_URL` + `GEOCODING_USER_AGENT` env vars) | ✅ |
| Tippecanoe pipeline (huge datasets → BullMQ job) | ⬜ |
| **KML import** (.kml via `@tmcw/togeojson` + `@xmldom/xmldom`; BullMQ worker + dispatcher) | ✅ |
| **GPX import** (.gpx via `@tmcw/togeojson`; same pipeline as KML) | ✅ |
| **GeoPackage import** (.gpkg via `sql.js` WASM SQLite; OGC 12-128r18 GP binary header parser; `ST_GeomFromWKB` + `ST_Transform`; SRID reprojection via PostGIS; BullMQ worker + dispatcher) | ✅ |
| **High-res image export** (map+legend captured via `html-to-image` at `pixelRatio: 2`; `preserveDrawingBuffer: true` on MapLibre; container ref synced through `mapStore.mapContainerEl`) | ✅ |
| **Map templates** (seeded template maps with `is_template = true`; `maps.listTemplates` + `maps.createFromTemplate` tRPC procs; dashboard template picker; config-only clone — features not copied) | ✅ |

---

## Phase 3 — Collaboration 🚧 IN PROGRESS

**Goal:** Multi-user real-time editing.

| Feature | Status |
|---|---|
| **Activity feed** (`map_events` table; `events.list` + `events.log` tRPC; `ActivityFeed.svelte`; client-side logging from MapEditor after imports + viewport saves) | ✅ |
| **Yjs CRDT** over WebSocket: conflict-free concurrent editing | ⬜ |
| Presence indicators: multiplayer cursors, "X is viewing/editing" sidebar | ⬜ |
| **Comment threads** (`comments` table; `comments.list`/`create`/`delete`/`resolve` tRPC; `CommentPanel.svelte`; denormalized `authorName`; map-owner-only resolve; `userId` threaded from page server → MapEditor → CommentPanel) | ✅ |
| **Guest commenting** (`publicProcedure` `listForShare` + `createForShare` on commentsRouter; `GuestCommentPanel.svelte` with authorName input; floating toggle button on share viewer page) | ✅ |
| Team library: shared dataset repository (upload once, reuse across maps) | ⬜ |
| **Granular permissions** (`map_collaborators` table; `collaborators.list`/`invite`/`remove`/`updateRole` tRPC; `CollaboratorsPanel.svelte`; roles: viewer/commenter/editor; self-invite guard; duplicate CONFLICT; error messages surfaced in UI) | ✅ |

---

## Phase 4 — Spatial Analysis

**Goal:** PostGIS geoprocessing without writing SQL.

- **PostGIS geoprocessing UI**: Buffer, Clip, Intersect, Union, Dissolve, Convex Hull, Centroid
- Spatial joins: point-in-polygon, nearest neighbor, attribute join by location
- Aggregation: point-to-polygon count / sum / avg
- Measurement tools: distance, area, perimeter with unit conversion
- Boundary analysis: census/admin boundary datasets; choropleth by aggregated metrics
- deck.gl integration: large-scale point clouds, 3D buildings, heatmaps (optional overlay)

---

## Phase 5 — Enterprise Polish

**Goal:** Production-grade self-hosting for organizations.

- **SSO / SAML**: OIDC + SAML2 via Arctic (Lucia ecosystem)
- Audit logs: tamper-evident append-only log of all data mutations
- Embeddable maps: iframe embed with configurable UI controls
- API keys: programmatic access to tRPC-equivalent REST API
- Raster support: GeoTIFF import + COG tile serving
- Helm chart: Kubernetes deployment with horizontal scaling
- Plugin system: custom import formats, custom analysis tools, custom basemaps
- Regional hosting docs: EU / US / APAC data residency deployment guides

---

## Architecture Decisions

See [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) for the living architecture doc (updated through Phase 2).

See [`docs/adr/`](adr/) for the key decisions made during Phase 1:

- [ADR-001](adr/001-sveltekit-over-nextjs.md) — SvelteKit over Next.js
- [ADR-002](adr/002-postgis-as-analysis-engine.md) — PostGIS as the analysis engine
- [ADR-003](adr/003-uuid-primary-keys.md) — UUID primary keys throughout
