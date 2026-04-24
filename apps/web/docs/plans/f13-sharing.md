# F13 — Sharing — Dedicated Plan

> Seed: `felt-like-it-1c79`. Companion to `flow-architecture-program.md`. Read program plan first.

## Problem (verbatim from seed)

Share URL carries no viewport state — recipient always sees the owner's last-saved viewport with no way to deeplink a specific view. Token resolution logic duplicated between server-load and tRPC. ShareViewerScreen loads full MapEditor (undo, drawing, filters, annotation infrastructure) for a read-only view. Only public access level used despite schema supporting others. No link expiration.

## Decomposition (4 sub-waves)

```
F13.1 — Hash-state viewport URL          ─┐
F13.2 — Dedupe token resolution          ├─►  F13.4 — Lightweight viewer (split bundle)
F13.3 — Link expiration                  ─┘
```

F13.1 + F13.2 + F13.3 are independent; F13.4 ideally lands after the others (or in parallel, but the bundle-split touches the same files as the read-only view).

### F13.1 — Hash-state viewport URL (this session)

**Goal.** Share URLs carry `#zoom/lat/lng` — a recipient lands at the linked viewport instead of the owner's saved view. Owner's UI updates the hash live as they pan/zoom on the share page.

**Approach.**
- A small composable `useViewportHash(map)` that:
  1. On hash change (or initial load with hash present), parses `#z/lat/lng` and `map.jumpTo({ zoom, center })`.
  2. On `map.on('moveend')`, writes `#z/lat/lng` back to `location.hash` (debounced, replaceState — no history pollution).
- Wire into `ShareViewerScreen.svelte` (the read-only viewer) only. Editor + embed get their own decisions later.

**Format.** `#zoom/lat/lng` matching common conventions (Leaflet, Mapbox URL hash plugin). Precision: zoom to 2 decimals, lat/lng to 5 decimals (~1m resolution at the equator). Defensive parsing — bail on malformed values, fall back to map's saved viewport.

**Acceptance.**
- Pan/zoom on the share page → URL hash updates within ~250ms of the move ending.
- Reload the page → map restores to the hashed viewport, not the owner's saved viewport.
- Open the page with no hash → owner's saved viewport renders (no regression).
- Open the page with malformed hash (`#abc/notanumber/x`) → owner's saved viewport renders; no error surfaces.
- Vitest: parse + serialize round-trip; precision; malformed input.

**Size.** 1 short session. ~40-80 LOC + 8-12 tests.

### F13.2 — Deduplicated token resolution (next session)

**Goal.** Token validation lives in one place. Server-load + tRPC + middleware all consume the same `resolveShareToken(token)` helper.

**Approach.** Audit `lib/server/auth/share-token.ts` + `lib/server/trpc/routers/shares.ts` + `routes/(public)/share/[token]/+page.server.ts` for the duplicated logic; consolidate into one helper exporting a typed `ShareTokenContext`. Caller-side becomes a single-line lookup.

**Acceptance.** Diff shows the duplicated code removed; both call sites use the same function; tests for token validation are not duplicated.

**Size.** 1 small session. Mostly grep + extract.

### F13.3 — Link expiration (next session)

**Goal.** Owner can set an expiration on a share link; expired tokens reject with a clear error.

**Approach.** Check the `shares` table schema for an `expires_at` column. If present, just surface in UI + enforce in `resolveShareToken`. If absent, schema migration: `ADD COLUMN expires_at TIMESTAMPTZ NULL`.

**Acceptance.** UI in share-creation modal accepts an expiration (no expiration / 1 day / 1 week / 30 days / custom). Expired tokens return `410 Gone` with `Link: <new-share-url>` if the owner has rotated. Vitest: pre-expiry resolves; post-expiry rejects.

**Size.** 1 session.

### F13.4 — Lightweight read-only viewer (separate session)

**Goal.** ShareViewerScreen loads only what's needed for read-only viewing — no undo store, no drawing toolbar, no filter store mutation paths. Bundle-split or dedicated component.

**Approach.** Audit ShareViewerScreen's dependency tree; identify what leaks into the read-only path. Either gate features inside MapEditor on a `readonly` prop already present, or build a parallel `ReadOnlyMapViewer.svelte` that imports a narrower set of components. Bundle-analyzer first to size the actual problem.

**Acceptance.** Lighthouse / bundle-analyzer shows N% reduction in JS for the share route. No regression in viewport / panning / annotations display.

**Size.** 1-2 sessions. Risk: ShareViewerScreen reuses MapEditor; the read-only gating may already be dense; refactor scope unclear without the audit.

## Out of scope for F13

- Multiple access levels (`public` vs `commenter` vs `editor`) — separate audit.
- Share link analytics / view tracking.
- Embed flow (F14) — sister seed; pairs naturally with F13.4.

## Open questions

- F13.3: does the `shares` table already have `expires_at` or do we need a migration?
- F13.4: does the existing `readonly` prop on MapEditor cover all the heavy code paths, or is a parallel viewer needed?

These get resolved at execution time; no pre-decision needed.
