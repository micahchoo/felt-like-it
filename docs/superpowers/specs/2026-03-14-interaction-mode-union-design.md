# Interaction Mode Discriminated Union

**Date:** 2026-03-14
**Scope:** Local refactor in MapEditor.svelte — replace boolean interaction flags with a discriminated union type.

## Problem

MapEditor.svelte uses ~5 loosely coupled boolean/nullable flags to represent mutually exclusive interaction modes:

- `annotationRegionMode` + `annotationRegionGeometry`
- `featurePickMode` + `pickedFeature`
- `pendingMeasurementAnnotation`
- `activeFeature`

These flags can exist in invalid combinations. `clearInteractionModes(keep?)` manually nulls them with a fragile `keep` parameter — which caused a real bug where `activeFeature` was nullified before `onannotate` could capture it (mx-0e73ff). Additionally, `clearInteractionModes` doesn't clear `pickedFeature` — only `featurePickMode` — leaving stale picked state in some flows (implicit bug the union will fix).

## Solution

Replace all boolean mode flags with a single discriminated union state variable.

### Type Definition

```typescript
// In MapEditor.svelte (local to component)

interface SelectedFeature {
  featureId: string;
  layerId: string;
  geometry: Geometry;
}

interface PickedFeatureRef {
  featureId: string;
  layerId: string;
}

interface MeasurementAnchor {
  type: 'measurement';
  geometry:
    | { type: 'LineString'; coordinates: [number, number][] }
    | { type: 'Polygon'; coordinates: [number, number][][] };
}

interface MeasurementContent {
  type: 'measurement';
  measurementType: 'distance' | 'area';
  value: number;
  unit: string;
  displayValue: string;
}

type InteractionState =
  | { type: 'idle' }
  | { type: 'featureSelected'; feature: SelectedFeature }
  | { type: 'drawRegion'; geometry?: { type: 'Polygon'; coordinates: number[][][] } }
  | { type: 'pickFeature'; picked?: PickedFeatureRef }
  | { type: 'pendingMeasurement'; anchor: MeasurementAnchor; content: MeasurementContent };
```

### State Management

```typescript
// Replaces: annotationRegionMode, annotationRegionGeometry,
//           featurePickMode, pickedFeature,
//           pendingMeasurementAnnotation, activeFeature
let interactionState: InteractionState = $state({ type: 'idle' });

// Replaces clearInteractionModes() — no keep parameter needed
function resetInteraction() {
  interactionState = { type: 'idle' };
}
```

### Transition Table

| From | Event | To | Code location |
|------|-------|----|---------------|
| idle | Feature selected/drawn (selection effect) | featureSelected | L278-291 |
| featureSelected | "Annotate" clicked | idle (with side-effects) | L721-726 |
| featureSelected | "Measure" clicked | idle (with side-effects) | L727-739 |
| featureSelected | "Done" clicked | idle | L740 |
| featureSelected | Drawing tool switch (non-select) | idle | L293-305 |
| idle | "Draw Region" requested (AnnotationPanel) | drawRegion | L820 |
| drawRegion | Region polygon completed (onregiondrawn) | drawRegion (geometry set) | L697 |
| drawRegion | Escape key | idle | L527-532 |
| drawRegion | Cancel button | idle | L709 |
| drawRegion | Sidebar leaves annotations | idle | L258-268 |
| idle | "Pick Feature" requested (AnnotationPanel) | pickFeature | L821 |
| pickFeature | Feature clicked on map | pickFeature (picked set, mode stays for AnnotationPanel to consume) | L307-316 |
| pickFeature | Escape key | idle | L527-532 |
| pickFeature | Cancel button | idle | L714 |
| pickFeature | Sidebar leaves annotations | idle | L258-268 |
| any (with pendingMeasurement) | Annotation saved (onannotationchange) | idle | L808-818 |
| any | Design mode entered | idle | L271-276 |

#### Important flow details

**"Annotate" from DrawActionRow (L721-726):**
Does NOT enter `pickFeature` mode. Instead:
1. Captures `activeFeature` into local const
2. Resets interaction to idle
3. Sets `activeSection = 'annotations'` (navigates sidebar)
4. Sets `pickedFeature` directly from captured feature

In the union model, this means: transition to `{ type: 'pickFeature', picked: { featureId, layerId } }` with `picked` already populated (skip the interactive pick step), plus navigate sidebar.

**"Measure" from DrawActionRow (L727-739):**
Does NOT enter a persistent `pendingMeasurement` mode. Instead:
1. Keeps `activeFeature` via `clearInteractionModes('activeFeature')`
2. Computes measurement from geometry
3. Navigates to analysis tab (`activeSection = 'analysis'`, `analysisTab = 'measure'`)
4. Clears `activeFeature`

