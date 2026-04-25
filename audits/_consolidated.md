# Svelte/SvelteKit audit — consolidated rollup

**Stack:** Svelte 5.17.3, SvelteKit 2.15, Tailwind 4, adapter-node.
**Per-skill canonicals** (this file is the rollup):
`audits/svelte-runes.md` · `audits/sveltekit-data-flow.md` · `audits/sveltekit-structure.md` · `audits/svelte-template-directives.md` · `audits/sveltekit-remote-functions.md` · `audits/svelte-deployment.md`
For `svelte-styling` and `svelte-components` see §5/§6 below (loaded by user, no separate file).

**Version gates surfaced by this audit (block whole categories of fixes):**
- `{@attach}` requires Svelte ≥ 5.29 → currently 5.17.3
- Remote functions require SvelteKit ≥ 2.58 + experimental flags → currently 2.15

---

## §1 svelte-runes

🔴 **HIGH — 5 module-scope `$state` SSR singletons**
- `lib/stores/map.svelte.ts:50-58`
- `lib/stores/style.svelte.ts:4`
- `lib/stores/layers.svelte.ts:3-4`
- `lib/stores/undo.svelte.ts:9-10`
- `lib/utils/map-sources.svelte.ts:3`
Fix: factory + `setContext()`. Pattern proven in `filters-store`/`activity-store`/`export-store`.

🟠 **MED — `$effect` doing data sync (silent overwrite of user input)**
- `GeoprocessingPanel.svelte:212` · `AnnotationForm.svelte:91` · `SettingsScreen.svelte:29` · `ExportDialog.svelte:19` · `FilterPanel.svelte:38`

🟠 **MED — missed `$state.raw`** (proxy overhead on non-reactive objects)
- `map.svelte.ts:58` `_mapInstance`, `_mapContainerEl` · `MapCanvas.svelte` `mapCenter` · `MapEditorState #selectedFeature`

🟠 **MED — `MapEditor.svelte`** has 8 effects mirroring `editorLayout.activeDialog` to local `*DialogOpen` state — should be `$derived`.

🟠 **MED — `useMeasurementTooltip.svelte.ts:47`** mutates `currentResult` without `untrack` — loop hazard.

🟡 **LOW** — `AnnotationPanel.svelte:337` no-op effect; `:347-358` should be `$derived`; `$bindable()` without default in 4 dialogs.

✅ **Refuted** — `AnnotationStylePanel.svelte:23` is the *correct* skill-compliant id-gated form-reset pattern.

---

## §2 sveltekit-data-flow

🟠 **MED — Date serialization leak** in 6 load functions (`dashboard:87-94`, `settings:49-65`, `map/[id]:32-37`, `share/[token]:30-39`, `embed/[token]:34-42`, `admin:80-90`). `share/[token]:27` already does `toISOString` for `expiredAt` — pick one rule.

🟠 **MED — `invalidateAll()` overuse** — 12 callsites, **zero** `depends()` calls. Targets: `(app)/admin:45,51,60,73`, `(app)/settings:47,56,74,86`, `(app)/dashboard:65,82`.

🟡 **LOW — `fail()` shape inconsistency** — `dashboard/+page.server.ts:103,109,116,124` drops `field` key. Every other action uses `{field, message}`.

🟡 **LOW** — layout shape duplication (root vs `(app)`) forces `as` casts; tighten `App.Locals`.

🟡 **LOW** — `embed/+page.server.ts:8,14,20` sequential DB; could `Promise.all` after `share` resolves.

✅ Cookies server-only · no try/catch around `redirect`/`error` · no `+page.ts` hybrid · `parent()` correct.

---

## §3 sveltekit-structure

🔴 **HIGH — zero error boundaries** — no `+error.svelte`, no `<svelte:boundary>`. Add at root, `(app)`, `(public)/share/[token]`, `(public)/embed/[token]`, plus a boundary around the MapLibre subtree at `(app)/map/[id]/+page.svelte`.

🟠 **MED — `routes/+layout.svelte:46-55`** uses `window.error` / `unhandledrejection` listeners; these can't catch Svelte 5 hydration/render errors. Coverage gap.

🟡 **LOW** — `(app)/settings/+page.svelte:36` uses `window.location.href` instead of `goto()` — drops SPA semantics.

🟡 **LOW** — `(public)` group has no own layout; embed/share inherit Toast/InstallPrompt/UpdateBanner — jarring inside iframes. Add a reset layout.

