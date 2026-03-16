# Twelve architectural patterns for mutable map and canvas annotation state

**The most battle-tested patterns for managing annotation state at scale center on local-first sync engines, reactive derived state, and spatial indexing — not the CRUD and collaboration primitives most teams reach for first.** Production tools like tldraw, Figma, and Mapbox GL JS have converged on remarkably similar solutions: column-level last-write-wins conflict resolution, R-tree spatial indexes for hit-testing, signal-based reactive derivations, and strict separation of ephemeral presence from persistent document state. This report covers twelve additional architectural patterns drawn from real production implementations, open-source codebases, and engineering blog posts.

---

## 1. Local-first sync engines treat the network as optional

The local-first movement has produced several production-ready sync engines, each making a different trade-off between CRDT sophistication and operational simplicity. The core architectural insight is identical across all of them: **put the database on the client and take the network off the critical interaction path**.

**Electric SQL** monitors Postgres via logical replication (WAL) and syncs subsets of data called "shapes" — subscriptions to filtered tables — over HTTP streams. The current rebuild (Electric Next, July 2024) provides read-path sync only; writes flow through your existing API. This composable approach means annotation data in PostGIS tables can sync to clients via standard HTTP, with the developer controlling write-path conflict resolution. The legacy version used CRDTs (the team includes CRDT co-inventors Marc Shapiro and Nuno Preguiça), but the current version favors simpler primitives.

**PowerSync** takes a different approach: it replicates data from Postgres to an in-app SQLite database, giving developers full SQL query capability on the client. Writes apply locally first, then queue for upload. Conflict resolution defaults to **last-write-wins with server reconciliation** — not CRDTs. Developers implement custom conflict resolution in their backend API when needed. PowerSync explicitly avoids schema changes to Postgres, supporting data transformations between server and client schemas. SQLite can handle tens of thousands of updates per second on the client, with ~100ms worst-case sync latency.

**cr-sqlite** (vlcn-io) takes the most technically ambitious approach: a Rust-written SQLite extension that upgrades existing tables to "conflict-free replicated relations" via `crsql_as_crr('tablename')`. Each column becomes an independent CRDT — LWW registers, counters, or fractional indexes. For spatial annotation data, this means concurrent edits to different properties of the same annotation (position, style, text) merge cleanly without conflict. Same-column concurrent edits use LWW. Inserts are ~2.5x slower than regular SQLite, with 15% write overhead from CRDT metadata. A sync virtual table (`crsql_changes`) exposes changes for peer-to-peer exchange.

**Triplit** runs a full database instance in both the browser and server, connected by WebSocket sync. Mutations write to a local **outbox** (pending) while confirmed data lives in a **cache**. Queries merge both stores by default. CRDTs operate per-attribute, minimizing conflict granularity. Triplit also handles **cache eviction** — when permissions change, the server automatically removes data from the client cache, even after offline reconnection.

**Linear's sync engine** demonstrates that CRDTs are often unnecessary. Linear uses an in-memory MobX object graph persisted to IndexedDB, with a centralized server providing **total ordering via monotonically incrementing `syncId` values**. Each GraphQL mutation returns a `lastSyncId`; WebSocket push delivers `SyncAction` objects for real-time sync. LWW is sufficient because conflicts are rare in practice. CRDTs were only recently added for rich-text issue descriptions. The architecture works as a Chrome PWA with full offline support — features can be developed entirely in the frontend first.

**Mapbox's offline system** focuses on tiles, not annotations. `OfflineManager` downloads tiles, glyphs, and sprites for a defined region to a local SQLite database. But **annotations have no built-in sync** — the annotation plugin manages GeoJSON features in memory only. Developers must implement their own persistence and sync layer. **JOSM** follows a similar download-edit-upload workflow: download an area via OSM API 0.6, save as `.osm` XML locally, edit offline with change tracking (new elements get negative IDs), then re-download to detect conflicts and upload via changesets. Conflict resolution is manual, with side-by-side version comparison per element.

The key finding across all these systems: **most production applications find LWW sufficient for conflict resolution**. CRDTs add power but also complexity. The critical architectural choice is client-side data ownership, not the specific conflict resolution strategy.

---

## 2. Spatial indexing makes annotation interaction tractable

