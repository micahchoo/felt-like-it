# MapEditor Decomposition Analysis

Deep drill into `apps/web/src/lib/components/map/MapEditor.svelte` — the highest-churn
file (62 commits) and coordination hub for the map editing experience.

## Anatomy

| Metric | Count |
|--------|-------|
| Total lines | 930 |
| Imports | 42 |
| `$state` declarations | 21 |
| `$derived` declarations | 3 |
| `$effect` blocks | 14 |
| Functions/handlers | 15 |
| Child components rendered | 18 |

Not a monolith by accident — it is a **coordination hub**. Most bloat is effects
bridging independent stores, not UI logic.

## Seam Map

Six decomposition seams identified, ordered by extraction safety:

### 1. Status Bar (very low risk)
- **Lines:** ~20
- **State:** None
- **Extraction:** `<MapStatusBar>` child component
- **Dependencies on MapEditor:** viewport coordinates (read-only prop)

### 2. Dialog Visibility (low risk)
- **Lines:** ~30 + 3 `$state`
- **State:** `showImportDialog`, `showExportDialog`, `showShareDialog`
- **Extraction:** `<MapDialogs>` child component wrapping all three dialogs
- **Dependencies on MapEditor:** mapId, layers (props)

### 3. Layer Data Manager (medium risk, highest payoff)
- **Lines:** L141, L289–348
- **State:** `layerData`, `viewportStore`
- **Effects:** `ME:initLayers`, `ME:viewportLoading`
- **Extraction:** `createLayerDataManager()` composable `.svelte.ts`
- **Dependencies:** layersStore, mapStore (map instance for `source.setData`)
- **Risk:** Direct `map.getSource().setData()` call bypasses svelte-maplibre-gl — needs map instance reference

### 4. Interaction Mode Bridge (medium risk, unlocks testability)
- **Lines:** L196–278 (5 effects)
- **Effects:** selectionToFeature, toolDismissFeature, drawRegionBridge, pickFeatureBridge, pendingMeasurementBridge
- **Extraction:** `useInteractionBridge()` composable `.svelte.ts`
- **Dependencies:** interactionModes, selectionStore
- **Risk:** `untrack()` cycle guards — must preserve exact reactive dependency boundaries
- **Payoff:** These 5 effects are the most complex behavioral cluster and currently **untestable** at component level

### 5. Keyboard Shortcuts (low-medium risk)
- **Lines:** L419–464
- **Handlers:** `handleKeydown` (single function with input/textarea guard + key dispatch)
- **Extraction:** `useKeyboardShortcuts()` composable; `<svelte:window>` binding stays in template
- **Dependencies:** undoStore, selectionStore, layersStore, interactionModes
- **Risk:** Input guard logic must stay with the handler

### 6. Viewport Server Save (very low risk)
- **Lines:** L378–398
- **Handlers:** `saveViewport`
- **Extraction:** Move into `mapStore.saveToServer(mapId)` method
- **Dependencies:** mapStore, trpc.maps.update

## Recommended Extraction Order

```
1. StatusBar        — zero risk, self-contained, removes template noise
2. DialogVisibility — removes 3 $state + 3 template blocks
3. LayerDataManager — highest payoff: removes loadLayerData + viewportStore + 2 effects
4. InteractionBridge — unlocks testability for 5 complex effects
5. KeyboardShortcuts — lifts to composable, enables unit testing
6. ViewportSave    — trivial, move to mapStore
```

After extraction: MapEditor drops from ~930 to ~500 LOC — primarily template composition
and the remaining coordination effects that genuinely need the orchestrator context.

## Test Gap Analysis

**Tested at store level:** mapStore, hotOverlay, drawingStore, selectionStore, interactionModes, filterStore, undoStore

**Untested (only testable as composables once extracted):**
- Keyboard shortcut dispatch
- Interaction mode bridge effects (5 effects)
- Feature-drawn → selection flow
- Import-complete layer reload chain
- Filter persistence at component level

The interaction bridge and keyboard handler are the two largest untested behavioral
clusters — both become unit-testable as `.svelte.ts` composables once extracted.

**See also:** [components](components.md) | [behavior](behavior.md) | [subsystems](../subsystems.md)
