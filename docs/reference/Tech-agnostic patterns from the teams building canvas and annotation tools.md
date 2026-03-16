# Tech-agnostic patterns from the teams building canvas and annotation tools

The most productive canvas, annotation, and collaboration teams converge on a surprisingly small set of architectural patterns — regardless of whether they ship React, Svelte, or vanilla JS. **Hierarchical state machines govern tool modes, two-phase spatial queries power both viewport culling and hit testing, and single-writer SQLite architectures win over multi-writer alternatives in the browser.** These patterns emerge repeatedly across tldraw, Excalidraw, Figma, Notion, Linear, Terra Draw, and Mapbox GL Draw, surfacing in engineering blogs, conference talks, and source code. What follows distills findings across five focus areas into the reusable, framework-agnostic insights that matter most.

---

## 1. R-trees as the backbone of spatial queries in reactive UIs

tldraw's **v4.4.0 release** (January 2026) introduced an R-tree spatial index via the `SpatialIndexManager`, upgrading shape queries from O(n) linear scans to **O(log n) lookups**. The implementation wraps Vladimir Agafonkin's RBush library — chosen over the same author's Flatbush because canvas shapes are frequently added, removed, and moved, demanding dynamic insert/remove rather than static bulk-load. PR #7676 added the index; PR #7699 immediately made it internal API, exposing it only through `editor.getShapesAtPoint()`, `editor.getShapeAtPoint()`, and `editor.getShapeIdsInsideBounds()`.

**RBush vs Flatbush** represents the fundamental dynamic-vs-static tradeoff. RBush supports incremental `insert()` and `remove()` with non-recursive R*-tree splits, making it ideal for editors where shapes constantly change. Bulk-loading via `tree.load()` is 2–3x faster and yields 20–30% better query performance than sequential inserts — useful at initialization. Flatbush, by contrast, produces a packed Hilbert R-tree stored as a single `ArrayBuffer`, transferable between threads and saveable as a binary file. It cannot be modified after `finish()`. For static geographic datasets or cross-worker scenarios, Flatbush wins; for interactive editors, RBush is the only viable choice.

**Viewport culling** follows directly from the spatial index. tldraw's `notVisibleShapes` derivation queries the R-tree with current viewport bounds, applying `display: none` via CSS to off-screen shapes. This is incremental: a fast path returns an empty set when all shapes are visible, and subsequent runs check only diffs. Excalidraw, notably, still uses O(n) linear scans through `isElementInViewport()` — community members in GitHub issue #8136 reported performance degradation at **8,000+ objects**, advocating for quadtrees or R-trees. The AntV Infinite Canvas Tutorial demonstrates the same pattern: check each shape's AABB against the viewport, set a `culled` flag, and skip rendering — achieving 60fps with 5,000 shapes versus 35fps at 1,000 without culling.

**Wiring an R-tree into Svelte 5 runes** requires keeping the mutable data structure outside the proxy system. Svelte 5's `$state()` wraps objects in deep reactive Proxies, which would break RBush's internal algorithms and cause up to **5,000x slowdowns** on large datasets. The recommended pattern uses a version counter:

```javascript
// spatialIndex.svelte.js
import RBush from 'rbush';
export class SpatialIndex {
  #tree = new RBush();
  #version = $state(0);
  insert(item) { this.#tree.insert(item); this.#version++; }
  remove(item) { this.#tree.remove(item); this.#version++; }
  search(bbox) { const _ = this.#version; return this.#tree.search(bbox); }
}
```

Reading `#version` inside a `$derived` block creates a reactive dependency without proxying the tree itself. `$state.raw` serves the same purpose for query results — only reassignment triggers updates, avoiding proxy overhead on large result arrays. This pattern generalizes: any imperative, mutable side-effect data structure (spatial index, physics engine, WebGL state) should live outside the reactivity system, with a version counter or signal bridging the two worlds.

