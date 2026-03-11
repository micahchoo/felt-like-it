# Felt Like It — Documentation State

Tracks what's documented, what's accurate, and what's missing.
Last synced: 2026-03-11 (documentation overhaul).

---

## Living Docs

| Doc | Scope | Status |
|---|---|---|
| `README.md` | Project overview, features, quickstart, doc index | Current |
| `docs/ARCHITECTURE.md` | Built system: schema, request flow, auth, tRPC, styles, import, geoprocessing, testing | Current |
| `docs/ROADMAP.md` | Phase checklist (1-7) with feature status | Current |
| `STATE.md` | Build state: test counts, delta log, known gaps, phase checklists | Current |
| `docs/DOCSTATE.md` | This file — doc coverage tracker | Current |
| `docs/OriginalVision.md` | Original design doc — static reference, not updated | Static |

## Getting Started

| Doc | Audience | Scope | Status |
|---|---|---|---|
| `docs/getting-started/development.md` | Contributors | One-command onboarding, project structure, tests | Current |
| `docs/getting-started/self-hosting.md` | Deployers | Production Docker, reverse proxy, backups | Current |

## Reference Docs

| Doc | Audience | Scope | Status |
|---|---|---|---|
| `docs/reference/environment-variables.md` | Deployers | All config options by service | Current |
| `docs/reference/database-schema.md` | Developers | Tables, relationships, migrations | Current |
| `docs/reference/api.md` | Developers | tRPC procedures, auth levels | Current |

## User Guides

| Doc | Audience | Scope | Status |
|---|---|---|---|
| `docs/guides/maps-and-layers.md` | Users | Create, import, draw, geoprocess, export | Current |
| `docs/guides/styling.md` | Users | Color, categorical, choropleth, heatmap | Current |
| `docs/guides/annotations.md` | Users | Pins, regions, content types, threads | Current |
| `docs/guides/collaboration.md` | Users | Roles, comments, sharing, activity | Current |

## Decision Records

| ADR | Topic | Status |
|---|---|---|
| `docs/adr/001-sveltekit-over-nextjs.md` | SvelteKit over Next.js | Written |
| `docs/adr/002-postgis-as-analysis-engine.md` | PostGIS as the analysis engine | Written |
| `docs/adr/003-uuid-primary-keys.md` | UUID primary keys throughout | Written |
| `docs/adr/004-martin-over-pg-tileserv.md` | Why Martin, not pg_tileserv or custom | Written |
| `docs/adr/005-bullmq-over-pg-boss.md` | Why BullMQ + Redis, not pg-boss | Written |
| `docs/adr/006-trpc-fetch-over-websocket.md` | Why Fetch adapter, not trpc-sveltekit WS | Written |

## Coverage — User-Facing Features vs Docs

Every feature should be documented in its authoritative doc. Guides may reference features documented in reference docs.

| Feature | Authoritative doc | Accurate? |
|---|---|---|
| Auth (email/password) | ARCHITECTURE.md Auth section | Yes |
| Auth (API keys) | collaboration.md API Keys section | Yes |
| Map dashboard (CRUD, clone, templates) | maps-and-layers.md Creating Maps | Yes |
| MapLibre editor + drawing tools | maps-and-layers.md Drawing Features | Yes |
| Layer panel (reorder, toggle, style, delete) | styling.md | Yes |
| Import pipeline (6 formats) | maps-and-layers.md Importing Data | Yes |
| Geoprocessing (10 ops) | maps-and-layers.md Geoprocessing | Yes |
| Spatial joins + aggregation | maps-and-layers.md Geoprocessing | Yes |
| Measurement tools | maps-and-layers.md Measurement | Yes |
| Choropleth + heatmap | styling.md | Yes |
| Annotations (6 content types) | annotations.md | Yes |
| Share links + embeds | collaboration.md Share Links / Embedding | Yes |
| Collaborators (3 roles) | collaboration.md | Yes |
| Comments (incl. guest) | collaboration.md Comments | Yes |
| Activity feed | collaboration.md Activity Feed | Yes |
| Audit log | ARCHITECTURE.md Current State | Yes |
| Martin vector tiles | self-hosting.md | Yes |
| Rate limiting (auth) | ARCHITECTURE.md Current State | Yes |
| CI pipeline | ROADMAP.md Phase 5b | Yes |
| Export (5 formats) | maps-and-layers.md Exporting Data | Yes |
| Data table + filters | maps-and-layers.md Data Table / Attribute Filters | Yes |
| Docker Compose (5 services) | self-hosting.md | Yes |
| Environment variables | environment-variables.md | Yes |
| Database schema | database-schema.md | Yes |
| tRPC API procedures | api.md | Yes |

## Gaps

| Gap | Severity | Notes |
|---|---|---|
| _(none)_ | — | All three prior gaps (quickstart, API reference, self-hosting) are now addressed |

## Sync Rules

- If a feature changes in code, its authoritative doc updates in the same round.
- STATE.md is overwritten every round (delta log + test counts + gaps).
- DOCSTATE.md is overwritten every round (coverage + gaps).
- One doc owns the authoritative description of each feature ("task coverage").
- Guides may reference features documented in reference docs ("feature mention").
- Test counts in STATE.md and ARCHITECTURE.md must match (single source: `pnpm test` output).
