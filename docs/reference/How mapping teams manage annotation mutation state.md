# How mapping teams manage annotation mutation state

**The industry has converged on a surprisingly small set of patterns for managing mutable map annotations, and none of the production-grade collaborative tools use off-the-shelf CRDTs.** Across interviews, engineering blogs, and conference talks from Felt, Figma, Mapbox, Esri, tldraw, Excalidraw, and the OpenStreetMap ecosystem, five dominant architectural patterns emerge: last-write-wins with fine-grained properties, immutable graph snapshots, the command pattern, mode-based state machines, and event sourcing. The choice between them depends almost entirely on whether the application needs real-time collaboration, offline editing, or undo/redo — and how geometrically complex the annotations are. What follows is a synthesis of the best publicly documented approaches, drawn from engineer interviews, architecture documents, and conference presentations.

---

## Real-time collaboration: why production tools reject CRDTs

The most counterintuitive finding is that **every major collaborative canvas and mapping tool has deliberately avoided standard CRDTs and operational transformation**. Felt, Figma, Excalidraw, and (until recently) tldraw all use variants of last-write-wins with server ordering, structured to minimize conflicts rather than resolve them.

Felt's CTO Can Duruk stated this explicitly in a 2023 Browsertech Digest interview: "We're not using something like Yjs, we're not using any of the CRDT or OT structures. We're just structuring the data as deeply as possible, so that merge conflicts don't happen often." Felt follows what Duruk calls "the Figma model" — a server-authoritative WebSocket architecture built on Elixir/Phoenix where the last write the server receives wins. Their key insight is that **concurrent edits to the same map element are vanishingly rare** in practice. The real value of collaboration is establishing a single shared version, not handling simultaneous edits to the same polygon vertex.

Figma's approach, documented by co-founder Evan Wallace in his influential 2019 blog post "How Figma's multiplayer technology works," operates at the **(ObjectID, Property)** granularity. Two users changing different properties on the same object produces no conflict. Two users changing the same property on the same object resolves via last-write-wins at the server. Wallace explained: "Figma isn't using true CRDTs. CRDTs are designed for decentralized systems where there is no single central authority. Since Figma is centralized, we can simplify our system by removing this extra overhead." Each document gets its own process on the multiplayer service, holds state in memory, broadcasts updates at ~30 FPS, and checkpoints to storage every 30–60 seconds. A DynamoDB-backed write-ahead log with sequence numbers prevents data loss during crashes.

Excalidraw takes a different path — a pseudo-peer-to-peer model with a relay server that performs no coordination. Each element carries a **version number and a random versionNonce**. When concurrent edits arrive, the higher version wins. If versions tie (simultaneous edits), the lower nonce wins deterministically. Elements are soft-deleted via tombstones. The Excalidraw developers acknowledged this trade-off openly: "For Excalidraw, we don't really care! We think this will be a pretty rare situation, and that users will tolerate some jankiness if it happens."

tldraw's approach is the most sophisticated among canvas tools. Its custom **TLSync protocol** uses CRDT-like semantics with optimistic updates and automatic rollback on conflicts, running on Cloudflare Durable Objects (one per file). The reactive state layer, **Signia**, uses fine-grained signals with logical clocks for incremental derivations. tldraw supports 400,000+ users across 200,000+ shared projects.

The one domain where standard CRDTs fall short is **geometry-aware collaborative editing**. A 2025 paper in ISPRS International Journal of Geo-Information proposed Geometric Vector Clocks (GVCs) — extensions of traditional vector clocks that incorporate spatial semantics and topological anomaly detection into the merge process. Standard CRDTs applied naively to vertex sequences produce geometrically invalid results (self-intersecting polygons, broken topology). A FOSS4G Europe 2025 paper demonstrated that CRDT-based co-editing of polygons with 100K–300K vertices by 60 concurrent users is feasible, but the GUI-CRDT integration — not the CRDT mechanics — is the bottleneck.

