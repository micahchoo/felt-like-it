# Svelte/SvelteKit audit — execution plan

Source of truth: `audits/_consolidated.md` + per-skill files in `audits/`.
12 seeds tracked in `.seeds/` under labels `audit-2026-04-24` + skill name.

## Wave map (DAG by blocker)

```
Wave 1 (start now, parallel)              Wave 2 (after W1)
──────────────────────────────────        ──────────────────────────────
e085 SSR singletons         ────►          05b0 share/embed cache hdrs
4657 silent-overwrite bugs  ────►          9841 effect refactor / $state.raw
41c7 error boundaries
7f74 data-flow correctness

Wave 3 (after W1, anytime)                Gated (post version-bump)
──────────────────────────────────        ──────────────────────────────
8b55 csrf/csp/version + $env              3776 prep for Svelte 5.29 / SK 2.58
53e0 inline-style sweep
ad85 structural cleanup ((public)
     layout, DataTable dup, etc.)
e6b1 build hygiene (playwright,
     service worker, Dockerfile)
404f a11y review
```

`sd ready` will surface Wave 1 + everything in Wave 3 immediately. Wave 2 unlocks atomically when its blocker closes.

## Wave 1 — correctness foundation (4 parallel tracks)

### `e085` — Migrate 5 module-scope `$state` stores to factories + `setContext` 🔴
**Why first:** SSR cross-request state corruption. Compounds with public-route caching.
**How:** One PR per store, mirror `lib/stores/filters-store.svelte.ts`. Stores: `mapStore`, `styleStore`, `layersStore`, `undoStore`, `hotOverlay`. Inject context at root `+layout.svelte`.
**Done when:** `grep -r "let _.*\$state" lib/stores lib/utils/map-sources.svelte.ts` returns nothing; SSR test of two concurrent requests shows no state bleed.

### `4657` — Fix 5 `$effect`-as-derived silent-overwrite bugs 🟠
**Why first:** Active user-visible data-loss bugs (typed text disappears).
**Sites:** `GeoprocessingPanel.svelte:212`, `AnnotationForm.svelte:91`, `SettingsScreen.svelte:29`, `ExportDialog.svelte:19`, `FilterPanel.svelte:38`.
**Pattern:** Pure projection → `$derived`. Prop-driven reset → `{#key prop.id}` parent boundary or `untrack` + id-diff inside `$effect.pre`.
**Done when:** Manual UAT: type a value, change the upstream prop, confirm typed value persists; or remount intentionally via `{#key}`.

