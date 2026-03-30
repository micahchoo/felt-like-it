# Drawing Tools -- Components (L5)

## Component Map

```
MapEditor.svelte
  |
  +-- MapCanvas.svelte          (passes props down)
        |
        +-- DrawingToolbar.svelte   (owns Terra Draw lifecycle + save flow)
```

## DrawingToolbar.svelte

**Location:** `apps/web/src/lib/components/map/DrawingToolbar.svelte`
**Lines:** 380

### Internal Structure

| Section | Lines | Responsibility |
|---------|-------|----------------|
| Props interface | 19-36 | `map`, `onfeaturedrawn`, `onmeasured`, `onregiondrawn` |
| State access | 38-39 | `getMapEditorState()`, `useQueryClient()` |
| tRPC mutations | 41-67 | `featureUpsertMutation`, `featureDeleteMutation` |
| Terra Draw init effect | 69-138 | `$effect` — lifecycle, `finish` handler, style.load re-init |
| measureFeature() | 144-152 | LineString/Polygon measurement dispatch |
| saveFeature() | 154-227 | Persist to DB, hot overlay, undo command push |
| Tool-sync effect | 229-268 | `$effect` — sync `activeTool` to Terra Draw mode |
| Escape-key effect | 271-292 | `$effect` — cancel in-progress drawing on Escape |
| isDrawing() / cancelDrawing() | 294-305 | Helper: check Terra Draw mid-draw state |
| handleKeydown() | 308-313 | `svelte:window` Escape handler (redundant with effect) |
| setTool() | 315-337 | User click handler — confirm discard, delegate to state |
| Tool definitions | 339-344 | Static array: select, point, line, polygon |
| Template | 347-379 | Toolbar UI with Tooltip, active state, disabled logic |

### Key Design Decisions

1. **No local state** -- all drawing/interaction state lives in `MapEditorState`. DrawingToolbar reads via `editorState.activeTool`, `editorState.isDrawingReady`, `editorState.drawingInstance`.

2. **Three operational modes** controlled by which callback prop is provided:
   - **Normal draw** (`onfeaturedrawn`): persist geometry to active layer via tRPC
   - **Measurement** (`onmeasured`): compute distance/area, do NOT persist
   - **Region capture** (`onregiondrawn`): capture polygon for annotation, do NOT persist

3. **Terra Draw lifecycle** is split: `MapEditorState.initDrawing()` creates/starts the instance; DrawingToolbar wires the `finish` event handler and manages mode switching.

## MapEditorState (Drawing-Relevant Surface)

**Location:** `apps/web/src/lib/stores/map-editor-state.svelte.ts`

The unified state class that replaced three separate stores. Drawing-relevant members:

| Member | Type | Purpose |
|--------|------|---------|
| `#drawingState` | `DrawingState` (idle/importing/ready/stopped) | Terra Draw lifecycle FSM |
| `#drawingGeneration` | `number` | Generation guard for async init races |
| `#activeTool` | `DrawTool` | Current tool: point/line/polygon/select/null |
| `initDrawing(map)` | async method | Dynamic import + create TerraDraw instance |
| `stopDrawing()` | method | Stop instance, set status to 'stopped' |
| `setActiveTool(tool)` | method | Atomic: set tool + clear selection if draw tool |
| `reset()` | method | Full teardown for component unmount / test isolation |
| `isDrawingReady` | getter | `#drawingState.status === 'ready'` |
| `drawingInstance` | getter | TerraDraw instance or null |

## Stratigraphy: Residual Old-Architecture Patterns

**Old architecture (3 stores + bridge):**
- `stores/drawing.svelte.ts` -- TerraDraw lifecycle
- `stores/selection.svelte.ts` -- feature selection
- `stores/interaction-modes.svelte.ts` -- state machine
- `useInteractionBridge.svelte.ts` -- 5 `$effect` chains synchronizing the 3 stores

**Current state:** All three stores consolidated into `MapEditorState`. Bridge deleted.

**Residual references** (comments only, no functional imports):
- `map-editor-state.test.ts:7` -- comment mentioning old bridge
- `interaction-modes.test.ts:34` -- comment about re-exported types
- `MapEditor.svelte:38,182` -- comments documenting what was replaced

**Verdict:** Clean migration. No functional residue. Comments serve as archaeological markers.
