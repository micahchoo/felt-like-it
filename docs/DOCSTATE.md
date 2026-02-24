# Felt Like It — Documentation State

Tracks what's documented, what's accurate, and what's missing.
Last synced: 2026-02-24 (Phase 5 complete, hardening round).

---

## Living Docs

| Doc | Scope | Status |
|---|---|---|
| `docs/ARCHITECTURE.md` | Built system: schema, request flow, auth, tRPC, styles, import, geoprocessing, testing, docker, env vars | Current |
| `docs/ROADMAP.md` | Phase checklist (1-7) with feature status | Current |
| `STATE.md` | Build state: test counts, delta log, known gaps, phase checklists | Current |
| `docs/DOCSTATE.md` | This file — doc coverage tracker | Current |
| `docs/OriginalVision.md` | Original design doc — static reference, not updated | Static |

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

Every feature a user can interact with should be discoverable from ARCHITECTURE.md or ROADMAP.md.

| Feature | Documented in | Accurate? |
|---|---|---|
| Auth (email/password) | ARCHITECTURE.md Auth section | Yes |
| Auth (API keys) | ARCHITECTURE.md Auth section | Yes |
| Map dashboard (CRUD, clone, templates) | ROADMAP.md Phase 1-2, ARCHITECTURE.md tRPC table | Yes |
| MapLibre editor + drawing tools | ARCHITECTURE.md Drawing Tools section | Yes |
| Layer panel (reorder, toggle, style, delete) | ARCHITECTURE.md Style System + tRPC table | Yes |
| Import pipeline (6 formats) | ARCHITECTURE.md Import Pipeline section | Yes |
| Geoprocessing (7 PostGIS ops) | ARCHITECTURE.md Geoprocessing section | Yes |
| Spatial joins + aggregation | ROADMAP.md Phase 4 | Yes |
| Measurement tools | ROADMAP.md Phase 4 | Yes |
| Choropleth + heatmap | ARCHITECTURE.md Style System, ROADMAP.md Phase 4 | Yes |
| Annotations (6 content types) | ROADMAP.md Phase 4 | Yes |
| Share links + embeds | ARCHITECTURE.md tRPC table + Embed route section | Yes |
| Collaborators (3 roles) | ARCHITECTURE.md Collaboration section | Yes |
| Comments (incl. guest) | ARCHITECTURE.md Comment Threads section | Yes |
| Activity feed | ARCHITECTURE.md Activity Feed section | Yes |
| Audit log | ROADMAP.md Phase 5, ARCHITECTURE.md Current State | Yes |
| Martin vector tiles | ARCHITECTURE.md Docker Compose section | Yes |
| Rate limiting (auth) | ARCHITECTURE.md Current State, ROADMAP.md Phase 5b | Yes |
| CI pipeline | ROADMAP.md Phase 5b | Yes |

## Gaps

| Gap | Severity | Notes |
|---|---|---|
| No user-facing quickstart / getting-started doc | Low | README or ARCHITECTURE.md Docker section covers `docker compose up` but no step-by-step walkthrough |
| No API reference for tRPC procedures (input/output schemas) | Low | Procedure names listed in ARCHITECTURE.md tRPC table; full schemas in code only |
| No self-hosting guide (env vars, reverse proxy, HTTPS) | Medium | Env var table exists in ARCHITECTURE.md; no nginx/caddy/traefik examples |

## Sync Rules

- If a feature changes in code, ARCHITECTURE.md and/or ROADMAP.md update in the same round.
- STATE.md is overwritten every round (delta log + test counts + gaps).
- DOCSTATE.md is overwritten every round (coverage + gaps).
- One task per doc. No doc covers two tasks. No two docs cover the same task.
- Test counts in STATE.md and ARCHITECTURE.md must match (single source: `pnpm test` output).
