# FLI × Allmaps — End-to-End Research Questions

Each question traces a user action or system behavior through the full stack,
identifies where FLI accumulates unnecessary complexity compared to allmaps,
and defines what a resolved answer looks like.

Allmaps is not a clean-room ideal — it has GPU memory leaks (R1), ~1400 LOC of
duplicated adapter methods (R5), a tile cache with no size cap (R7), and three
coexisting renderer paths without deprecation (R10). The comparison is structural:
what would FLI look like if it absorbed the patterns that work, not the project wholesale.

---

## RQ1. When a user draws a polygon, how many independent stores mutate before the geometry reaches the database — and can that number be one?

**Trace now:** User clicks draw → DrawingToolbar sets `interactionState` → Terra Draw callback fires → `drawingStore` buffers geometry → `$effect` in MapEditor bridges to `mapStore` → tRPC mutation → Drizzle → PostGIS INSERT → TanStack cache invalidated → `layerStore` refetches → MapLibre source updated via another `$effect`.

At least 5 stores mutate (`interactionModes`, `drawing`, `map`, `layers`, `selection`) across 3+ `$effect` chains in MapEditor, with documented ordering hazards (ST1, setActiveTool races).

**Allmaps pattern:** Every state module in the editor follows the same class structure:
```
class FooState {
  #field = $state(...)
  #computed = $derived(...)
  constructor() { $effect(...) }
}
export function setFooState() { return setContext(KEY, new FooState()) }
export function getFooState() { return getContext(KEY) }
```
12+ state modules follow this pattern. State is created in layout components, consumed via `getContext()`. Cross-state communication uses native `EventTarget` (not `$effect` chains) — `MapsEventTarget` dispatches typed events that views subscribe to. No store-to-store mutation.

**Key insight:** Allmaps's `MapsState` is also the sole ShareDB integration point — all mutations flow through one class. This is possible *because* state isn't fragmented across independent stores.

**Resolved when:** A prototype `MapState` class (class-based runes + context API pattern) handles the draw-to-persist flow with ≤2 reactive boundaries (state write + derived read). The number of `$effect` blocks required in the orchestrating component is measured against the current 14. Side-channel communication between state classes uses `EventTarget.dispatchEvent()` instead of effect-mediated store writes.

---

## RQ2. When a user imports a 50MB Shapefile, the same parsing code runs in two different processes — what is the actual divergence between web and worker parsers, and can a single `import-engine` package serve both?

**Trace now:** User uploads file → web app validates + enqueues BullMQ job → worker picks up job → worker has its own copies of all 6 format parsers (GeoJSON, CSV, Shapefile, KML, GPX, GeoPackage) → worker writes features via raw SQL (bypassing Drizzle) → web polls for completion.

The worker's 685 LOC `index.ts` duplicates parsing logic and uses raw SQL that the web app doesn't, meaning bugs fixed in one copy don't reach the other.

**Allmaps pattern:** The dependency graph is a strict DAG with no circular deps. `@allmaps/types` (Layer 0, zero deps) → `@allmaps/annotation` (parsing) → consumed identically by editor, CLI, and workers. `stdlib` is depended on by 18 of 24 packages. One parse function, many consumers — enforced by the package boundary.

**Key insight from allmaps infra:** Their build system requires `^build` (topological build order) in Turbo, so any shared package change propagates to all consumers automatically. FLI's Turbo already does this — the missing piece is extracting the shared code into a package, not the build wiring.

**Resolved when:** A dependency graph shows which imports/types each parser needs, whether they're all Node-compatible (no browser APIs), and a concrete package boundary is drawn. Bonus: does the worker's raw SQL diverge from Drizzle's generated SQL in ways that cause data inconsistency?

---

## RQ3. When MapLibre re-renders a layer with 8,000 features on pan, does FLI rebuild the GeoJSON source from scratch — and would `$state.raw` plus a viewport-scoped cache eliminate that work?

