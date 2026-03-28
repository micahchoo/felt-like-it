# Subsystems

13 subsystems identified across 4 workspace packages. Boundaries range from
service-level (separate Docker process) to implicit (should be separated but
currently coupled).

## Boundary Map

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                        │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  MapEditor (orchestrator / god component)              │    │
│  │  ┌──────────┐ ┌────────────┐ ┌──────────────────────┐ │    │
│  │  │MapCanvas │ │DrawToolbar │ │LayerPanel            │ │    │
│  │  │+DeckGL   │ │+DrawAction │ │                      │ │    │
│  │  └────┬─────┘ └─────┬──────┘ └──────────┬───────────┘ │    │
│  │       │              │                   │             │    │
│  │  ┌────▼──────────────▼───────────────────▼───────────┐ │    │
│  │  │  Svelte Stores (map / layers / drawing /          │ │    │
│  │  │  viewport / selection / undo / interaction-modes  │ │    │
│  │  │  style / filters / annotation-geo)                │ │    │
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
│  │(12 rtrs) │ │(external)│ │Session   │ │(server-side)   │   │
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
│  → geo-engine (validate / detect / auto-style / geocode)       │
│  → PostgreSQL (raw SQL batch insert, bypasses ORM)             │
└────────────────────────────────────────────────────────────────┘

Shared packages:
  packages/shared-types  ─── Zod schemas + branded types (contract layer)
  packages/geo-engine    ─── Pure spatial computation (+ geocode side-effect)
```

## Subsystem Index

| # | Subsystem | Boundary | Root Path | Risk |
|---|-----------|----------|-----------|------|
| 1 | [Map Editor](#1-map-editor) | implicit | `components/map/MapEditor.svelte` | Critical |
| 2 | [Map Canvas](#2-map-canvas) | implicit | `components/map/MapCanvas.svelte` | High |
| 3 | [Drawing Tools](#3-drawing-tools) | implicit | `components/map/DrawingToolbar.svelte` | High |
| 4 | [Layer Management](#4-layer-management) | implicit | `components/map/LayerPanel.svelte` | Medium |
| 5 | [Annotation System](#5-annotation-system) | module | `components/annotations/` + `server/annotations/` | High |
| 6 | [Collaboration](#6-collaboration) | module | `components/collaboration/` + tRPC routers | Medium |
| 7 | [Data Import/Export](#7-data-importexport) | module+service | `components/data/` + `server/import/` + worker | High |
| 8 | [Geoprocessing](#8-geoprocessing) | module | `components/geoprocessing/` + `server/geo/` | Medium |
| 9 | [Auth / Session](#9-auth--session) | module | `server/auth/` | Medium |
| 10 | [REST API v1](#10-rest-api-v1) | module | `routes/api/v1/` | Medium |
| 11 | [Shared Types](#11-shared-types) | module | `packages/shared-types/` | Medium |
| 12 | [Geo Engine](#12-geo-engine) | module | `packages/geo-engine/` | Low |
| 13 | [Import Worker](#13-import-worker) | service | `services/worker/` | High |

All paths relative to `apps/web/src/lib/` unless otherwise noted.

## 1. Map Editor
- **Boundary type:** implicit (god component)
- **Responsibility:** Top-level orchestrator composing MapCanvas, DrawingToolbar, LayerPanel, SidePanel, AnnotationPanel, and all overlays.
- **Key dependencies:** All map stores, tRPC routers (maps, layers, features, annotations), geo-engine
- **Crosses boundary:** MapId from route, session/user from layout; coordinates children via shared stores
- **Risk:** 62 commits (hottest file). No component-level tests. Classic god component.

## 2. Map Canvas
- **Boundary type:** implicit
- **Responsibility:** MapLibre GL rendering, deck.gl overlay, click/hover events, viewport state.
- **Key dependencies:** stores/map, viewport, layers, map-sources
- **Crosses boundary:** Viewport object, layer render configs, feature click → selection store
- **Risk:** 25 commits. map-sources utility has ambiguous ownership. No integration test.

## 3. Drawing Tools
- **Boundary type:** implicit
- **Responsibility:** Draw mode activation, geometry creation/editing, undo stack.
- **Key dependencies:** stores/drawing, undo, interaction-modes, tRPC features
- **Crosses boundary:** DrawingMode → interaction-modes; GeoJSON → features mutation; undo commands
- **Risk:** 25 commits. Past closure/race bugs (2 dedicated tests). Undo crosses into selection store.

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
- **Key dependencies:** server/jobs → Redis → worker; server/import/ parsers; geo-engine
- **Crosses boundary:** ImportJobPayload via Redis; filesystem path shared between processes; job status polling
- **Risk:** Two import paths with unclear routing. Filesystem path is implicit contract. No test for queue dispatch.

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
- **Responsibility:** BullMQ consumer; parses files; batch-inserts features via raw PostGIS SQL.
- **Key dependencies:** shared-types, geo-engine, PostgreSQL (direct), Redis, filesystem
- **Crosses boundary:** Redis queue (ImportJobPayload), shared filesystem path, direct DB writes (bypasses ORM)
- **Risk:** No test files. Raw SQL bypasses Drizzle validation. Filesystem path is implicit contract.

**See also:** [domain](domain.md) | [infrastructure](infrastructure.md)