Steve Ruiz discussed tldraw's architecture across multiple podcasts — **Latent Space**, **devtools.fm** (Feb 2022), **Code with Jason** (#273), **ShopTalk Show** (#690), and **Scaling DevTools** — consistently emphasizing managing complexity through abstractions and state machines. His **React Advanced 2025 talk "What's Under the Pointer?"** is the most technically focused, described as "a deep dive into five hundred of the most confusing lines of code in tldraw." He confirmed that tldraw deliberately uses DOM rendering (React components) rather than `<canvas>`, because it makes embedding videos, iframes, and arbitrary web content trivial — a significant SDK advantage over canvas-based competitors.

---

## 2. Mode architectures and the problem of mid-draw cancellation

Drawing tools universally model user interactions as **finite state machines with mode transitions**, but the two dominant mapping-focused libraries — Terra Draw and Mapbox GL Draw — implement this pattern very differently, with significant consequences for reliability.

**Terra Draw** (created by James Milner, now at v1.25.1) uses a clean adapter + mode architecture. Adapters are thin wrappers decoupling drawing logic from mapping libraries — `TerraDrawMapLibreGLAdapter`, `TerraDrawMapboxGLAdapter`, `TerraDrawLeafletAdapter`, etc. As Milner described at FOSS4G 2023: "The architecture means that any mode can work with any adapter and vice versa, creating a strong multiplier effect." Modes extend `TerraDrawBaseMode` and implement lifecycle methods (`onClick`, `onMouseMove`, `onKeyDown`, `onKeyUp`, `onDragStart`, `onDrag`, `onDragEnd`, `styleFeature`). Crucially, each mode declares **configurable key events** as typed properties — `cancel: KeyboardEvent["key"] | null` and `finish: KeyboardEvent["key"] | null` — defaulting to Escape and Enter respectively. This design makes cancel behavior explicit, testable, and overridable per-mode. `TerraDrawSelectMode` further exposes granular **feature flags** per geometry type: `draggable`, `coordinates.midpoints`, `coordinates.deletable`, `coordinates.snappable`.

**Mapbox GL Draw** takes a different approach: custom modes implement a bag of lifecycle methods (`onSetup`, `onClick`, `onKeyUp`, `toDisplayFeatures`, `onStop`, `onTrash`) with state passed through as a plain object. The `onSetup(opts)` return value becomes the `state` argument for all subsequent methods. Escape handling must be manually coded in each mode's `onKeyUp`:

```javascript
onKeyUp: function(state, e) {
  if (e.keyCode === 27) return this.changeMode('simple_select');
}
```

This approach has led to well-documented bugs. **Issue #582** reports that calling `changeMode()` during `draw_polygon` mode causes infinite `modeChanged` event loops, freezing Chrome. **Issue #1103** documents keyboard shortcuts completely breaking across mapbox-gl-js v2.7.1 and maplibre-gl v2.1.7. **Issue #1028** reveals that the framework's event handler consumes Delete/Backspace keys when `control.trash` is false, preventing custom modes from receiving them. The hot/cold source distinction — `mapbox-gl-draw-hot` for actively drawn features, `mapbox-gl-draw-cold` for inactive ones — provides the data model for separating in-progress geometry from committed state, but the imperative mode transitions lack guardrails.

**The cleanest cancellation pattern** combines three techniques found across these tools. First, **wrap all drawing operations in transactions** — tldraw's `@tldraw/state` package supports `transact()` for atomic batching with rollback. On Escape, roll back the entire transaction without touching the undo stack. Second, **use entry/exit actions on states** — Terra Draw's `start()`/`stop()`/`cleanUp()` lifecycle and Mapbox GL Draw's `onStop()` both clean up artifacts on mode exit. Third, **separate in-progress from committed geometry** — the hot/cold source distinction or temporary feature flags ensure uncommitted geometry never enters the undo history. Only completed drawing operations get pushed onto the undo stack.