Client-side spatial indexing determines whether an annotation tool feels responsive or sluggish. The JavaScript ecosystem has converged on two R-tree libraries from Mourner (Vladimir Agafonkin of Mapbox): **rbush** for dynamic data and **flatbush** for static datasets.

**rbush** is a dynamic R*-tree supporting insert, remove, and bulk-load operations. Its API is minimal: `tree.insert({minX, minY, maxX, maxY})`, `tree.search(bbox)`, `tree.collides(bbox)`. Bulk loading (`tree.load(items)`) is 2–3x faster than individual inserts and produces 20–30% better subsequent query performance. On 1M items, rbush performs 1,000 searches over 0.01% of the area in **0.03 seconds** — 30x faster than the older RTree implementation. It supports JSON serialization for server-to-client index transfer.

**flatbush** trades dynamic updates for superior performance and memory efficiency. It produces a packed Hilbert R-tree stored as a **single ArrayBuffer**, transferable to Web Workers via `SharedArrayBuffer`. It includes built-in k-nearest-neighbor search (`index.neighbors(x, y, k)`), which rbush requires the separate rbush-knn extension for. Flatbush is ideal for static reference datasets that don't change during interaction.

**tldraw added rbush in v4.4.0**, replacing brute-force O(n) iteration. The `SpatialIndexManager` updates the R-tree when shapes are added, moved, or deleted. Public APIs — `editor.getShapesAtPoint()`, `editor.getShapeIdsInsideBounds()` — use a **two-phase hit-testing pipeline**: R-tree bbox query narrows candidates to O(log n), then precise geometry checks via `ShapeUtil.getGeometry()` (polygon outlines, circles, etc.) confirm the hit. Viewport culling uses the same spatial index — a `notVisibleShapes` derivation queries the R-tree with viewport bounds and a `CullingController` reactor sets `display: none` on out-of-viewport shapes, avoiding React re-renders entirely. A canvas with 10,000 shapes might render only ~50 visible ones.

**Mapbox GL JS does not use rbush.** Instead, it uses a custom **grid-based spatial index** (`mapbox/grid-index`) that divides each vector tile's 8192×8192 extent into a 16×16 grid. GridIndex is ArrayBuffer-based, making it transferable to web workers. Its README candidly states: "You should probably use rbush instead" — GridIndex wins only when the index must transfer between workers and features are evenly distributed. The query pipeline for `queryRenderedFeatures` is: screen coordinates → tile coordinate transform → grid-based lookup → geometry intersection testing → layer filtering → result. Mapbox GL Draw **delegates entirely** to this system, maintaining no spatial index of its own — it renders drawn features as GeoJSON sources and uses `queryRenderedFeatures` with pixel buffers (2px for click, 25px for touch).

**deck.gl takes a radically different approach: GPU-based color picking.** Each pickable object gets a unique 3-byte RGB picking color (supporting up to 16M objects per layer). An off-screen framebuffer render pass produces a color-coded image; reading the pixel under the pointer and decoding it back to an object index takes one GPU round-trip. This eliminates CPU-side spatial data structures entirely but requires a WebGL render pass on every hover.

**Leaflet's core uses brute-force O(n) iteration** — its Canvas renderer iterates over all drawn layers on every click/hover event, calling `_containsPoint(point)` per layer. This works for under ~1,000 features but degrades badly beyond that. Plugins like Leaflet.LayerIndex and Leaflet.Canvas-Markers add rbush-based spatial indexing to fix this.

For annotation tools, the practical recommendation is: **rbush for interactive editing** (shapes change constantly), **flatbush for static reference data** (pre-loaded datasets), and always use two-phase hit-testing (spatial index → precise geometry check).

---

## 3. Presence state lives in a parallel universe from document state

Every production collaborative tool separates ephemeral presence (cursors, selections, viewports) from persistent document state. This separation is not merely architectural preference — it reflects fundamentally different consistency, lifetime, and bandwidth requirements.

**Figma** broadcasts cursor positions over persistent WebSocket connections. Cursor updates are **throttled on the sending side** and **interpolated on the receiving side** using requestAnimationFrame for smooth movement. Each user's cursor displays with custom styling (name label, assigned color, shadows). Figma later added "cursor chat" (press `/` to attach ephemeral text to your cursor) and "Spotlight" for drawing attention to your location. Clicking a user's avatar follows their viewport.