**Practical pattern for collaborative map annotations:** Structure data with fine-grained properties (position, style, label as separate fields), use a central server as authority, apply last-write-wins per property, and invest in reducing conflict probability through data structure design rather than complex conflict resolution algorithms.

---

## Two schools of undo/redo: immutable snapshots versus commands

The OpenStreetMap editing ecosystem provides the clearest contrast between the two dominant undo/redo architectures. The iD editor and JOSM solve the identical problem — editing OSM nodes, ways, and relations — with fundamentally different state management philosophies.

**iD editor uses immutable persistent data structures.** Its architecture document (on GitHub) describes a system where entities (osmNode, osmWay, osmRelation) are immutable objects. Any edit produces a new copy with the changed property. These entities live in an immutable `coreGraph` — a map from entity IDs to entities. Adding, replacing, or removing an entity produces a new graph. Because entities are immutable, the original and new graphs share references to unchanged entities via **structural sharing**, minimizing memory overhead. The `coreHistory` module maintains a simple **stack of graph snapshots**. Undo moves a pointer backward; redo moves it forward. Edit operations are pure functions: `Action(graph) → newGraph`. The UI pipeline flows from Modes → Operations → Actions → new Graph → History stack. At save time, iD computes a diff between the first and current graph to generate an OsmChange document.

**JOSM uses the classic Gang-of-Four command pattern.** Its `Command` abstract base class has `executeCommand()` and `undoCommand()` methods. Before executing, each command clones the state of all primitives it will modify into a `cloneMap`. Undo restores primitives from this map. Concrete commands include `AddCommand`, `DeleteCommand`, `MoveCommand`, `ChangePropertyCommand`, and `SequenceCommand` (which bundles multiple commands into a compound operation). The `UndoRedoHandler` singleton manages the command stack.

Tom MacWright, who worked on both the iD editor and Mapbox Studio, documented his evolution through five approaches in blog posts spanning 2015–2021. He started with **Immutable.js snapshots** (used in Mapbox Studio and iD), moved to **hand-crafted immutability** with ES6 spread syntax, then **Immer** for ergonomic "mutable-looking" code that produces immutable results, then **JSON Patch** (RFC 6902) for persistable diffs, and finally concluded that **OT/CRDTs represent the natural endpoint** — where the same infrastructure handles both collaboration and undo/redo. His key observation: snapshot-based undo is trivially simple but cannot persist history or support collaboration, while operation-based approaches are more complex but unlock both.

Among canvas tools, **tldraw's HistoryManager** uses a command-based system with "marks" — named checkpoints that group multiple commands into a single undoable unit. `editor.mark('resize')` creates a checkpoint; `editor.bail()` undoes everything to the last mark; `editor.history.ignore(fn)` makes changes invisible to the undo stack. Since v2.2.0, all store changes are automatically recorded unless explicitly excluded. Critically for multiplayer, remote changes received via `mergeRemoteChanges` are excluded from the local undo stack.

**Figma's multiplayer undo** follows a principle stated by engineer Rasmus Andersson: "If you undo a lot, copy something, and redo back to the present, the document should not change." Each client maintains its own local undo/redo stack. Undo entries store inverse operations. When undo encounters a conflict (e.g., another user deleted the object), Figma simply does nothing — the same approach Google Slides uses.

**QGIS** combines Qt's QUndoStack with database SAVEPOINTs for PostgreSQL-backed layers. Each undo step maps to a SAVEPOINT; rolling back executes `ROLLBACK TO SAVEPOINT`. Compound operations use `editCommandStarted`/`editCommandEnded` to group multiple feature modifications.

| Approach | Memory | Persistence | Collaboration | Complexity | Best for |
|----------|--------|-------------|---------------|------------|----------|
| Immutable snapshots | High (mitigated by structural sharing) | In-memory only | Poor | Low | Single-user editors with simple state |
| Command pattern | Low (only diffs) | Serializable | Good with per-client stacks | Medium | Professional editors, multiplayer |
| Event sourcing | Low (append-only log) | Native | Excellent | High | Versioned data, audit trails |