**Trace now:** Pan event → viewport changes → `$effect` in MapCanvas detects new bounds → TanStack Query may refetch (staleTime 30s) → full GeoJSON array assigned to MapLibre source via `setData()` → MapLibre diffs internally. Meanwhile, Svelte's deep proxy tracks every property of every feature object in `$state`, even though the array is replaced wholesale, never mutated in place.

**Allmaps pattern:** Uses `$state.raw` for data that changes by replacement (maps, annotations). `TileCache` with R-tree spatial indexing (`rbush`) provides viewport-aware data loading — only tiles intersecting the current viewport are fetched and rendered.

**Honest caveat:** Allmaps's tile cache has no absolute size cap (risk R7) and relies on viewport proximity for pruning. Their approach trades memory for speed — and they haven't solved memory management either. The question isn't "copy their cache" but "is FLI's full-reload simpler-but-costlier, and at what feature count does it matter?"

**Resolved when:** Profile data shows: (a) Svelte proxy overhead on feature arrays (measurable > 1ms per render cycle?), (b) `$state.raw` substitution impact, (c) feature count threshold where full-GeoJSON `setData()` becomes slower than viewport-clipped queries via `ST_Intersects(geometry, bbox)`.

---

## RQ4. When two users edit the same map in different tabs, the second user's save silently overwrites the first — can FLI's server-first mutation model gain conflict detection without adopting full real-time sync?

**Trace now:** User A saves → tRPC mutation → UPDATE WHERE id = X → success. User B (stale data) saves → UPDATE WHERE id = X → overwrites User A. The `optimistic-concurrency-version-column` decision (mx-dc7e37) identified this but no version column exists yet.

**Allmaps pattern (specific):** `MapsState` is the *sole* ShareDB integration point. All mutations go through `doc.submitOp(json1Op)` → ShareDB server → broadcast to other clients → `#handleOperation` parses ops into typed events via `parseOperations()` → views update. OT-JSON1 supports fine-grained operations on nested JSON — individual GCP moves, mask changes, and transformation type selections are each distinct ops, not full-document replacements.

Data versioning is implicit: every `submitOp` advances the document version. Conflicts are resolved by OT before they reach state. The architecture requires WebSocket connectivity and a ShareDB server (their editor uses `PUBLIC_ALLMAPS_API_WS_URL`).

**The spectrum:** There are three levels of conflict handling, increasing in complexity:
1. **Optimistic locking** (version column, `UPDATE WHERE version = N`, reject stale) — detects conflicts, doesn't resolve them
2. **Last-write-wins with notification** (version column + SSE to notify stale clients) — detects + notifies
3. **Operational transformation** (ShareDB/OT-JSON1) — detects + resolves automatically

**Resolved when:** The minimum viable approach is chosen for FLI's current single-user reality. Is the version column sufficient? When collaborative editing (felt-like-it-660a) is unblocked, does the version column become throwaway, or does it serve as the foundation for OT (since OT also needs a version counter)?

---

## RQ5. When a user runs "Buffer" on a 5,000-feature layer, they wait for the server with no preview — can the geoprocessing pipeline split into instant client-side preview + authoritative server-side persist?

**Trace now:** User selects layer → picks Buffer → sets distance → clicks Run → tRPC mutation → raw PostGIS `ST_Buffer()` SQL → new layer created → TanStack invalidation → full refetch → MapLibre renders result. User sees a spinner for the entire duration.

**Allmaps pattern:** All transformations run client-side in pure TS packages. The browser computes and renders results immediately. For heavy work (tile fetching, image processing), Web Workers via Comlink keep the UI thread free — computation happens off-thread and results are posted back.

**Applicable insight:** FLI's `geo-engine` package already exists but isn't used for client-facing computation. Turf.js is already a dependency (used for measurement). Turf has `buffer()`, `centroid()`, `convexHull()`, `union()`, `intersect()`, `difference()` — covering 6 of FLI's 7 PostGIS operations. The 7th (dissolve) is `union` applied iteratively.

