# Subsystems

14 subsystems identified across 5 workspace packages. Boundaries range from
service-level (separate Docker process) to implicit (should be separated but
currently coupled).

**Cross-cutting surfaces** (not subsystems — consumed by multiple subsystems):
- `components/ui/` — 28 shared UI primitives (buttons, modals, toasts, sidepanels, etc.). No business logic; pure presentation. Consumed by subsystems 1-8.
- `components/admin/` — 4 admin tools (AuditLogViewer, ImportJobMonitor, StorageStats, UserList). ImportJobMonitor is on FB-1 (file-import-async) flow. Owned by auth/admin routes, consuming subsystems 7, 9, 13.
- `routes/` — SvelteKit route groups `(app)/`, `(auth)/`, `(public)/` provide layout inheritance and server-side loads. Route handlers delegate to subsystems; they are wiring, not business logic.

## Boundary Map

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                        │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  MapEditor (orchestrator)                              │    │
│  │  ┌──────────┐ ┌────────────┐ ┌──────────────────────┐ │    │
│  │  │MapCanvas │ │DrawToolbar │ │LayerPanel            │ │    │
│  │  │+DeckGL   │ │+DrawAction │ │                      │ │    │
│  │  └────┬─────┘ └─────┬──────┘ └──────────┬───────────┘ │    │
│  │       │              │                   │             │    │
│  │  ┌────▼──────────────▼───────────────────▼───────────┐ │    │
│  │  │  MapEditorState (consolidated state machine)      │ │    │
│  │  │  + Svelte Stores (map / layers / viewport / undo  │ │    │
│  │  │  / style / filters / annotation-geo)              │ │    │
│  │  └────────────────────────┬──────────────────────────┘ │    │
│  │                           │ tRPC calls                  │    │
│  │  ┌───────────┐ ┌─────────┤  ┌───────────────────────┐ │    │
│  │  │Annotation │ │Collabor-│  │Data / Import-Export   │ │    │
│  │  │System     │ │ation    │  │                       │ │    │
│  │  └──────┬────┘ └─────────┘  └──────────┬────────────┘ │    │
│  └─────────┼───────────────────────────────┼─────────────┘    │
└────────────┼───────────────────────────────┼──────────────────┘
             │ HTTP/tRPC                      │ HTTP (upload+poll)
┌────────────▼───────────────────────────────▼──────────────────┐
│  SvelteKit Server (apps/web)                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐   │
│  │tRPC      │ │REST v1   │ │Auth /    │ │Import / Export │   │
│  │(12 rtrs) │ │(external)│ │Session   │ │(thin wrappers) │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬─────────┘   │
│       └─────────────┴────────────┴──────────────┘              │
│                      │                                         │
│  ┌───────────────────▼─────────────────────────────────────┐   │
│  │  server/db (Drizzle ORM → PostgreSQL + PostGIS)          │   │
│  │  server/geo (geoprocessing, queries, access)             │   │
│  │  server/annotations (service + changelog)                │   │
│  │  server/audit (tamper-evident hash chain)                │   │
│  └─────────────────────────┬───────────────────────────────┘   │
│                            │ BullMQ enqueue                     │
└────────────────────────────┼───────────────────────────────────┘
                             │ Redis queue + shared /uploads
┌────────────────────────────▼───────────────────────────────────┐
│  services/worker (separate Docker process, ×2 in prod)         │
│  → import-engine (parse all geo formats)                       │
│  → geo-engine (validate / detect / auto-style / geocode)       │
│  → PostgreSQL (raw SQL batch insert, bypasses ORM)             │
└────────────────────────────────────────────────────────────────┘

Shared packages:
  packages/shared-types    ─── Zod schemas + branded types (contract layer)
  packages/geo-engine      ─── Pure spatial computation (+ geocode side-effect)
  packages/import-engine   ─── Format parsing: CSV, GeoJSON, Shapefile, KML, GPX, GeoPackage
