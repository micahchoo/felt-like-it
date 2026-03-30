# Architecture Overview

**Felt Like It** is a self-hosted collaborative GIS platform for data-sovereign organizations. Teams create, import, edit, style, analyze, and share spatial data on interactive maps — without cloud lock-in or proprietary licensing.

## Shape

**Monorepo** (Turborepo + pnpm workspaces)

| Package | Role |
|---------|------|
| `apps/web` | SvelteKit 2 + tRPC 11 full-stack application |
| `services/worker` | BullMQ consumer for async file imports |
| `packages/shared-types` | Zod schemas + branded types (cross-process contract) |
| `packages/geo-engine` | Pure spatial computation library |

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Svelte 5 (runes), MapLibre GL 5, deck.gl 9, Terra Draw, Tailwind 4 |
| Backend | SvelteKit (Node adapter), tRPC 11, REST API v1 |
| Database | PostgreSQL 16 + PostGIS 3.4, Drizzle ORM |
| Queue | Redis 7 + BullMQ 5 |
| Tiles | Martin (vector tile server) |
| Auth | Lucia v3 (sessions) + API keys (`flk_` prefix) |
| Deployment | Docker Compose + Traefik + Let's Encrypt, GHCR |

## Subsystems (14)

All 14 subsystems have been drilled to full depth (components, behavior, contracts).

```
Browser: MapEditor → MapCanvas + DrawingTools + LayerManagement
         + AnnotationPanel + Collaboration + Data/Import-Export

Server:  tRPC (12 routers, ~47 procedures)
         REST v1 (external API for Research-Narratives)
         Auth (Lucia sessions + API keys)
         Import/Export + Geoprocessing + Annotations + Audit

Worker:  BullMQ consumer (file import processing, ×2 in prod)

Shared:  shared-types (Zod schemas) + geo-engine (spatial computation)
         import-engine (pure parsing, shared by web + worker)
```

## Key Architectural Decisions

1. **Server-first mutations** — no optimistic UI; undo only after server confirm (mx-2f016d)
2. **Optimistic/non-optimistic split** — Layer Management uses optimistic updates for toggle/reorder/style but non-optimistic for create/delete. Decision criteria: optimistic when the operation is visually immediate and reversible without data loss; non-optimistic when the operation creates or destroys server-side state
3. **Discriminated unions** for interaction modes and state machines (mx-b66438)
4. **Single requireMapAccess function** gates all map-scoped operations
5. **Dual API surface** — tRPC for internal frontend, REST v1 for external consumers (mx-363d7f)
6. **Dual auth paths** — Session auth (Lucia) in hooks.server.ts and API key auth in v1 middleware run in parallel; REST endpoints receive both, causing redundant auth on overlapping paths
7. **Viewport sync protocol** — MapCanvas uses a `viewportVersion` counter to break bidirectional update cycles between MapLibre's native viewport state and Svelte 5 reactive state
8. **Three-sublayer rendering** — all layers render Fill+Line+Circle for mixed geometry support (mx-894289)
9. **Soft-delete users** via disabledAt timestamp (mx-b84f7c)
10. **Tamper-evident audit log** with SHA-256 hash chain

## Top Risks

No critical risks — initially flagged auth gap was disproved (hooks.server.ts handles disabledAt correctly).

1. **High:** CI has no test/lint gate (only builds + pushes images)
2. **High:** MapEditor god component (930 LOC, 62 commits, 14 effects, no tests — 6 decomposition seams identified)
3. **High:** Import worker has no tests, duplicates all 5 format parsers from web app
4. **High:** Uploaded import files never cleaned up (disk exhaustion risk)
5. **Medium:** Runtime validation gaps — only 2 of 5 identified process boundaries have Zod validation. Redis, REST, and tRPC boundaries are inconsistently covered
6. **Medium:** Activity feed write-only dead end — eventsRouter + map_events table exist but have zero UI consumers. Backend infrastructure spans collaboration + API subsystems with no read path

See [risk-map.md](risk-map.md) for the full prioritized risk inventory.

## Documentation Map

**47 architecture docs** (7 foundation + 2 cross-cutting + 38 subsystem drill docs) across 13 subsystem directories covering all 14 subsystems at full depth.