For large feature counts, the Comlink pattern is relevant: spawn a Web Worker, run Turf operations there, post preview GeoJSON back to the main thread for immediate rendering.

**Resolved when:** Each of FLI's 7 geoprocessing operations is benchmarked with Turf.js at 1K/5K/10K features on a mid-range device. Operations completing in < 200ms get client-side preview. Operations that exceed that threshold get a progress indicator instead. Define: does the preview layer render as a temporary MapLibre source, or does it reuse the existing layer with a "preview" style?

---

## RQ6. When the codebase adds a new spatial operation, how many files must change — and can `geo-engine` become the single place where spatial logic lives?

**Trace now:** Adding a new operation requires changes in: (1) tRPC router (SQL template), (2) Zod schema in shared-types, (3) GeoprocessingPanel UI component, (4) possibly worker if it needs the operation, (5) REST v1 route if exposed externally. Spatial SQL lives inline in tRPC routers, not in `geo-engine`.

**Allmaps pattern:** Adding a new transformation means adding a class in `@allmaps/transform` and exporting it. Every consumer (editor, viewer, CLI, all 3 map library plugins) gets it automatically because they depend on the package. The dependency fan-in is formalized:

```
Layer 0: types (zero deps)
Layer 1: stdlib, id (depends on L0)
Layer 2: annotation, iiif-parser, transform (depends on L0-1)
Layer 3: project (depends on L0-2)
Layer 4: render (depends on L0-3)
Layer 5: map adapters (depends on L0-4)
Layer 6: apps (depends on everything)
```

The discipline is that lower layers never import from higher layers. This makes the "add once, get everywhere" property fall out of the structure.

**Resolved when:** An inventory of every file containing PostGIS SQL (`ST_*` calls) shows the actual scatter. Then: which can be moved into `geo-engine` as typed functions that accept/return GeoJSON, with the tRPC router reduced to calling the function and persisting the result? Define: should `geo-engine` have a Layer 0/1 dependency rule (no framework, no ORM imports)?

---

## RQ7. When a developer changes a type in `shared-types`, how long until the error surfaces in `web` and `worker` — and would TypeScript project references make that instant?

**Trace now:** Developer edits a Zod schema in `shared-types` → must run `turbo build` or wait for CI → type error surfaces in dependent packages only after compilation. During `dev`, Vite hot-reloads `web` but the worker process doesn't pick up the change until restarted.

**Allmaps pattern:** TypeScript project references with `composite: true`. Their Turbo `types` task depends on `build + ^types`, so type checking is incremental and topological. The `precommit` task fans out to `build`, `test`, `types`, `lint`, `documentation` — a comprehensive local gate before any push.

**Counterpoint:** Allmaps has no CI/CD pipeline (risk R2). Their `precommit` hook is the only quality gate. FLI already has CI with lint/test/check gates (mx-6282dd). The question is whether the *local* feedback loop is fast enough, not whether gates exist.

**Resolved when:** Measure current feedback loop (edit shared-types → error visible in web IDE) with and without project references. For a 4-package monorepo, is the improvement meaningful or negligible? Also: does the worker's `dev` mode auto-restart on dependency changes, or is that a separate DX issue?

---

## RQ8. When FLI renders a map with mixed geometry types, every layer creates 3 MapLibre sublayers (fill + line + circle) regardless of actual content — does geometry-aware rendering eliminate measurable GPU work?

**Trace now:** A layer containing only points still creates fill and line sublayers (empty but registered with MapLibre). With 20 layers, that's 60 sublayers where 20 would suffice. Each sublayer participates in MapLibre's style diffing and render loop.

