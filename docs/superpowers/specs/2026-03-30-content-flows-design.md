# Group 2 Content Flows Design — F09, F10, F11

**Date:** 2026-03-30
**Scope:** Measurement (F09), Annotations (F10), Export (F11)
**Parent Design:** `docs/superpowers/specs/2026-03-30-reference-driven-enhancement-design.md`

## Intent

Three content-related flows share a common pattern: state trapped in monolithic components, no real-time feedback during operations, and forced context-switching to complete tasks. This design extracts state into dedicated stores, decomposes monoliths, and adds in-place feedback so users never lose their working context.

## Constraints

- Svelte 5 runes, existing tRPC API surface preserved
- Existing test suite must stay green (839+ tests)
- No breaking changes to component props consumed by MapEditor
- Build on F12 panel navigation (EditorLayout store, collapsible SidePanel)
- Build on F02 SSE progress pattern (EventSource + poll fallback)

---

## Flow Map

### F09: Measurement

**Flow:** User presses M → measures distance/area on map → sees floating tooltip → optionally saves as annotation
**Observable trigger:** `keydown` with `M` key or clicking measurement tool in toolbar
**Observable outcome:** Measurement tooltip appears at geometry centroid; "Save as annotation" creates annotation without panel switch

#### Path

1. `apps/web/src/lib/components/map/MapEditor.svelte` — **[CHANGE SITE]** measurement mode toggle, `measureResult` local state (line 187), `onmeasure` handler (line 728-733), existing `useKeyboardShortcuts` composable (line 334-344)
2. `apps/web/src/lib/components/map/MapCanvas.svelte` — receives `onmeasured` prop, passes measurement geometry back to MapEditor
3. `apps/web/src/lib/components/annotations/AnnotationPanel.svelte` — displays result in analysisTab (current only path)

#### Upstream contract

- MapEditor's `onmeasure` handler receives `{ type: 'distance'|'area', value: number, geometry: GeoJSON.Geometry }` from MapCanvas via prop callback
- Computation uses `measureLine`/`measurePolygon` from `@felt-like-it/geo-engine`

#### Downstream contract

- Measurement result consumed by SidePanel analysisTab (string display)
- Save creates annotation via tRPC mutation

#### Depth justification

**Standard tier** — ≤2 subsystems (MapEditor + AnnotationPanel), architecture docs exist from F12.

---

### F10: Annotations

**Flow:** User clicks pin tool → clicks map → fills annotation form → saves → pin appears on map
**Observable trigger:** Click pin tool in toolbar, then click on map
**Observable outcome:** Pin marker appears at click location with annotation thread accessible via click

#### Path

1. `apps/web/src/lib/components/annotations/AnnotationPanel.svelte` — **[CHANGE SITE]** 1287-line monolith
2. `apps/web/src/lib/server/trpc/routers/annotations.ts` — tRPC mutations (create, update, delete, comment)
3. `apps/web/src/lib/components/map/MapCanvas.svelte` — renders pin markers from annotation GeoJSON via `annotationGeo.pins`

#### Upstream contract

- tRPC mutations: `createAnnotation`, `updateAnnotation`, `deleteAnnotation`, `addComment`, `resolveAnnotation`
- Annotation data shape: `{ id, mapId, lat, lng, title, content, type, resolved, comments[] }`
- Content types: `['text', 'emoji', 'gif', 'image', 'link', 'iiif']` (6 types)
- Pins rendered via `createAnnotationGeoStore` which transforms TanStack Query data into GeoJSON features

#### Downstream contract

- MapCanvas receives annotation GeoJSON features, renders pins at lat/lng positions
- Clicking pin opens annotation thread popup
- Optimistic creates use TanStack Query's `onMutate`/`onError`/`onSettled` pattern (already used for comment mutations)

#### Depth justification

**Standard tier** — 2 subsystems (AnnotationPanel + tRPC router), but AnnotationPanel is a decompose target.

---

### F11: Export

