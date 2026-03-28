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

## Subsystems (13)

```
Browser: MapEditor → MapCanvas + DrawingToolbar + LayerPanel
         + AnnotationPanel + Collaboration + Data/Import-Export

Server:  tRPC (12 routers, ~47 procedures)
         REST v1 (external API for Research-Narratives)
         Auth (Lucia sessions + API keys)
         Import/Export + Geoprocessing + Annotations + Audit

Worker:  BullMQ consumer (file import processing, ×2 in prod)

Shared:  shared-types (Zod schemas) + geo-engine (spatial computation)
```

## Key Architectural Decisions

1. **Server-first mutations** — no optimistic UI; undo only after server confirm (mx-2f016d)
2. **Discriminated unions** for interaction modes and state machines (mx-b66438)
3. **Single requireMapAccess function** gates all map-scoped operations
4. **Dual API surface** — tRPC for internal frontend, REST v1 for external consumers (mx-363d7f)
5. **Three-sublayer rendering** — all layers render Fill+Line+Circle for mixed geometry support (mx-894289)
6. **Soft-delete users** via disabledAt timestamp (mx-b84f7c)
7. **Tamper-evident audit log** with SHA-256 hash chain

## Top Risks

No critical risks — initially flagged auth gap was disproved (hooks.server.ts handles disabledAt correctly).

1. **High:** CI has no test/lint gate (only builds + pushes images)
2. **High:** MapEditor god component (930 LOC, 62 commits, 14 effects, no tests — 6 decomposition seams identified)
3. **High:** Import worker has no tests, duplicates all 5 format parsers from web app
4. **High:** Uploaded import files never cleaned up (disk exhaustion risk)

See [risk-map.md](risk-map.md) for the full prioritized risk inventory.

## Documentation Map

```
docs/architecture/
├── overview.md              ← you are here
├── domain.md                — business contexts, ubiquitous language, data model
├── ecosystem.md             — dependencies, integrations, security surface
├── infrastructure.md        — containers, database, queue, CI/CD, deployment
├── subsystems.md            — 13 subsystems with boundary map
├── subsystems/
│   ├── map-editor/
│   │   ├── components.md    — component tree, 8 stores in 2 rings
│   │   ├── behavior.md      — flow traces (load, draw, style, interaction)
│   │   ├── contracts.md     — store-to-store, component-to-store, tRPC, Terra Draw, MapLibre
│   │   └── decomposition.md — 6 extraction seams, test gap analysis
│   ├── data-pipeline/
│   │   ├── components.md    — import/export architecture, security
│   │   ├── behavior.md      — CSV geocoding, GeoPackage async, export flows
│   │   ├── contracts.md     — web↔worker, worker↔DB, filesystem, geo-engine, tRPC
│   │   └── modules.md       — file inventory, duplication audit, dead code
│   ├── annotation-collab/
│   │   ├── components.md    — annotations v2, collaboration, sharing
│   │   ├── behavior.md      — annotation CRUD, comment, share, guest flows
│   │   └── contracts.md     — annotation↔map-editor, share↔auth, v1/v2 boundary
│   ├── api-auth/
│   │   ├── components.md    — auth, tRPC, REST v1, audit, security
│   │   ├── behavior.md      — login, registration, API key, session, admin flows
│   │   └── contracts.md     — auth↔tRPC, auth↔REST, auth↔DB, CSRF, audit
│   └── geoprocessing/
│       ├── components.md    — 10 PostGIS ops, spatial joins, measurement (Turf.js)
│       └── behavior.md     — buffer flow, spatial join, measurement, error handling
├── cross-cutting/
│   ├── patterns.md          — 10 patterns spanning 2+ subsystems
│   └── security.md          — security findings by severity
├── risk-map.md              — prioritized risk inventory
└── _meta.json               — staleness tracking
```