**tldraw** stores presence in `TLInstancePresence` records containing cursor position (x, y, type, rotation), chat message, activity timestamp, current page, user identity, selection state, and viewport bounds. Remote cursors render via a `CollaboratorCursor` component with colored arrows and name labels from a 12-color palette. The `perfect-cursors` library handles interpolation between discrete network updates. tldraw's sync uses Cloudflare Durable Objects, supporting up to **50 simultaneous collaborators** per canvas. Follow-mode lets teammates share viewports for guided editing.

**The Yjs awareness protocol** is the most widely-adopted standard for presence in CRDT-based tools. Crucially, awareness is defined in `y-protocols`, not the core `yjs` module — it is explicitly **not part of the document CRDT**. Each client maintains a local awareness state (arbitrary JSON) attached to an increasing clock. Updates propagate to all peers; receivers overwrite their stored state only if the received clock is newer. Clients that go silent for **30 seconds** are marked offline. The protocol exchanges complete state for each client (no state vectors needed, since awareness payloads are small). The `cursor` and `user` fields are conventions, not requirements.

**Liveblocks** provides the most developer-friendly presence API: `useMyPresence()` returns `[presence, updateMyPresence]`; `useOthers()` returns an array of other users. Default throttle rate is **100ms** (10 updates/second), configurable down to **16ms** (60fps) for smoother cursors. Presence resets on every disconnect — it is purely temporary.

The architectural distinction between presence and document state follows clear lines:

- **Presence** is ephemeral (resets on disconnect), best-effort consistent (lost data is harmless), high-frequency but small-payload (cursor x/y at 10–60Hz), and never persisted. Last-writer-wins is always acceptable.
- **Document state** is persistent (survives disconnects), eventually consistent with all changes converging, lower-frequency but larger-payload, and requires sophisticated merge (CRDTs, OT). It must be persisted to storage.

Mixing these two concerns — for instance, storing cursor positions in the CRDT document — would pollute the document history with transient data that has no value after the session ends.

---

## 4. Selection state spans the boundary between presence and history

Selection management is deceptively complex because it sits at the intersection of several concerns: it's user-specific (like presence), sometimes part of the undo stack (like document state), and must interact with spatial queries for hit-testing.

**tldraw** stores selection as an array of shape IDs in the `TLInstance` record — not on individual shapes. The API is clean: `editor.select(...shapes)`, `editor.selectNone()`, `editor.deselect(...shapes)`. Selection interacts with undo/redo through configurable history control: `editor.run(() => { ... }, { history: 'ignore' })` excludes changes from the undo stack, while the default includes them. History "marks" (`editor.mark(id)`) serve as undo checkpoints, and consecutive changes to the same records auto-squash into single undo entries.

**Excalidraw** tracks selection in `appState.selectedElementIds`, a `Record<string, boolean>`. This is explicitly browser-only state (`server: false, export: false`) — it's neither synced to collaborators nor saved in exported files. The `getSelectedElements()` function uses **shallow equality checks** to avoid unnecessary re-renders when the selection hasn't actually changed. Locked elements cannot be box-selected; bound text elements are automatically included when their container is selected.

**Mapbox GL Draw** uses a mode-based approach: `simple_select` mode allows multi-feature selection, `direct_select` mode selects individual vertices. Selection is tracked via the `active` property on features. Draw maintains two data sources — `mapbox-gl-draw-hot` (selected features) and `mapbox-gl-draw-cold` (inactive features) — and features move between them based on selection state. There's no direct `select()` API; programmatic selection requires `draw.changeMode('simple_select', { featureIds: [...] })`.

**Lasso/marquee selection** follows a two-phase pattern across all tools. The broad phase uses a spatial index query with the selection rectangle's bounding box. The narrow phase applies precise geometry tests: for rectangular selection, this is bbox containment or intersection; for freehand lasso, it's the ray-casting point-in-polygon algorithm (cast a ray from each test point, count boundary intersections — odd count means inside). Tools offer both containment mode (shape fully within selection area) and intersection mode (any overlap counts).