**Flow:** User opens export dialog → selects format → downloads file
**Observable trigger:** Click export button → select format (GeoJSON, GPKG, CSV, etc.)
**Observable outcome:** File downloads to browser; progress indicator for large exports

#### Path

1. `apps/web/src/lib/components/data/ExportDialog.svelte` — **[CHANGE SITE]** 6 boolean loading states
2. `apps/web/src/routes/api/export/[layerId]/+server.ts` — per-format GET endpoints (existing: geojson, gpkg, shp, pdf)
3. `apps/web/src/routes/api/export/annotations/[mapId]/+server.ts` — annotation export

#### Upstream contract

- Layer data available via MapLibre `queryRenderedFeatures` or server-side layer query
- Format selection: GeoJSON, GPKG, CSV, Shapefile, KML, GPX

#### Downstream contract

- Browser receives blob via `Content-Disposition: attachment`
- No persistent server state (export is read-only operation)

#### Depth justification

**Standard tier** — 2 subsystems (ExportDialog + export routes), state unification target.

---

## Design Section 1: F09 Measurement — Floating Tooltip + Keyboard Shortcut

### Problem

Measurement results are trapped in the SidePanel's analysisTab. Users must:

1. Open the processing panel (cross-wired to 'analysis' section)
2. Run a measurement
3. Results appear only in the panel — no visual feedback on the map
4. Saving forces a panel switch to annotations, losing measurement context

### Solution

**1. MeasurementStore class** — Extract `measureResult` local `$state` from MapEditor.svelte:187 into a dedicated store.

```typescript
// apps/web/src/lib/stores/measurement-store.svelte.ts
class MeasurementStore {
  active = $state(false);
  currentResult = $state<MeasurementResult | null>(null);
  history = $state<MeasurementResult[]>([]);

  toggle() {
    this.active = !this.active;
  }
  setResult(result: MeasurementResult) {
    this.currentResult = result;
    this.history.push(result);
  }
  clear() {
    this.currentResult = null;
  }
  saveAsAnnotation(): AnnotationDraft {
    /* convert to annotation draft */
  }
}
```

**2. MeasurementTooltip.svelte** — Floating DOM overlay positioned at geometry centroid. Shows distance (m/km) or area (m²/ha) with a "Save as annotation" button.

**3. M keyboard shortcut** — Add M key to existing `useKeyboardShortcuts` composable in MapEditor (line 334-344), which is already bound via `<svelte:window onkeydown={handleKeydown}>`. Do NOT add a parallel keydown handler.

**4. In-place save** — "Save as annotation" creates annotation via tRPC mutation without switching `editorLayout.rightSection`. The measurement tooltip is replaced with a confirmation toast.

### Files

- **Create:** `apps/web/src/lib/stores/measurement-store.svelte.ts`
- **Create:** `apps/web/src/lib/components/measurements/MeasurementTooltip.svelte`
- **Modify:** `apps/web/src/lib/components/map/MapEditor.svelte` — extract local state to store, add M shortcut to existing `useKeyboardShortcuts`
- **Modify:** `apps/web/src/lib/components/map/MeasurementPanel.svelte` — consume store instead of prop

### Open Questions

- Q: Does MapCanvas already emit measurement events, or does measurement logic live entirely in MapEditor? (assumed MapCanvas has measurement drawing hooks — verify)
- Q: Should measurement history persist across page reloads? (assumed no — session-only)

---

## Design Section 2: F10 Annotations — Decomposition + Optimistic Creates

### Problem

AnnotationPanel.svelte is 1280 lines handling 6 content types, blob upload, form state, anchor placement, thread rendering, comment management, and list rendering. No optimistic create — users wait for server round-trip before seeing their pin.

### Solution

**Decompose into 4 components:**

