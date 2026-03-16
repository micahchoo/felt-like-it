# Developer Interviews & Deep Dives: Annotation, Mutation, State Management & Collaboration Patterns

*A curated research guide drawing from developer interviews, engineering blog posts, source code analysis, and community discussions from teams building popular canvas, annotation, and collaboration tools.*

---

## 1. Spatial Indexing with R-Trees in Reactive UI Frameworks

### What tldraw Actually Ships

tldraw v4.4.0 (February 2026) introduced R-tree spatial indexing via RBush, replacing O(n) iteration with O(log n) lookups for brushing, scribble selection, and erasing. The key architectural decision was to make the spatial index **internal** — `editor.spatialIndex` was explicitly removed from the public API. Consumers use `editor.getShapesAtPoint()` and `editor.getShapeAtPoint()` instead.

From the tldraw release notes and DeepWiki architecture analysis:

- The `SpatialIndexManager` sits alongside `SnapManager` under the `Editor` class, which also manages `HistoryManager` (undo/redo) and `InputsManager` (pointer/keyboard/touch events).
- The spatial index is maintained internally and rebuilt as shapes change. tldraw also skips hover hit-testing during camera movement to reduce panning overhead in large documents.
- Performance companion changes included: optimized Set comparisons, reduced memory allocations, cached string hashes, and an `FpsScheduler` that throttles network traffic to 1 FPS when no collaborators are present.

