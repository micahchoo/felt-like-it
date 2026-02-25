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

**Tech:** SvelteKit 2 + Svelte 5 runes · MapLibre GL 5 · Terra Draw 1 · PostgreSQL 16 + PostGIS 3.4 · Drizzle ORM · Lucia v3 · tRPC 11 · BullMQ 5 · Tailwind CSS 4

---

## Phase 2 — Power Features ✅ COMPLETE

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

## Phase 3 — Collaboration ✅ COMPLETE

**Goal:** Comment threads, granular permissions, and guest access. (Real-time concurrent editing — Yjs, presence, team library — deferred to Phase 6.)

| Feature | Status |
|---|---|
| **Activity feed** (`map_events` table; `events.list` + `events.log` tRPC; `ActivityFeed.svelte`; client-side logging from MapEditor after imports + viewport saves) | ✅ |
| **Yjs CRDT** over WebSocket: conflict-free concurrent editing | ⬜ → Phase 6 |
| Presence indicators: multiplayer cursors, "X is viewing/editing" sidebar | ⬜ → Phase 6 |
| **Comment threads** (`comments` table; `comments.list`/`create`/`delete`/`resolve` tRPC; `CommentPanel.svelte`; denormalized `authorName`; map-owner-only resolve; `userId` threaded from page server → MapEditor → CommentPanel) | ✅ |
| **Guest commenting** (`publicProcedure` `listForShare` + `createForShare` on commentsRouter; `GuestCommentPanel.svelte` with authorName input; floating toggle button on share viewer page) | ✅ |
| Team library: shared dataset repository (upload once, reuse across maps) | ⬜ → Phase 6 |
| **Granular permissions** (`map_collaborators` table; `collaborators.list`/`invite`/`remove`/`updateRole` tRPC; `CollaboratorsPanel.svelte`; roles: viewer/commenter/editor; self-invite guard; duplicate CONFLICT; error messages surfaced in UI) | ✅ |

---

## Phase 4 — Spatial Analysis ✅ COMPLETE

**Goal:** PostGIS geoprocessing without writing SQL.

| Feature | Status |
|---|---|
| **PostGIS geoprocessing UI** (Buffer, Clip, Intersect, Union, Dissolve, Convex Hull, Centroid — `GeoprocessingOpSchema` discriminated union; `runGeoprocessing` exhaustive switch; `GeoprocessingPanel.svelte`) | ✅ |
| **Rich annotation suite** (text / emoji / GIF / image / link / IIIF NavPlace; WGS84 Point anchor; `AnnotationContentSchema` discriminated union; `annotations` PostGIS table; full CRUD + `fetchIiifNavPlace` tRPC; amber pin layer in MapCanvas; `AnnotationContent.svelte` + `AnnotationPanel.svelte`) | ✅ |
| **Spatial joins** (point-in-polygon, nearest neighbor; `SpatialJoinSchema`; PostGIS `ST_Within` / `ST_DWithin`; attributes propagated to joined layer; `GeoprocessingPanel.svelte`) | ✅ |
| **Aggregation** (point-to-polygon count / sum / avg; `GeoAggregateSchema`; PostGIS `ST_Within` aggregate; result written as new layer) | ✅ |
| **Measurement tools** (distance, area, perimeter; km/mi/m/ft and km²/mi²/ha/ac/m²; Turf.js geodesic; floating `MeasurementPanel` overlay; measurement mode in DrawingToolbar — no DB write) | ✅ |
| **Boundary analysis + choropleth** (9 ColorBrewer ramps; quantile + equal-interval classification; `generateChoroplethStyle`; StylePanel choropleth UI with ramp picker, class slider, method dropdown) | ✅ |
| **deck.gl integration** (heatmap kernel density overlay for point layers via `MapboxOverlay` + `HeatmapLayer`; `DeckGLOverlay.svelte`; `style.type === 'heatmap'`; radius / intensity / weight-attribute controls in StylePanel; resets to simple) | ✅ |

---

## Phase 5 — Enterprise Polish ✅ COMPLETE

**Goal:** Production-grade self-hosting for organizations.

| Feature | Status |
|---|---|
| **Embeddable maps** (`/embed/[token]` bare-canvas route; `MapEditor embed` prop strips all chrome; `Content-Security-Policy: frame-ancestors *`; "Embed" copy-to-clipboard button on share viewer) | ✅ |
| **API keys** (`flk_<64-hex>` Bearer tokens; SHA-256 hash-only storage; `hooks.server.ts` Bearer auth before session; `last_used_at` fire-and-forget; settings page create/revoke/list UI) | ✅ |
| **Audit logs** (BIGSERIAL hash-chain; `appendAuditLog` utility with `pg_advisory_xact_lock`; 11 mutation hooks across maps/shares/collaborators/apiKeys routers; `auditLog.list` + `auditLog.verify` tRPC) | ✅ |
| **Collaborator role enforcement** (`requireMapAccess` helper; viewer/commenter/editor enforced on maps.get, layers, features, geoprocessing, annotations, comments; `maps.listCollaborating`; dashboard "Shared with me"; editor page collab access) | ✅ |