| Component                | Responsibility                                                                                     | Lines |
| ------------------------ | -------------------------------------------------------------------------------------------------- | ----- |
| `AnnotationPanel.svelte` | Orchestrator — layout, tab switching, store wiring                                                 | ~150  |
| `AnnotationForm.svelte`  | Create/edit form, blob upload, validation                                                          | ~300  |
| `AnnotationList.svelte`  | Virtualized list, filtering, thread preview                                                        | ~200  |
| `AnnotationMutations.ts` | tRPC mutation hooks + TanStack Query cache manipulation (plain TS module, NOT a .svelte component) | ~100  |

**Optimistic pin placement:**

1. User submits annotation form → temporary pin appears immediately on map (local-only ID)
2. tRPC mutation fires in background using TanStack Query's `onMutate` pattern (same pattern already used for comment mutations in AnnotationPanel.svelte:124-131)
3. On success: temporary pin replaced with server-confirmed pin (real ID) via `onSettled` cache update
4. On error: temporary pin removed via `onError` rollback, error toast shown

**MeasurementDraftStore:**

- Lightweight `$state` class that holds annotation form state
- Written to when "Save as annotation" clicked from measurement tooltip
- Read by AnnotationForm when it mounts — pre-fills the form with measurement data
- NOTE: Consolidated with MeasurementStore's `saveAsAnnotation()` — MeasurementDraftStore is NOT a separate store. It is the return type of `saveAsAnnotation()`, a plain data object passed as prop to AnnotationForm.

### Files

- **Create:** `apps/web/src/lib/components/annotations/AnnotationForm.svelte`
- **Create:** `apps/web/src/lib/components/annotations/AnnotationList.svelte`
- **Create:** `apps/web/src/lib/components/annotations/AnnotationMutations.svelte`
- **Create:** `apps/web/src/lib/stores/measurement-draft.svelte.ts`
- **Modify:** `apps/web/src/lib/components/annotations/AnnotationPanel.svelte` — decompose to orchestrator
- **Modify:** `apps/web/src/lib/components/map/MapCanvas.svelte` — accept optimistic pins

### Open Questions

- Q: What are the 6 content types AnnotationPanel handles? (need to verify: pin, region, badge, measurement, comment, thread)
- Q: Does MapCanvas already render annotation pins from a data source, or does AnnotationPanel render them directly? (verify pin rendering path)
- Q: Blob upload for annotation attachments — does it use the same streaming upload endpoint from F02? (assumed yes)

---

## Design Section 3: F11 Export — Unified State + Bulk Export + Progress

### Problem

ExportDialog.svelte (387 lines) has 6 individual boolean loading states (`exportingGeoJSON`, `exportingGpkg`, etc.). One layer at a time. No progress for large exports. No bulk export option.

### Solution

**1. ExportState class** — Single state object replaces 6 booleans:

```typescript
type ExportStatus = 'idle' | 'preparing' | 'exporting' | 'complete' | 'error';
interface ExportState {
  format: ExportFormat | null;
  progress: number; // 0-100
  status: ExportStatus;
  error: string | null;
  layerIds: string[]; // empty = all layers
}
```

**2. Export All Layers** — Checkbox in ExportDialog. When checked, server creates a ZIP archive containing all layers in the selected format.

**3. Progress tracking** — Reuse F02's SSE pattern:

- Server writes export progress to a transient `export_jobs` table (or reuses `import_jobs` with different job type)
- Client subscribes via EventSource to `/api/export/progress?jobId=...`
- Poll fallback on SSE error

**4. Unified API** — Single POST endpoint:

```
POST /api/export
Body: { layerIds: string[], format: ExportFormat, includeAnnotations: boolean }
Response: { jobId: string }  // for SSE tracking
```

Existing GET endpoints (`/api/export/geojson`, etc.) deprecated but kept for backward compatibility.

### Files

- **Create:** `apps/web/src/lib/stores/export-store.svelte.ts`
- **Create:** `apps/web/src/routes/api/export/+server.ts` — unified POST endpoint
- **Create:** `apps/web/src/routes/api/export/progress/+server.ts` — SSE progress
- **Modify:** `apps/web/src/lib/components/data/ExportDialog.svelte` — unified state + bulk UI
- **Modify:** `apps/web/src/routes/api/export/*/+server.ts` — add progress tracking to existing endpoints

