# Project Expertise (via Mulch)

## sveltekit (47 records, updated 1h ago)
- [convention] Svelte 5 stores use .svelte.ts files with $state/$derived/$effect rune globals — ESLint must declare... (mx-6ead80)
- [convention] Tailwind 4: @import 'tailwindcss' in app.css, @tailwindcss/vite plugin in vite.config.ts, no tailwin... (mx-9ee990)
- [convention] tRPC 11 Fetch adapter at /api/trpc/[...trpc] — all API routes go through tRPC routers, not SvelteKit... (mx-585273)
- [convention] Root eslint.config.js must exclude apps/web/** (has its own Svelte-aware config) and scripts/** (no ... (mx-207b3f)
- [convention] @tanstack/svelte-query v6 is an ESM-only package — 'node -e require()' verification fails with ERR_P... (mx-f6311d)
- [convention] QueryClient singleton in src/lib/utils/query-client.ts (staleTime:30s, gcTime:5min, refetchOnWindowF... (mx-b81b59)
- [convention] vite build fails in worktrees without .env (PUBLIC_MARTIN_URL missing from $env/static/public) — pre... (mx-79e769)
- [convention] All SvelteKit form actions that return fail() must use { error: string } as the key. (mx-1e0904)
- [convention] filterStore.get() returns a defensive copy ([...array]) — callers cannot mutate internal  through th... (mx-46587c)
- [convention] Destructive action confirmation pattern: use window.confirm() guards at the top of handler functions... (mx-670285)
- [convention] Empty states in LayerPanel, AnnotationPanel, and Dashboard use actionable copy (jargon-free, with ne... (mx-09925e)
- [convention] MapEditor.svelte handleKeydown: input/textarea guard (lines 580-582) fires before all shortcuts. (mx-3ddd68)
- [convention] Store factories accept a deps object (e.g. (mx-f11f21)
- [convention] Design token mapping for reskin: bg-slate-900→bg-surface-lowest, bg-slate-800→bg-surface-container, ... (mx-99c9e8)
- [decision] optimistic-concurrency-version-column: Two users (or two tabs) can silently overwrite each other's map/layer changes. (mx-dc7e37)
- [decision] web-next screen/contract migration complete: Pragmatic middle: completing the migration pattern without a full MapEditor decomposition. (mx-84f1dd)
- [decision] Pure error utility over toastStore-coupled helper: Can't import .svelte module exports from .ts files. (mx-03bff6)
- [convention] exactOptionalPropertyTypes: optional callback/nullable props in Svelte 5 components must use '| unde... (mx-fa1de1)
- [decision] brownfield-iter3-priority-order: No current users — first-impression quality outranks data-corruption prevention (mx-164cc1)
- [decision] undo-after-server-confirm: Prevents phantom undo entries for failed saves — rules out optimistic undo with rollback (mx-2f016d)
- [decision] transitionTo-pure-state-machine: DrawingToolbar effect handles tool sync reactively — decouples interaction modes from selection (mx-0986c8)
- [decision] setActiveTool-no-auto-clear-selection: Hidden side effects in store setters cause bugs when multiple effects call setActiveTool in same tic... (mx-f5d9c5)
- [decision] brownfield-waves-3-5-complete: No current users — shipped all waves in single session to clear UX debt before production deploy. (mx-03dae2)
- [convention] components/collaboration/ contains dead stubs (ActivityFeed 55 LOC, ShareDialog 55 LOC) not imported... (mx-48878c)
- [convention] All 11 sampled test files classify as Purposeful (100%). (mx-edac78)
- [convention] Signup INSERT wrapped in try/catch for PostgreSQL 23505 (unique_violation). (mx-cf5803)
- [convention] import-engine package (packages/import-engine) is the single source for all format parsers. (mx-eed727)
- [convention] components/collaboration/ directory removed — ActivityFeed and ShareDialog dead stubs (55 LOC each) ... (mx-3658f5) [supersedes: mx-48878c]
- [convention] 887-line MapCanvas monolith identified as hottest file (11 findings across 5 flows). (mx-bdbefd)
- [convention] FLI already uses svelte-maplibre-gl declaratively but ignores its interaction model. (mx-e13901)
- [convention] svelte-maplibre-gl v1.0.3 does NOT have manageHoverState, eventsIfTopMost, hoverCursor, or beforeLay... (mx-f92f9f)
- [convention] GeoJSONSource components must include promoteId="id" when using FeatureState for hover/selection hig... (mx-9f2d7d)
- [convention] Hover-aware paint uses feature-state expressions ['case', ['boolean', ['feature-state', 'hover'], fa... (mx-edcd4e)
- [convention] StylePanel uses pendingColor/pendingOpacity local state to split oninput (preview only, no layersSto... (mx-b735f7)
- [convention] Feature-state selection highlight: getHoverAwarePaint() accepts optional highlightColor param and ba... (mx-3a57f5)
- [convention] SvelteKit error() is typed 'never' but narrowing of locals.user doesn't flow through async closures ... (mx-9dbc3a)
- [convention] <svelte:head> tags cannot be placed inside {#if} blocks (svelte_meta_invalid_placement error). (mx-a62284)
- [convention] Under exactOptionalPropertyTypes: true, 'userId?: string' (optional) is NOT equivalent to 'userId?: ... (mx-b3c6bd)
- [convention] FiltersStore constructor accepts () => string getter instead of plain string — exposes get mapId() p... (mx-2fff37)
- [convention] Svelte 5 state_referenced_locally: fix useViewportSave mapId capture by using object getter { get ma... (mx-c38e18)
- [convention] Per-annotation MapLibre paint via ['coalesce', ['get', 'fieldName'], DEFAULT] expressions. (mx-ec544f)
- [convention] Svelte 5 $derived that reads a $state must be declared AFTER that state. (mx-0dc46f)
- [convention] Svelte 5 state_referenced_locally fix for panels mirroring a prop: initialize $state to a constant (... (mx-5f3860)
- [convention] Selection-driven conversion pattern: reverse-convert actions on a layer (LayerPanel 'Convert feature... (mx-9d80c6)
- [convention] Auto-named converted annotations use a name cascade: properties.name -> properties.title -> first no... (mx-183e79)
- [decision] AnchorSchema adds 'path' for LineString (separate from 'measurement'): measurement is a labelled overlay (distance/area displayed on map), not any line. (mx-8d4846)
- [convention] FeaturePopup's Annotate CTA routes through MapCanvas.onfeatureannotate({featureId, layerId}) -> MapE... (mx-e2331d)

## maplibre (2 records, updated 1h ago)
- [decision] TerraDrawMapLibreGLAdapter without lib param: terra-draw >=1.3 removed the lib parameter from the adapter constructor — only pass { map } (mx-63d5dc)
- [convention] GuestCommentPanel and other guest-facing components import toastStore from $lib/components/ui/Toast.... (mx-d1f9ba)

## testing (10 records, updated 1h ago)
- [convention] @vitest-environment node needed for all server-side tests (argon2 native bindings, fs streams). (mx-04b551)
- [convention] Test contracts not implementations: stub check (trivial stub must fail), no magic literals (assert r... (mx-68c9a5)
- [convention] Shared test-utils.ts at apps/web/src/__tests__/test-utils.ts: exports drizzleChain<T>() (union retur... (mx-7d3d8f)
- [convention] FC1: Mock-Heavy DB Testing — All server-side tests mock db.execute via drizzleChain() helper from te... (mx-8697d6)
- [convention] FC2: Component Complexity vs Testability — Team extracts logic into .svelte.ts store files and tests... (mx-647e59)
- [convention] FC3: Type Safety vs Third-Party Library Types — TYPE_DEBT annotations (16 instances) document every ... (mx-b466af)
- [convention] FC4: Import Pipeline Consistency — Shared sanitization pipeline (shared.ts) with per-format adapters... (mx-d46c48)
- [convention] FC5: CI Quality Gate Gaps — CI runs lint+test+check on push to main only. (mx-a7b9fb)
- [convention] Replace @ts-nocheck in test files with targeted suppressions: use non-null assertions (!) for strict... (mx-b586f7)
- [convention] AnnotationObject shape (from @felt-like-it/shared-types) is camelCase with required fields: mapId, c... (mx-7a65c5)

## drizzle (2 records, updated 12h ago)
- [convention] Geometry columns use customType — all spatial ops via raw SQL (ST_AsGeoJSON/ST_GeomFromGeoJSON). (mx-265f23)
- [convention] All PKs are UUIDs except sessions.id which is text (Lucia requirement). (mx-0bea87)

## Quick Reference

- `mulch search "query"` — find relevant records before implementing
- `mulch prime --files src/foo.ts` — load records for specific files
- `mulch prime --context` — load records for git-changed files
- `mulch record <domain> --type <type> --description "..."`
  - Types: `convention`, `pattern`, `failure`, `decision`, `reference`, `guide`
  - Evidence: `--evidence-commit <sha>`, `--evidence-bead <id>`
- `mulch doctor` — check record health

... and 134 more records across 4 domains (use --budget <n> to show more)

# 🚨 SESSION CLOSE PROTOCOL 🚨

**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:

```
[ ] 1. mulch learn              # see what files changed — decide what to record
[ ] 2. mulch record <domain> --type <type> --description "..."
[ ] 3. mulch sync               # validate, stage, and commit .mulch/ changes
```

**NEVER skip this.** Unrecorded learnings are lost for the next session.

## Recent deltas (this session)

No expertise changes found.