🟡 **LOW** — duplicated `DataTable.svelte` (`lib/components/data/` + `lib/components/ui/`).

✅ File naming canonical · all 3 layouts render `{@render children()}` · `<svelte:head>` always top-level · route groups non-colliding.

---

## §4 svelte-template-directives

🟠 **MED — third-party DOM via `$effect` instead of `{@attach}`** (gated on Svelte 5.29+):
- `DeckGLOverlay.svelte:55-72` (MapboxOverlay)
- `DrawingToolbar.svelte:69-134` (TerraDraw)

🟠 **MED — 7 unkeyed `{#each}` over mutable data** — keying needed.

🟡 **LOW — 4 window/document listener `$effect`s** should be `<svelte:window>`/`<svelte:document>`:
`OfflineBanner` · `InstallPrompt` · `+layout.svelte` · `DrawingToolbar:312`.

✅ Zero `{@html}` · zero `innerHTML` · zero `{@debug}` · 12 `{@render}` correct · 18 `{@const}` idiomatic.

---

## §5 svelte-styling

🟠 **MED — 17 inline `style="…"` interpolations** that should be `style:` directive. Sites: `ProgressBar:28`, `ColorSwatch:28`, `Slider:49`, `ImportDialog:285`, `ExportDialog:385`, `GeoprocessingPanel:532`, `MeasurementTooltip:27`, `Legend:62/71`, `StylePanel:673`, `MapEditor:774`, `routes/api/v1/docs/+page.svelte:100`.

🟡 **LOW — Tailwind-able statics** — `AnnotationContent.svelte:118,133,153` (use `max-h-48`, `line-clamp-2`).

✅ Zero `:global()` · only 3 `<style>` blocks project-wide · design tokens via Tailwind `@theme`.

---

## §6 svelte-components

🟡 **LOW — handwritten primitives** (Modal, Slider, Toggle, Select, Tooltip) — a11y unverified. Consider Bits UI 1.0 for ARIA-heavy ones.

✅ 76 `$props()` destructures · 10 `$bindable()` confined to genuine two-way · `use:enhance` only on signup/login.

---

## §7 sveltekit-remote-functions

🟡 **N/A — version gated.** SvelteKit 2.15 < 2.58. Skill prescribes nothing as mandatory. Current tRPC + tanstack-query is endorsed by skill as a baseline. **No action.** Revisit `GuestCommentPanel.svelte:109` only post-upgrade.

---

## §8 svelte-deployment

🟠 **MED — `(public)/share/[token]/+page.server.ts:5,30`** has **no `setHeaders` at all** (default cacheable; combined with §1 singletons → catastrophic leak).
🟠 **MED — `(public)/embed/[token]/+page.server.ts:30-32`** — `frame-ancestors *` unconditional, no `Cache-Control`.
🟠 **MED — `svelte.config.js:5-15`** — no `kit.csrf` / `kit.csp` / `kit.version` / `paths` block. Future PRs can silently downgrade.

🟡 **LOW — direct `process.env.*`** at `routes/api/v1/middleware.ts:128`, `routes/api/v1/export/progress/+server.ts:29-30,63` — should go through `$env/dynamic/private`.
🟡 `static/manifest.webmanifest` exists with no service worker — ship one or delete.
🟡 `playwright.config.ts:30-35` runs `pnpm dev` not `preview` — masks adapter/manualChunks bugs the vite comment specifically warns about.
🟡 `apps/web/.env` exists, no `.env.example` committed.
🟡 `docker/Dockerfile.web:30-49` double `pnpm install`; prefer `pnpm deploy --prod`.

✅ adapter-node correct · `build.target: es2022` with comment · MapLibre `manualChunks` · vitest coverage scoped sensibly · non-root runner.

---

## §9 svelte-layerchart — N/A (no charts in app).

---

## Cross-cutting picture

Two version gates dominate the long-term roadmap (Svelte 5.29 unlocks `{@attach}`; SvelteKit 2.58 unlocks remote functions). Today's actual bugs cluster around:

1. **SSR cross-request state** (§1 singletons + §8 caching = compounding leak on public routes).
2. **Silent overwrites in form/UI state** (§1 effect-as-derived) — user-visible data loss.
3. **No error containment** (§3 zero boundaries) — any thrown load error is full-page.
4. **Inconsistent serialization & invalidation** (§2 Date leak + invalidateAll without depends).

Fix order: `(1 + §8 caching together)` → `2` → `3` → `4` → cosmetic sweeps (§5, §3 dups, §1 refactors) → version-gated migrations.