**Allmaps pattern:** The render pipeline is geometry-aware through a deep class hierarchy: `WarpedMap` → `TriangulatedWarpedMap` → `WebGL2WarpedMap`, with per-map GPU state (VAOs, texture arrays). Only relevant rendering paths activate. But this comes at a cost: the WebGL2Renderer is 1146 LOC, manages 3 shader programs (map/lines/points), and has documented GPU memory leaks where textures of departed maps are never freed (risk R1).

**Honest framing:** Allmaps trades MapLibre's managed rendering for manual WebGL2 control — and they've introduced bugs doing it (shader deletion bug: lines/points shaders are never cleaned up due to copy-paste error). FLI's 3-sublayer approach is simpler and delegates memory management to MapLibre. The question is whether the overhead of empty sublayers is measurable, not whether FLI should take on manual GPU management.

**Resolved when:** Profile MapLibre's render loop with 20 layers × 3 sublayers vs. 20 geometry-matched sublayers. If empty sublayers cost < 0.5ms per frame, keep the current approach — simplicity wins. If measurable, a geometry-type check at layer creation time (`if (layer.geometryType !== 'Point') skip circle sublayer`) is a one-line fix per sublayer, not an architectural change.

---

## RQ9. When the Martin tile server is unavailable, does FLI's fallback to full GeoJSON for large layers create a cliff — and is there a progressive middle ground?

**Trace now:** If `PUBLIC_MARTIN_URL` is unset or Martin is down, layers > 10K features fall back to loading the entire GeoJSON dataset into the browser. There's no intermediate strategy.

**Allmaps pattern:** Tile cache with R-tree spatial indexing. Tiles are fetched on demand per viewport. Degradation is progressive: fewer tiles cached = slower fill, not an all-or-nothing data dump. But their cache has no absolute size cap (risk R7), so "progressive" can still mean "progressively eating all memory."

**Resolved when:** Define "graceful degradation" for FLI with three concrete strategies and their feasibility:
(a) **Server-side simplification**: `ST_Simplify(geometry, tolerance)` at lower zooms — reduces payload without losing spatial coverage
(b) **Viewport-clipped queries**: `ST_Intersects(geometry, ST_MakeEnvelope(...))` instead of full-table fetch — only load what's visible
(c) **Client-side clustering**: For point layers, cluster at low zooms (MapLibre has built-in clustering)
Measure memory + render time for 50K features with each strategy vs. current full-load behavior. Which combination gives the best degradation curve?

---

## RQ10. FLI validates data with Zod at multiple layers — does re-validation after the trust boundary waste cycles, and where exactly is FLI's trust boundary?

**Trace now:** Zod schemas in `shared-types` are used for tRPC input validation, REST API validation, worker message validation, and potentially in-store parsing. Each tRPC procedure validates its input independently. Feature properties (`JSONB`) are never validated (noted as risk in architecture docs).

**Allmaps pattern (explicit):** "Validation happens at ingestion (Core Data), but validated types flow through Math Engine → Render Pipeline → Adapters without re-validation. Trust boundary is at the Core Data edge." Zod runs once at the IIIF manifest/annotation parse step. After that, validated types are trusted — no re-parsing at the render layer, no re-checking at the adapter layer.

**End-to-end question:** When a GeoJSON feature travels from PostGIS → Drizzle → tRPC router → TanStack cache → Svelte store → MapLibre source, how many times is it parsed/validated? tRPC output validation runs Zod on server responses. TanStack may trigger refetch + revalidation. Is there a Zod `.parse()` in a hot rendering path?

**Resolved when:** Grep for all `z.parse()` / `.safeParse()` / `schema.parse()` calls. Classify each as: (a) external boundary (user input, file import, API request) — keep, (b) internal boundary (store-to-component, server-to-cache) — likely removable, (c) hot path (inside render loops, effect callbacks) — remove immediately if found. Document FLI's trust boundary explicitly: "data is validated here; after this point, types are trusted."

---

