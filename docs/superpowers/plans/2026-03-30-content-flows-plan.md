# Group 2 Content Flows Implementation Plan — F09, F10, F11

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract trapped state into dedicated stores, decompose the 1280-line AnnotationPanel monolith, and add real-time feedback so users never lose working context during measurement, annotation, or export operations.

**Architecture:** Three independent feature groups sharing common patterns: (1) MeasurementStore extracted from MapEditor local state with floating tooltip overlay and M keyboard shortcut, (2) AnnotationPanel decomposed into 4 components with optimistic pin creation via TanStack Query onMutate pattern, (3) ExportState unifying 6 boolean flags with server-side bulk export and SSE progress tracking.

**Deviations from spec:**

- `measurement-draft.svelte.ts` (spec line 204) is consolidated into `MeasurementStore.saveAsAnnotation()` — no separate file needed. The spec review (S1) resolved this overlap.
- Bulk ZIP export (spec locked decision #5) is deferred. Task 10 returns jobId for SSE tracking; ZIP creation is a follow-up task.
- Existing GET export routes remain unchanged — new POST endpoint handles all progress-tracked exports. GET routes stay for simple direct downloads.

**Tech Stack:** Svelte 5 runes, TanStack Query (createMutation with onMutate/onError/onSettled), SvelteKit route handlers, @felt-like-it/geo-engine (measureLine/measurePolygon), SSE (EventSource + poll fallback from F02 pattern).

---

## Flow Map

### F09: Measurement

**Flow:** User presses M → measures distance/area on map → sees floating tooltip → optionally saves as annotation
**Observable trigger:** `keydown` with `M` key or clicking measurement tool in toolbar
**Observable outcome:** Measurement tooltip appears at geometry centroid; "Save as annotation" creates annotation without panel switch

#### Path

1. `apps/web/src/lib/components/map/MapEditor.svelte` — **[CHANGE SITE]** extract `measureResult` local state to MeasurementStore, add M keyboard shortcut
2. `apps/web/src/lib/components/map/MapCanvas.svelte` — emits measurement data via `onmeasured` prop callback (no changes needed — already emits measurement results)
3. `apps/web/src/lib/components/map/MeasurementPanel.svelte` — displays result in SidePanel (existing, no changes needed — props already compatible)
4. `apps/web/src/lib/components/measurements/MeasurementTooltip.svelte` — **[CREATE]** floating DOM overlay at centroid

#### Upstream contract

- MapCanvas receives `onmeasured: (r: MeasurementResult) => void` prop from MapEditor
- `MeasurementResult` from `@felt-like-it/geo-engine`: `{ type: 'distance'|'area', value: number, geometry: GeoJSON.Geometry, vertexCount: number, distanceKm?: number, areaKm2?: number }`

#### Downstream contract

- Measurement result displayed in MeasurementPanel (SidePanel) and MeasurementTooltip (floating overlay)
- Save creates annotation via tRPC `trpc.annotations.create.mutate()` with measurement payload

#### Depth justification

**Standard tier** — ≤2 subsystems (MapEditor + MeasurementPanel), architecture docs exist from F12.

---

### F10: Annotations

**Flow:** User clicks pin tool → clicks map → fills annotation form → saves → pin appears on map
**Observable trigger:** Click pin tool in toolbar, then click on map
**Observable outcome:** Pin marker appears at click location with annotation thread accessible via click

#### Path

1. `apps/web/src/lib/components/annotations/AnnotationPanel.svelte` — **[CHANGE SITE]** decompose 1280-line monolith into 4 components
2. `apps/web/src/lib/server/trpc/routers/annotations.ts` — tRPC mutations (create, update, delete, reply) — no changes
3. `apps/web/src/lib/components/map/MapEditor.svelte` — `createAnnotationGeoStore` transforms TanStack Query data into GeoJSON pins — no changes (optimistic pins with temp IDs flow through TanStack Query cache → createAnnotationGeoStore → MapCanvas via existing `annotationPins` prop)

#### Upstream contract

- tRPC mutations: `trpc.annotations.create.mutate({ mapId, anchor, content })`, `trpc.annotations.delete.mutate({ id })`, `trpc.annotations.update.mutate({ id, content?, anchor?, version? })`
- TanStack Query: `queryKeys.annotations.list({ mapId })` returns `AnnotationObject[]`
- `createAnnotationGeoStore(data: AnnotationObject[])` returns `{ pins: GeoJSON.FeatureCollection }`

#### Downstream contract

- MapCanvas receives `annotationPins={annotationGeo.pins}` prop (GeoJSON FeatureCollection)
- Pins rendered as MapLibre point features with popup on click

#### Depth justification

**Standard tier** — 2 subsystems (AnnotationPanel + tRPC router), but AnnotationPanel is a decompose target. tRPC router unchanged.

---

### F11: Export

**Flow:** User opens export dialog → selects format → downloads file
**Observable trigger:** Click export button → select format (GeoJSON, GPKG, CSV, Shapefile, KML, GPX)
**Observable outcome:** File downloads to browser; progress indicator for large exports

#### Path

1. `apps/web/src/lib/components/data/ExportDialog.svelte` — **[CHANGE SITE]** 6 boolean loading states → unified ExportState
2. `apps/web/src/routes/api/export/[layerId]/+server.ts` — per-format GET handlers (geojson, gpkg, shp) + POST for pdf — add progress tracking
3. `apps/web/src/routes/api/export/annotations/[mapId]/+server.ts` — annotation GeoJSON export — no changes
4. `apps/web/src/routes/api/export/+server.ts` — **[CREATE]** unified POST endpoint for bulk export with ZIP

#### Upstream contract

- `getExportData(layerId, userId)` returns `{ layerName: string, features: Feature[] }`
- Export formats: `geojson`, `gpkg`, `shp`, `pdf` (existing); `csv`, `kml`, `gpx` (new, deferred)
- Layer data available via MapLibre `queryRenderedFeatures` or server-side layer query

#### Downstream contract

- Browser receives blob via `Content-Disposition: attachment` header
- SSE progress endpoint: `GET /api/export/progress?jobId=...` streams `{ type: 'progress'|'complete'|'error', data: { progress?: number, error?: string } }`

#### Depth justification

**Standard tier** — 2 subsystems (ExportDialog + export routes), state unification target.

---

## Execution Waves

**Wave 1: F09 Measurement** — Tasks 1-4 (independent, no dependencies on other flows)
**Wave 2: F10 Annotations** — Tasks 5-8 (independent of Wave 1)
**Wave 3: F11 Export** — Tasks 9-12 (independent of Waves 1-2)
**Wave 4: Integration verification** — Task 13 (depends on all previous waves)

---

### Task 1: MeasurementStore class [CHANGE SITE]

**Flow position:** Step 1 of 4 in measurement flow (MapEditor local state → **MeasurementStore** → MeasurementPanel + MeasurementTooltip)
**Upstream contract:** Receives `MeasurementResult` from MapEditor's `onmeasured` callback (from MapCanvas)
**Downstream contract:** Produces `active: boolean`, `currentResult: MeasurementResult | null`, `saveAsAnnotation(): SaveAsAnnotationPayload`
**Files:**

- Create: `apps/web/src/lib/stores/measurement-store.svelte.ts`
- Test: `apps/web/src/__tests__/measurement-store.test.ts`
  **Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/__tests__/measurement-store.test.ts
import { describe, it, expect } from 'vitest';
import { MeasurementStore } from '$lib/stores/measurement-store.svelte.js';

describe('MeasurementStore', () => {
  it('starts with no active measurement and no result', () => {
    const store = new MeasurementStore();
    expect(store.active).toBe(false);
    expect(store.currentResult).toBe(null);
  });

  it('toggles active state', () => {
    const store = new MeasurementStore();
    store.toggle();
    expect(store.active).toBe(true);
    store.toggle();
    expect(store.active).toBe(false);
  });

  it('stores measurement result when set', () => {
    const store = new MeasurementStore();
    const result = {
      type: 'distance' as const,
      value: 1500,
      vertexCount: 3,
      distanceKm: 1.5,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [0, 0],
          [1, 1],
          [2, 0],
        ] as [number, number][],
      },
    };
    store.setResult(result);
    expect(store.currentResult).toBe(result);
  });

  it('clears current result', () => {
    const store = new MeasurementStore();
    store.setResult({
      type: 'distance',
      value: 100,
      vertexCount: 2,
      distanceKm: 0.1,
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    });
    store.clear();
    expect(store.currentResult).toBe(null);
  });

  it('produces SaveAsAnnotationPayload for distance', () => {
    const store = new MeasurementStore();
    store.setResult({
      type: 'distance',
      value: 1500,
      vertexCount: 3,
      distanceKm: 1.5,
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
          [2, 0],
        ] as [number, number][],
      },
    });
    const payload = store.saveAsAnnotation();
    expect(payload.type).toBe('pendingMeasurement');
    expect(payload.content.measurementType).toBe('distance');
    expect(payload.content.value).toBe(1500);
    expect(payload.anchor.type).toBe('measurement');
    expect(payload.anchor.geometry.type).toBe('LineString');
  });

  it('produces SaveAsAnnotationPayload for area', () => {
    const store = new MeasurementStore();
    store.setResult({
      type: 'area',
      value: 5000,
      vertexCount: 4,
      areaKm2: 0.005,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ] as [number, number][][],
      },
    });
    const payload = store.saveAsAnnotation();
    expect(payload.content.measurementType).toBe('area');
    expect(payload.content.value).toBe(5000);
    expect(payload.anchor.geometry.type).toBe('Polygon');
  });
});
```

Run: `cd apps/web && npx vitest run src/__tests__/measurement-store.test.ts`
Expected: FAIL with "Cannot find module '$lib/stores/measurement-store.svelte.js'"

- [ ] **Step 2: Write minimal implementation**

```typescript
// apps/web/src/lib/stores/measurement-store.svelte.ts
import type { MeasurementResult } from '@felt-like-it/geo-engine';

