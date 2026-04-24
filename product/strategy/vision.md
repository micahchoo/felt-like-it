# Product Vision — Cycle 01

**Date:** 2026-04-24 · **Owner:** Micah · **Cycle:** 1

## Vision (one paragraph)

**Felt-like-it (FLI) is an API-first, self-hostable annotation layer for geospatial workflows.** For a researcher living inside a narrative tool, a stakeholder marking up a map, and an integrator embedding spatial annotation into a third-party product, FLI is the single backend that serves all three through one schema and two surfaces: a Felt-aligned web UI for the first two personas, and a documented REST API for the third. We differentiate from Felt by being API-first and self-hostable; from Mapbox / MapLibre by shipping annotation UX out-of-the-box; from ArcGIS by being lighter-weight; from Google My Maps by being programmable.

## Positioning statement

> For **researchers, storytellers, and platform integrators** working with spatial data, FLI is an **API-first, self-hostable annotation layer** that delivers **collaborative, concurrency-safe spatial markup** — unlike **Felt** (no public API), **Mapbox/MapLibre** (no built-in annotation UX), **ArcGIS** (enterprise TCO), or **Google My Maps** (no programmatic write access).

## Three-lens validation

- **UX** — Felt-aligned authoring surface for the Storyteller; invisible to the Integrator.
- **Engineering** — `annotation_objects` as the single source of truth; tRPC for the UI, REST `/api/v1/` for external consumers; Drizzle + Postgres; Svelte 5 + TanStack Query.
- **Business** — Self-host is the revenue / trust differentiator vs Felt. RN is the inaugural API consumer and first case study.

## Locked decisions (from the bible and this cycle)

1. **No template authoring for slotted content** — Felt uses flat key-value attributes; we match.
2. **No pagination UI** — Felt has none; load-all + grouping is the Felt pattern.
3. **Groups, not tags or filters,** are the panel's organizing primitive.
4. **Style is per-annotation, not per-group.**
5. **Feature / viewport anchors and threading are FLI extensions** — keep and label as ours.

## Source

- Evidence: `product/strategy/research-cycle-01.md`
- Reference product: `docs/felt-annotations/BIBLE-SPEC.md`
- Technical state: `apps/web/e2e/api/STATE-annotation-ui-shadow.md`

## Recorded as mulch decision

`scope:product,source:product-strategy,cycle:01,lifecycle:active`