## RQ11. Allmaps uses native `EventTarget` for inter-component communication. FLI uses `$effect` chains. When a MapEditor effect writes to store A which triggers an effect that writes to store B — is that an event system with extra steps?

**Trace now:** MapEditor's 14 `$effect` blocks form an implicit event graph. Effect E1 writes `interactionState`, which triggers effect E7 (via `$derived` dependency), which calls `setActiveTool()`, which was documented as having race conditions (mx-f5d9c5: "hidden side effects in store setters cause bugs when multiple effects call setActiveTool in same tick").

**Allmaps pattern (specific):** Components extend the browser's native `EventTarget`. Events are typed via a custom event system:
- `MapsEventTarget` dispatches events like `gcpInserted`, `resourceMaskReplaced`, `transformationTypeChanged`
- View components subscribe: `mapsEventTarget.addEventListener('gcpInserted', handler)`
- No store-to-store mutation — events are notifications, not commands

This is simpler than a custom pub-sub library because `EventTarget` is a browser built-in with well-defined dispatch semantics (synchronous within `dispatchEvent`, no ordering surprises across ticks).

**Resolved when:** Map all 14 MapEditor effects as an event graph: which writes trigger which reads? Identify which are "true derivations" (computed from state, should stay as `$derived`) vs. "event reactions" (side effects triggered by state changes, candidates for `EventTarget`). A prototype replaces ≥3 effect chains with typed EventTarget events and measures: does the setActiveTool race condition disappear?

---

## RQ12. Allmaps isolates heavy computation in Web Workers via Comlink. FLI sends all heavy work to a server-side BullMQ worker. Is there a class of operations where browser-side Web Workers would eliminate the round-trip entirely?

**Trace now:** File import → BullMQ job → server-side worker parses file → writes to DB → web polls for completion. Geoprocessing → tRPC mutation → PostGIS SQL → result written to DB → web refetches. Every heavy operation requires a server round-trip.

**Allmaps pattern:** The Render Pipeline uses Web Workers via Comlink for tile fetching and image data processing. The main thread stays responsive: `CacheableWorkerImageDataTile` offloads pixel-level work to a worker and receives `ImageData` back. The worker has no server dependency — it runs entirely in the browser.

**FLI applicability:** Some FLI operations are server-bound by necessity (PostGIS spatial joins, database writes). But others could run client-side in a Web Worker: file parsing (GeoJSON, CSV, KML are pure JS), geometry validation, measurement calculations, and geoprocessing preview (RQ5). The question is whether the Web Worker overhead (structured clone of GeoJSON, worker startup) is worth it vs. main-thread computation.

**Resolved when:** Profile FLI's import parsers on a 10MB GeoJSON file: main thread vs. Web Worker. If parsing blocks the UI for > 100ms, a Web Worker is justified. If parsing is < 50ms, the structured clone overhead makes it worse. Define the threshold and identify which parsers cross it.

---

## How to Use This List

Each RQ is independent. Pick by the problem you're currently feeling:

| Pain | Questions |
|------|-----------|
| **Complexity / churn** | RQ1 (store mutation chain), RQ6 (spatial op scatter), RQ11 (effect-as-event-system) |
| **Performance** | RQ3 (render proxy overhead), RQ8 (phantom sublayers), RQ9 (Martin fallback), RQ10 (re-validation) |
| **UX responsiveness** | RQ5 (geoprocessing preview), RQ12 (Web Worker offload) |
| **Data integrity** | RQ2 (parser duplication), RQ4 (silent overwrites) |
| **Developer experience** | RQ7 (cross-package type feedback) |

**Dependency order, if doing multiple:**
- RQ1 (state unification) unlocks RQ11 (event migration) and simplifies RQ5 (preview state)
- RQ2 (import-engine extraction) feeds RQ6 (geo-engine consolidation) and RQ12 (Web Worker feasibility)
- RQ10 (trust boundary) is a quick audit that informs RQ3 (hot-path optimization)