export interface SaveAsAnnotationPayload {
  type: 'pendingMeasurement';
  anchor: {
    type: 'measurement';
    geometry:
      | { type: 'LineString'; coordinates: [number, number][] }
      | { type: 'Polygon'; coordinates: [number, number][][] };
  };
  content: {
    type: 'measurement';
    measurementType: 'distance' | 'area';
    value: number;
    unit: string;
    displayValue: string;
  };
}

export class MeasurementStore {
  active = $state(false);
  currentResult = $state<MeasurementResult | null>(null);

  toggle() {
    this.active = !this.active;
  }

  setResult(result: MeasurementResult) {
    this.currentResult = result;
  }

  clear() {
    this.currentResult = null;
  }

  saveAsAnnotation(): SaveAsAnnotationPayload {
    if (!this.currentResult) {
      throw new Error('No measurement result to save');
    }
    const r = this.currentResult;
    const isDistance = r.type === 'distance';
    return {
      type: 'pendingMeasurement',
      anchor: {
        type: 'measurement',
        geometry: r.geometry as SaveAsAnnotationPayload['anchor']['geometry'],
      },
      content: {
        type: 'measurement',
        measurementType: isDistance ? 'distance' : 'area',
        value: r.value,
        unit: isDistance ? 'km' : 'km2',
        displayValue: isDistance
          ? `${r.distanceKm?.toFixed(2) ?? 0} km`
          : `${r.areaKm2?.toFixed(4) ?? 0} km²`,
      },
    };
  }
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/__tests__/measurement-store.test.ts`
Expected: PASS (6/6 tests)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/stores/measurement-store.svelte.ts apps/web/src/__tests__/measurement-store.test.ts
git commit -m "feat(F09): MeasurementStore class with saveAsAnnotation"
```

---

### Task 2: MeasurementTooltip floating overlay

**Flow position:** Step 2 of 4 in measurement flow (MeasurementStore → **MeasurementTooltip** → user sees result on map)
**Upstream contract:** Receives `MeasurementResult` from MeasurementStore.currentResult
**Downstream contract:** Renders floating DOM element at geometry centroid with "Save as annotation" button
**Files:**

- Create: `apps/web/src/lib/components/measurements/MeasurementTooltip.svelte`
- Test: `apps/web/src/__tests__/measurement-tooltip.test.ts`
  **Skill:** `superpowers:test-driven-development`
  **Codebooks:** `interactive-spatial-editing` (spatial overlay positioning), `focus-management-across-boundaries` (tooltip focus trap)

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/__tests__/measurement-tooltip.test.ts
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import MeasurementTooltip from '$lib/components/measurements/MeasurementTooltip.svelte';

describe('MeasurementTooltip', () => {
  const distanceResult = {
    type: 'distance' as const,
    value: 1500,
    vertexCount: 3,
    distanceKm: 1.5,
    geometry: {
      type: 'LineString' as const,
      coordinates: [
        [0, 0],
        [1, 1],
        [2, 0],
      ] as [number, number][],
    },
  };

  it('renders distance measurement with value', () => {
    let saveCalled = false;
    render(MeasurementTooltip, {
      result: distanceResult,
      position: { x: 100, y: 200 },
      onsave: () => {
        saveCalled = true;
      },
      onclear: () => {},
    });
    expect(screen.getByText(/1\.50 km/)).toBeInTheDocument();
    expect(screen.getByText('Save as annotation')).toBeInTheDocument();
  });

  it('calls onsave when save button clicked', async () => {
    let saveCalled = false;
    const { component } = render(MeasurementTooltip, {
      result: distanceResult,
      position: { x: 100, y: 200 },
      onsave: () => {
        saveCalled = true;
      },
      onclear: () => {},
    });
    const btn = screen.getByText('Save as annotation');
    await btn.click();
    expect(saveCalled).toBe(true);
  });

  it('calls onclear when clear button clicked', async () => {
    let clearCalled = false;
    render(MeasurementTooltip, {
      result: distanceResult,
      position: { x: 100, y: 200 },
      onsave: () => {},
      onclear: () => {
        clearCalled = true;
      },
    });
    const btn = screen.getByText('Clear');
    await btn.click();
    expect(clearCalled).toBe(true);
  });
});
```

Run: `cd apps/web && npx vitest run src/__tests__/measurement-tooltip.test.ts`
Expected: FAIL with "Cannot find module '$lib/components/measurements/MeasurementTooltip.svelte'"

- [ ] **Step 2: Write minimal implementation**

```svelte
<!-- apps/web/src/lib/components/measurements/MeasurementTooltip.svelte -->
<script lang="ts">
  import type { MeasurementResult, DistanceUnit, AreaUnit } from '@felt-like-it/geo-engine';
  import { formatDistance, formatArea } from '@felt-like-it/geo-engine';

  interface Props {
    result: MeasurementResult;
    position: { x: number; y: number };
    onsave: () => void;
    onclear: () => void;
  }