tldraw's **hierarchical state machine** (statechart) provides the most robust implementation. Tools extend `StateNode` with static `id`, `initial` child state, and `children()` returning child state classes. Events bubble up through the hierarchy: if a child state's handler doesn't process an event, the parent does. State transitions use `this.parent.transition('pointing', { shape })`. This mirrors the UML statechart pattern and aligns closely with XState's approach — David Khourshid has presented extensively on how statecharts prevent impossible state combinations and cleanly separate behaviors into finite states.

---

## 3. TypeScript type conflicts at library boundaries are structural, not incidental

The type mismatches between MapLibre GL JS, Terra Draw, and Annotorious aren't bugs — they're consequences of overlapping ambient declarations, coordinate system incompatibilities, and the Mapbox/MapLibre fork legacy.

**The most common compile failure** is MapLibre issue #4855: `@types/css-font-loading-module` declares `FontFaceSet.onloadingdone` with `FontFaceSetLoadEvent` parameter type, while TypeScript's built-in `lib.dom.d.ts` declares it with `Event`. This produces `TS2717: Subsequent property declarations must have the same type` — breaking any project that doesn't set `skipLibCheck: true`. The conflict exists because MapLibre's transitive dependency on `@types/css-font-loading-module` introduces ambient declarations that clash with TypeScript's DOM lib, which has since absorbed those same types with slightly different signatures.

**The Mapbox/MapLibre dual-support problem** has an elegant solution documented in a January 2023 MapLibre blog post by Tyler Austin. The anti-pattern is `// @ts-ignore` on every `addControl()` call. The recommended pattern uses **intersection types**:

```typescript
import { IControl as MapboxIControl, Map as MapboxMap } from 'mapbox-gl';
import { IControl as MaplibreIControl, Map as MaplibreMap } from 'maplibre-gl';
type IControl = MapboxIControl & MaplibreIControl;
type Map = MapboxMap & MaplibreMap;
```

This works because the two libraries are structurally similar — their `Map` and `IControl` interfaces overlap almost entirely, so the intersection type satisfies both consumers. Since Mapbox GL JS v3.5.0 ships its own types (making `@types/mapbox-gl` a stub), and MapLibre migrated fully to TypeScript, the naming conventions diverge: Mapbox uses `*Specification` suffixes (`StyleSpecification`, `LayerSpecification`) where the community types used bare names (`Style`, `AnyLayer`).

**Terra Draw's type conflicts** were more severe before its monorepo split. Issue #350 documented how bundling all adapter type declarations in a single package forced users to install `@types/google.maps`, `@arcgis/core`, and OpenLayers types even when using only MapLibre. The fix — separate packages like `terra-draw-maplibre-gl-adapter` — isolates type dependencies cleanly. The `@watergis/maplibre-gl-terradraw` wrapper adds another layer, declaring peer dependencies on `maplibre-gl ^4.0.0 || ^5.0.0` alongside `terra-draw ^1.0.0`.

**Annotorious introduces a different kind of mismatch** — semantic rather than structural. Its native model uses direct pixel coordinates (`{ x: 272, y: 169, w: 121, h: 90 }` with a `bounds` object), optimized for image annotation performance. The W3C Web Annotation model uses string-based selectors — `FragmentSelector` values like `xywh=pixel:272,169,121,90` or `SvgSelector` with SVG markup. GeoJSON mandates WGS84 `[longitude, latitude]` coordinates. These three representations share no type structure at all. Annotorious bridges its native model to W3C via `W3CImageAdapter`, which parses and serializes between formats. For geographic contexts, the IIIF community has demonstrated a dual-coordinate approach: W3C `#xywh` Fragment Selectors identify pixel regions, while annotation bodies contain GeoJSON-LD with geographic coordinates — but nested GeoJSON coordinate arrays are incompatible with JSON-LD 1.0 processing.