### Open Questions

- Q: Should export jobs be persisted in `import_jobs` table (reuse existing SSE infrastructure) or a separate `export_jobs` table? (recommend reuse — same shape: jobId, status, progress, error)
- Q: What's the max file size for server-side ZIP exports? (recommend same 100MB limit as import)
- Q: Do existing GET export endpoints support all 6 formats? (verify format parity between GET and new POST endpoint)

---

## Locked Decisions

1. **MeasurementStore extracted from MapEditor local state** — Measurement state is no longer a local `$state` variable in MapEditor. Rules out keeping measurement as inline state.
2. **AnnotationPanel decomposed into 4 components** — The 1280-line monolith is split. Rules out incremental refactoring of the single file.
3. **Optimistic pin placement for annotations** — Pins appear immediately on submit, confirmed async. Rules out waiting for server round-trip before any visual feedback.
4. **ExportState replaces 6 booleans** — Single state object for all export operations. Rules out keeping per-format loading flags.
5. **Export All Layers via ZIP** — Bulk export produces server-side ZIP. Rules out client-side concatenation of multiple downloads.
6. **SSE progress reused from F02 pattern** — Export progress uses same EventSource + poll fallback pattern. Rules out WebSocket or polling-only approaches.
7. **M keyboard shortcut for measurement** — Global keydown listener toggles measurement mode. Rules out requiring toolbar click to activate.
8. **MeasurementDraftStore bridges measurement→annotation** — Lightweight form state passed between stores. Rules out prop drilling through component tree.

## Alternatives Considered

- **F09: Keep measurement in panel** — Rejected because it forces context-switching (panel open → measure → save → panel switch). Floating tooltip keeps user in map context.
- **F10: Keep AnnotationPanel monolithic** — Rejected because 1280 lines is unmaintainable and blocks adding new annotation types. Each new type currently requires changes throughout the file.
- **F10: WebSocket for optimistic sync** — Rejected because F02 already established SSE pattern. Adding WebSocket just for annotations adds infrastructure complexity for one feature.
- **F11: Client-side bulk export** — Rejected because large datasets would block the main thread during GeoJSON serialization. Server-side ZIP with progress is more scalable.
- **F11: Replace GET endpoints entirely** — Rejected because external consumers may depend on them. Deprecate with backward compatibility instead.

## Open Questions

### F09 Measurement

- Q: Does MapCanvas already emit measurement events, or does measurement logic live entirely in MapEditor? (assumed MapCanvas has measurement drawing hooks — verify by reading MapCanvas.svelte for measurement-related code)
- Q: Should measurement history persist across page reloads? (assumed no — session-only)

### F10 Annotations

- Q: What are the 6 content types AnnotationPanel handles? (need to verify by reading AnnotationPanel.svelte content type enum)
- Q: Does MapCanvas already render annotation pins from a data source, or does AnnotationPanel render them directly? (verify pin rendering path)
- Q: Blob upload for annotation attachments — does it use the same streaming upload endpoint from F02? (assumed yes)

### F11 Export

- Q: Should export jobs reuse `import_jobs` table or create separate `export_jobs` table? (recommend reuse — same shape)
- Q: What's the max file size for server-side ZIP exports? (recommend same 100MB limit as import)
- Q: Do existing GET export endpoints support all 6 formats? (verify format parity)

## Referenced Documents

- `docs/superpowers/specs/2026-03-30-reference-driven-enhancement-design.md` — Parent design with wave ordering
- `apps/web/src/lib/components/map/MapEditor.svelte` — Current measurement state location
- `apps/web/src/lib/components/annotations/AnnotationPanel.svelte` — Decomposition target (1280 lines)
- `apps/web/src/lib/components/data/ExportDialog.svelte` — Export state unification target
- `apps/web/src/lib/components/map/MapCanvas.svelte` — Measurement event source + pin rendering