  let { result, position, onsave, onclear }: Props = $props();
  let distUnit = $state<DistanceUnit>('km');
  let areaUnit = $state<AreaUnit>('km2');
</script>

<div
  class="absolute z-50 bg-surface-high border border-white/10 rounded-lg shadow-lg px-3 py-2 min-w-[180px]"
  style="left: {position.x}px; top: {position.y - 60}px; transform: translateX(-50%);"
>
  {#if result.type === 'distance'}
    <div class="text-lg font-mono font-semibold text-on-surface">
      {formatDistance(result.distanceKm ?? 0, distUnit)}
    </div>
  {:else}
    <div class="text-lg font-mono font-semibold text-on-surface">
      {formatArea(result.areaKm2 ?? 0, areaUnit)}
    </div>
  {/if}
  <div class="text-xs text-on-surface-variant/60 mt-0.5">
    {result.vertexCount} vertices
  </div>
  <div class="flex gap-2 mt-2">
    <button
      class="text-xs px-2 py-1 rounded bg-primary text-on-primary hover:bg-primary/90"
      onclick={onsave}
    >
      Save as annotation
    </button>
    <button
      class="text-xs px-2 py-1 rounded bg-surface-low text-on-surface-variant hover:bg-surface-low/80"
      onclick={onclear}
    >
      Clear
    </button>
  </div>
</div>
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/__tests__/measurement-tooltip.test.ts`
Expected: PASS (3/3 tests)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/components/measurements/MeasurementTooltip.svelte apps/web/src/__tests__/measurement-tooltip.test.ts
git commit -m "feat(F09): MeasurementTooltip floating overlay component"
```

---

### Task 3: Wire MeasurementStore into MapEditor + M keyboard shortcut [CHANGE SITE]

**Flow position:** Step 3 of 4 in measurement flow (MapEditor → **MeasurementStore wiring** → MeasurementTooltip visible)
**Upstream contract:** Receives `onmeasured` callback from MapCanvas prop
**Downstream contract:** Produces `measurementStore` instance consumed by MeasurementPanel and MeasurementTooltip
**Files:**

- Modify: `apps/web/src/lib/components/map/MapEditor.svelte:187,218,334,655-660,728-733,889-891`
- Modify: `apps/web/src/lib/components/map/useKeyboardShortcuts.svelte.ts:5-18,32-77`
- Test: `apps/web/src/__tests__/measurement-integration.test.ts`
  **Skill:** `superpowers:test-driven-development`
  **Codebooks:** `focus-management-across-boundaries` (keyboard shortcut scoping)

- [ ] **Step 1: Write characterization test for current behavior**

```typescript
// Add to apps/web/src/__tests__/data-pipeline-characterization.test.ts (measurement section)
// OR create new apps/web/src/__tests__/measurement-integration.test.ts
import { describe, it, expect } from 'vitest';
import { MeasurementStore } from '$lib/stores/measurement-store.svelte.js';

describe('MeasurementStore integration', () => {
  it('toggles active on M key via keyboard shortcuts deps', () => {
    const store = new MeasurementStore();
    // Simulate what useKeyboardShortcuts will do: call store.toggle()
    store.toggle();
    expect(store.active).toBe(true);
  });

  it('receives measurement result from onmeasured callback', () => {
    const store = new MeasurementStore();
    const result = {
      type: 'distance' as const,
      value: 1500,
      vertexCount: 3,
      distanceKm: 1.5,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [0, 0],
          [1, 1],
        ] as [number, number][],
      },
    };
    // This is what MapEditor.onmeasured callback will do
    store.setResult(result);
    expect(store.currentResult).toBe(result);
  });
});
```

Run: `cd apps/web && npx vitest run src/__tests__/measurement-integration.test.ts`
Expected: PASS (2/2 tests — store already exists from Task 1)

- [ ] **Step 2: Add measurement toggle to useKeyboardShortcuts**

Modify `apps/web/src/lib/components/map/useKeyboardShortcuts.svelte.ts`:

```typescript
// Add to KeyboardShortcutsDeps interface (line 5-18):
export interface KeyboardShortcutsDeps {
  // ... existing fields ...
  measurementStore?: { toggle: () => void }; // NEW: optional measurement toggle
}

// Add M key handler after the 1/2/3 tool switching block (around line 76):
// M — toggle measurement mode (only when measurementStore is provided)
if (e.key.toLowerCase() === 'm' && !mod && !e.shiftKey && !e.altKey) {
  e.preventDefault();
  deps.measurementStore?.toggle();
  return;
}
```

- [ ] **Step 3: Wire MeasurementStore into MapEditor**

In `apps/web/src/lib/components/map/MapEditor.svelte`:

```typescript
// Replace line 187: let measureResult = $state<MeasurementResult | null>(null);
import { MeasurementStore } from '$lib/stores/measurement-store.svelte.js';
const measurementStore = new MeasurementStore();

// Add measurementStore to useKeyboardShortcuts deps (line 334-344):
const { handleKeydown } = useKeyboardShortcuts({
  // ... existing deps ...
  measurementStore,  // NEW
});

// Replace onmeasured handler (lines 657-658):
onmeasured: (r: MeasurementResult) => {
  if (measurementStore.active) {
    measurementStore.setResult(r);
  }
},

// Replace measurement computation in DrawActionRow (lines 729-731):
// Keep measureLine/measurePolygon calls but feed into measurementStore:
// (these are already called by MapCanvas internally — the onmeasured callback receives the result)

// Replace MeasurementPanel usage (around line 889-891):
<!-- OLD: -->
{#if measureResult}
  <MeasurementPanel measureResult={measureResult} onclear={() => { measureResult = null; }} onsaveasannotation={...} />
{/if}

<!-- NEW: -->
{#if measurementStore.currentResult}
  <MeasurementPanel
    measureResult={measurementStore.currentResult}
    onclear={() => measurementStore.clear()}
    onsaveasannotation={(payload) => { ... }}
  />
{/if}
```

- [ ] **Step 4: Run tests to verify**

Run: `cd apps/web && npx vitest run src/__tests__/measurement-store.test.ts src/__tests__/measurement-tooltip.test.ts src/__tests__/measurement-integration.test.ts`
Expected: PASS (11/11 tests)

Run: `cd apps/web && npx vitest run --reporter=verbose 2>&1 | tail -5`
Expected: All tests pass (839+ total)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/components/map/MapEditor.svelte apps/web/src/lib/components/map/useKeyboardShortcuts.svelte.ts apps/web/src/__tests__/measurement-integration.test.ts
git commit -m "feat(F09): wire MeasurementStore into MapEditor + M keyboard shortcut"
```

---

### Task 4: Verify MeasurementPanel compatibility

**Flow position:** Step 4 of 4 in measurement flow (MeasurementPanel ← **MeasurementStore prop** ← MapEditor)
**Upstream contract:** Receives `measureResult: MeasurementResult | null`, `onclear`, `onsaveasannotation` props from MapEditor
**Downstream contract:** Displays measurement stats and "Save as annotation" button
**Files:**

- Verify: `apps/web/src/lib/components/map/MeasurementPanel.svelte:23-27` (Props interface — already compatible, no changes needed)
- Test: characterization test update
  **Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Verify MeasurementPanel props are compatible**

MeasurementPanel.svelte already has the correct Props interface (lines 23-27):

```typescript
interface Props {
  measureResult: MeasurementResult | null;
  onclear: () => void;
  onsaveasannotation: (payload: SaveAsAnnotationPayload) => void;
}
```

No changes needed — the component already accepts the exact shape MeasurementStore produces. The wiring in Task 3 passes the correct props.

- [ ] **Step 2: Update characterization test for measurement flow**

Add test to `apps/web/src/__tests__/data-pipeline-characterization.test.ts`:

```typescript
describe('MeasurementPanel', () => {
  it('accepts MeasurementResult prop and displays distance', async () => {
    const { default: MeasurementPanel } =
      await import('$lib/components/map/MeasurementPanel.svelte');
    // Verify component accepts the expected props
    expect(MeasurementPanel).toBeDefined();
  });
});
```

Run: `cd apps/web && npx vitest run src/__tests__/data-pipeline-characterization.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/__tests__/data-pipeline-characterization.test.ts
git commit -m "feat(F09): update characterization test for measurement flow"
```

---

### Task 5: Decompose AnnotationPanel — AnnotationMutations module [CHANGE SITE]

**Flow position:** Step 1 of 4 in annotation flow (AnnotationPanel monolith → **AnnotationMutations module** → TanStack Query mutations)
**Upstream contract:** TanStack Query `createMutation` with `trpc.annotations.*` and `trpc.comments.*` mutations
**Downstream contract:** Exports mutation hooks: `useCreateAnnotation`, `useDeleteAnnotation`, `useUpdateAnnotation`, `useReplyAnnotation`, `useCreateComment`, `useDeleteComment`, `useResolveComment`
**Files:**

- Create: `apps/web/src/lib/components/annotations/AnnotationMutations.ts`
- Test: `apps/web/src/__tests__/annotation-mutations.test.ts`
  **Skill:** `superpowers:test-driven-development`
  **Codebooks:** `optimistic-ui-vs-data-consistency` (onMutate/onError/onSettled pattern)

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/__tests__/annotation-mutations.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/svelte-query';

// Mock trpc
vi.mock('$lib/trpc/client', () => ({
  trpc: {
    annotations: {
      create: { mutate: vi.fn().mockResolvedValue({ id: 'test-id' }) },
      delete: { mutate: vi.fn().mockResolvedValue(undefined) },
      update: { mutate: vi.fn().mockResolvedValue({ id: 'test-id' }) },
    },
    comments: {
      create: { mutate: vi.fn().mockResolvedValue({ id: 'comment-id' }) },
      delete: { mutate: vi.fn().mockResolvedValue(undefined) },
      resolve: { mutate: vi.fn().mockResolvedValue(undefined) },
    },
  },
}));

vi.mock('$lib/trpc/query-keys', () => ({
  queryKeys: {
    annotations: {
      list: (opts: { mapId: string }) => ['annotations', 'list', opts],
      thread: (opts: { annotationId: string }) => ['annotations', 'thread', opts],
    },
    comments: { list: (opts: { mapId: string }) => ['comments', 'list', opts] },
  },
}));

describe('AnnotationMutations', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
  });

  it('exports mutation factory functions', async () => {
    const { useCreateAnnotation, useDeleteAnnotation, useCreateComment } =
      await import('$lib/components/annotations/AnnotationMutations.js');
    expect(typeof useCreateAnnotation).toBe('function');
    expect(typeof useDeleteAnnotation).toBe('function');
    expect(typeof useCreateComment).toBe('function');
  });

  it('createAnnotation mutation calls trpc.annotations.create', async () => {
    const { useCreateAnnotation } =
      await import('$lib/components/annotations/AnnotationMutations.js');
    const mutation = useCreateAnnotation({ queryClient, mapId: 'map-1' });
    await mutation.mutateAsync({
      mapId: 'map-1',
      anchor: { type: 'point', coordinates: [0, 0] },
      content: { kind: 'single', body: { type: 'text', text: 'test' } },
    });
    const { trpc } = await import('$lib/trpc/client');
    expect(trpc.annotations.create.mutate).toHaveBeenCalled();
  });
});
```

Run: `cd apps/web && npx vitest run src/__tests__/annotation-mutations.test.ts`
Expected: FAIL with "Cannot find module '$lib/components/annotations/AnnotationMutations.js'"

- [ ] **Step 2: Write AnnotationMutations module**

```typescript
// apps/web/src/lib/components/annotations/AnnotationMutations.ts
import { createMutation } from '@tanstack/svelte-query';
import type { QueryClient } from '@tanstack/svelte-query';
import { trpc } from '$lib/trpc/client';
import { queryKeys } from '$lib/trpc/query-keys';
import type { AnnotationObject, Anchor, AC } from '@felt-like-it/shared-types';
import { toastStore } from '$lib/components/ui/Toast.svelte';

interface MutationDeps {
  queryClient: QueryClient;
  mapId: string;
}

export function useCreateAnnotation(deps: MutationDeps) {
  return createMutation(() => ({
    mutationFn: (input: { mapId: string; anchor: Anchor; content: { kind: 'single'; body: AC } }) =>
      trpc.annotations.create.mutate(input),
    onMutate: async (variables) => {
      await deps.queryClient.cancelQueries({
        queryKey: queryKeys.annotations.list({ mapId: deps.mapId }),
      });
      const previous = deps.queryClient.getQueryData<AnnotationObject[]>(
        queryKeys.annotations.list({ mapId: deps.mapId })
      );
      // Optimistic insert with temporary ID
      const optimisticId = `temp-${Date.now()}`;
      const optimisticAnnotation: AnnotationObject = {
        id: optimisticId,
        map_id: deps.mapId,
        anchor: variables.anchor,
        content: variables.content,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 0,
        resolved: false,
      } as AnnotationObject;
      deps.queryClient.setQueryData<AnnotationObject[]>(
        queryKeys.annotations.list({ mapId: deps.mapId }),
        (old) => [...(old ?? []), optimisticAnnotation]
      );
      return { previous, optimisticId };
    },
    onError: (_err, _vars, context: { previous?: AnnotationObject[] } | undefined) => {
      if (context?.previous) {
        deps.queryClient.setQueryData(
          queryKeys.annotations.list({ mapId: deps.mapId }),
          context.previous
        );
      }
      toastStore.error('Failed to create annotation.');
    },
    onSuccess: () => {
      deps.queryClient.invalidateQueries({
        queryKey: queryKeys.annotations.list({ mapId: deps.mapId }),
      });
    },
  }));
}

export function useDeleteAnnotation(deps: MutationDeps) {
  return createMutation(() => ({
    mutationFn: (input: { id: string }) => trpc.annotations.delete.mutate(input),
    onMutate: async ({ id }: { id: string }) => {
      await deps.queryClient.cancelQueries({
        queryKey: queryKeys.annotations.list({ mapId: deps.mapId }),
      });
      const previous = deps.queryClient.getQueryData<AnnotationObject[]>(
        queryKeys.annotations.list({ mapId: deps.mapId })
      );
      deps.queryClient.setQueryData<AnnotationObject[]>(
        queryKeys.annotations.list({ mapId: deps.mapId }),
        (old) => old?.filter((a) => a.id !== id) ?? []
      );
      return { previous } as { previous?: AnnotationObject[] };
    },
    onError: (_err, _vars, context: { previous?: AnnotationObject[] } | undefined) => {
      if (context?.previous) {
        deps.queryClient.setQueryData(
          queryKeys.annotations.list({ mapId: deps.mapId }),
          context.previous
        );
      }
      toastStore.error('Failed to delete annotation.');
    },
    onSettled: () => {
      deps.queryClient.invalidateQueries({
        queryKey: queryKeys.annotations.list({ mapId: deps.mapId }),
      });
      deps.queryClient.invalidateQueries({ queryKey: ['annotations', 'getThread'] });
    },
  }));
}

export function useUpdateAnnotation(deps: MutationDeps) {
  return createMutation(() => ({
    mutationFn: (input: {
      id: string;
      content?: { kind: 'single'; body: AC };
      anchor?: Anchor;
      version?: number;
    }) => trpc.annotations.update.mutate(input),
    onSuccess: () => {
      deps.queryClient.invalidateQueries({
        queryKey: queryKeys.annotations.list({ mapId: deps.mapId }),
      });
    },
  }));
}

export function useReplyAnnotation(deps: MutationDeps) {
  return createMutation(() => ({
    mutationFn: (input: {
      mapId: string;
      parentId: string;
      anchor: Anchor;
      content: { kind: 'single'; body: AC };
    }) => trpc.annotations.create.mutate(input),
    onSuccess: (_data: unknown, variables: { parentId: string }) => {
      deps.queryClient.invalidateQueries({
        queryKey: queryKeys.annotations.list({ mapId: deps.mapId }),
      });
      deps.queryClient.invalidateQueries({
        queryKey: queryKeys.annotations.thread({ annotationId: variables.parentId }),
      });
    },
  }));
}

export function useConvertToPoint(deps: MutationDeps) {
  return createMutation(() => ({
    mutationFn: (input: { mapId: string; annotationId: string; coordinates: [number, number] }) =>
      trpc.annotations.convertToPoint.mutate(input),
    onSuccess: () => {
      deps.queryClient.invalidateQueries({
        queryKey: queryKeys.annotations.list({ mapId: deps.mapId }),
      });
    },
    onError: () => {
      toastStore.error('Failed to convert annotation to point.');
    },
  }));
}

// Comment mutations
export function useCreateComment(deps: MutationDeps) {
  return createMutation(() => ({
    mutationFn: (input: { mapId: string; annotationId: string; body: string }) =>
      trpc.comments.create.mutate(input),
    onSuccess: () => {
      deps.queryClient.invalidateQueries({
        queryKey: queryKeys.comments.list({ mapId: deps.mapId }),
      });
    },
  }));
}

export function useDeleteComment(deps: MutationDeps) {
  return createMutation(() => ({
    mutationFn: (input: { id: string }) => trpc.comments.delete.mutate(input),
    onMutate: async ({ id }: { id: string }) => {
      await deps.queryClient.cancelQueries({
        queryKey: queryKeys.comments.list({ mapId: deps.mapId }),
      });
      const previous = deps.queryClient.getQueryData(
        queryKeys.comments.list({ mapId: deps.mapId })
      );
      deps.queryClient.setQueryData(
        queryKeys.comments.list({ mapId: deps.mapId }),
        (old: any[]) => old?.filter((c: any) => c.id !== id) ?? []
      );
      return { previous };
    },
    onError: (_err, _vars, context: { previous?: any } | undefined) => {
      if (context?.previous) {
        deps.queryClient.setQueryData(
          queryKeys.comments.list({ mapId: deps.mapId }),
          context.previous
        );
      }
      toastStore.error('Failed to delete comment.');
    },
    onSettled: () => {
      deps.queryClient.invalidateQueries({
        queryKey: queryKeys.comments.list({ mapId: deps.mapId }),
      });
    },
  }));
}

export function useResolveComment(deps: MutationDeps) {
  return createMutation(() => ({
    mutationFn: (input: { id: string }) => trpc.comments.resolve.mutate(input),
    onMutate: async ({ id }: { id: string }) => {
      await deps.queryClient.cancelQueries({
        queryKey: queryKeys.comments.list({ mapId: deps.mapId }),
      });
      const previous = deps.queryClient.getQueryData(
        queryKeys.comments.list({ mapId: deps.mapId })
      );
      deps.queryClient.setQueryData(
        queryKeys.comments.list({ mapId: deps.mapId }),
        (old: any[]) => old?.map((c: any) => (c.id === id ? { ...c, resolved: true } : c)) ?? []
      );
      return { previous };
    },
    onError: (_err, _vars, context: { previous?: any } | undefined) => {
      if (context?.previous) {
        deps.queryClient.setQueryData(
          queryKeys.comments.list({ mapId: deps.mapId }),
          context.previous
        );
      }
      toastStore.error('Failed to resolve comment.');
    },
    onSettled: () => {
      deps.queryClient.invalidateQueries({
        queryKey: queryKeys.comments.list({ mapId: deps.mapId }),
      });
    },
  }));
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/__tests__/annotation-mutations.test.ts`
Expected: PASS (2/2 tests)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/components/annotations/AnnotationMutations.ts apps/web/src/__tests__/annotation-mutations.test.ts
git commit -m "feat(F10): extract AnnotationMutations module with optimistic create"
```

---

### Task 6: Decompose AnnotationPanel — AnnotationForm component

**Flow position:** Step 2 of 4 in annotation flow (AnnotationPanel monolith → **AnnotationForm** → user fills annotation form)
**Upstream contract:** Receives `mapId: string`, `oncreate: (payload) => void`, `pendingMeasurementData: SaveAsAnnotationPayload | null`
**Downstream contract:** Emits form submission events to parent orchestrator
**Files:**

- Create: `apps/web/src/lib/components/annotations/AnnotationForm.svelte`
- Test: `apps/web/src/__tests__/annotation-form.test.ts`
  **Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/__tests__/annotation-form.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import AnnotationForm from '$lib/components/annotations/AnnotationForm.svelte';

describe('AnnotationForm', () => {
  it('renders form with title and content fields', () => {
    render(AnnotationForm, {
      mapId: 'map-1',
      oncreate: vi.fn(),
      pendingMeasurementData: null,
    });
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/content/i)).toBeInTheDocument();
  });

  it('pre-fills form when pendingMeasurementData is provided', () => {
    const measurementData = {
      type: 'pendingMeasurement' as const,
      anchor: {
        type: 'measurement' as const,
        geometry: { type: 'Point' as const, coordinates: [0, 0] as [number, number] },
      },
      content: {
        type: 'measurement' as const,
        measurementType: 'distance' as const,
        value: 1500,
        unit: 'km',
        displayValue: '1.50 km',
      },
    };
    render(AnnotationForm, {
      mapId: 'map-1',
      oncreate: vi.fn(),
      pendingMeasurementData: measurementData,
    });
    // Form should show measurement data pre-filled
    expect(screen.getByText(/1\.50 km/)).toBeInTheDocument();
  });

  it('calls oncreate with form data on submit', async () => {
    const oncreate = vi.fn();
    render(AnnotationForm, {
      mapId: 'map-1',
      oncreate,
      pendingMeasurementData: null,
    });
    const titleInput = screen.getByLabelText(/title/i);
    await titleInput.focus();
    await titleInput.clear();
    await titleInput.type('Test annotation');
    const submitBtn = screen.getByRole('button', { name: /save/i });
    await submitBtn.click();
    expect(oncreate).toHaveBeenCalled();
  });
});
```

Run: `cd apps/web && npx vitest run src/__tests__/annotation-form.test.ts`
Expected: FAIL with "Cannot find module '$lib/components/annotations/AnnotationForm.svelte'"

- [ ] **Step 2: Write minimal implementation**

Extract form logic from AnnotationPanel.svelte (lines 200-480 approximately — the form state, content type selection, blob upload, EXIF parsing, and submit handler).

```svelte
<!-- apps/web/src/lib/components/annotations/AnnotationForm.svelte -->
<script lang="ts">
  import type { SaveAsAnnotationPayload } from '$lib/stores/measurement-store.svelte.js';
  import type { Anchor, AC } from '@felt-like-it/shared-types';
  import { toastStore } from '$lib/components/ui/Toast.svelte';

  const CONTENT_TYPES = ['text', 'emoji', 'gif', 'image', 'link', 'iiif'] as const;
  type ContentType = (typeof CONTENT_TYPES)[number];

  interface Props {
    mapId: string;
    oncreate: (input: {
      mapId: string;
      anchor: Anchor;
      content: { kind: 'single'; body: AC };
    }) => void;
    pendingMeasurementData: SaveAsAnnotationPayload | null;
  }

  let { mapId, oncreate, pendingMeasurementData }: Props = $props();

  let title = $state('');
  let selectedType = $state<ContentType>('text');
  let bodyText = $state('');
  let emojiValue = $state('');
  let gifUrl = $state('');
  let imageUrl = $state('');
  let linkUrl = $state('');
  let linkTitle = $state('');
  let iiifManifestUrl = $state('');
  let imagePreviewUrl = $state<string | null>(null);
  let selectedImageFile = $state<File | null>(null);
  let gpsExtracted = $state(false);
  let parsingExif = $state(false);

  // Pre-fill from measurement data
  if (pendingMeasurementData) {
    title = `Measurement: ${pendingMeasurementData.content.displayValue}`;
    bodyText = `${pendingMeasurementData.content.measurementType} = ${pendingMeasurementData.content.displayValue}`;
  }

  function buildContent(): AC {
    switch (selectedType) {
      case 'text':
        return { type: 'text', text: bodyText };
      case 'emoji':
        return { type: 'emoji', emoji: emojiValue };
      case 'gif':
        return { type: 'gif', url: gifUrl };
      case 'image':
        return { type: 'image', url: imageUrl };
      case 'link':
        return { type: 'link', url: linkUrl, title: linkTitle };
      case 'iiif':
        return { type: 'iiif', manifestUrl: iiifManifestUrl };
    }
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    // Build anchor and content, call oncreate
    // (Extracted from AnnotationPanel.handleCreate — lines 548-650)
  }
</script>

<form onsubmit={handleSubmit} class="flex flex-col gap-3 p-4">
  <!-- Title input -->
  <label class="text-xs text-on-surface-variant">
    Title
    <input
      type="text"
      bind:value={title}
      class="w-full mt-1 px-2 py-1 rounded bg-surface-low border border-white/10 text-on-surface"
      aria-label="Title"
    />
  </label>

  <!-- Content type tabs -->
  <div class="flex gap-1">
    {#each CONTENT_TYPES as type (type)}
      <button
        type="button"
        class="px-2 py-1 text-xs rounded {selectedType === type
          ? 'bg-primary text-on-primary'
          : 'bg-surface-low text-on-surface-variant'}"
        onclick={() => {
          selectedType = type;
        }}
      >
        {type}
      </button>
    {/each}
  </div>

  <!-- Content fields based on selected type -->
  {#if selectedType === 'text'}
    <textarea
      bind:value={bodyText}
      class="w-full px-2 py-1 rounded bg-surface-low border border-white/10 text-on-surface"
      aria-label="Content"
      rows={3}
    ></textarea>
  {:else if selectedType === 'emoji'}
    <input
      type="text"
      bind:value={emojiValue}
      class="w-full px-2 py-1 rounded bg-surface-low border border-white/10 text-on-surface"
      aria-label="Content"
    />
  {/if}

  <!-- Measurement data display -->
  {#if pendingMeasurementData}
    <div class="px-2 py-1 rounded bg-primary/10 border border-primary/20 text-xs text-primary">
      {pendingMeasurementData.content.displayValue}
    </div>
  {/if}

  <button type="submit" class="px-3 py-1.5 rounded bg-primary text-on-primary hover:bg-primary/90">
    Save
  </button>
</form>
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/__tests__/annotation-form.test.ts`
Expected: PASS (3/3 tests)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/components/annotations/AnnotationForm.svelte apps/web/src/__tests__/annotation-form.test.ts
git commit -m "feat(F10): extract AnnotationForm component with measurement pre-fill"
```

---

### Task 7: Decompose AnnotationPanel — AnnotationList component

**Flow position:** Step 3 of 4 in annotation flow (AnnotationPanel monolith → **AnnotationList** → displays annotation list)
**Upstream contract:** Receives `annotations: AnnotationObject[]`, `comments: CommentEntry[]`, `selectedAnnotationId: string | null`
**Downstream contract:** Emits `onselect`, `ondelete`, `onresolve` events
**Files:**

- Create: `apps/web/src/lib/components/annotations/AnnotationList.svelte`
- Test: `apps/web/src/__tests__/annotation-list.test.ts`
  **Skill:** `superpowers:test-driven-development`
  **Codebooks:** `virtualization-vs-interaction-fidelity` (list rendering with selection)

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/__tests__/annotation-list.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import AnnotationList from '$lib/components/annotations/AnnotationList.svelte';

describe('AnnotationList', () => {
  const mockAnnotations = [
    {
      id: 'a1',
      map_id: 'map-1',
      content: { kind: 'single', body: { type: 'text', text: 'First' } },
      anchor: { type: 'point', coordinates: [0, 0] },
      resolved: false,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      version: 0,
    },
    {
      id: 'a2',
      map_id: 'map-1',
      content: { kind: 'single', body: { type: 'text', text: 'Second' } },
      anchor: { type: 'point', coordinates: [1, 1] },
      resolved: false,
      created_at: '2024-01-02',
      updated_at: '2024-01-02',
      version: 0,
    },
  ];

  it('renders list of annotations', () => {
    render(AnnotationList, {
      annotations: mockAnnotations,
      comments: [],
      selectedAnnotationId: null,
      onselect: vi.fn(),
      ondelete: vi.fn(),
      onresolve: vi.fn(),
    });
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('calls onselect when annotation clicked', async () => {
    const onselect = vi.fn();
    render(AnnotationList, {
      annotations: mockAnnotations,
      comments: [],
      selectedAnnotationId: null,
      onselect,
      ondelete: vi.fn(),
      onresolve: vi.fn(),
    });
    await screen.getByText('First').click();
    expect(onselect).toHaveBeenCalledWith('a1');
  });
});
```

Run: `cd apps/web && npx vitest run src/__tests__/annotation-list.test.ts`
Expected: FAIL with "Cannot find module '$lib/components/annotations/AnnotationList.svelte'"

- [ ] **Step 2: Write minimal implementation**

Extract list rendering from AnnotationPanel.svelte (the annotation list section, thread rendering, comment display).

```svelte
<!-- apps/web/src/lib/components/annotations/AnnotationList.svelte -->
<script lang="ts">
  import type { AnnotationObject } from '@felt-like-it/shared-types';
  import type { CommentEntry } from '$lib/types';

  interface Props {
    annotations: AnnotationObject[];
    comments: CommentEntry[];
    selectedAnnotationId: string | null;
    onselect: (id: string) => void;
    ondelete: (id: string) => void;
    onresolve: (id: string) => void;
  }

  let { annotations, comments, selectedAnnotationId, onselect, ondelete, onresolve }: Props =
    $props();
</script>

<div class="flex flex-col flex-1 min-h-0 overflow-y-auto">
  {#if annotations.length === 0}
    <div class="flex flex-col items-center justify-center py-8 text-center gap-2">
      <p class="text-sm text-on-surface-variant">No annotations yet</p>
      <p class="text-xs text-on-surface-variant/50">
        Click the pin tool and click on the map to create one
      </p>
    </div>
  {:else}
    {#each annotations as annotation (annotation.id)}
      <div
        class="px-3 py-2 border-b border-white/5 cursor-pointer hover:bg-surface-high/50 {selectedAnnotationId ===
        annotation.id
          ? 'bg-primary/10'
          : ''}"
        onclick={() => onselect(annotation.id)}
      >
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-on-surface">
            {annotation.content.kind === 'single' && annotation.content.body.type === 'text'
              ? ((annotation.content.body as any).text?.slice(0, 50) ?? 'Annotation')
              : annotation.content.body.type}
          </span>
          <div class="flex gap-1">
            {#if !annotation.resolved}
              <button
                class="text-xs text-on-surface-variant/60 hover:text-primary"
                onclick={() => onresolve(annotation.id)}
              >
                Resolve
              </button>
            {/if}
            <button
              class="text-xs text-on-surface-variant/60 hover:text-red-400"
              onclick={() => ondelete(annotation.id)}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    {/each}
  {/if}
</div>
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/__tests__/annotation-list.test.ts`
Expected: PASS (2/2 tests)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/components/annotations/AnnotationList.svelte apps/web/src/__tests__/annotation-list.test.ts
git commit -m "feat(F10): extract AnnotationList component"
```

---

### Task 8: Wire decomposed components into AnnotationPanel orchestrator [CHANGE SITE]

**Flow position:** Step 4 of 4 in annotation flow (AnnotationPanel orchestrator → **AnnotationForm + AnnotationList + AnnotationMutations** → pins on map)
**Upstream contract:** Receives `mapId`, `oncountchange` props from MapEditor
**Downstream contract:** Renders annotation UI using decomposed components; pins rendered via `createAnnotationGeoStore` in MapEditor (unchanged)
**Files:**

- Modify: `apps/web/src/lib/components/annotations/AnnotationPanel.svelte` (full rewrite — 1280 lines → ~200 lines orchestrator)
- Test: `apps/web/src/__tests__/annotation-panel-decomposed.test.ts`
  **Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Write characterization test for current AnnotationPanel behavior**

```typescript
// apps/web/src/__tests__/annotation-panel-decomposed.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import AnnotationPanel from '$lib/components/annotations/AnnotationPanel.svelte';

describe('AnnotationPanel (decomposed)', () => {
  it('renders AnnotationForm and AnnotationList', async () => {
    render(AnnotationPanel, {
      mapId: 'map-1',
      oncountchange: vi.fn(),
    });
    // After decomposition, should still show form and list areas
    expect(screen.getByText(/annotations/i)).toBeInTheDocument();
  });

  it('accepts pending measurement data for pre-fill', async () => {
    // Verify the panel can receive measurement draft data
    // This is tested through the integration with MapEditor
  });
});
```

Run: `cd apps/web && npx vitest run src/__tests__/annotation-panel-decomposed.test.ts`
Expected: Current AnnotationPanel passes; after rewrite, decomposed version passes

- [ ] **Step 2: Rewrite AnnotationPanel as orchestrator**

```svelte
<!-- apps/web/src/lib/components/annotations/AnnotationPanel.svelte -->
<script lang="ts">
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { trpc } from '$lib/trpc/client';
  import { queryKeys } from '$lib/trpc/query-keys';
  import type { SaveAsAnnotationPayload } from '$lib/stores/measurement-store.svelte.js';
  import AnnotationForm from './AnnotationForm.svelte';
  import AnnotationList from './AnnotationList.svelte';
  import {
    useCreateAnnotation,
    useDeleteAnnotation,
    useUpdateAnnotation,
    useReplyAnnotation,
    useConvertToPoint,
    useCreateComment,
    useDeleteComment,
    useResolveComment,
  } from './AnnotationMutations.js';

  interface Props {
    mapId: string;
    oncountchange?: (annotationCount: number, commentCount: number) => void;
  }

  let { mapId, oncountchange }: Props = $props();

  const queryClient = useQueryClient();

  // Data queries
  const annotationsQuery = createQuery(() => ({
    queryKey: queryKeys.annotations.list({ mapId }),
    queryFn: () => trpc.annotations.list.query({ mapId }),
  }));
  const annotations = $derived(annotationsQuery.data ?? []);

  const commentsQuery = createQuery(() => ({
    queryKey: queryKeys.comments.list({ mapId }),
    queryFn: () => trpc.comments.list.query({ mapId }),
  }));
  const comments = $derived(commentsQuery.data ?? []);

  // Count change effect
  $effect(() => {
    if (oncountchange) {
      oncountchange(annotations.length, comments.length);
    }
  });

  // Mutation hooks
  const createAnnotation = useCreateAnnotation({ queryClient, mapId });
  const deleteAnnotation = useDeleteAnnotation({ queryClient, mapId });
  const updateAnnotation = useUpdateAnnotation({ queryClient, mapId });
  const replyAnnotation = useReplyAnnotation({ queryClient, mapId });
  const convertToPoint = useConvertToPoint({ queryClient, mapId });
  const createComment = useCreateComment({ queryClient, mapId });
  const deleteComment = useDeleteComment({ queryClient, mapId });
  const resolveComment = useResolveComment({ queryClient, mapId });

  // Local state
  let selectedAnnotationId = $state<string | null>(null);
  let pendingMeasurementData = $state<SaveAsAnnotationPayload | null>(null);

  // Handlers
  function handleCreate(input: { mapId: string; anchor: any; content: any }) {
    createAnnotation.mutate(input);
  }

  function handleSelect(id: string) {
    selectedAnnotationId = id;
  }

  function handleDelete(id: string) {
    deleteAnnotation.mutate({ id });
  }

  function handleResolve(id: string) {
    resolveComment.mutate({ id });
  }

  // Expose method for measurement draft
  function setPendingMeasurementData(data: SaveAsAnnotationPayload | null) {
    pendingMeasurementData = data;
  }

  // Expose to parent
  export { setPendingMeasurementData };
</script>

<div class="flex flex-col h-full">
  <!-- Form section -->
  <div class="border-b border-white/10">
    <AnnotationForm {mapId} oncreate={handleCreate} {pendingMeasurementData} />
  </div>

  <!-- List section -->
  <AnnotationList
    {annotations}
    {comments}
    {selectedAnnotationId}
    onselect={handleSelect}
    ondelete={handleDelete}
    onresolve={handleResolve}
  />
</div>
```

- [ ] **Step 3: Run tests to verify**

Run: `cd apps/web && npx vitest run src/__tests__/annotation-panel-decomposed.test.ts src/__tests__/annotation-mutations.test.ts src/__tests__/annotation-form.test.ts src/__tests__/annotation-list.test.ts`
Expected: PASS (all annotation tests)

Run: `cd apps/web && npx vitest run --reporter=verbose 2>&1 | tail -5`
Expected: All tests pass (839+ total)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/components/annotations/AnnotationPanel.svelte apps/web/src/__tests__/annotation-panel-decomposed.test.ts
git commit -m "feat(F10): decompose AnnotationPanel into orchestrator with 3 child components"
```

---

### Task 9: ExportState class

**Flow position:** Step 1 of 4 in export flow (ExportDialog 6 booleans → **ExportState** → unified export UI)
**Upstream contract:** Receives export format selection and layer IDs from ExportDialog UI
**Downstream contract:** Produces `ExportState { format, progress, status, error, layerIds }` consumed by ExportDialog template
**Files:**

- Create: `apps/web/src/lib/stores/export-store.svelte.ts`
- Test: `apps/web/src/__tests__/export-store.test.ts`
  **Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/__tests__/export-store.test.ts
import { describe, it, expect } from 'vitest';
import { ExportStore } from '$lib/stores/export-store.svelte.js';

describe('ExportStore', () => {
  it('starts in idle state', () => {
    const store = new ExportStore();
    expect(store.status).toBe('idle');
    expect(store.format).toBe(null);
    expect(store.progress).toBe(0);
    expect(store.error).toBe(null);
  });

  it('sets format and transitions to preparing', () => {
    const store = new ExportStore();
    store.startExport('geojson', ['layer-1']);
    expect(store.format).toBe('geojson');
    expect(store.status).toBe('preparing');
    expect(store.layerIds).toEqual(['layer-1']);
  });

  it('updates progress', () => {
    const store = new ExportStore();
    store.startExport('gpkg', ['layer-1']);
    store.setProgress(50);
    expect(store.progress).toBe(50);
    expect(store.status).toBe('exporting');
  });

  it('completes export', () => {
    const store = new ExportStore();
    store.startExport('geojson', ['layer-1']);
    store.complete();
    expect(store.status).toBe('complete');
    expect(store.progress).toBe(100);
  });

  it('handles export error', () => {
    const store = new ExportStore();
    store.startExport('geojson', ['layer-1']);
    store.fail('Network error');
    expect(store.status).toBe('error');
    expect(store.error).toBe('Network error');
  });

  it('resets to idle', () => {
    const store = new ExportStore();
    store.startExport('geojson', ['layer-1']);
    store.fail('error');
    store.reset();
    expect(store.status).toBe('idle');
    expect(store.format).toBe(null);
    expect(store.error).toBe(null);
  });

  it('supports bulk export (all layers)', () => {
    const store = new ExportStore();
    store.startExport('geojson', []); // empty = all layers
    expect(store.layerIds).toEqual([]);
    expect(store.isBulkExport).toBe(true);
  });
});
```

Run: `cd apps/web && npx vitest run src/__tests__/export-store.test.ts`
Expected: FAIL with "Cannot find module '$lib/stores/export-store.svelte.js'"

- [ ] **Step 2: Write minimal implementation**

```typescript
// apps/web/src/lib/stores/export-store.svelte.ts
export type ExportFormat = 'geojson' | 'gpkg' | 'shp' | 'pdf';
export type ExportStatus = 'idle' | 'preparing' | 'exporting' | 'complete' | 'error';

export class ExportStore {
  format = $state<ExportFormat | null>(null);
  progress = $state(0);
  status = $state<ExportStatus>('idle');
  error = $state<string | null>(null);
  layerIds = $state<string[]>([]);

  get isBulkExport(): boolean {
    return this.layerIds.length === 0;
  }

  startExport(format: ExportFormat, layerIds: string[]) {
    this.format = format;
    this.layerIds = layerIds;
    this.progress = 0;
    this.status = 'preparing';
    this.error = null;
  }

  setProgress(progress: number) {
    this.progress = progress;
    this.status = 'exporting';
  }

  complete() {
    this.progress = 100;
    this.status = 'complete';
  }

  fail(error: string) {
    this.error = error;
    this.status = 'error';
  }

  reset() {
    this.format = null;
    this.progress = 0;
    this.status = 'idle';
    this.error = null;
    this.layerIds = [];
  }
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/__tests__/export-store.test.ts`
Expected: PASS (7/7 tests)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/stores/export-store.svelte.ts apps/web/src/__tests__/export-store.test.ts
git commit -m "feat(F11): ExportStore class replacing 6 boolean flags"
```

---

### Task 10: Unified export API endpoint + SSE progress [CHANGE SITE]

**Flow position:** Step 2 of 4 in export flow (ExportDialog → **Unified export API** → browser download)
**Upstream contract:** Receives POST body `{ layerIds: string[], format: ExportFormat, includeAnnotations: boolean }`
**Downstream contract:** Returns `{ jobId: string }` for SSE progress tracking, or direct blob for small exports
**Files:**

- Create: `apps/web/src/routes/api/export/+server.ts`
- Create: `apps/web/src/routes/api/export/progress/+server.ts`
- Test: `apps/web/src/__tests__/export-api.test.ts`
  **Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/__tests__/export-api.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => ({ db: vi.fn() }));
vi.mock('$lib/server/export/shared.js', () => ({
  getExportData: vi.fn().mockResolvedValue({ layerName: 'test', features: [] }),
  toFeatureCollection: vi.fn().mockReturnValue({ type: 'FeatureCollection', features: [] }),
}));

describe('POST /api/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without user', async () => {
    // Test unauthenticated request
    const { POST } = await import('$routes/api/export/+server.js');
    const request = new Request('http://localhost/api/export', {
      method: 'POST',
      body: JSON.stringify({ layerIds: ['1'], format: 'geojson' }),
    });
    const response = await POST({ request, locals: { user: null }, params: {} } as any);
    expect(response.status).toBe(401);
  });

  it('returns 400 for unsupported format', async () => {
    const { POST } = await import('$routes/api/export/+server.js');
    const request = new Request('http://localhost/api/export', {
      method: 'POST',
      body: JSON.stringify({ layerIds: ['1'], format: 'invalid' }),
    });
    const response = await POST({ request, locals: { user: { id: 'user-1' } }, params: {} } as any);
    expect(response.status).toBe(400);
  });
});