The GeoJSON `Geometry` union type itself causes friction in MapLibre event handlers (discussion #6323): accessing `event.features[0].geometry.coordinates` fails because `GeometryCollection` doesn't have `coordinates`. Type narrowing on `geometry.type` is required, but developers routinely resort to `@ts-expect-error` instead.

---

## 4. SQLite in the browser demands single-writer coordination and careful VFS selection

Notion's July 2024 engineering blog post, "How we sped up Notion in the browser with WASM SQLite," provides the most detailed public account of production browser-SQLite architecture. The result: **20% faster page navigation** across modern browsers, with **33% improvement in India** where network latency previously dominated. The architecture centers on a critical insight: OPFS has poor concurrency handling, and multi-writer access causes data corruption.

**Notion's final architecture** uses a SharedWorker + Active Tab pattern:

- Each browser tab spawns a dedicated Web Worker capable of running SQLite
- Only **one** tab's Worker is designated "active" and actually writes to the database
- A SharedWorker manages which tab is active
- The **Web Locks API** detects tab closures — each tab holds an infinitely-open lock; if the lock releases, the tab has closed
- All SQL queries from any tab route through: Main Thread → SharedWorker → Active Tab's Dedicated Worker → SQLite/OPFS

This uses **two message hops per query**. Roy Hashimoto (wa-sqlite creator) noted in wa-sqlite Discussion #81 that a `MessageChannel`-based approach achieves single-hop communication by establishing direct channels between tabs and the active worker via `BroadcastChannel` signaling — more efficient but more complex to implement.

**Notion chose the OPFS SyncAccessHandle Pool VFS** (equivalent to wa-sqlite's `AccessHandlePoolVFS`) specifically because it requires no Cross-Origin Isolation headers (COOP/COEP). They evaluated `sqlite3_vfs` with SharedArrayBuffer first but found it impractical — Notion depends on many third-party scripts that would break under COEP restrictions. During testing of multi-tab writes with `sqlite3_vfs`, they observed **severe data corruption**: wrong data on pages, comments attributed to wrong coworkers, multiple rows with the same ID containing different content.

**The wa-sqlite VFS landscape** (as catalogued by PowerSync's November 2025 blog post) offers five main options with distinct tradeoff profiles:

- **AccessHandlePoolVFS**: Best raw performance, no Asyncify overhead, pre-opens OPFS handles synchronously. Single-connection only, not filesystem-transparent. Worker context required. This is what Notion uses.
- **OPFSCoopSyncVFS**: PowerSync's **2025 recommended general-purpose VFS**. Supports multiple concurrent connections with filesystem transparency. Returns `SQLITE_BUSY` when async operations are needed (opening handles, acquiring locks); the JS wrapper waits and retries. Works well past 1GB database sizes. No COOP/COEP required.
- **IDBBatchAtomicVFS**: Widest context support — works on main thread, workers, shared workers, service workers. Good fallback for Safari incognito (no OPFS support). Performance degrades above **100MB** databases; Safari has stack overflow issues on large queries.
- **OPFSPermutedVFS**: Most advanced concurrency — simultaneous read + write transactions, WAL-like behavior in VFS. Requires Chrome's `readwrite-unsafe` mode (no Firefox/Safari support yet).
- **OPFSAdaptiveVFS**: Filesystem-transparent, uses async OPFS for reads and sync handles for writes. Good compatibility but requires Asyncify or JSPI build.

**The async-sync bridge** is the central technical challenge. SQLite's C code demands synchronous I/O, but browser storage APIs are async. Four approaches exist: **Emscripten Asyncify** transforms WASM to pause/resume on promises (~2x file size, 2–5x performance hit — the SQLite team refuses to use it). **SharedArrayBuffer + Atomics** blocks one worker while another completes async I/O (requires COOP/COEP headers). **JavaScript Promise Integration (JSPI)**, available in Chrome 137+ (May 2025) without flags, suspends WASM natively on promises — no compile-time transforms, but no Safari support yet. **Pre-opened handle pools** (the AccessHandlePoolVFS approach) sidestep the problem entirely by pre-opening all OPFS `FileSystemSyncAccessHandle`s at init time — once open, all I/O is natively synchronous.

**Linear's sync engine** takes a different path entirely, using **IndexedDB** (not SQLite) with MobX for in-memory reactive state. Full issue data bootstraps on first load, stores in IndexedDB, then hydrates on subsequent loads with WebSocket delta sync. As Tuomas Artman explained: "We don't have to make REST calls, we don't have to make GraphQL calls. We modify the data, we save it, and everything always updates." Linear uses BroadcastChannel for instant cross-tab updates. They adopted CRDTs only recently, for issue description text — LWW conflict resolution handles everything else because conflicts are rare in practice.

---

## 5. Hit testing is two-phase everywhere, but the narrow phase is where complexity hides

Steve Ruiz's **React Advanced 2025 talk "What's Under the Pointer?"** called tldraw's hit testing code "five hundred of the most confusing lines" in the codebase. The complexity isn't in the spatial query — it's in the precise geometry tests, overlapping shape resolution, and edge cases around self-intersecting polygons.

**tldraw's two-phase approach** is now the gold standard. The broad phase queries the R-tree with the pointer position (plus a margin), returning candidate shapes in O(log n). The narrow phase calls each candidate's `ShapeUtil.getGeometry()`, which returns a `Geometry2d` object — an abstract class with `hitTestPoint(point, margin, hitInside)` and `hitTestLineSegment(A, B, distance)` methods. The `Geometry2d` hierarchy includes `Rectangle2d`, `Polygon2d`, `Polyline2d`, `Circle2d`, `Ellipse2d`, `CubicBezier2d`, `CubicSpline2d`, and `Group2d`. The critical boolean `isFilled` determines whether points inside the boundary count as hits or only points near the edge do. For unfilled shapes, `nearestPoint(point)` finds the closest point on the geometry edge, and the distance to the test point is compared against the margin.

**Excalidraw's hit testing** follows the same conceptual pattern but with O(n) broad phase. The call chain runs `getElementAtPosition` → `getElementsAtPosition` → `hitElement` → `getElementShape`, iterating elements in reverse z-order. PR #8539 by Mark Tolmacs refactored the distance and hit testing code into a dedicated math package, reorganizing collision detection, bounds calculation, and intersection logic. Excalidraw also distinguishes `hitElement` (precise geometry test) from `hitElementBoundingBoxOnly` (must account for bound text as part of the element).

**Konva.js takes a fundamentally different approach**: a hidden hit canvas where shapes are drawn with unique colors, and hit testing reads the pixel color at the cursor position. This is GPU-accelerated and handles arbitrary shapes including stroked paths naturally, but costs memory (a full offscreen canvas) and makes debugging harder. Konva's `hitStrokeWidth` property independently controls the width of strokes on the hit canvas versus the visible canvas — a clean separation of visual and interactive concerns.

**The ray casting algorithm** (even-odd rule) for point-in-polygon tests is conceptually simple — cast a ray in the +X direction, count edge intersections, odd = inside — but three edge cases cause real bugs. **Vertex intersections**: if the ray passes through a vertex, it intersects two adjacent edges. The fix is to count an intersection only when the other vertex of the edge lies below the ray, effectively treating vertices on the ray as "slightly above." **Horizontal edges**: coincident with the ray direction, they produce ambiguous results. The same "slightly above" convention ensures horizontal edges are never counted. **Floating-point precision**: points very close to edges produce incorrect results due to rounding. A numerical tolerance ε, or a tiny offset to the test point (`P.y += 0.0001`), avoids exact-boundary cases. Ruiz acknowledged at React Advanced 2025 that self-intersecting polygons (e.g., a paperclip shape) can defeat even-odd testing: "Unless you do a lot of extra complicated things to build essentially multiple polygons out of the self-intersecting polygon... some of the hit testing might not work as good as you're used to. But most people don't. Got to take your losses somewhere."

**Distance-to-path calculations for stroked shapes** present their own challenge. The Canvas 2D API offers `ctx.isPointInStroke(path, x, y)`, which uses the current `lineWidth` for the hit region — a useful shortcut when you can temporarily set a wider `lineWidth` for detection. For mathematical approaches, the Bezier.js library uses a **two-pass LUT (Look-Up Table) approach**: generate 100 sample points along the curve, find the closest, then refine by subdivision around that match. For line segments, the point-to-segment distance formula with endpoint clamping is standard. These per-edge calculations are only needed for the small candidate set surviving the broad phase.

---

## Cross-cutting patterns that transcend framework choice

Several architectural patterns recur so consistently across these projects that they constitute best practices for any canvas or annotation tool, regardless of framework.

**CRDT-inspired but server-authoritative sync** dominates production systems. Figma's Evan Wallace wrote the seminal 2019 post explaining their choice: "Since Figma is centralized, we can simplify our system" — using **last-writer-wins registers** per property on a document tree modeled as `Map<ObjectID, Map<Property, Value>>`. Linear follows the same pattern with LWW and custom conflict resolution. tldraw uses Cloudflare Durable Objects as room-level authority. Only for text editing, where character-level conflicts are common, do teams reach for true CRDTs — and even there, Figma's 2024/2025 Code Layers feature adopted **Event Graph Walker (Eg-walker)**, a new algorithm by Joseph Gentle and Martin Kleppmann that combines CRDT merge performance with OT-like memory efficiency. Eg-walker represents edits as a directed acyclic causal graph, analogous to git rebase, temporarily building CRDT structures only during conflict resolution and discarding them after.

**Undo/redo in collaborative settings** remains uniquely hard. Martin Kleppmann's PaPoC 2024 paper "Undo and Redo Support for Replicated Registers" surveys the landscape and proposes a counter-based approach: each operation gets an undo counter, with even values meaning visible and odd meaning invisible. Zed's editor uses the same pattern — "each participant needs their own undo stack, capable of undoing operations in arbitrary order." Figma's design principle is memorable: "if someone undoes a lot, copies something, and redoes it back to the present, the document should not change." tldraw's `HistoryManager` uses `markHistoryStoppingPoint()` for atomic transaction boundaries, and its `@tldraw/state` signals library supports transactions with rollback — enabling clean undo that doesn't interact with in-progress drawing operations.

**The local-first movement** has crystallized around a shared architecture: `Client → Local DB → Instant UI Update ↓ (async) Sync Engine → Server`. Linear's Tuomas Artman is the most cited practitioner: "I'm sure I won't ever go back to working any other way." The first Local-First Conference (Berlin, May 2024) established the community, with FOSDEM 2026 hosting a 22-talk devroom on local-first. The practical benefit isn't ideological — it eliminates loading states, network error handling, and cache invalidation from application code. The key tradeoff is upfront investment in sync infrastructure.

**Frame scheduling and rendering optimization** follows three universal patterns. Viewport culling — rendering only shapes intersecting the visible area — is the highest-impact optimization, with R-tree-backed culling (tldraw) dramatically outperforming linear scans (Excalidraw) at scale. Draw call batching groups rendering operations to minimize CPU→GPU overhead. Frame scheduling via `requestAnimationFrame` paces rendering at display refresh rate. tldraw additionally skips hover hit-testing during camera panning and renders shape indicators via a 2D canvas instead of SVG — achieving **25x faster indicator rendering**.

## Conclusion

The convergence across these projects reveals that the hard problems in canvas tools aren't framework-specific — they're algorithmic and architectural. The teams that ship the most reliable tools share three commitments: they model user interactions as explicit state machines rather than ad-hoc event handlers, they invest in spatial indexing early (before performance forces the issue), and they design undo/redo as a first-class system concern rather than an afterthought. The most surprising finding is how uniformly production systems reject pure CRDTs in favor of simpler server-authoritative sync with LWW registers, reserving complex merge algorithms only for text editing where conflicts are genuinely common. For anyone building annotation or collaboration tools today, Notion's SQLite/WASM journey offers the clearest cautionary tale: multi-writer browser storage causes data corruption in practice, and the single-writer SharedWorker pattern, while adding message-hop latency, is the only architecture that has survived production at scale.