---

## Phase 5b — Delta & Hardening ✅ COMPLETE

**Goal:** Close the gap between `OriginalVision.md` and what's built. Scheduled bug-squash passes keep quality high before the Collab v2 and Enterprise phases.

### Bug Squash

| Item | Status |
|---|---|
| Recurring bug-squash pass after each feature batch | ✅ |
| `maps.update` missing audit log | ✅ |
| TYPE_DEBT cast removal (hooks.server.ts, auth/index.ts) | ✅ |

### Toolchain & Quality Gates

| Item | Status |
|---|---|
| CI pipeline (GitHub Actions: lint, svelte-check, test, build) | ✅ |
| Playwright E2E tests (auth, import, share critical paths) | ✅ |
| Vitest coverage thresholds (75/85/84/75 — ratcheting toward 85/85/80) | ✅ |
| ADRs 004–006 (Martin tile server, BullMQ over pg-boss, Fetch adapter over WebSocket) | ✅ |

### Logging & Reliability

| Item | Status |
|---|---|
| pino structured JSON logging (replace `console.warn/error` with pino JSON) | ✅ |
| Rate limiting on auth endpoints (in-memory, 10 req/min/IP) | ✅ |

### Export Formats

| Item | Status |
|---|---|
| GeoPackage export per layer | ✅ |
| Shapefile export per layer | ✅ |
| PDF map export | ✅ |

### Admin

| Item | Status |
|---|---|
| Admin panel (user list, storage stats, import job monitor) | ✅ |
| `admin-cli.ts` (create user, reset password, promote admin) | ✅ |

### UI Wiring (audit: backend exists, no user-reachable surface)

| Item | Status |
|---|---|
| Share button + dialog in MapEditor | ✅ |
| Export format buttons in ExportDialog (GeoPackage, Shapefile, PDF) | ✅ |
| Audit log viewer page (admin panel + hash-chain verification) | ✅ |
| Layer reorder up/down arrows in LayerPanel | ✅ |
| Map rename inline edit on dashboard map cards | ✅ |
| Undo/Redo toolbar buttons + Ctrl+Z/Shift+Z keyboard shortcuts | ✅ |

### FSL Style Editors (audit: rendering works, no UI to configure)

| Item | Status |
|---|---|
| Label attribute editor in StylePanel | ✅ |
| Categorical style editor in StylePanel | ✅ |
| `isClickable` toggle in StylePanel | ✅ |
| Popup config editor (`titleAttribute` / `keyAttributes`) | ✅ |
| Attributes block editor (`displayName`) | ✅ |
| `highlightColor` picker in StylePanel | ✅ |
| `isSandwiched` toggle in StylePanel | ✅ |

### Infrastructure

| Item | Status |
|---|---|
| S3 / MinIO file storage (pluggable `UPLOAD_DIR` backend) | ⬜ → Phase 6+ |
| Tippecanoe tile pipeline (huge datasets → pre-tiled MBTiles via BullMQ) | ⬜ → Phase 6+ |

---

## Phase 6 — Collaboration v2 ⬜

**Goal:** Real-time concurrent editing and shared datasets. (Deferred from Phase 3.)

| Feature | Status |
|---|---|
| Yjs CRDT over WebSocket: conflict-free concurrent editing | ⬜ |
| Presence indicators: multiplayer cursors, "X is viewing/editing" sidebar | ⬜ |
| Team library: shared dataset repository (upload once, reuse across maps) | ⬜ |

---

## Phase 7 — Enterprise ⬜

**Goal:** Large-organisation deployment: SSO, Kubernetes, extensibility, data residency.

| Feature | Status |
|---|---|
| SSO / SAML: OIDC + SAML2 via Arctic (Lucia ecosystem) | ⬜ |
| Raster support: GeoTIFF import + COG tile serving | ⬜ |
| Helm chart: Kubernetes deployment with horizontal scaling | ⬜ |
| Plugin system: custom import formats, custom analysis tools, custom basemaps | ⬜ |
| Regional hosting docs: EU / US / APAC data residency deployment guides | ⬜ |

---

## Architecture Decisions

See [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) for the living architecture doc (current through Phase 5 + 5b planning).

See [`docs/adr/`](adr/) for recorded decisions:

- [ADR-001](adr/001-sveltekit-over-nextjs.md) — SvelteKit over Next.js
- [ADR-002](adr/002-postgis-as-analysis-engine.md) — PostGIS as the analysis engine
- [ADR-003](adr/003-uuid-primary-keys.md) — UUID primary keys throughout
- [ADR-004](adr/004-martin-over-pg-tileserv.md) — Martin over pg_tileserv
- [ADR-005](adr/005-bullmq-over-pg-boss.md) — BullMQ over pg-boss
- [ADR-006](adr/006-trpc-fetch-over-websocket.md) — tRPC Fetch adapter over trpc-sveltekit WebSocket
