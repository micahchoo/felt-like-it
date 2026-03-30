# E2E Flow Problems

> Reframed from 64 audit findings into 16 flow-level problems + 4 new flow opportunities.
> Each problem: what the user does → what goes wrong → what should happen.

---

## Existing Flow Problems

### F01: Map Creation — broken path, no onboarding
**User does:** Clicks "New Map" on dashboard
**What goes wrong:** `handleCreate` recursively calls itself (infinite recursion bug). Even if fixed: hard-coded "New Map" title with no input, no loading indicator, lands on empty editor with no affordance to add data or pick a starting location. Dead form-action code path alongside live tRPC path.
**Should happen:** Title prompt → creation with feedback → editor with onboarding hint (import or draw).

### F02: Data Import — blind upload, dangerous buffering
**User does:** Drags file into ImportDialog, clicks Upload
**What goes wrong:** No upload progress (0% until worker starts). Server buffers entire file in memory (up to 100MB). Fixed 1s poll with no backoff. Error messages are unstructured strings — user sees "parse failed" with no guidance. Uploaded files never cleaned up after success.
**Should happen:** Upload progress bar → streaming to disk → structured error messages with recovery hints → automatic file cleanup.

### F03: Layer Rendering — monolith blocks all map work
**User does:** Opens a map with layers
**What goes wrong:** 887-line MapCanvas mixes rendering, click handling, annotations, badges, measurement, and drawing toolbar. Every sublayer has triple-duplicated onclick handlers (6 copies per layer). Paint builders return `Record<string,unknown>` requiring unsafe casts. No z-ordering — data renders above map labels. No clustering for large point datasets.
**Should happen:** Declarative composition (DataLayers + AnnotationLayers + MeasurementLayers as children inside `<MapLibre>`). Typed paint builders. `beforeLayerType="symbol"` for proper z-order.

### F04: Feature Interaction — silent map, no feedback loop
**User does:** Hovers/clicks a feature on the map
**What goes wrong:** Zero hover feedback — no cursor change, no visual highlight, no preview. Click uses 300ms timestamp hack to deduplicate overlapping layers. Highlight is paint-based (rebuilds entire paint expression on selection change). Popup is rendered at top level instead of composed inside layers. No keyboard navigation between features.
**Should happen:** Hover cursor + visual feedback via `manageHoverState`. `eventsIfTopMost` for clean dedup. Feature-state-based highlight (cheap toggle). Popup composed inside layers. Hover tooltip for preview.

### F05: Drawing — feature vanishes, aggressive auto-dismiss
**User does:** Picks point/line/polygon tool, draws on map
**What goes wrong:** After drawing completes, feature disappears from Terra Draw overlay, then reappears only after server round-trip succeeds. DrawActionRow auto-dismisses after 8 seconds regardless of user intent. No client-side validation (self-intersecting polygons, zero-area). Terra Draw init failure silently leaves toolbar non-functional.
**Should happen:** Optimistic UI (add to hotOverlay immediately, replace on confirm). DrawActionRow stays until user acts. Client-side geometry validation. Surfaced init errors.

### F06: Style Editing — expensive rebuilds, no safety net
**User does:** Opens StylePanel, drags color/opacity sliders
**What goes wrong:** Full paint object rebuild on every reactive cycle (no diff-based updates). No debounce on save — rapid slider changes fire many tRPC mutations. No style undo — once saved, previous style is gone. 4-file FSL bridge chain adds translation overhead.
**Should happen:** Diff-based paint updates. Debounced save (300-500ms). Style revert option. Evaluate whether FSL abstraction earns its cost.

### F07: Filtering — split-brain, ephemeral, incomplete
**User does:** Adds attribute filter in FilterPanel
**What goes wrong:** Dual filtering paths (MapLibre expressions for map, JS `matchesFilter` for DataTable) risk semantic divergence. Field discovery limited to first 100 features — sparse columns invisible. Filters are ephemeral (localStorage only) — not shareable or persistable. No spatial filters. Manual filter expression building instead of composable helpers.
**Should happen:** Single source of truth for filter semantics. Full field discovery. "Save as default filter" writes to `style.filters`. Composable filter helper library.

### F08: Geoprocessing — black box with no preview
**User does:** Picks buffer/intersect/etc, selects layers, clicks Run
**What goes wrong:** No preview of result before committing. No progress reporting — synchronous tRPC, user stares at spinner. 30s timeout is only guard (no pre-flight size check). Tightly coupled to PostGIS — can't preview client-side or unit-test without DB. Output layer has no provenance metadata (what operation produced it).
**Should happen:** Turf.js preview on sample. BullMQ for long operations (like import). Pre-flight feature count warning. Pure-function extraction for testability. Result provenance stored on layer.

### F09: Measurement — trapped in a side panel
**User does:** Switches to Analysis > Measure, draws on map
**What goes wrong:** Results only appear in fixed SidePanel — no floating tooltip near the drawn geometry. Measurement state scattered as local vars in 700+ line MapEditor. "Save as annotation" forces panel switch, losing measurement context. No keyboard shortcut to toggle measurement mode.
**Should happen:** Floating tooltip at geometry midpoint/centroid AND panel stats. Extracted measurement store. In-place annotation save. `M` keyboard shortcut.