The critical design question — **should selection be part of the undo stack?** — has no universal answer. Figma includes selection in undo, allowing users to navigate between pages and undo back to the previous page's selection. Excalidraw excludes it entirely. tldraw makes it configurable. In collaborative contexts, each user's selection must be preserved independently — User B hitting undo must never change User A's selection. Selection in collaborative editing is best modeled as **presence state** (ephemeral, per-user) rather than document state.

---

## 5. Schema migration is a solved problem that most tools solve poorly

When an annotation tool adds a new shape type, renames a property, or changes a data type, every previously-saved document must still open correctly. **tldraw has the most sophisticated client-side migration system** among canvas tools, while most others rely on ad-hoc restoration logic.

tldraw's system uses **named migration sequences** with explicit up/down functions and a dependency graph. Each record type (shapes, assets, bindings) has its own sequence. Every snapshot embeds a `schema` object with version numbers per sequence. On load, the store compares snapshot versions to current versions and applies missing migrations in dependency order. The bidirectional design (up for forward migration, down for backward) enables multiplayer compatibility — newer clients can send data to older clients by applying down-migrations. SDK users add their own parallel migration sequences for custom shapes:

```typescript
const migrations = createShapePropsMigrationSequence({
  sequenceId: 'com.tldraw.shape.myshape',
  sequence: [{
    id: versions.AddColor,
    up(props) { props.color = 'black' },
    down(props) { delete props.color },
  }],
})
```

**Excalidraw** uses a less formal approach: a `restoreElements()` function handles deserialization, legacy property renames, and default value application. It has a top-level `version` field (currently 2) for breaking changes, but relies primarily on graceful handling of missing/extra properties rather than numbered migrations. Unknown properties are preserved during round-trip (JSON pass-through).

**OpenStreetMap's tagging evolution** is a fascinating case of schema-less evolution. With over 100,000 unique tag combinations in use, OSM has no formal schema — tag conventions emerge from community consensus, not enforcement. Deprecated tags persist in legacy data with no migration mechanism. The `id-tagging-schema` project codifies commonly-used tags into presets for editors like iD and StreetComplete. This approach scales remarkably well for crowd-sourced data but creates significant parsing difficulties for consumers.

**CRDT schema evolution** is particularly challenging. Automerge's documentation recommends embedding a schema version number in the document and writing migration functions, but warns that two users may independently perform the same migration, causing conflicts. The workaround is hard-coding migration changes with deterministic actorId and timestamp. The **Cambria** paper explores safe schema migrations for CRDT apps but isn't yet production-ready. Yjs has no built-in migration system — schema evolution is entirely the application's responsibility.

---

## 6. Client-side persistence has graduated beyond IndexedDB

The client-side persistence landscape has shifted dramatically with SQLite/WASM and the Origin Private File System (OPFS), though IndexedDB remains the pragmatic default for most tools.