In the union model: transition to idle, compute measurement, navigate. The `pendingMeasurement` variant is for a separate flow where the measurement is being saved as an annotation (set from the measure/analysis UI, consumed by AnnotationPanel).

**Feature click during pickFeature (L307-316):**
Sets `picked` AND sets `featurePickMode = false`. In the union model, the `picked` data stays in the variant — AnnotationPanel reads it. We keep `type: 'pickFeature'` with `picked` populated; AnnotationPanel consumes it and calls `onannotationchange` which resets to idle.

**onregiondrawn (L697):**
Sets geometry AND sets `annotationRegionMode = false`. In the union model, keep `type: 'drawRegion'` with `geometry` populated — AnnotationPanel reads it. Same consumption pattern as pickFeature.

**Drawing tool switch (L293-305):**
Clears `activeFeature`. Also has a conditional: does NOT clear `featurePickMode` if tool is 'polygon' AND `annotationRegionMode` is true (user is drawing the annotation region polygon). In the union model: if `interactionState.type === 'drawRegion'` and tool is 'polygon', preserve state.

**onannotationchange (L808-818):**
Resets all annotation interaction state (region, pick, measurement) but does NOT clear `activeFeature`. In the union model: if in `drawRegion`, `pickFeature`, or `pendingMeasurement`, reset to idle. If in `featureSelected`, preserve.

### Derived Values for Children

Children don't see the union — MapEditor derives props:

```typescript
// For MapCanvas — conditional onregiondrawn handler
const onregiondrawn = interactionState.type === 'drawRegion'
  ? (g) => { interactionState = { ...interactionState, geometry: g }; }
  : undefined;

// For AnnotationPanel
const regionGeometry = interactionState.type === 'drawRegion'
  ? interactionState.geometry : undefined;

const pickedFeature = interactionState.type === 'pickFeature'
  ? interactionState.picked : undefined;

const pendingMeasurement = interactionState.type === 'pendingMeasurement'
  ? { anchor: interactionState.anchor, content: interactionState.content } : null;

// For DrawActionRow visibility
const showDrawActionRow = interactionState.type === 'featureSelected'
  && !measureActive;

// For overlay banners
const showRegionBanner = interactionState.type === 'drawRegion';
const showPickBanner = interactionState.type === 'pickFeature' && !interactionState.picked;
```

### Callback Rewrites

```typescript
// DrawActionRow "Annotate" — data moves between variants, no clearing race
onannotate={() => {
  if (interactionState.type === 'featureSelected') {
    const { feature } = interactionState;
    interactionState = {
      type: 'pickFeature',
      picked: { featureId: feature.featureId, layerId: feature.layerId }
    };
    activeSection = 'annotations';
  }
}}

// DrawActionRow "Measure" — compute and navigate, return to idle
onmeasure={() => {
  if (interactionState.type !== 'featureSelected') return;
  const { geometry } = interactionState.feature;
  interactionState = { type: 'idle' };
  if (geometry.type === 'LineString') {
    measureResult = measureLine(geometry.coordinates as [number, number][]);
  } else if (geometry.type === 'Polygon') {
    measureResult = measurePolygon(geometry.coordinates as [number, number][][]);
  }
  activeSection = 'analysis';
  analysisTab = 'measure';
}}

// AnnotationPanel callbacks
onrequestregion={() => {
  interactionState = { type: 'drawRegion' };
  selectionStore.setActiveTool('polygon');
}}

onrequestfeaturepick={() => {
  interactionState = { type: 'pickFeature' };
  selectionStore.setActiveTool('select');
}}

onannotationchange={(action) => {
  // Reset annotation-related modes but preserve featureSelected
  if (interactionState.type !== 'featureSelected') {
    interactionState = { type: 'idle' };
  }
  loadAnnotationPins();
  if (action) logActivity(`annotation.${action}`);
}}

// Escape key
if (e.key === 'Escape') {
  if (interactionState.type === 'drawRegion' || interactionState.type === 'pickFeature') {
    interactionState = { type: 'idle' };
    selectionStore.setActiveTool('select');
    return;
  }
}
```

### Effects Rewrite