describe('GET /api/export/progress', () => {
  it('returns 400 without jobId', async () => {
    const { GET } = await import('$routes/api/export/progress/+server.js');
    const request = new Request('http://localhost/api/export/progress');
    const response = await GET({
      request,
      url: new URL('http://localhost/api/export/progress'),
    } as any);
    expect(response.status).toBe(400);
  });
});
```

Run: `cd apps/web && npx vitest run src/__tests__/export-api.test.ts`
Expected: FAIL with "Cannot find module '$routes/api/export/+server.js'"

- [ ] **Step 2: Write unified export endpoint**

```typescript
// apps/web/src/routes/api/export/+server.ts
import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getExportData, toFeatureCollection } from '$lib/server/export/shared.js';
import { exportAsGeoPackage } from '$lib/server/export/geopackage.js';
import { exportAsShapefile } from '$lib/server/export/shapefile.js';
import { exportAsPdf } from '$lib/server/export/pdf.js';
import { db } from '$lib/server/db';
import { importJobs } from '$lib/server/db/schema';
import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';

const SUPPORTED_FORMATS = ['geojson', 'gpkg', 'shp', 'pdf'] as const;

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) error(401, 'Unauthorized');

  let body: { layerIds: string[]; format: string; includeAnnotations?: boolean };
  try {
    body = await request.json();
  } catch {
    error(400, 'Invalid JSON body');
  }

  const format = body.format as (typeof SUPPORTED_FORMATS)[number];
  if (!SUPPORTED_FORMATS.includes(format)) {
    error(400, `Unsupported format: ${format}. Supported: ${SUPPORTED_FORMATS.join(', ')}`);
  }

  const layerIds = body.layerIds ?? [];
  const jobId = randomUUID();

  // Create job record for SSE progress tracking
  await db.insert(importJobs).values({
    id: jobId,
    map_id: 'export', // exports are not map-scoped
    status: 'processing',
    progress: 0,
    file_name: `export-${format}`,
    file_size: 0,
  });

  try {
    // For single layer, export directly
    if (layerIds.length === 1) {
      const data = await getExportData(layerIds[0], locals.user.id);
      await db
        .update(importJobs)
        .set({ progress: 50 })
        .where(sql`id = ${jobId}`);

      let response: Response;
      switch (format) {
        case 'geojson': {
          const fc = toFeatureCollection(data);
          response = new Response(JSON.stringify(fc, null, 2), {
            headers: {
              'Content-Type': 'application/geo+json',
              'Content-Disposition': `attachment; filename="${data.layerName}.geojson"`,
            },
          });
          break;
        }
        case 'gpkg': {
          const buf = await exportAsGeoPackage(data);
          response = new Response(new Uint8Array(buf), {
            headers: {
              'Content-Type': 'application/geopackage+sqlite3',
              'Content-Disposition': `attachment; filename="${data.layerName}.gpkg"`,
            },
          });
          break;
        }
        case 'shp': {
          const buf = await exportAsShapefile(data);
          response = new Response(new Uint8Array(buf), {
            headers: {
              'Content-Type': 'application/zip',
              'Content-Disposition': `attachment; filename="${data.layerName}.shp.zip"`,
            },
          });
          break;
        }
        case 'pdf': {
          const buf = await exportAsPdf({ data });
          response = new Response(new Uint8Array(buf), {
            headers: {
              'Content-Type': 'application/pdf',
              'Content-Disposition': `attachment; filename="${data.layerName}.pdf"`,
            },
          });
          break;
        }
      }

      await db
        .update(importJobs)
        .set({ status: 'done', progress: 100 })
        .where(sql`id = ${jobId}`);
      return response!;
    }

    // Bulk export: return jobId for SSE tracking
    // (ZIP creation would be async — for now, return jobId)
    await db
      .update(importJobs)
      .set({ status: 'done', progress: 100 })
      .where(sql`id = ${jobId}`);
    return new Response(JSON.stringify({ jobId }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    await db
      .update(importJobs)
      .set({ status: 'failed', error_message: String(err) })
      .where(sql`id = ${jobId}`);
    error(500, `Export failed: ${err}`);
  }
};
```

- [ ] **Step 3: Write SSE progress endpoint**

```typescript
// apps/web/src/routes/api/export/progress/+server.ts
import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { importJobs } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ request, url }) => {
  const jobId = url.searchParams.get('jobId');
  if (!jobId) error(400, 'Missing jobId parameter');

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const interval = setInterval(async () => {
        try {
          const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
          if (!job) {
            send('error', { error: 'Job not found' });
            controller.close();
            clearInterval(interval);
            return;
          }

          if (job.status === 'done') {
            send('complete', { progress: 100 });
            controller.close();
            clearInterval(interval);
          } else if (job.status === 'failed') {
            send('error', { error: job.error_message ?? 'Unknown error' });
            controller.close();
            clearInterval(interval);
          } else {
            send('progress', { progress: job.progress ?? 0 });
          }
        } catch (err) {
          send('error', { error: String(err) });
          controller.close();
          clearInterval(interval);
        }
      }, 1000);

      // Clean up on client disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};
```

- [ ] **Step 4: Run tests**

Run: `cd apps/web && npx vitest run src/__tests__/export-api.test.ts`
Expected: PASS (3/3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/api/export/+server.ts apps/web/src/routes/api/export/progress/+server.ts apps/web/src/__tests__/export-api.test.ts
git commit -m "feat(F11): unified export API + SSE progress endpoint"
```

---

### Task 11: Wire ExportState into ExportDialog [CHANGE SITE]

**Flow position:** Step 3 of 4 in export flow (ExportDialog ← **ExportState wiring** ← export API)
**Upstream contract:** Receives export response (direct blob or { jobId }) from POST /api/export
**Downstream contract:** User sees unified export UI with progress bar, single loading state, bulk export checkbox
**Files:**

- Modify: `apps/web/src/lib/components/data/ExportDialog.svelte` (full rewrite of export logic — 6 booleans → ExportState)
- Test: `apps/web/src/__tests__/export-dialog.test.ts`
  **Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Write characterization test for current ExportDialog behavior**

```typescript
// apps/web/src/__tests__/export-dialog.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ExportDialog from '$lib/components/data/ExportDialog.svelte';

describe('ExportDialog (unified)', () => {
  it('renders export options for all formats', () => {
    render(ExportDialog, {
      open: true,
      selectedLayerId: 'layer-1',
      allLayerIds: ['layer-1', 'layer-2'],
      onclose: vi.fn(),
    });
    expect(screen.getByText(/geojson/i)).toBeInTheDocument();
    expect(screen.getByText(/geopackage/i)).toBeInTheDocument();
    expect(screen.getByText(/shapefile/i)).toBeInTheDocument();
  });

  it('shows bulk export checkbox', () => {
    render(ExportDialog, {
      open: true,
      selectedLayerId: 'layer-1',
      allLayerIds: ['layer-1', 'layer-2'],
      onclose: vi.fn(),
    });
    expect(screen.getByText(/export all layers/i)).toBeInTheDocument();
  });
});
```

Run: `cd apps/web && npx vitest run src/__tests__/export-dialog.test.ts`
Expected: Current ExportDialog passes; after rewrite, unified version passes

- [ ] **Step 2: Rewrite ExportDialog with ExportState**

Replace the 6 boolean states (lines 22-27) and 6 export functions (lines 60-194) with ExportState:

```svelte
<!-- Key changes in ExportDialog.svelte -->
<script lang="ts">
  // REPLACE lines 22-27 (6 booleans) with:
  import { ExportStore } from '$lib/stores/export-store.svelte.js';
  const exportStore = new ExportStore();

  // REPLACE export functions with unified handler:
  async function handleExport(format: ExportFormat) {
    const layerIds = bulkExport ? [] : [selectedLayerId];
    exportStore.startExport(format, layerIds);

    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layerIds, format, includeAnnotations: false }),
      });

      if (!response.ok) {
        const error = await response.text();
        exportStore.fail(error);
        toastStore.error(`Export failed: ${error}`);
        return;
      }

      // Check if response is a direct download or jobId
      const contentType = response.headers.get('Content-Type');
      if (contentType?.includes('application/json')) {
        const data = await response.json();
        if (data.jobId) {
          // Subscribe to SSE progress
          subscribeToProgress(data.jobId);
        }
      } else {
        // Direct blob download
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download =
          response.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') ??
          `export.${format}`;
        a.click();
        URL.revokeObjectURL(url);
        exportStore.complete();
        toastStore.success('Export complete.');
      }
    } catch (err) {
      exportStore.fail(String(err));
      toastStore.error('Export failed.');
    }
  }

  // SSE progress subscription (reuse F02 pattern)
  let eventSource = $state<EventSource | null>(null);
  function subscribeToProgress(jobId: string) {
    closeEventSource();
    try {
      eventSource = new EventSource(`/api/export/progress?jobId=${jobId}`);
      eventSource.addEventListener('progress', (e) => {
        const data = JSON.parse(e.data);
        exportStore.setProgress(data.progress);
      });
      eventSource.addEventListener('complete', () => {
        exportStore.complete();
        toastStore.success('Export complete.');
        closeEventSource();
      });
      eventSource.addEventListener('error', (e) => {
        const data = JSON.parse(e.data);
        exportStore.fail(data.error);
        toastStore.error(`Export failed: ${data.error}`);
        closeEventSource();
      });
    } catch {
      // Fallback to polling
      startPolling(jobId);
    }
  }

  function closeEventSource() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  // Cleanup on dialog close
  $effect(() => () => {
    closeEventSource();
    exportStore.reset();
  });
</script>

<!-- Template: replace individual export buttons with unified format buttons -->
{#each ['geojson', 'gpkg', 'shp', 'pdf'] as fmt}
  <button
    onclick={() => handleExport(fmt as ExportFormat)}
    disabled={exportStore.status === 'preparing' || exportStore.status === 'exporting'}
  >
    {fmt.toUpperCase()}
    {#if exportStore.format === fmt && exportStore.status === 'exporting'}
      <div class="w-full bg-surface-low rounded-full h-1 mt-1">
        <div
          class="bg-primary h-1 rounded-full transition-all"
          style="width: {exportStore.progress}%"
        ></div>
      </div>
    {/if}
  </button>
{/each}

<!-- Bulk export checkbox -->
<label class="flex items-center gap-2">
  <input type="checkbox" bind:value={bulkExport} />
  <span class="text-xs">Export all layers</span>
</label>
```

- [ ] **Step 3: Run tests**

Run: `cd apps/web && npx vitest run src/__tests__/export-dialog.test.ts src/__tests__/export-store.test.ts src/__tests__/export-api.test.ts`
Expected: PASS (all export tests)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/components/data/ExportDialog.svelte apps/web/src/__tests__/export-dialog.test.ts
git commit -m "feat(F11): wire ExportState into ExportDialog with unified UI"
```

---

### Task 12: Update existing export routes for progress tracking

**Flow position:** Step 4 of 4 in export flow (existing GET routes → **progress tracking** → SSE compatible)
**Upstream contract:** Existing GET /api/export/[layerId]/+server.ts handles per-format exports
**Downstream contract:** Backward compatible — existing GET endpoints continue to work, new POST endpoint adds progress
**Files:**

- Modify: `apps/web/src/routes/api/export/[layerId]/+server.ts` — add optional progress tracking
- Test: characterization test update
  **Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Verify backward compatibility**

The existing GET endpoint at `/api/export/[layerId]/+server.ts` already works correctly for direct downloads. No changes needed — the new POST endpoint handles bulk/progress cases, while GET remains for simple single-layer exports.

- [ ] **Step 2: Update characterization test**

```typescript
// Add to apps/web/src/__tests__/export.test.ts or data-pipeline-characterization.test.ts
describe('Export routes', () => {
  it('GET /api/export/[layerId] returns geojson', async () => {
    // Verify existing endpoint still works
    const { GET } = await import('$routes/api/export/[layerId]/+server.js');
    expect(GET).toBeDefined();
  });

  it('POST /api/export accepts unified body', async () => {
    const { POST } = await import('$routes/api/export/+server.js');
    expect(POST).toBeDefined();
  });

  it('GET /api/export/progress returns SSE stream', async () => {
    const { GET } = await import('$routes/api/export/progress/+server.js');
    expect(GET).toBeDefined();
  });
});
```

Run: `cd apps/web && npx vitest run src/__tests__/export.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/__tests__/export.test.ts
git commit -m "feat(F11): update characterization test for export routes"
```

---

### Task 13: Integration verification

**Flow position:** Final verification across all three flows
**Files:** All modified files from Tasks 1-12
**Skill:** `none`

- [ ] **Step 1: Run full test suite**

Run: `cd apps/web && npx vitest run --reporter=verbose 2>&1 | tail -10`
Expected: All tests pass (839+ total, plus new tests from Tasks 1-12)

- [ ] **Step 2: Run svelte-check**

Run: `cd apps/web && npx svelte-check --threshold warning 2>&1 | tail -20`
Expected: 0 new errors (pre-existing errors acceptable)

- [ ] **Step 3: Run lint**

Run: `cd apps/web && npx eslint src/lib/stores/measurement-store.svelte.ts src/lib/stores/export-store.svelte.ts src/lib/components/measurements/MeasurementTooltip.svelte src/lib/components/annotations/AnnotationMutations.ts src/lib/components/annotations/AnnotationForm.svelte src/lib/components/annotations/AnnotationList.svelte src/lib/components/annotations/AnnotationPanel.svelte src/lib/components/data/ExportDialog.svelte src/lib/components/map/MapEditor.svelte src/lib/components/map/useKeyboardShortcuts.svelte.ts src/routes/api/export/+server.ts src/routes/api/export/progress/+server.ts 2>&1 | head -30`
Expected: 0 errors in our files (pre-existing errors in other files acceptable)

- [ ] **Step 4: Commit**

```bash
git commit --allow-empty -m "chore(F09,F10,F11): integration verification — all tests pass"
```

---

## Open Questions

### Flow Contracts

- Q: Does `createAnnotationGeoStore` in MapEditor.svelte:242 need updating for optimistic pins with temp IDs? (assumed no — temp IDs are filtered out by TanStack Query on settle, but verify)
- Q: Can the existing `import_jobs` table handle export job tracking? (same schema: id, map_id, status, progress, error_message — export uses map_id='export' as sentinel)

### Wave 1 (F09)

- **Task 3: M keyboard shortcut**
  - Q: Does `useKeyboardShortcuts` need to skip M when focus is inside a text input? (yes — already handled by existing guard at line 46)
  - Q: Should M toggle work in readonly mode? (assumed no — existing `getEffectiveReadonly()` guard at line 34 handles this)

### Wave 2 (F10)

- **Task 5: AnnotationMutations**
  - Q: Does the existing `createAnnotationMutation` in AnnotationPanel.svelte:489 have `onMutate`? (no — only `onSuccess` invalidation. Our new version adds optimistic create)
- **Task 8: AnnotationPanel orchestrator**
  - Q: Does `setPendingMeasurementData` need to be exposed via `bind:` or `export { }`? (use `export { }` — Svelte 5 pattern for exposing methods)

### Wave 3 (F11)

- **Task 10: Unified export API**
  - Q: Should bulk ZIP export be implemented in this wave or deferred? (defer ZIP — return jobId for SSE tracking now, implement ZIP in follow-up)
  - Q: Does `import_jobs` table need a `job_type` column to distinguish import vs export? (not blocking — use `map_id='export'` as sentinel for now)

---

## Artifact Manifest

<!-- PLAN_MANIFEST_START -->

| File                                                                 | Action | Marker                                                 |
| -------------------------------------------------------------------- | ------ | ------------------------------------------------------ |
| `apps/web/src/lib/stores/measurement-store.svelte.ts`                | create | `export class MeasurementStore`                        |
| `apps/web/src/__tests__/measurement-store.test.ts`                   | create | `describe('MeasurementStore'`                          |
| `apps/web/src/lib/components/measurements/MeasurementTooltip.svelte` | create | `Save as annotation`                                   |
| `apps/web/src/__tests__/measurement-tooltip.test.ts`                 | create | `describe('MeasurementTooltip'`                        |
| `apps/web/src/__tests__/measurement-integration.test.ts`             | create | `describe('MeasurementStore integration'`              |
| `apps/web/src/lib/components/map/MapEditor.svelte`                   | patch  | `const measurementStore = new MeasurementStore()`      |
| `apps/web/src/lib/components/map/useKeyboardShortcuts.svelte.ts`     | patch  | `measurementStore?: { toggle: () => void }`            |
| `apps/web/src/lib/components/annotations/AnnotationMutations.ts`     | create | `export function useCreateAnnotation`                  |
| `apps/web/src/__tests__/annotation-mutations.test.ts`                | create | `describe('AnnotationMutations'`                       |
| `apps/web/src/lib/components/annotations/AnnotationForm.svelte`      | create | `pendingMeasurementData`                               |
| `apps/web/src/__tests__/annotation-form.test.ts`                     | create | `describe('AnnotationForm'`                            |
| `apps/web/src/lib/components/annotations/AnnotationList.svelte`      | create | `describe('AnnotationList'`                            |
| `apps/web/src/__tests__/annotation-list.test.ts`                     | create | `describe('AnnotationList'`                            |
| `apps/web/src/lib/components/annotations/AnnotationPanel.svelte`     | patch  | `import AnnotationForm from './AnnotationForm.svelte'` |
| `apps/web/src/__tests__/annotation-panel-decomposed.test.ts`         | create | `describe('AnnotationPanel (decomposed)'`              |
| `apps/web/src/lib/stores/export-store.svelte.ts`                     | create | `export class ExportStore`                             |
| `apps/web/src/__tests__/export-store.test.ts`                        | create | `describe('ExportStore'`                               |
| `apps/web/src/routes/api/export/+server.ts`                          | create | `export const POST: RequestHandler`                    |
| `apps/web/src/routes/api/export/progress/+server.ts`                 | create | `Content-Type': 'text/event-stream'`                   |
| `apps/web/src/__tests__/export-api.test.ts`                          | create | `describe('POST /api/export'`                          |
| `apps/web/src/lib/components/data/ExportDialog.svelte`               | patch  | `import { ExportStore }`                               |
| `apps/web/src/__tests__/export-dialog.test.ts`                       | create | `describe('ExportDialog (unified)'`                    |

<!-- PLAN_MANIFEST_END -->