```
docs/architecture/
├── overview.md              ← you are here
├── domain.md                — business contexts, ubiquitous language, data model
├── ecosystem.md             — dependencies, integrations, security surface
├── infrastructure.md        — containers, database, queue, CI/CD, deployment
├── subsystems.md            — 14 subsystems with boundary map
├── evolution.md             — codebase evolution analysis, churn, fault lines, trajectory
├── risk-map.md              — prioritized risk inventory
├── _meta.json               — staleness tracking
├── subsystems/
│   ├── map-editor/          — orchestrator component (930 LOC)
│   │   ├── components.md    — component tree, MapEditorState consolidated store
│   │   ├── behavior.md      — flow traces (load, draw, style, interaction)
│   │   ├── contracts.md     — store-to-store, component-to-store, tRPC, Terra Draw, MapLibre
│   │   └── decomposition.md — 6 extraction seams, test gap analysis
│   ├── map-canvas/          — MapLibre GL + deck.gl rendering
│   │   ├── components.md    — sublayer rendering, viewport management
│   │   ├── behavior.md      — viewport sync, layer rendering, basemap switching
│   │   └── contracts.md     — MapCanvas↔MapEditor, MapLibre↔Svelte reactive bridge
│   ├── drawing-tools/       — Terra Draw integration
│   │   ├── components.md    — DrawingToolbar, tool modes, Terra Draw lifecycle
│   │   ├── behavior.md      — draw, edit, delete flows, mode transitions
│   │   └── contracts.md     — TerraDraw↔MapEditorState, mutation→cache invalidation
│   ├── layer-management/    — LayerPanel + layer CRUD + styling
│   │   ├── components.md    — LayerPanel, StyleEditor, reorder/visibility
│   │   ├── behavior.md      — create, delete, reorder, style, toggle visibility
│   │   └── contracts.md     — optimistic vs non-optimistic mutation boundaries
│   ├── data-pipeline/       — import/export file processing
│   │   ├── components.md    — import/export architecture, security
│   │   ├── behavior.md      — CSV geocoding, GeoPackage async, export flows
│   │   ├── contracts.md     — web↔worker, worker↔DB, filesystem, geo-engine, tRPC
│   │   └── modules.md       — file inventory, duplication audit, dead code
│   ├── import-engine/       — pure parsing library (shared by web + worker)
│   │   ├── components.md    — parser modules, format support matrix
│   │   └── contracts.md     — import-engine↔web wrappers, import-engine↔worker
│   ├── import-worker/       — BullMQ async file import consumer
│   │   ├── components.md    — worker architecture, job processing
│   │   ├── behavior.md      — job lifecycle, error handling, retry
│   │   └── contracts.md     — worker↔Redis, worker↔DB (raw SQL), worker↔filesystem
│   ├── annotation-collab/   — annotations v2 + sharing
│   │   ├── components.md    — annotations v2, collaboration, sharing
│   │   ├── behavior.md      — annotation CRUD, comment, share, guest flows
│   │   └── contracts.md     — annotation↔map-editor, share↔auth, v1/v2 boundary
│   ├── collaboration/       — real-time collaboration infrastructure
│   │   ├── components.md    — collaboration store, presence, activity feed
│   │   ├── behavior.md      — presence tracking, activity logging, share flows
│   │   └── contracts.md     — collaboration↔map-editor, eventsRouter, map_events
│   ├── api-auth/            — auth + tRPC + audit
│   │   ├── components.md    — auth, tRPC, REST v1, audit, security
│   │   ├── behavior.md      — login, registration, API key, session, admin flows
│   │   └── contracts.md     — auth↔tRPC, auth↔REST, auth↔DB, CSRF, audit
│   ├── rest-api/            — REST v1 external API
│   │   ├── components.md    — v1 routes, middleware, API key auth
│   │   ├── behavior.md      — CRUD flows, scope enforcement, rate limiting
│   │   └── contracts.md     — REST↔auth, REST↔DB, REST↔tRPC overlap
│   ├── geoprocessing/       — PostGIS operations + Turf.js measurement
│   │   ├── components.md    — 10 PostGIS ops, spatial joins, measurement (Turf.js)
│   │   └── behavior.md      — buffer flow, spatial join, measurement, error handling
│   └── shared-types/        — cross-process Zod schemas + branded types
│       ├── components.md    — schema inventory, branded type catalog
│       └── contracts.md     — shared-types↔web, shared-types↔worker boundaries
└── cross-cutting/
    ├── patterns.md          — 19 cross-cutting patterns spanning 2+ subsystems
    └── security.md          — security findings by severity
```