```

## Subsystem Index

| # | Subsystem | Boundary | Root Path | Risk | Changed |
|---|-----------|----------|-----------|------|---------|
| 1 | [Map Editor](#1-map-editor) | implicit | `components/map/MapEditor.svelte` | High | **yes** |
| 2 | [Map Canvas](#2-map-canvas) | implicit | `components/map/MapCanvas.svelte` | High | |
| 3 | [Drawing Tools](#3-drawing-tools) | implicit | `components/map/DrawingToolbar.svelte` | Medium | **yes** |
| 4 | [Layer Management](#4-layer-management) | implicit | `components/map/LayerPanel.svelte` | Medium | |
| 5 | [Annotation System](#5-annotation-system) | module | `components/annotations/` + `server/annotations/` | High | |
| 6 | [Collaboration](#6-collaboration) | module | `components/collaboration/` + tRPC routers | Medium | |
| 7 | [Data Import/Export](#7-data-importexport) | module+service | `components/data/` + `server/import/` + worker | High | **yes** |
| 8 | [Geoprocessing](#8-geoprocessing) | module | `components/geoprocessing/` + `server/geo/` | Medium | |
| 9 | [Auth / Session](#9-auth--session) | module | `server/auth/` | Medium | |
| 10 | [REST API v1](#10-rest-api-v1) | module | `routes/api/v1/` | Medium | |
| 11 | [Shared Types](#11-shared-types) | module | `packages/shared-types/` | Medium | |
| 12 | [Geo Engine](#12-geo-engine) | module | `packages/geo-engine/` | Low | |
| 13 | [Import Worker](#13-import-worker) | service | `services/worker/` | High | **yes** |
| 14 | [Import Engine](#14-import-engine) | package | `packages/import-engine/` | Medium | **new** |

All paths relative to `apps/web/src/lib/` unless otherwise noted.

## 1. Map Editor
- **Boundary type:** implicit (orchestrator)
- **Responsibility:** Top-level orchestrator composing MapCanvas, DrawingToolbar, LayerPanel, SidePanel, AnnotationPanel, and all overlays.
- **Key dependencies:** MapEditorState (consolidated), remaining stores (map, layers, viewport, undo, style, filters, annotation-geo), tRPC routers (maps, layers, features, annotations), geo-engine
- **Crosses boundary:** MapId from route, session/user from layout; coordinates children via MapEditorState (Svelte context) + remaining stores
- **Risk:** 62 commits (hottest file). No component-level tests. Reduced from god-component to orchestrator after store consolidation.
- **Migration status:** ⚠️ **Uncommitted.** The store consolidation appears in the working tree (`D` for deleted stores, `??` for new MapEditorState). Analysis reflects the intended target architecture, not committed state. Wave 3 agents should treat deleted stores as prior state and MapEditorState as the current implementation.
- **What changed:** Three separate stores (`drawing.svelte.ts`, `selection.svelte.ts`, `interaction-modes.svelte.ts`) and `useInteractionBridge.svelte.ts` deleted. Replaced by single `MapEditorState` class (`stores/map-editor-state.svelte.ts`) that provides atomic state transitions. The 5 bridge effects that synchronized stores are now synchronous method calls. Risk downgraded from Critical to High.

## 2. Map Canvas
- **Boundary type:** implicit
- **Responsibility:** MapLibre GL rendering, deck.gl overlay, click/hover events, viewport state.
- **Key dependencies:** stores/map, viewport, layers, map-sources
- **Crosses boundary:** Viewport object, layer render configs, feature click → selection store
- **Risk:** 25 commits. map-sources utility has ambiguous ownership. No integration test.

## 3. Drawing Tools
- **Boundary type:** implicit
- **Responsibility:** Draw mode activation, geometry creation/editing, undo stack.
- **Key dependencies:** MapEditorState (via `getMapEditorState()`), undo, tRPC features
- **Crosses boundary:** DrawTool type → MapEditorState; GeoJSON → features mutation; undo commands
- **Risk:** 25 commits. Past closure/race bugs (2 dedicated tests). Risk downgraded from High to Medium — no more cross-store race conditions since drawing/selection/interaction state are now atomic operations on a single class.
- **What changed:** No longer depends on separate `stores/drawing`, `stores/selection`, or `stores/interaction-modes`. All drawing state (TerraDraw lifecycle, active tool, drawing generation) now lives in `MapEditorState`. DrawingToolbar calls `editorState.setActiveTool()`, `editorState.initDrawing()` etc. directly.

## 4. Layer Management
- **Boundary type:** implicit
- **Responsibility:** Layer CRUD, visibility/ordering, style assignment.
- **Key dependencies:** stores/layers, tRPC layers, stores/style
- **Crosses boundary:** LayerRow from schema to UI; LayerStyle across server↔client; style → map-sources
- **Risk:** 11 commits. Past rollback bugs (`style-panel-rollback.test.ts`).

## 5. Annotation System
- **Boundary type:** module (client + dedicated server service)
- **Responsibility:** Map-anchored annotations, threading, versioned changelog, object attachments.
- **Key dependencies:** stores/annotation-geo, tRPC annotations, server/annotations/service, REST upload endpoint
- **Crosses boundary:** AnnotationContent type, Anchor type, image upload via REST side-channel
- **Risk:** 50 commits combined. Best test coverage (6 files). Schema still evolving (annotation_objects v2). REST upload outside tRPC is implicit seam.

## 6. Collaboration
- **Boundary type:** module
- **Responsibility:** Activity feed, per-map permissions, commenting (auth + guest), share links.
- **Key dependencies:** tRPC comments/collaborators/events/shares, routes/share/embed
- **Crosses boundary:** ShareRow, MapCollaboratorRow, guest auth via token
- **Risk:** ActivityFeed possibly duplicated across components/map/ and components/collaboration/. Guest path is reduced-trust context.

## 7. Data Import/Export
- **Boundary type:** module (sync) + service (async via worker)
- **Responsibility:** File upload, async import dispatch (BullMQ), sync parsing fallback, export.
- **Key dependencies:** server/jobs → Redis → worker; server/import/ (thin wrappers); **import-engine** (parsing); geo-engine
- **Crosses boundary:** ImportJobPayload via Redis; filesystem path shared between processes; job status polling; ParsedFeature type from import-engine
- **Risk:** Two import paths with unclear routing. Filesystem path is implicit contract. No test for queue dispatch.
- **What changed:** Server-side parsers (`csv.ts`, `geojson.ts`, `shapefile.ts`, `xmlgeo.ts`, `geopackage.ts`) refactored to thin wrappers that delegate parsing to `@felt-like-it/import-engine`. `sanitize.ts` is now a re-export: `export { sanitizeFilename } from '@felt-like-it/import-engine'`. Parsing logic extracted to shared package consumed by both web server and worker. Import orchestration (layer creation, batch insert, progress tracking) remains in `server/import/shared.ts`.

## 8. Geoprocessing
- **Boundary type:** module
- **Responsibility:** PostGIS spatial operations (buffer, intersect, clip, etc.), spatial joins, aggregation.
- **Key dependencies:** server/geo/, tRPC geoprocessing, geo-engine
- **Crosses boundary:** GeoprocessingRequest schema, feature UUIDs, result GeoJSON
- **Risk:** Low churn. Most PostGIS-dependent subsystem. Single test file.

## 9. Auth / Session
- **Boundary type:** module
- **Responsibility:** Lucia session management, password hashing, user disable/enable, API key auth.
- **Key dependencies:** db schema (users, sessions, apiKeys), routes/+layout.server.ts
- **Crosses boundary:** Session object → tRPC context; API keys carry scope flags; disabled_at gates all routes
- **Risk:** API key scope still evolving. Auth context bug would break all 12 tRPC routers.

## 10. REST API v1
- **Boundary type:** module
- **Responsibility:** Public REST API for programmatic access (Research-Narratives integration).
- **Key dependencies:** server/api/serializers, pagination, geojson-cache, API key auth
- **Crosses boundary:** API key auth (parallel to session auth), FeatureUUID, GeoJSON responses
- **Risk:** Parallel auth path. GeoJSON cache with no visible test coverage.

## 11. Shared Types
- **Boundary type:** module (cross-process)
- **Responsibility:** Single source of truth for Zod schemas and branded types.
- **Key dependencies:** Zod
- **Crosses boundary:** Every inter-process payload (ImportJobPayload, LayerStyle, Viewport, AnnotationContent, Anchor)
- **Risk:** Breaking changes break 3 processes simultaneously. Schema.ts has 11 commits.

## 12. Geo Engine
- **Boundary type:** module (pure computation, no I/O)
- **Responsibility:** Format detection, GeoJSON validation, coordinate transforms, auto-styling, classification, measurement.
- **Key dependencies:** None (pure functions); consumed by worker and web server
- **Crosses boundary:** GeoJSON in, styled/validated output out
- **Risk:** Low. Well tested (9 files). geocode.ts has I/O side-effects — latent boundary violation.

## 13. Import Worker
- **Boundary type:** service (separate Docker process)
- **Responsibility:** BullMQ consumer; parses files via import-engine; batch-inserts features via raw PostGIS SQL.
- **Key dependencies:** shared-types, **import-engine**, geo-engine, PostgreSQL (direct), Redis, filesystem
- **Crosses boundary:** Redis queue (ImportJobPayload), shared filesystem path, direct DB writes (bypasses ORM), ParsedFeature type from import-engine
- **Risk:** No test files. Raw SQL bypasses Drizzle validation. Filesystem path is implicit contract.
- **What changed:** Now imports parsers (`parseGeoJSON`, `parseCSV`, `parseShapefile`, `parseKML`, `parseGPX`, `parseGeoPackage`) from `@felt-like-it/import-engine` instead of duplicating parsing logic. Worker retains orchestration (job status, retry cleanup, batch SQL insert, auto-styling via geo-engine).

## 14. Import Engine
- **Boundary type:** package (pure computation, no I/O beyond file reads)
- **Responsibility:** Parse all supported geo formats into uniform `ParsedFeature` / `ParsedWkbFeature` / `ParsedCsv` types. Sanitize filenames.
- **Key dependencies:** shared-types (Geometry type), geo-engine (none — independent), papaparse, shpjs, fast-xml-parser, sql.js
- **Crosses boundary:** `ParsedFeature` → consumed by server/import/ and worker; `ParsedCsv` → CSV-specific path needing coordinate detection from geo-engine
- **Risk:** Medium. Well tested (7 test files covering all formats). Pure parsing — no DB, no network. Breaking type changes would affect both import paths simultaneously.
- **Formats:** GeoJSON, CSV, Shapefile (.shp/.zip), KML, GPX, GeoPackage (.gpkg)
- **Era:** New package (2024+). Extracted from duplicated logic in server/import/ and worker.

## Flow Basins

Primary data/request flows through the system. All marked `validated: false` —
these trace the expected path from the boundary map, not verified by runtime observation.

### FB-1: File Import (async path)
```
Browser upload → SvelteKit route → BullMQ enqueue → Redis →
  Worker: import-engine.parse*() → geo-engine.detect/style →
  raw SQL batch INSERT → PostGIS →
  job status update → Browser poll → tRPC features.list → render