**Excalidraw** uses a dual-storage strategy: localStorage for elements and AppState as JSON, IndexedDB (via the `idb-keyval` library) for binary files like images. The `LocalData` class orchestrates debounced saves with pause/resume for collaboration mode. When localStorage quota is exceeded, the app displays a warning. An active proposal (PR #9810) would migrate elements to IndexedDB, but maintainers note that browsers can evict IndexedDB data under disk pressure — they're considering a dual LS+IDB strategy with version tracking.

**tldraw** offers single-prop automatic persistence: `<Tldraw persistenceKey="my-document" />` saves to IndexedDB and syncs across browser tabs via `BroadcastChannel`. For custom backends, the snapshot API (`getSnapshot`/`loadSnapshot`) separates `document` (shapes, pages, bindings — persist to server) from `session` (camera, selection, UI state — keep per-user locally). Since v2.3.0, images and videos are stored in a separate IndexedDB table rather than base64 in snapshot JSON.

**SQLite/WASM** has emerged as a serious alternative. The official SQLite WASM build (`@sqlite.org/sqlite-wasm`) uses OPFS for persistence via Web Workers, requiring COOP/COEP headers for SharedArrayBuffer. **wa-sqlite** (`rhashimoto/wa-sqlite`) provides pluggable VFS implementations: `OPFSCoopSyncVFS` offers the best general-purpose performance (even with large databases), `IDBBatchAtomicVFS` works in all contexts as a fallback, and `AccessHandlePoolVFS` pre-opens OPFS handles for maximum performance.

**Notion's migration to SQLite/WASM + OPFS** is the most significant production validation. They achieved a **20% improvement in navigation times** with no observed SQLite corruption. Their architecture uses Web Workers with wa-sqlite's OPFS SyncAccessHandle Pool VFS, with **Comlink** for main-thread-to-Worker communication. Only the active tab handles database writes; other tabs route requests through a SharedWorker pattern. They could not use cross-origin isolation due to third-party scripts, requiring the pool-based VFS approach.

For mapping tools specifically, tile persistence dominates: Leaflet plugins (leaflet.offline, leaflet.dexie) store tiles in IndexedDB; Mapbox uses a local SQLite database on mobile. **User annotations are always the developer's responsibility** — no mapping SDK provides built-in annotation persistence.

---

## 7. Tombstone accumulation is the tax on collaborative deletion

Every collaborative system that supports deletion must decide how to handle the ghost data left behind. CRDTs require tombstones because deleted items' positions are needed to correctly order concurrent insertions. A heavily-edited 1,000-character document might internally contain **50,000 tombstones**.

**Yjs** uses three strategies that its creator Kevin Jahns argues make traditional tombstone GC unnecessary. First, **struct merging**: sequential inserts from the same user become a single struct, dramatically reducing JS objects. Second, **content deletion**: when GC is enabled (`doc.gc = true`, the default), deleted items have their content discarded, retaining only lightweight `GC` objects with length information. Third, **orphan GC**: when a parent is deleted, children can be safely replaced with GC objects. Jahns has stated explicitly that "tombstone garbage collection is not even necessary for CRDTs to work in practice" — efficient encoding makes the problem manageable. However, disabling GC for version history (`doc.gc = false`) is "pretty awful for performance, disk space, and network throughput" per a community member managing millions of Y.Docs.

**Automerge** takes a different path, retaining full document history by design. Automerge 2.0 uses an efficient binary columnar format achieving **less than 1 additional byte per character** of overhead. Automerge 3.0 achieved a **10x+ memory reduction** by using compressed columnar representation at runtime: a Moby Dick-sized document dropped from 700MB to 1.3MB in memory, and loading time from 17 hours to 9 seconds. The automerge-repo storage layer periodically compacts incremental changes into snapshots, using a clever concurrency-safe approach where each process tracks its own "live keyset" and only deletes keys it had loaded.

**Excalidraw** demonstrates the pragmatic end of the spectrum. Each element has an `isDeleted` tombstone flag. The team's explicit position: "We don't consider this a problem as a shared whiteboard session will only contain a few dozen shapes." The cleanup strategy is simple: **strip `isDeleted` elements when saving to persistent storage**. Tombstones only exist during active collaboration sessions.

For spatial annotation data specifically, tombstones create a unique problem: deleted shapes scattered across 2D coordinate space don't compress into runs the way deleted text characters do. Any spatial index (R-tree) built over CRDT data must either include tombstones (wasting query time), maintain a secondary index excluding them (extra bookkeeping), or rebuild indexes after compaction. tldraw's approach of separating "ephemeral shapes" from document shapes (Issue #7869) avoids polluting the shape system with non-document concerns.

---

## 8. Reactive derived state with signals outperforms traditional approaches

Computing derived values from annotation state — bounding boxes, spatial relationships, viewport culling sets, label placements — is a core performance bottleneck. tldraw's signal-based approach represents the state of the art for canvas tools.

**tldraw's `@tldraw/state`** (originally the standalone "Signia" library) uses a **global logical clock** — a single integer incremented on any root state change. Comparing clock values enables "always-on caching" of computed values regardless of whether they're being actively observed. This solved tldraw's critical problem: computed values used only during pointer-move event handling were being thrown away and recomputed every frame in other reactive frameworks. The key innovation is **incremental derivations with diffs**: signals emit change descriptions alongside current values, enabling operations like list filtering to apply predicates only to new/updated items. Transactions (`transact(() => { ... })`) batch updates and trigger reactions only once; if an error occurs, all updates roll back.

**Figma** uses a C++/WASM document representation with a custom **parameter runtime** for reactive updates. When a variable changes, parameter usage tracking triggers invalidation, resolution, and re-rendering. They recently unified two separate reactive architectures (component properties and variables) into a single runtime. Hot paths (code executing many times per second) use time-slicing to avoid frame drops.

**Mapbox GL JS's label placement** is the most computationally sophisticated derived-state system in the mapping world. Collision detection runs **synchronously every frame** using a global viewport-based approach. The algorithm iterates through all symbols in priority order, computes bounding geometry in screen coordinates, and checks against a `GridIndex` for available space. For line labels, **collision circles** (rather than rectangles) approximate the curved path of text along a line. Variable anchor placement (`text-variable-anchor`) tries multiple anchor positions in order before giving up, maximizing label density. The `CrossTileSymbolIndex` tracks symbols across tile boundaries for smooth transitions during panning.

The practical pattern for annotation tools is three-layered: signals/atoms for root state (shape records), computed derivations for intermediate values (bounding boxes, selection sets, spatial index results), and reactive side effects for external updates (DOM manipulation, network sync). The critical optimization is **lazy evaluation with caching** — computed values should only recompute when their specific dependencies change, never on every frame.

---

## 9. Batching turns thousands of micro-mutations into coherent operations

Rapid interaction — dragging shapes, drawing freehand paths, resizing — generates hundreds of mutations per second. Without batching at multiple levels (state, rendering, network, undo), tools become sluggish or generate enormous sync traffic.

**tldraw's `Editor.run()`** (formerly `batch()`) is the primary mechanism. Multiple store operations inside `run()` collect into a single transaction. Since v2.2.0, "squashing is gone entirely — everything squashes and does so much faster than before," meaning consecutive updates to the same record auto-merge. The `@tldraw/state` signal library ensures downstream computed values recompute only once per transaction. Shape indicators switched from SVG to **2D canvas rendering for 25x improvement** — the renderer draws selection outlines directly on a canvas overlay rather than managing SVG DOM elements.

**Excalidraw** throttles `pointermove` events to the animation framerate (PR #4727) and caps scene rendering to rAF (PR #5422). For collaboration, a **30ms debounce** on sync reduced bandwidth from lag-inducing levels (8–15 second delays during rotations) to imperceptible. The `onChange` callback fires on every minimal change, so implementations should cache `getSceneVersion()` and only persist when it increments. Documentation recommends **500ms debounce** on save operations.

**Network debouncing** varies by system. Yjs's y-websocket sends updates immediately by default; developers implement custom throttling by collecting updates and merging via `Y.mergeUpdates()`. The Prosemirror-yjs binding uses a **1-second** snapshot debounce interval. Liveblocks defaults to **100ms** throttle for presence updates, configurable to 16ms (60fps) for smoother cursors. Its `room.batch()` groups Storage and Presence modifications into a single message.

**Freehand drawing** uses specialized simplification. tldraw's `perfect-freehand` library (also used by Canva, draw.io, and Excalidraw) deliberately avoids Douglas-Peucker/RDP simplification during drawing because "if a simplify-and-fit algorithm is applied while the user is still drawing, the curves will noticeably jump around." Instead, it uses a `streamline` parameter (0–1) that lerps between previous and current points, recalculating the entire stroke every frame. This produces stable, smooth lines without visual artifacts. Douglas-Peucker is reserved for post-hoc simplification after drawing completes.

**Undo entry coalescing** is critical for drag operations. tldraw uses history "marks" as checkpoints — a mark placed at drag start means the entire drag operation reverts as one undo step, regardless of how many intermediate position updates occurred. Excalidraw's 2024 rewrite introduced a `Store` and `Delta` system where the `CaptureUpdateAction` enum controls granularity: `IMMEDIATELY` (instant undo capture), `EVENTUALLY` (deferred), or `NEVER` (remote updates, scene initialization).

---

## 10. Validation constrains geometry without blocking interaction

Geometric validation spans a spectrum from real-time feedback during editing (snapping, topology warnings) to blocking validation before save/upload (self-intersection detection, schema validation).

**turf.js** provides the most widely-used JavaScript geometric validation functions. `@turf/kinks` detects self-intersections in polygons by returning all intersection points. `@turf/unkink-polygon` decomposes self-intersecting polygons into simple polygons. **JSTS** (JavaScript Topology Suite), a full port of Java JTS, provides `isValid()` per OGC Simple Features rules: polygon shells must be counter-clockwise, holes clockwise, no self-intersections, and MultiPolygon elements may touch only at finite points. The classic `buffer(0)` trick — applying a zero-width buffer — repairs invalid polygon topology by inherently handling overlaps and self-intersections.

**Snapping** is implemented differently across tools. Mapbox GL Draw's snap plugins (`mapbox-gl-draw-snap-mode`) add custom draw modes with configurable snap distance (**15px default**), vertex-over-midpoint priority, and turf.js `nearestPointOnLine` for edge snapping. Alt/Option temporarily disables snapping. tldraw's `SnapManager` has two subsystems: `BoundsSnaps` for aligning shape edges/centers during translate/resize, and `HandleSnaps` for snapping handles to key geometry points. Custom shapes define their own snap targets via `ShapeUtil.getHandleSnapGeometry()`.

**The iD editor** runs the most comprehensive real-time validation system for map editing, with validators in `modules/validations/` checking for: crossing ways without proper bridge/tunnel tags, almost-junctions (near-miss road connections), disconnected routing islands, nodes too close together, non-square buildings, outdated tags, and missing essential tags. Validation runs **instantly while editing** with a dedicated Issues pane. Errors **block changeset upload**; warnings are advisory. Quick-fix buttons provide one-click repairs for common issues.

**tldraw** uses a `StoreSideEffects` system where hooks fire after transactions complete, enabling post-commit validation and derived state enforcement. Side effects can modify other records in response to changes (e.g., updating bindings when shapes move). Minimum drag distance scales with zoom to prevent degenerate geometries — a design pattern where **minimum distance thresholds** serve as implicit geometric constraints.

**Mapbox GL style expression validation** deserves mention: the `@mapbox/mapbox-gl-style-spec` package validates style JSON against the v8 schema specification, with type-safe expression checking (filter expressions must return boolean, data expressions validate property type compatibility). Runtime methods (`addSource`, `addLayer`, `setFilter`) validate inputs against the spec before applying.

---

## 11. Serialization formats beyond GeoJSON unlock scale and performance

GeoJSON's dominance as the web's spatial interchange format obscures significant limitations: **no topology, no streaming, no schema, no spatial index, mandatory WGS84, and text parsing overhead** that becomes a bottleneck at scale. A 2.1GB GeoJSON file of Texas building footprints can exceed string buffer limits.

**FlatGeobuf** addresses these limitations with a binary format built on Google's FlatBuffers. Zero-copy deserialization means data is read directly from the buffer without parsing. A packed Hilbert R-Tree spatial index enables HTTP Range Request-based spatial filtering — host an FGB file on S3 and clients fetch only features within their viewport. Performance benchmarks show **8x faster reads than Shapefile** on a 2.5M polygon dataset. FlatGeobuf is supported natively by GDAL, QGIS, GeoServer, PostGIS, OpenLayers, and Leaflet. Its limitation is that it's immutable after creation — no random writes.

**GeoParquet** stores geospatial vector data in Apache Parquet's columnar format. GeoParquet 1.0/1.1 adds metadata to label geometry columns (encoded as WKB). **GeoParquet 2.0** (announced February 2025) will use native `GEOMETRY` and `GEOGRAPHY` logical types added to the Parquet specification itself in March 2025. Over **20 tools in 6+ languages** support GeoParquet, including BigQuery, Snowflake, DuckDB, and Databricks. Columnar format enables cheap column-subset reads, making it excellent for analytics, but row-based formats remain better for write-heavy interactive editing.

**PMTiles** is a single-file archive format for tiled data using Hilbert curve ordering with HTTP Range Request access. It enables **serverless tile hosting** — place a file on S3 or Cloudflare R2 with no tile server. Internal de-duplication reduces file sizes by 70%+ for global vector basemaps. The entire planet OpenStreetMap tileset is ~107GB as PMTiles. Client integrations exist for MapLibre GL JS, Leaflet, and OpenLayers.

**Mapbox Vector Tiles (MVT)** use Protocol Buffers with delta-encoded geometry commands relative to a tile extent (default 4096×4096), dictionary-encoded properties (shared `keys[]` and `values[]` arrays referenced by index), and typed values. This is the most widely-deployed binary geo format, rendered by Mapbox GL JS, MapLibre, OpenLayers, and QGIS.

**GeoArrow** specifies how to store geometries in Apache Arrow's columnar memory format, operating in-memory, on disk (via Parquet), and over the wire (via Arrow IPC/Flight). Raw coordinate values sit in contiguous buffers with offset arrays reconstructing geometries, enabling zero-copy access. Implementations exist in C, Rust, R, and Python, with query engine support in DuckDB and Velox.

For annotation state specifically, custom tool formats dominate: **Figma uses Kiwi** (a custom binary format similar to Protocol Buffers, compressed with zlib/Zstandard), **tldraw uses JSON snapshots** with embedded schema versions, and **Excalidraw uses JSON** with per-element versioning that can embed in PNG metadata or SVG comments for roundtripping.

---

## 12. Access control gravitates toward document-level boundaries

Per-feature annotation permissions are technically possible but rarely implemented in practice. Most production tools enforce permissions at the document, room, or layer level.

**ArcGIS Online** has the most mature per-feature permission system: ownership-based access control restricts edits so only the feature creator can update/delete their features. This requires editor tracking (recording who created/edited each feature and when). Options control whether non-owners can query, update, or delete — if query is disabled, users see only their own features. Hosted feature layer views create filtered subsets with different permissions for different user groups, including geographic region restrictions.

**Figma's permission model** is hierarchical (Organization → Workspace → Team → Project → File) with roles: Owner, Admin, Can Edit, Can View. Permissions are **per-file, not per-element** — the file is the unit of access control. Figma outgrew a simple integer hierarchy and built a custom **Access Control Policy (ACP)** system inspired by IAM policies: each policy has a resource type, effect (ALLOW/DENY), permissions list, and conditional application. They evaluated Open Policy Agent, Google Zanzibar, and Oso before building their own.

**Liveblocks** provides room-level permissions with three tiers: default accesses (room-wide baseline), group accesses (per-group overrides), and user accesses (per-user overrides). Permission types are `room:write` (full edit), `room:read` (view-only), and `room:presence:write` (can update cursors and selections but not content). This last permission type is particularly useful for "follow along" modes. Permissions are **room-level only** — no per-element or per-storage-key granularity.

**PostgreSQL Row-Level Security (RLS) with PostGIS** is the most powerful pattern for per-feature annotation permissions. Policies evaluate arbitrary SQL expressions including spatial predicates:

```sql
CREATE POLICY "Region editors" ON annotations
  FOR UPDATE USING (
    ST_Within(geometry, (SELECT region FROM editor_regions WHERE user_id = auth.uid()))
  );
```

This enables geographic access control — an editor can only modify annotations within their assigned region. Supabase provides this stack with automatic API generation. Performance requires indexes on policy-referenced columns and careful query planner guidance.

**OpenStreetMap** proves that fully open edit access scales when combined with community moderation and full history. Any registered user can edit any feature globally, but changesets provide accountability, automated tools (OSMCha) flag suspicious edits, and the Data Working Group handles disputes. The changeset model provides accountability without restricting access — every edit is reversible.

---

## Conclusion

These twelve patterns reveal a clear maturity gradient in annotation state management. The most impactful architectural decisions are not about which CRDT library to choose, but about **where to draw boundaries**: presence versus document state, dynamic versus static spatial indexes, local versus remote persistence, document-level versus per-feature permissions.

Three insights stand out as particularly underappreciated. First, **LWW at the property level is sufficient for nearly all spatial annotation conflicts** — the complexity of operation-based CRDTs is justified only for rich text, not for shape positions or style properties. Second, **spatial indexing is the single largest performance lever** for annotation interaction, yet Leaflet ships without it and Mapbox GL Draw delegates entirely to the rendering engine's query system. Third, **schema migration is a first-class architectural concern** that most tools treat as an afterthought — tldraw's bidirectional migration system with dependency graphs is the only production example that properly handles multiplayer version skew.

The trend is clear: annotation tools are converging on local-first architectures with SQLite/WASM persistence, signal-based reactive derivations, R-tree spatial indexing, and strict separation of ephemeral and persistent state. The tools that get this stack right feel instant and collaborative. The tools that don't feel like web apps from 2015.