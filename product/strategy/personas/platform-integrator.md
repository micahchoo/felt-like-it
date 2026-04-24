# Persona — Platform Integrator

**Archetype:** A developer embedding spatial annotation workflows into a third-party product (notebook, dashboard, content platform) via REST. They never see our UI.

**Primary job-to-be-done:** Embed collaborative annotation workflows into third-party applications via REST API **without running FLI's web UI**.

## Current tools / workarounds

- DIY stack on Mapbox Studio / MapLibre / ArcGIS + a custom backend for collaborative state.
- Google My Maps for simple embeds — no programmatic write access.
- Felt has no public REST API. `research-cycle-01.md §Q2`

## Pain points (cited)

- Felt's annotation surface is closed. ArcGIS / Mapbox require enterprise licenses and don't ship a collaborative annotation model. `research-cycle-01.md §Q2`
- Measurement + annotation state split across UI and schema — integrators reconstruct measurement UX in their own product. `BIBLE-SPEC.md §6`
- Multi-user safety demands optimistic concurrency; today it's only partially wired (tRPC delete was missing `version` until this week). `STATE-annotation-ui-shadow.md` — Promise 10/11

## Switch trigger

- `/api/v1/` stabilizes with a published versioning policy.
- REST contract is demonstrated by a live consumer (RN is the proof-of-concept).
- OpenAPI spec + SDK generation reduce integration friction.

## Design implications

- API-first: annotation CRUD, measurement data, version/concurrency fields, cursor pagination, bulk operations.
- Rate-limiting + per-key scopes are visible and documented (the security H-series work is directly for this persona).
- Slotted/templated annotations are a differentiator — keep in the schema, market as extensibility. Felt = flat attributes; FLI = structured slots + free-form.
- Idempotency keys on write endpoints (already shipped H5) are retry-safe for integrators.
- 28/28 REST marketing tests pass today — the contract is legible.

## What this persona does NOT ask for

- UI polish, groups/folders, styling panel.
- A native annotation authoring flow in FLI — they build their own.

## Source

- `project_rn_interop.md` — memory file
- `BIBLE-SPEC.md` §6
- `STATE-annotation-ui-shadow.md` — Promise 10/11, Divergences table
- `research-cycle-01.md` §Q1 Persona 3, §Q2 FLI positioning