```typescript
// Sidebar section change — abandon annotation flows
$effect(() => {
  const section = activeSection;
  if (section !== 'annotations') {
    if (['drawRegion', 'pickFeature', 'pendingMeasurement'].includes(interactionState.type)) {
      interactionState = { type: 'idle' };
    }
  }
});

// Design mode — reset everything
$effect(() => {
  if (designMode) {
    interactionState = { type: 'idle' };
    selectionStore.setActiveTool('select');
  }
});

// Selection → featureSelected (only from idle or featureSelected — don't clobber other modes)
$effect(() => {
  const feat = selectionStore.selectedFeature;
  const lid = selectionStore.selectedLayerId;
  if (feat && lid) {
    const geom = feat.geometry as Geometry | undefined;
    const fid = String(feat.id ?? '');
    if (geom && fid && (interactionState.type === 'idle' || interactionState.type === 'featureSelected')) {
      interactionState = { type: 'featureSelected', feature: { featureId: fid, layerId: lid, geometry: geom } };
    }
  } else if (interactionState.type === 'featureSelected') {
    interactionState = { type: 'idle' };
  }
});

// Drawing tool switch — dismiss featureSelected, preserve drawRegion
$effect(() => {
  const tool = selectionStore.activeTool;
  if (tool && tool !== 'select') {
    if (interactionState.type === 'featureSelected') {
      interactionState = { type: 'idle' };
    }
    // Don't clear drawRegion when tool is 'polygon' (user is drawing the region)
    if (interactionState.type === 'drawRegion' && tool !== 'polygon') {
      interactionState = { type: 'idle' };
    }
  }
});

// Feature pick capture
$effect(() => {
  if (interactionState.type === 'pickFeature' && !interactionState.picked
      && selectionStore.selectedFeature && selectionStore.selectedLayerId) {
    const feat = selectionStore.selectedFeature;
    const fid = String(feat.id ?? '');
    if (fid) {
      interactionState = {
        type: 'pickFeature',
        picked: { featureId: fid, layerId: selectionStore.selectedLayerId }
      };
    }
  }
});
```

## What Stays the Same

- **`InteractionMode` in `map.svelte.ts`** — low-level map cursor/tool mode (separate concern)
- **`selectionStore`** — manages DrawTool and selectedFeature for drawing toolbar
- **Child component interfaces** — MapCanvas, DrawActionRow, AnnotationPanel receive same derived props
- **`scrollToAnnotationFeatureId`** — stays as independent state (not an interaction mode, just a scroll target)
- **`measureResult`** — stays as independent state (computed from geometry, displayed in analysis tab)
- **`measureActive`** — stays as independent state (controls measure tool overlay on MapCanvas)

## What Gets Deleted

- `annotationRegionMode` boolean
- `annotationRegionGeometry` variable
- `featurePickMode` boolean
- `pickedFeature` variable
- `pendingMeasurementAnnotation` variable
- `activeFeature` variable
- `clearInteractionModes(keep?)` function

## Implicit Bug Fixes

- **Stale `pickedFeature`**: Current `clearInteractionModes` clears `featurePickMode` but NOT `pickedFeature`. In the union, `picked` lives inside the `pickFeature` variant — resetting to idle automatically clears it.
- **`onannotate` race condition** (mx-0e73ff): Data moves between variants instead of being cleared and re-read — no window where feature data is null.

### pendingMeasurement Setter

`pendingMeasurementAnnotation` is set by the "Save as annotation" button in the analysis/measure tab (L912-945). Flow:
1. Draw feature → Measure → `measureResult` computed, shown in analysis tab
2. User clicks "Save as annotation" → `pendingMeasurementAnnotation` set from `measureResult` + navigates to annotations sidebar (`activeSection = 'annotations'`)
3. AnnotationPanel consumes it to create the annotation, then `onannotationchange` resets to idle

In the union model, this button transitions: `idle → pendingMeasurement`, then sidebar navigation to annotations.

## Out of Scope

- Extracting interaction state to a separate store file
- Changing child component APIs
- Modifying the low-level `InteractionMode` type in `map.svelte.ts`

## Testing

- Existing tests should continue to pass (no child API changes)
- No new unit tests for the type itself (compiler-enforced mutual exclusivity)
- **Manual verification required** for all flows:
  1. Draw feature → Done
  2. Draw feature → Annotate → annotation created
  3. Draw feature → Measure → result shown in analysis tab
  4. AnnotationPanel → "Draw Region" → draw polygon → annotation created
  5. AnnotationPanel → "Pick Feature" → click feature → annotation created
  6. Escape key during drawRegion and pickFeature
  7. Sidebar navigation away from annotations during drawRegion/pickFeature
  8. Design mode toggle during any active mode

## Risk

Low. Pure refactor — zero bundle cost, no API changes to children, compiler enforces mutual exclusivity. Main risk is missing a transition edge case, mitigated by the comprehensive transition table and manual flow testing checklist.