### `41c7` — Add error boundaries 🔴
**Files to create:** `routes/+error.svelte`, `routes/(app)/+error.svelte`, `routes/(public)/share/[token]/+error.svelte`, `routes/(public)/embed/[token]/+error.svelte`. Wrap MapLibre subtree at `routes/(app)/map/[id]/+page.svelte` in `<svelte:boundary onerror>` with retry snippet.
**Also:** Remove `window.error`/`unhandledrejection` listeners at `routes/+layout.svelte:46-55` (can't catch hydration errors anyway).
**Done when:** Throwing in any load surfaces in a per-route error UI, not the framework default; map-render error doesn't full-page.

### `7f74` — Data-flow correctness 🟠
**Three sub-tasks (single PR or trio):**
- (a) Apply `toISOString()` to all Drizzle `Date` columns in 6 load fns (`dashboard:87-94`, `settings:49-65`, `map/[id]:32-37`, `share/[token]:30-39`, `embed/[token]:34-42`, `admin:80-90`). Update consumer types to `string`.
- (b) Replace `invalidateAll()` (12 sites) with `event.depends('domain:key')` in load + `invalidate('domain:key')` in handler.
- (c) Bring `dashboard/+page.server.ts:103,109,116,124` `fail()` to the standard `{field, message}` shape.
**Done when:** No `Date` instance crosses the load boundary; `grep "invalidateAll"` returns zero hits in `(app)/admin`, `(app)/settings`, `(app)/dashboard`; all `fail()` payloads typed identically.

## Wave 2 — unlocked by Wave 1

### `05b0` — Public-route cache headers 🟠 (blocked by `e085`)
**Why blocked:** `Cache-Control: private, no-store` only matters once stores are per-request. Doing it before the singleton fix would be pointless.
**Action:** Add `setHeaders` to `share/[token]/+page.server.ts` and tighten `embed/[token]/+page.server.ts` (`frame-ancestors` per share-row policy, `Cache-Control` matches share or stricter).

### `9841` — `MapEditor` dialog mirroring + `$state.raw` + minor cleanups 🟠 (blocked by `4657`)
**Why blocked:** Same effect→derived pattern as Wave 1; let the canonical fix land first so this PR mirrors it.
**Action:** 8 effects in `MapEditor.svelte` → `$derived`; `$state.raw` for `_mapInstance`/`_mapContainerEl`/`mapCenter`/`#selectedFeature`; fix `useMeasurementTooltip.svelte.ts:47` untrack hazard; convert `AnnotationPanel.svelte:347-358` to `$derived`; delete no-op effect at `:337`.

## Wave 3 — independent cleanups (no blockers)

### `8b55` — csrf/csp/version pinning + `$env/dynamic/private` migration 🟠
Pin defaults explicitly in `svelte.config.js`. Migrate `process.env.*` → `$env/dynamic/private` at `routes/api/v1/middleware.ts:128`, `export/progress/+server.ts:29-30,63`. Commit `.env.example`.

### `53e0` — Styling sweep 🟠
17 inline `style="..."` interpolations → `style:` directive. Tailwind utilities for the 3 static cases in `AnnotationContent`. Mechanical, no risk.

### `ad85` — Structural cleanup 🟡/🟠
`(public)/+layout.svelte` reset for iframes; consolidate two `DataTable.svelte`; replace `window.location.href` in `settings:36` with `goto()`; key 7 `{#each}` over mutable data; migrate 4 window/document `$effect` listeners to `<svelte:window>` / `<svelte:document>`.

### `e6b1` — Build hygiene 🟡
Playwright on `pnpm preview` not `pnpm dev`; ship `service-worker.ts` or delete `manifest.webmanifest`; `pnpm deploy --prod` in `Dockerfile.web` instead of double install.

### `404f` — A11y review of handwritten UI primitives 🟡
Modal/Select/Tooltip/Toggle/Slider — review focus-trap, ARIA, keyboard; replace ARIA-heaviest with Bits UI 1.0 if cheaper.

## Gated — `3776` (post-upgrade)

Track the Svelte 5.29 / SvelteKit 2.58 bumps. Once landed:
- `DeckGLOverlay.svelte:55-72`, `DrawingToolbar.svelte:69-134` → `{@attach}` migration.
- Revisit id-shadow `$effect` patterns for `{#key}`.
- Optionally adopt remote functions; first candidate is `GuestCommentPanel.svelte:109` (unauthenticated progressive-enhancement form).

## Sequencing notes

- **`e085` + `05b0` ship together** ideally as a coordinated PR pair — the cache hardening is undefined-behavior until the stores are per-request.
- **`4657` should ship before `9841`** so the canonical effect→derived idiom is set in code before the deeper refactor touches 8 more sites.
- **`41c7`** is a UX safety net — should land before any large refactor wave (`9841`, `ad85`).
- **`53e0` and `8b55`** are mechanical — good fillers for context-switches; assign to whoever wants a low-risk PR.
- **`404f` is calendar work** (review + decision), schedule alongside Wave 3 but don't block on it.

## Success criteria for closing the audit cycle

When Waves 1–3 are closed:
- No `let _x = $state` in module scope of any `.svelte.ts` exporting a singleton.
- Every public-SSR route either no-stores or sets a per-share-row policy.
- Every route group has an `+error.svelte`; map subtree is boundaried.
- Zero `Date` flows through load returns; zero raw `invalidateAll()` after form actions.
- `grep -E 'style="[^"]*\\{' apps/web/src --include='*.svelte'` returns ≤2 hits (allow exceptional cases).
- `mulch record` of the SSR singleton fix as a `decision` so the pattern is enforced going forward.