### F10: Annotations — monolith, no versioning, no optimism
**User does:** Places annotation pin, fills content editor, saves
**What goes wrong:** AnnotationPanel is ~1200 LOC handling 6 mutations, blob upload, form state, anchor placement, thread rendering, and list management. No annotation schema versioning (content structure can't evolve safely). `contentJson` serialized into GeoJSON properties duplicates data in memory. No optimistic create — pin doesn't appear until server confirms. Measurement→annotation bridge spans 3 files.
**Should happen:** Decomposed panel (form, list, mutations, upload). Versioned content schema. Optimistic pin placement. Centralized annotation-draft store.

### F11: Export — inconsistent surface, no bulk option
**User does:** Clicks Export, picks format and layer
**What goes wrong:** 6 individual boolean loading states instead of one. GET/POST API split for formats is inconsistent. No multi-layer export (one at a time only). No progress for large GeoPackage/Shapefile exports. No server-side annotation export endpoint. PNG export may miss WebGL canvas content.
**Should happen:** Single `exportingFormat` state. Consistent API. "Export All Layers" ZIP. Progress indicator. Unified export surface.

### F12: Panel Navigation — three systems fighting
**User does:** Clicks toolbar buttons to open/close panels
**What goes wrong:** Three parallel panel systems (`activePanelIcon`, `activeSection`, `showDataTable`+`dialogs`) with implicit cross-wiring — clicking Analysis in left rail sets BOTH left and right panel state. Hidden side effect: section changes can transition editor interaction state (ending measurement without warning). Panel state not URL-reflected — refresh resets. SidePanel always 320px with no collapse option.
**Should happen:** Unified `EditorLayout` store. URL-reflected panel state. Explicit interaction-mode transitions with confirmation. Collapsible SidePanel.

### F13: Sharing — no viewport context, heavy viewer
**User does:** Creates share link, sends to someone
**What goes wrong:** Share URL carries no viewport state — recipient always sees owner's last-saved viewport with no way to deeplink a specific view. Token resolution logic duplicated between server load and tRPC. ShareViewerScreen loads full MapEditor (undo, drawing, filters, annotation infrastructure) for a read-only view. Only `public` access level used despite schema supporting others. No link expiration.
**Should happen:** `#zoom/lat/lng` hash in share URLs. Deduplicated token resolution. Lightweight read-only viewer. Expiration option.

### F14: Embedding — scroll-jacks, ships bloat
**User does:** Copies iframe snippet, embeds in external page
**What goes wrong:** No cooperative gestures — embedded map captures scroll events, making it impossible to scroll past on mobile. Two different embed snippets exist (800×600 vs 100%/500). Full MapEditor JS bundle shipped despite most being `{#if !embed}` hidden. `frame-ancestors *` is maximally permissive.
**Should happen:** Cooperative gestures when embedded. Single `generateEmbedSnippet()`. Code-split or dedicated embed component. Configurable frame-ancestors.

### F15: Commenting — split paths, stale, unmoderated
**User does:** Writes comment on a map (authenticated or guest via share link)
**What goes wrong:** Two completely separate code paths for authenticated vs guest (duplicated pagination). No real-time updates — manual refresh to see new comments. Guest comments have no spam protection beyond rate limit. No visual distinction between guest and authenticated comments. Guest comments can't be moderated from share view. No comment editing. Delete returns NOT_FOUND for non-authors (ambiguous).
**Should happen:** Unified comment pipeline with optional auth context. Polling or subscription for live updates. Guest badge. Owner moderation on share view. Edit within time window.

### F16: Collaboration — invitation-only, no feedback
**User does:** Invites collaborator by email
**What goes wrong:** Can't invite unregistered users (throws NOT_FOUND). No accept/decline flow — collaborator is immediately added. Dashboard shows generic "Shared" badge instead of actual role. No email notification. Collaborator can't leave voluntarily. `handleCreate` recursion bug blocks dashboard.
**Should happen:** Pending invitations resolved on signup. Accept/decline UI. Role badge on dashboard cards. Email notification. Self-removal option.

---

## New Flow Opportunities (from references)

### N01: Cluster Exploration Flow
**Trigger:** User imports large point dataset (>1000 features)
**Path:** Map detects high point density → auto-enables clustering → renders circle clusters with counts → user zooms/clicks → clusters expand → individual features with popups
**Reference:** svelte-maplibre `<GeoJSON cluster={...}>` + CircleLayer for clusters + expansion on click

### N02: Rich Marker Flow
**Trigger:** User enables marker mode on a layer
**Path:** Features render as custom HTML markers (icons, badges, mini-cards) → hover highlights → click opens popup/panel
**Reference:** svelte-maplibre `<MarkerLayer>` with Svelte snippet children

### N03: Data Join Flow
**Trigger:** User has polygon layer + uploads CSV with matching key column
**Path:** Key matching UI → preview joined attributes → confirm → choropleth updates with joined values → DataTable shows merged columns
**Reference:** svelte-maplibre `<JoinedData>` for client-side feature+data merge

### N04: Image Overlay Flow
**Trigger:** User uploads georeferenced image or defines bounding box
**Path:** Image renders as map layer → adjustable opacity → draggable/resizable bounds → saves as overlay layer
**Reference:** Allmaps `WarpedMapLayer` (MapLibre CustomLayerInterface + WebGL2) for full GCP warping; svelte-maplibre `<ImageSource>` for simple bounding-box placement