**Steve Ruiz (tldraw founder)** discussed the architecture in multiple interviews (Latent Space podcast, Code with Jason #273, devtools.fm, Scaling DevTools). Key themes from those conversations:

- tldraw uses the DOM and React for rendering rather than a custom canvas engine — which is counterintuitive but enables composability (you can put any React component on the canvas).
- The Editor class is a hierarchical state machine for tools (select, draw, etc.), and managing complexity through abstractions and state machines was a recurring theme across rewrites.
- Multiple full rewrites helped discover the core problems. Each rewrite shed abstractions that weren't paying for themselves.

### RBush vs Flatbush: When to Use Which

Both libraries come from Vladimir Agafonkin (Mapbox/Leaflet ecosystem).

**RBush** — dynamic R-tree, supports insert/remove/update after indexing. Use when shapes move, appear, or disappear at runtime (canvas editors, games, interactive dashboards). Default node size is 9. Bulk insertion is 2–3x faster than one-by-one. Custom `toBBox`/`compareMinX`/`compareMinY` methods let you index non-standard formats.

**Flatbush** — static, immutable after `finish()`. Faster indexing and search, much lower memory footprint. Index stored as a single ArrayBuffer (transferable between threads or saveable as a binary file). Use when the dataset doesn't change after loading (map tile data, pre-computed spatial queries). Supports `SharedArrayBuffer` for cross-thread sharing.

**KDBush** — static, points only (no rectangles). 2x less memory than Flatbush for point data. Best for scatter plots, network graphs.

### Wiring a Spatial Index into a Svelte 5 Reactive Store

Svelte 5 runes (`$state`, `$derived`, `$effect`) allow reactive state to live outside `.svelte` files in `.svelte.ts` files. The pattern for integrating an R-tree:

The key insight is that the R-tree itself is a **side-effect data structure** — you don't want Svelte's deep reactivity proxying its internals. Use `$state` for the canonical shape array, and `$effect` to sync the R-tree when shapes change. Return viewport query results via `$derived`.

The rebuild-vs-incremental decision: RBush supports incremental `insert`/`remove`, so you can diff changes. But if a bulk change (paste, undo) touches >~30% of shapes, `tree.clear()` + `tree.load(allItems)` is often faster than individual operations. tldraw's approach is to maintain the index internally and just expose query methods — they don't expose whether they rebuild or patch.

### Viewport Culling Patterns

The infinite canvas tutorial from AntV describes the standard approach: maintain a bounding box for the viewport in world coordinates, updated on every camera change, then intersect against each shape's AABB. With an R-tree, this becomes `tree.search({ minX, minY, maxX, maxY })` — returning only candidates that overlap the viewport.

tldraw's additional optimization: skip hover hit-testing entirely while the camera is moving (`TLInstance.cameraState: 'idle' | 'moving'`). This avoids recalculating which shape is under the cursor during pan/zoom gestures.

---

## 2. In-Progress Operations, Mode Transitions & the Terra Draw / Mapbox GL Draw APIs

### The Mid-Draw Cancel Problem

When a user is halfway through drawing a polygon and presses Escape, the application needs to: discard the in-progress geometry, clean up any temporary visual state, return to a neutral mode, and not corrupt the undo history. This is a state machine transition problem.

### Mapbox GL Draw's Custom Mode API

Mapbox GL Draw provides a lifecycle-based custom mode system. Each mode is an object with handler methods:

- `onSetup(opts)` — initialize mode state, return a state object
- `onClick(state, e)` — handle map clicks
- `onKeyUp(state, e)` — handle keyboard events (e.g., `if (e.keyCode === 27) return this.changeMode('simple_select')`)
- `toDisplayFeatures(state, geojson, display)` — **required** — decides which features render
- `onStop(state)` — cleanup when leaving the mode
- `onTrash(state)` — handle delete requests

The mode has access to `this.newFeature()`, `this.addFeature()`, `this.deleteFeature()`, `this.changeMode()`, and `this.updateUIClasses()`. Features live in Draw's internal data store and are split between "hot" (active/in-progress) and "cold" (committed) sources for rendering performance.

Known issues: `changeMode()` during `draw_polygon` can cause browser hangs if the in-progress polygon isn't properly cleaned up (GitHub issue #582). Delete/Backspace keypresses are swallowed and never reach `onKeyUp` in some modes (issue #1047).

### Terra Draw's Adapter Architecture

Terra Draw takes a different approach — library-agnostic adapters that wrap specific mapping libraries:

- `TerraDrawMapLibreGLAdapter`
- `TerraDrawMapboxGLAdapter`
- `TerraDrawLeafletAdapter`
- `TerraDrawGoogleMapsAdapter`
- `TerraDrawOpenLayersAdapter`

Adapters are thin wrappers containing map-library-specific logic for creating/updating rendered layers. The core `TerraDraw` instance holds the store and modes:

```
const draw = new TerraDraw({ adapter, modes });
draw.start();
draw.setMode('polygon');
```

Modes extend `TerraDrawBaseMode` and are categorized into three types. Custom modes can be written by extending the base class. The `TerraDrawSelectMode` has granular feature flags per geometry type: `draggable`, `coordinates.midpoints`, `coordinates.draggable`, `coordinates.deletable`, `coordinates.snappable`, and resize from `center` or `opposite`.

For mid-draw cancellation, Terra Draw uses `draw.setMode('select')` or `draw.setMode('static')` to transition out. The store is exposed via `draw.getSnapshot()` which returns all features as GeoJSON. The `draw.on('change', callback)` event fires for any store mutation.

### Comparison: Escape Handling Patterns

| Concern | Mapbox GL Draw | Terra Draw |
|---|---|---|
| Cancel key | `onKeyUp` handler calls `this.changeMode()` | Mode switch via `draw.setMode()` |
| In-progress cleanup | Manual: remove temp features in `onStop` | Automatic: store manages in-progress state |
| Custom modes | Object with lifecycle methods | Class extending `TerraDrawBaseMode` |
| Adapter model | Tightly coupled to Mapbox GL | Adapter pattern — library-agnostic |
| Feature data | Internal store with hot/cold split | Single store, GeoJSON snapshots |

---

## 3. TypeScript Type Mismatches Across MapLibre, Terra Draw & Annotorious

### The Core Problem

MapLibre GL JS is a TypeScript fork of Mapbox GL JS. Many plugins were developed for Mapbox and expect Mapbox's type definitions. When you use them with MapLibre, the TypeScript compiler throws type inference errors because the `Map` objects have diverged.

From the MapLibre blog post on plugin interoperability: the common band-aid is `@ts-ignore`, but this suppresses real warnings if the two implementations diverge. MapLibre recommends using TypeScript **Intersection Types** to combine the two map types, so plugins accept either.

### Specific Pain Points

**MapLibre + Terra Draw**: The `TerraDrawMapLibreGLAdapter` is maintained as a separate package (`terra-draw-maplibre-gl-adapter`) and expects the MapLibre `Map` type directly. The `@watergis/maplibre-gl-terradraw` plugin further wraps this for easier integration. Type issues are less common here because Terra Draw's adapter was built for MapLibre specifically.

**MapLibre + `@types` packages**: A basic TypeScript project with MapLibre can fail to compile without `skipLibCheck: true` due to conflicts in `@types/css-font-loading-module` (GitHub issue #4855). Earlier versions had syntax errors in the `.d.ts` file itself when using `strict` mode (issue #790).

**Mapbox plugins on MapLibre**: The recommended pattern from MapLibre's documentation:

```typescript
// Using intersection types for dual compatibility
import maplibregl from 'maplibre-gl';
import mapboxgl from 'mapbox-gl';

type CombinedMap = maplibregl.Map & mapboxgl.Map;
```

This avoids `@ts-ignore` while keeping type safety. The alternative with named imports follows the same intersection pattern.

### Annotorious Integration Considerations

Annotorious (the W3C Web Annotation standard library) interfaces with various renderers. When integrating with mapping libraries, the key type boundaries are around annotation body/target formats (W3C model) vs. GeoJSON feature formats (mapping model). The translation layer between these two type systems is where mismatches tend to surface — particularly around coordinate systems (pixel vs. geographic) and geometry representations.

---

## 4. SQLite/WASM: VFS Selection, OPFS, Multi-Tab Coordination & Worker Architecture

### Notion's Engineering Deep Dive

Notion's engineering blog post ("How we sped up Notion in the browser with WASM SQLite," July 2024) is the definitive case study. Key findings:

**The problem**: Notion wanted to use SQLite as a client-side cache to speed up page navigation (which was already 50% faster on desktop apps using native SQLite).

**VFS options evaluated**:

1. **OPFS via `sqlite3_vfs`** — Supports multiple tabs but requires cross-origin isolation (COOP/COEP headers). This was impractical because Notion depends on many third-party scripts that would all need header changes. When deployed to a small percentage of users, they observed **database corruption** — wrong data on pages, comments attributed to wrong users. Root cause: OPFS concurrency handling was insufficient for multiple tabs writing simultaneously.

2. **OPFS SyncAccessHandle Pool VFS** — No cross-origin isolation needed, works on all major browsers, slightly better performance. But can only run in **one tab at a time** — subsequent tabs get an error on database open.

**The final architecture** (SharedWorker pattern):

- Each tab has its own **dedicated Web Worker** capable of writing to SQLite.
- A **SharedWorker** tracks which tab is the "active tab" — only the active tab's Web Worker is allowed to write.
- All SQLite queries from any tab are sent to the SharedWorker, which redirects them to the active tab's dedicated Worker.
- When the active tab closes, the SharedWorker elects a new active tab.
- **Comlink** is used to proxy message passing between the main thread and the Worker.
- The **Web Locks API** prevents multiple writers.

**Performance mitigations**:
- WASM SQLite loaded asynchronously to avoid blocking initial page load.
- A "race" between disk cache read and network request handles slow-device cases (some Android phones read from OPFS slower than fetching from Notion's API).
- Result: 20% improvement in navigation times with no regressions.

### wa-sqlite VFS Landscape (Roy Hashimoto)

Roy Hashimoto's wa-sqlite project offers multiple VFS implementations:

- **AccessHandlePoolVFS** — Pre-opens a pool of OPFS sync access handles, making all subsequent operations synchronous. Fastest OPFS approach, but only supports one connection (one tab).
- **OPFSCoopSyncVFS** — Supports multiple connections. Has to work magic to provide synchronous VFS methods despite some async OPFS operations (like file opening).
- **OPFSAnyContextVFS** — Works in SharedWorker (where sync access handles aren't available), using async OPFS. Slower writes but no context restrictions.
- **IDBBatchAtomicVFS** — Uses IndexedDB as storage. Available everywhere including SharedWorker. Slower I/O than OPFS but offset by not needing message passing.
- **OPFSPermutedVFS** — New VFS supporting concurrent reads even during writes, similar to SQLite's WAL mode but implemented in the VFS itself.

### Multi-Tab Coordination Patterns

From the wa-sqlite discussion #81 and #84, the shared-Worker-instead-of-SharedWorker pattern:

- Use **Web Locks** to watch tab lifetimes and initiate service migration.
- Use **BroadcastChannel** to tell all tabs to execute migration.
- A Comlink-style proxy hides raw message passing from the application.
- The OPFS access handle pooling + shared worker combination provides the best performance while supporting multiple tabs.

Key caveat from Roy Hashimoto: when a write transaction is submitted and an exception occurs during service migration, you can't know if the transaction committed or not. Simply resubmitting may produce incorrect results. Applications need idempotent write patterns.

### The Async-Sync Bridge Problem

The SQLite VFS interface expects synchronous methods (`xRead`, `xWrite`, `xLock`), but browser APIs (OPFS, IndexedDB) are often async. Solutions include:

- **SharedArrayBuffer + Atomics** — Used by the official sqlite3 WASM build's OPFS VFS. Requires COOP/COEP headers. A synchronous worker waits on an atomic while an async worker performs OPFS operations.
- **Asyncify** (Emscripten) — Transforms sync calls to async. Adds binary size and performance overhead.
- **Pre-opened handle pools** — wa-sqlite's approach. Open handles upfront (async), then all subsequent operations are sync. 2x+ faster than the SharedArrayBuffer bridge.

---

## 5. Selection & Hit Testing: Ray Casting in Canvas Applications

### The Algorithm

Ray casting (even-odd rule) determines if a point is inside a polygon: cast a ray from the point in any direction, count edge crossings. Odd count = inside, even = outside. O(n) per polygon where n is the number of edges.

Edge cases that matter in practice:
- Ray passes exactly through a vertex — count the intersection only if the other vertex of that edge lies below the ray.
- Horizontal edges on the ray — handled by the vertex rule above.
- Floating-point precision near boundaries — use epsilon adjustments (bump the test point by a tiny amount if it's at the same Y as a vertex).

### How Excalidraw Does Hit Testing

From Excalidraw's source (visible in error stack traces and the App.tsx architecture):

- `getElementAtPosition(x, y)` — finds the topmost element at a point
- `getElementsAtPosition(x, y)` — returns all elements at a point (uses `Array.filter`)
- `hitElement(element)` — tests a specific element, calls `getElementShape(element)` first
- `getElementShape(element)` — converts the Excalidraw element into a geometric shape for testing

The pipeline is: screen coordinates → canvas coordinates → iterate through elements (Z-order, back to front for topmost) → per-element shape generation → point-in-shape test.

Excalidraw does **not** currently use a spatial index (no R-tree) — it iterates all elements. For their typical use case (tens to hundreds of shapes), this is fast enough. The hand-drawn style means shapes are represented as rough paths, making bounding-box pre-filtering important before doing precise hit tests.

### How tldraw Does It

tldraw (v4.4.0+) uses R-tree spatial indexing to narrow candidates, then precise geometry tests on the candidates:

- `editor.getShapesAtPoint(point)` — R-tree query + precise hit test
- `editor.getShapeAtPoint(point)` — same, returns topmost
- Shape indicators now render via 2D canvas (not SVG) for up to 25x faster rendering when many shapes are selected/hovered.

### The Two-Phase Pattern

Both applications (and most canvas editors) follow the same two-phase pattern:

1. **Broad phase**: Bounding box test. Either linear scan (Excalidraw) or spatial index query (tldraw). Returns candidates.
2. **Narrow phase**: Precise geometry test. For simple shapes (rectangles, ellipses), analytic tests. For complex paths, ray casting or distance-to-path calculations.

For filled shapes, the ray casting / point-in-polygon test determines if the click is inside the fill. For stroked-only shapes, a distance-to-path test checks if the click is within the stroke width.

---

## Key Interviews & Sources Referenced

### Podcasts & Talks (Steve Ruiz / tldraw)
- **Latent Space** — "The Accidental AI Canvas" (Jan 2024) — deep dive on tldraw architecture, DOM-based rendering, Make Real
- **Code with Jason #273** — managing complexity through abstractions, state machines, multiple rewrites
- **devtools.fm** — open source canvas graphics libraries, tldraw as reusable UI
- **Scaling DevTools** — creativity, taste, obsession, marketing to developers (June 2025)
- **React Advanced 2024** — "Make Real: tldraw's AI Adventure" — betting on React, canvas component composition
- **JSNation 2026** — "Agents on the Canvas With tldraw" — spatial agents, agent-on-canvas patterns

### Engineering Blog Posts
- **Notion** — "How we sped up Notion in the browser with WASM SQLite" (July 2024) — SharedWorker architecture, VFS selection, corruption debugging, Comlink integration
- **PowerSync** — "The Current State of SQLite Persistence on the Web" (Nov 2025) — comprehensive VFS comparison, concurrency matrix
- **MapLibre** — "Developing Plugins for MapLibre Interoperability" (Jan 2023) — TypeScript intersection types for dual Mapbox/MapLibre support

### Library Documentation & Discussions
- **wa-sqlite** GitHub Discussions #81, #84, #138 — Roy Hashimoto on multi-tab coordination, VFS selection, SharedArrayBuffer tradeoffs
- **Mapbox GL Draw** MODES.md — custom mode lifecycle API, onKeyUp/Escape handling
- **Terra Draw** guides (GETTING_STARTED, MODES, STYLING) — adapter architecture, mode system, select mode feature flags
- **RBush/Flatbush/KDBush** — Vladimir Agafonkin's spatial indexing libraries, API differences
- **tldraw v4.4.0 Release Notes** — R-tree integration, SpatialIndexManager, FpsScheduler, camera state optimization

### Source Code (for deeper study)
- `excalidraw/excalidraw` — `App.tsx` (`hitElement`, `getElementAtPosition`, `getElementsAtPosition`, `getElementShape`)
- `tldraw/tldraw` — `packages/editor/src/lib/editor/Editor.ts` (SpatialIndexManager, SnapManager integration)
- `JamesLMilner/terra-draw` — `TerraDrawBaseMode` extension, adapter interface
- `rhashimoto/wa-sqlite` — VFS implementations (AccessHandlePoolVFS, OPFSCoopSyncVFS)
- `mapbox/mapbox-gl-draw` — `docs/MODES.md` (custom mode interface, state management)