---

## Mode-based state machines drive every drawing tool

**The finite state machine is the universal interaction pattern across all annotation editors.** Mapbox GL Draw, Terra Draw, nebula.gl, Leaflet-Geoman, and Esri's Editor widget all organize user interaction through modes that encapsulate behavior, event handling, and state transitions.

Mapbox GL Draw's mode system is the most thoroughly documented and widely forked. Five built-in modes — `simple_select`, `direct_select`, `draw_point`, `draw_line_string`, `draw_polygon` — each implement lifecycle functions: `onSetup()`, `onClick()`, `onMouseMove()`, `onDrag()`, `onStop()`, and `toDisplayFeatures()`. The `onSetup()` function returns a mutable state object that persists for the mode's lifetime. This architecture enables a rich ecosystem of custom modes (freehand drawing, rotation, circle, cut/split) without modifying core code.

Mapbox GL Draw also introduced the **hot/cold source pattern** — a rendering optimization where actively edited features live in a frequently-updated "hot" GeoJSON source while inactive features sit in a rarely-updated "cold" source. Features migrate between sources based on interaction state, minimizing GPU re-renders. An open GitHub issue (#994) proposes replacing this with the Feature State API for smoother transitions.

**Terra Draw**, presented at FOSS4G 2023, FOSS4G Europe 2024, and FOSDEM 2025 by James Milner, represents the state of the art for new projects. It applies the **adapter pattern** on top of the mode pattern: built-in adapters for MapLibre, Leaflet, OpenLayers, Google Maps, and Mapbox abstract away library specifics, while mode objects define drawing behaviors. Any mode works with any adapter. Terra Draw is now an OSGeo Community Project and is referenced in Google Maps JavaScript API documentation. Its Store manages all features in GeoJSON format with add, remove, and restore operations.

**nebula.gl** (Uber/Vis.gl) takes the most React-native approach: the application owns the GeoJSON FeatureCollection, passes it as props to `EditableGeoJsonLayer`, and receives edit callbacks. Mode objects (DrawPolygonMode, DrawLineStringMode) are passed as props. Selection operates by feature index, not ID. This "lift state up" / controlled component pattern mirrors React conventions but requires careful reference stability — passing a new array instance for `selectedFeatureIndexes` clears in-progress drawings.

---

## Platform-specific CRUD architectures reveal three paradigms

The major mapping platforms organize annotation CRUD into three distinct paradigms: **observer/imperative** (Google Maps), **batch command** (Esri), and **SQL mutation** (CARTO).

**Google Maps** uses an MVC-inspired `MVCObject` base class with `get()`, `set()`, and `bindTo()` methods. Every map object — markers, polygons, overlays — extends MVCObject, providing observable property changes. There is no centralized state store. Each overlay manages its own state independently. The Data Layer accepts GeoJSON via `addGeoJson()` and fires events (`addfeature`, `removefeature`, `setgeometry`, `setproperty`), but for complex applications developers must build their own state management layer. Google's DrawingManager was deprecated in August 2025, signaling a shift in their annotation approach.

**Esri's ArcGIS Maps SDK** has the most sophisticated editing architecture. The `FeatureLayer.applyEdits()` method takes an object specifying `addFeatures`, `updateFeatures`, and `deleteFeatures` arrays — essentially a **batch command pattern** where you compose edit operations and submit them as a transaction. The Editor widget uses a clean **ViewModel separation**: business logic in the ViewModel, UI in the widget. Internally, `SketchViewModel` handles geometry capture. The system supports undo/redo during vertex editing, snapping, feature templates (predefined configurations for creating features with default attributes and symbols), attribute domains, and conditional field visibility. Esri Developer Summit talks from 2023–2024 demonstrate these workflows extensively.

**CARTO** operates at a fundamentally different layer. There is no client-side feature store. CRUD operations are SQL statements executed against PostGIS tables or cloud data warehouse tables (BigQuery, Snowflake, Redshift). Visualization is generated from server-side queries. This "SQL mutation pattern" trades client-side state complexity for database-level transaction semantics.

**Felt** introduced a hybrid with their December 2025 "Lightning" engine — a **merge-on-demand architecture** that combines pre-generated base tiles (via Tippecanoe), an edit database tracking changes, and a dynamic tiling engine that merges edits with base tiles in real-time. A background process continuously incorporates edits back into base tiles to keep the dynamic delta small. This enables real-time multi-user editing of datasets at scale while maintaining tile-based rendering performance.

---

## OSM's optimistic locking and the versioning frontier

The OpenStreetMap API v0.6 uses **optimistic locking with per-element version numbers** — a pattern closer to CVS than Git, as analyzed by Seth Fitzsimmons of Stamen Design in his POSM Replay Tool write-up. Every node, way, and relation carries a version starting at 1, incremented with each edit. To update an element, the client must supply the current version; a mismatch returns HTTP 409 Conflict. Changesets group edits but are **not atomic** — individual changes within a changeset can be independently rejected. There is no server-side merge, three-way diff, or delta updating. All conflict resolution happens client-side.

The iD editor handles this with an optimistic save strategy: attempt a "fast save" first, and only enter conflict resolution if the server returns 409. This was an explicit optimization (GitHub issue #3056) over the original approach of pre-fetching all server versions before upload.

For long-term geospatial data versioning, **GeoGig** (LocationTech) applies Git's model directly to spatial data. Every change is tracked as a commit with content-addressable storage and structural sharing for unchanged features. It supports branching, merging with conflict detection at the feature level, push/pull to remotes, and import from Shapefiles and PostGIS. This represents the event sourcing / version control approach taken to its logical conclusion for geospatial data.

The proposed OSM API v0.7 would introduce delta updating of element properties (e.g., append a node to a way without transmitting all nodes) and relaxed locking (version match only for the modified portion of an element) — ideas that would bring OSM closer to the fine-grained property-level conflict resolution that Figma and Felt already use.

---

## Conclusion: the patterns that matter most

Five conceptual patterns dominate annotation mutation state management across the industry, each addressing a different axis of the problem:

**For conflict resolution**, the winning pattern is not CRDTs but **fine-grained last-write-wins with structural conflict avoidance** — decompose annotations into independent properties so concurrent edits rarely collide. Felt, Figma, and Excalidraw all converged on this independently. CRDTs become necessary only for text-like data (Figma's Eg-walker for code layers) or when geometric topology must be preserved during concurrent vertex editing (academic Geometry-Aware CRDTs).

**For undo/redo**, the choice is between **immutable snapshots** (iD editor, early Mapbox Studio — simple but memory-intensive and non-persistable) and **command/operation stacks** (JOSM, tldraw, Figma, QGIS — more complex but enable multiplayer undo with per-client stacks and persistable history). Tom MacWright's trajectory from Immutable.js to JSON Patch to CRDTs traces the natural evolution as requirements grow.

**For interaction management**, the **mode-based state machine** with lifecycle hooks (Mapbox GL Draw, Terra Draw, nebula.gl) is universal. Terra Draw's adapter layer on top of this pattern represents the current best practice for library-agnostic drawing.

**For rendering performance**, the **hot/cold source split** (Mapbox GL Draw) or merge-on-demand architecture (Felt Lightning) separates actively edited features from stable ones, minimizing re-render scope.

**For data flow**, the industry is split between **imperative/event-driven** patterns (Leaflet, Google Maps, MapKit UIKit) and **reactive/declarative** patterns (nebula.gl, SwiftUI MapKit, react-map-gl). The tension between mutable map library internals and immutable React-style state flows remains the central architectural challenge, with the "lift state up" controlled component pattern as the cleanest bridge.