```
Subsystems: 7 (Data Import/Export) → 14 (Import Engine) → 12 (Geo Engine) → 13 (Import Worker)
Drainage density: high (touches 4 subsystems, 2 processes, 2 transport layers)

### FB-2: File Import (sync path)
```
Browser upload → SvelteKit route → server/import/*.ts (thin wrapper) →
  import-engine.parse*() → server/import/shared.ts →
  Drizzle ORM INSERT → PostGIS → tRPC invalidation → render
```
Subsystems: 7 (Data Import/Export) → 14 (Import Engine)
Drainage density: medium (single process, ORM path)

### FB-3: Map Interaction (draw + select)
```
User click/draw → MapCanvas event → MapEditorState.transitionTo() →
  atomic state update (interaction + selection + tool) →
  DrawingToolbar reads activeTool → TerraDraw mode switch →
  feature drawn → tRPC features.create → PostGIS → query invalidation → re-render
```
Subsystems: 2 (Map Canvas) → 1 (Map Editor / MapEditorState) → 3 (Drawing Tools)
Drainage density: low (single process, single state machine, no bridge effects)

### FB-4: Feature Selection + Popup
```
MapCanvas click → resolveFeatureId → MapEditorState.selectFeature() →
  atomic: #selectedFeature + #interactionState + #popupCoords →
  SidePanel / popup re-render → optional edit via tRPC
```
Subsystems: 2 (Map Canvas) → 1 (Map Editor / MapEditorState)
Drainage density: low (single state machine)

### FB-5: REST API (external consumer)
```
HTTP + API key → auth middleware → REST route handler →
  server/api/serializers → Drizzle query + GeoJSON cache →
  JSON response
```
Subsystems: 9 (Auth) → 10 (REST API v1)
Drainage density: low (single process, linear)

### FB-6: Annotation Lifecycle
```
User anchors annotation → AnnotationPanel → tRPC annotations.create →
  server/annotations/service → PostGIS + changelog →
  optional image upload via REST side-channel →
  tRPC invalidation → re-render
```
Subsystems: 5 (Annotation System) → 9 (Auth)
Drainage density: medium (dual transport: tRPC + REST upload)

## Drainage Density Summary

| Subsystem | Density | Rationale |
|-----------|---------|-----------|
| 1. Map Editor | low | Consolidated state machine eliminated cross-store coordination |
| 2. Map Canvas | low | Renders + dispatches events, single consumer (MapEditorState) |
| 3. Drawing Tools | low | Reads from MapEditorState, writes via tRPC |
| 4. Layer Management | low | CRUD via tRPC, style assignment |
| 5. Annotation System | medium | Dual transport (tRPC + REST upload), changelog |
| 6. Collaboration | low | Activity feed, permissions, share links |
| 7. Data Import/Export | **high** | Two import paths (sync/async), 2 processes, filesystem contract |
| 8. Geoprocessing | low | PostGIS operations via tRPC |
| 9. Auth / Session | medium | Two parallel auth paths (session + API key) |
| 10. REST API v1 | low | Linear request/response |
| 11. Shared Types | medium | Cross-process contract — breakage cascades to 3 processes |
| 12. Geo Engine | low | Pure computation, well-tested |
| 13. Import Worker | **high** | BullMQ + raw SQL + filesystem + retry logic |
| 14. Import Engine | low | Pure parsing, no orchestration, well-tested |

## Faults

| Fault | Location | Era Marker | Type | Impact |
|-------|----------|------------|------|--------|
| No fault | MapEditorState consolidation | 2024+ (Svelte 5 runes, `$state`) | evolution | Positive — eliminated 5 bridge effects, removed implicit coupling between 3 stores |
| Dual import path | server/import/ + worker/ | 2020+ | architectural | Two paths to insert features — sync (ORM) vs async (raw SQL). import-engine unifies parsing but not orchestration |
| sanitize.ts re-export shim | `server/import/sanitize.ts` | 2024+ | residual | 1-line re-export of `sanitizeFilename` from import-engine. Exists only for import-path compatibility |

**See also:** [domain](domain.md) | [infrastructure](infrastructure.md)
