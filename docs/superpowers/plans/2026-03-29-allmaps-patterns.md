# Allmaps Pattern Absorption — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Absorb two proven Allmaps architectural patterns into FLI: (1) class-based state consolidation replacing fragmented stores + effect chains, (2) shared import-engine package eliminating parser duplication between web and worker.

**Architecture:** Track A merges 3 tightly-coupled stores (`interactionModes`, `selection`, `drawing`) into a single `MapEditorState` class with atomic methods, scoped via Svelte 5 `setContext`/`getContext`. Track B extracts 6 format parsers into `packages/import-engine/` with a Layer 0/1 dependency rule (depends only on `shared-types` + `geo-engine`, no ORM/framework).

**Tech Stack:** Svelte 5 runes (class-based `$state`/`$derived`), TypeScript, vitest, pnpm workspaces, Turbo `^build`

**Locked Decisions:**
1. Approach B (targeted consolidation) — only the 3 coupled stores merge; 6 independent stores stay as-is
2. Context API scoping — `setContext`/`getContext`, not module singletons
3. No EventTarget initially — Svelte 5 reactivity via class getters suffices; EventTarget deferred to real-time collab (felt-like-it-660a)
4. import-engine Layer 0/1 rule — depends on `shared-types` + `geo-engine`, nothing else
5. GeoPackage parser returns `ParsedWkbFeature[]` (WKB hex); all others return `ParsedFeature[]` (GeoJSON geometry)
6. Trust boundary audit: already clean, no changes

**Referenced Documents:**
- `docs/research/allmaps-comparison.md` — RQ1, RQ2, RQ10, RQ11 analysis
- `apps/web/src/__tests__/interaction-modes.test.ts` — existing state machine tests (adapt, don't rewrite)

---

## File Structure

### Track A: MapEditorState

| File | Action | Purpose |
|------|--------|---------|
| `apps/web/src/lib/stores/map-editor-state.svelte.ts` | Create | Class consolidating interaction + selection + drawing state |
| `apps/web/src/__tests__/map-editor-state.test.ts` | Create | State machine tests (adapted from interaction-modes.test.ts) |
| `apps/web/src/lib/components/map/MapEditor.svelte` | Modify | Create + provide MapEditorState via context |
| `apps/web/src/lib/components/map/DrawingToolbar.svelte` | Modify | Consume MapEditorState from context |
| `apps/web/src/lib/components/map/MapCanvas.svelte` | Modify | Consume MapEditorState from context |
| `apps/web/src/lib/components/data/DataTable.svelte` | Modify | Consume MapEditorState from context |
| `apps/web/src/lib/components/map/useInteractionBridge.svelte.ts` | Delete | Replaced by atomic methods |
| `apps/web/src/lib/stores/interaction-modes.svelte.ts` | Delete | Absorbed into MapEditorState |
| `apps/web/src/lib/stores/selection.svelte.ts` | Delete | Absorbed into MapEditorState |
| `apps/web/src/lib/stores/drawing.svelte.ts` | Delete | Absorbed into MapEditorState |

### Track B: Import Engine

| File | Action | Purpose |
|------|--------|---------|
| `packages/import-engine/package.json` | Create | Package manifest |
| `packages/import-engine/tsconfig.json` | Create | TS config (matches geo-engine) |
| `packages/import-engine/vitest.config.ts` | Create | Test config |
| `packages/import-engine/src/index.ts` | Create | Public exports |
| `packages/import-engine/src/types.ts` | Create | ParsedFeature / ParsedWkbFeature |
| `packages/import-engine/src/geojson.ts` | Create | GeoJSON parser |
| `packages/import-engine/src/csv.ts` | Create | CSV parser (rows + coordinate detection) |
| `packages/import-engine/src/shapefile.ts` | Create | Shapefile parser |
| `packages/import-engine/src/kml.ts` | Create | KML parser |
| `packages/import-engine/src/gpx.ts` | Create | GPX parser |
| `packages/import-engine/src/geopackage.ts` | Create | GeoPackage parser (WKB output) |
| `packages/import-engine/src/sanitize.ts` | Create | Filename sanitization |
| `packages/import-engine/src/__tests__/` | Create | Tests for each parser |
| `apps/web/src/lib/server/import/*.ts` | Modify | Thin wrappers calling import-engine |
| `services/worker/src/index.ts` | Modify | Replace inline parsers with import-engine |

---

## Execution Waves

- **Wave 0:** Task 1 (foundation — types + scaffold)
- **Wave 1:** Tasks 2, 3 (parallel — core implementations on each track)
- **Wave 2:** Tasks 4, 5 (parallel — integration on each track; Task 4 is sequential internally: MapEditor → DrawingToolbar → MapCanvas/DataTable)
- **Wave 3:** Task 6 (cleanup — delete old code, full test suite)

---

## Task 1: Foundation — Types + Import-Engine Scaffold

**Skill:** `none`

**Files:**
- Create: `packages/import-engine/package.json`
- Create: `packages/import-engine/tsconfig.json`
- Create: `packages/import-engine/vitest.config.ts`
- Create: `packages/import-engine/src/types.ts`
- Create: `packages/import-engine/src/index.ts`

- [ ] **Step 1: Create import-engine package.json**

```json
{
  "name": "@felt-like-it/import-engine",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "lint": "tsc --noEmit",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "@felt-like-it/shared-types": "workspace:*",
    "@felt-like-it/geo-engine": "workspace:*",
    "papaparse": "^5.4.1",
    "shpjs": "^6.1.0",
    "fast-xml-parser": "^4.5.0",
    "sql.js": "^1.12.0"
  },
  "devDependencies": {
    "@types/papaparse": "^5.3.15",
    "@vitest/coverage-v8": "^2.1.8",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create tsconfig.json** (copy from geo-engine)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
  },
});
```

- [ ] **Step 4: Create types.ts — the parsing contract**

```typescript
import type { Geometry } from '@felt-like-it/shared-types';

/** Standard parsed feature — GeoJSON geometry + properties. */
export interface ParsedFeature {
  geometry: Geometry;
  properties: Record<string, unknown>;
}

/**
 * GeoPackage parsed feature — WKB binary + SRID.
 * Both web and worker pass WKB directly to PostGIS via ST_GeomFromWKB.
 */
export interface ParsedWkbFeature {
  wkbHex: string;
  srid: number;
  properties: Record<string, unknown>;
}

/** Result of CSV header analysis — which columns hold coordinates. */
export interface CsvCoordinateColumns {
  latColumn: string;
  lngColumn: string;
}

/** Parsed CSV with headers preserved for coordinate detection. */
export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}
```

- [ ] **Step 5: Create index.ts with stub exports**

```typescript
export * from './types.js';
export * from './sanitize.js';
```

- [ ] **Step 6: Create stub sanitize.ts** (move from `apps/web/src/lib/server/import/sanitize.ts`)

Copy the existing `sanitizeFilename` function verbatim — it has zero dependencies.

- [ ] **Step 7: Install dependencies**

Run: `cd /mnt/Ghar/2TA/DevStuff/felt-like-it && pnpm install`
Expected: lockfile updates, no errors

- [ ] **Step 8: Verify build**

Run: `pnpm build`
Expected: all packages build including import-engine

- [ ] **Step 9: Commit**

```bash
git add packages/import-engine/
git commit -m "feat: scaffold import-engine package with types"
```

---

## Task 2: MapEditorState Class + Tests

**Skill:** `superpowers:test-driven-development`

**Files:**
- Create: `apps/web/src/lib/stores/map-editor-state.svelte.ts`
- Create: `apps/web/src/__tests__/map-editor-state.test.ts`

**Interfaces (consumed from existing code):**

```typescript
// From apps/web/src/lib/stores/interaction-modes.svelte.ts
type InteractionState =
  | { type: 'idle' }
  | { type: 'featureSelected'; feature: SelectedFeature }
  | { type: 'drawRegion'; geometry?: { type: 'Polygon'; coordinates: number[][][] } }
  | { type: 'pickFeature'; picked?: PickedFeatureRef }
  | { type: 'pendingMeasurement'; anchor: {...}; content: {...} };

type SelectedFeature = { featureId: string; layerId: string; geometry: Geometry };
type PickedFeatureRef = { featureId: string; layerId: string };

// From apps/web/src/lib/stores/selection.svelte.ts
type DrawTool = 'point' | 'line' | 'polygon' | 'select' | null;

// From apps/web/src/lib/stores/drawing.svelte.ts
type DrawingState =
  | { status: 'idle' }
  | { status: 'importing'; generation: number }
  | { status: 'ready'; instance: TerraDraw; generation: number }
  | { status: 'stopped' };
```

- [ ] **Step 1: Write failing tests — state transitions**

Adapt `apps/web/src/__tests__/interaction-modes.test.ts` patterns. The existing test creates a `createInteractionModes()` function that mirrors the state machine. Replace with `MapEditorState` class instantiation.

Key test groups:
1. **Initial state**: idle, no selection, no tool, drawing idle
2. **Atomic selectFeature**: sets selectedFeature + selectedFeatureIds + interactionState in one call
3. **Atomic setActiveTool**: sets tool + clears selection for draw tools (no effect chain)
4. **transitionTo tool sync**: drawRegion → activeTool='polygon', pickFeature → activeTool='select'
5. **Section cleanup**: onSectionChange away from 'annotations' resets drawRegion/pickFeature to idle
6. **Design mode cleanup**: onDesignModeChange(true) → idle + clear selection + tool='select'
7. **Feature pick capture**: selectFeature during pickFeature mode captures picked ref
8. **Drawing lifecycle**: init → importing → ready → stop → stopped
9. **Adversarial**: rapid tool switching, selectFeature during drawRegion (should not transition)
10. **reset()**: returns all state to initial values (for test isolation)

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
// Mock terra-draw same pattern as drawing-store.test.ts
// ...
import { MapEditorState } from '../lib/stores/map-editor-state.svelte.js';

describe('MapEditorState', () => {
  let state: MapEditorState;
  beforeEach(() => {
    state = new MapEditorState();
  });

  it('starts idle with no selection', () => {
    expect(state.interactionState.type).toBe('idle');
    expect(state.selectedFeature).toBeNull();
    expect(state.activeTool).toBeNull();
    expect(state.hasSelection).toBe(false);
    expect(state.drawingStatus).toBe('idle');
  });

  describe('selectFeature (atomic)', () => {
    it('sets selection AND transitions to featureSelected in one call', () => {
      const geom = { type: 'Point', coordinates: [0, 0] };
      state.selectFeature(
        { id: 'f1', geometry: geom, properties: {} },
        { lng: 0, lat: 0 },
        'layer1'
      );
      expect(state.selectedFeature?.id).toBe('f1');
      expect(state.selectedLayerId).toBe('layer1');
      expect(state.interactionState.type).toBe('featureSelected');
      expect(state.hasSelection).toBe(true);
    });
  });

  describe('setActiveTool (atomic, no race)', () => {
    it('clears selection when switching to draw tool', () => {
      // Set up a selection first
      state.selectFeature({ id: 'f1', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }, undefined, 'l1');
      expect(state.hasSelection).toBe(true);

      state.setActiveTool('polygon');
      expect(state.activeTool).toBe('polygon');
      expect(state.hasSelection).toBe(false);
      expect(state.interactionState.type).toBe('idle');
    });

    it('preserves selection when switching to select tool', () => {
      state.selectFeature({ id: 'f1', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }, undefined, 'l1');
      state.setActiveTool('select');
      expect(state.hasSelection).toBe(true);
    });
  });
  // ... etc for all 10 test groups
});
```

Run: `cd apps/web && npx vitest run src/__tests__/map-editor-state.test.ts`
Expected: FAIL — MapEditorState does not exist

- [ ] **Step 2: Implement MapEditorState class**

Create `apps/web/src/lib/stores/map-editor-state.svelte.ts`:

```typescript
import { setContext, getContext } from 'svelte';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { TerraDraw } from 'terra-draw';
import type { GeoJSONFeature } from '@felt-like-it/shared-types';
import type { Geometry } from 'geojson';
import { mutation } from '$lib/debug/effect-tracker.js';
import { resolveFeatureId } from '$lib/utils/resolve-feature-id.js';

// ── Types (moved from interaction-modes + selection + drawing) ─────────────

export type SelectedFeature = {
  featureId: string;
  layerId: string;
  geometry: Geometry;
};

export type PickedFeatureRef = {
  featureId: string;
  layerId: string;
};

export type InteractionState =
  | { type: 'idle' }
  | { type: 'featureSelected'; feature: SelectedFeature }
  | { type: 'drawRegion'; geometry?: { type: 'Polygon'; coordinates: number[][][] } }
  | { type: 'pickFeature'; picked?: PickedFeatureRef }
  | { type: 'pendingMeasurement'; anchor: { /* ... keep full type from interaction-modes.svelte.ts ... */ }; content: { /* ... */ } };

export type DrawTool = 'point' | 'line' | 'polygon' | 'select' | null;

type DrawingState =
  | { status: 'idle' }
  | { status: 'importing'; generation: number }
  | { status: 'ready'; instance: TerraDraw; generation: number }
  | { status: 'stopped' };

// ── Class ──────────────────────────────────────────────────────────────────

const MAP_EDITOR_STATE_KEY = Symbol('MapEditorState');

export class MapEditorState {
  // Interaction state
  #interactionState = $state<InteractionState>({ type: 'idle' });

  // Selection state
  #selectedFeatureIds = $state<Set<string>>(new Set());
  #selectedFeature = $state<GeoJSONFeature | null>(null);
  #activeTool = $state<DrawTool>(null);
  #popupCoords = $state<{ lng: number; lat: number } | null>(null);
  #selectedLayerId = $state<string | null>(null);

  // Drawing state
  #drawingState = $state<DrawingState>({ status: 'idle' });
  #drawingGeneration = 0;

  // ── Getters (reactive reads for components) ────────────────────────────

  get interactionState(): InteractionState { return this.#interactionState; }
  get selectedFeature(): GeoJSONFeature | null { return this.#selectedFeature; }
  get selectedFeatureIds(): Set<string> { return this.#selectedFeatureIds; }
  get activeTool(): DrawTool { return this.#activeTool; }
  get popupCoords(): { lng: number; lat: number } | null { return this.#popupCoords; }
  get selectedLayerId(): string | null { return this.#selectedLayerId; }
  get hasSelection(): boolean { return this.#selectedFeatureIds.size > 0; }
  get drawingStatus(): DrawingState['status'] { return this.#drawingState.status; }
  get isDrawingReady(): boolean { return this.#drawingState.status === 'ready'; }
  get drawingInstance(): TerraDraw | null {
    return this.#drawingState.status === 'ready' ? this.#drawingState.instance : null;
  }

  // ── Atomic transitions ─────────────────────────────────────────────────
  // Each method updates ALL related state in one synchronous call.
  // No cross-store $effect chains. No untrack() guards needed.

  transitionTo(next: InteractionState): void {
    this.#interactionState = next;
    // Inline tool sync (was a separate $effect in interaction-modes.svelte.ts)
    switch (next.type) {
      case 'drawRegion':
        this.#activeTool = 'polygon';
        break;
      case 'pickFeature':
        this.#activeTool = 'select';
        break;
      case 'idle':
        // Only reset tool if coming from a special mode
        // (featureSelected → idle should NOT force tool change)
        break;
    }
  }

  selectFeature(
    feature: GeoJSONFeature,
    coords?: { lng: number; lat: number } | undefined,
    layerId?: string | undefined,
  ): void {
    this.#selectedFeature = feature;
    this.#selectedFeatureIds = new Set([String(feature.id ?? '')]);
    this.#popupCoords = coords ?? null;
    this.#selectedLayerId = layerId ?? null;

    // Atomic: also transition to featureSelected (was bridge effect ME:selectionToFeature)
    const geom = feature.geometry as Geometry | undefined;
    const fid = resolveFeatureId(feature as any);
    if (geom && fid && layerId) {
      const currentType = this.#interactionState.type;
      if (currentType === 'idle' || currentType === 'featureSelected') {
        this.#interactionState = {
          type: 'featureSelected',
          feature: { featureId: fid, layerId, geometry: geom },
        };
      } else if (currentType === 'pickFeature' && !(this.#interactionState as any).picked) {
        // Feature pick capture (was bridge effect ME:featurePickCapture)
        this.#interactionState = {
          type: 'pickFeature',
          picked: { featureId: fid, layerId },
        };
      }
    }
  }

  clearSelection(): void {
    if (!this.#selectedFeature && this.#selectedFeatureIds.size === 0) return;
    this.#selectedFeature = null;
    this.#selectedFeatureIds = new Set();
    this.#popupCoords = null;
    this.#selectedLayerId = null;
    // If we were in featureSelected, go idle (was bridge effect ME:selectionToFeature else branch)
    if (this.#interactionState.type === 'featureSelected') {
      this.#interactionState = { type: 'idle' };
    }
  }

  setActiveTool(tool: DrawTool): void {
    this.#activeTool = tool;
    // Clear selection for draw tools (was hidden side effect in selectionStore.setActiveTool)
    if (tool !== null && tool !== 'select') {
      this.#selectedFeature = null;
      this.#selectedFeatureIds = new Set();
      this.#popupCoords = null;
      this.#selectedLayerId = null;
      // Dismiss featureSelected (was bridge effect ME:toolDismissFeature)
      if (this.#interactionState.type === 'featureSelected') {
        this.#interactionState = { type: 'idle' };
      }
    }
  }

  toggleFeatureId(id: string): void {
    const next = new Set(this.#selectedFeatureIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.#selectedFeatureIds = next;
  }

  // ── Context-driven reactions ───────────────────────────────────────────
  // Called by MapEditor when external state changes. Replaces bridge effects
  // ME:sectionCleanup and ME:designModeCleanup.

  handleSectionChange(section: string | null): void {
    if (section !== 'annotations') {
      const t = this.#interactionState.type;
      if (t === 'drawRegion' || t === 'pickFeature' || t === 'pendingMeasurement') {
        this.#interactionState = { type: 'idle' };
      }
    }
  }

  handleDesignModeChange(designMode: boolean): void {
    if (designMode) {
      this.#interactionState = { type: 'idle' };
      this.clearSelection();
      this.#activeTool = 'select';
    }
  }

  // ── Drawing lifecycle ──────────────────────────────────────────────────
  // Moved from drawingStore. Same generation-guarded init pattern.

  async initDrawing(map: MapLibreMap): Promise<TerraDraw | null> {
    const gen = ++this.#drawingGeneration;
    this.#drawingState = { status: 'importing', generation: gen };

    const { TerraDraw, TerraDrawPointMode, TerraDrawLineStringMode,
            TerraDrawPolygonMode, TerraDrawSelectMode } = await import('terra-draw');
    const { TerraDrawMapLibreGLAdapter } = await import('terra-draw-maplibre-gl-adapter');

    if (gen !== this.#drawingGeneration) return null;

    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawPointMode(),
        new TerraDrawLineStringMode(),
        new TerraDrawPolygonMode({ snapping: { toLine: true, toCoordinate: true } }),
        new TerraDrawSelectMode(),
      ],
    });

    draw.start();
    this.#drawingState = { status: 'ready', instance: draw, generation: gen };
    return draw;
  }

  stopDrawing(): void {
    if (this.#drawingState.status === 'ready') {
      try { this.#drawingState.instance.stop(); }
      catch (err) { console.error('MapEditorState stopDrawing failed:', err); }
    }
    this.#drawingState = { status: 'stopped' };
  }

  /** Reset all state — for test isolation and component teardown. */
  reset(): void {
    if (this.#drawingState.status === 'ready') {
      try { this.#drawingState.instance.stop(); } catch {}
    }
    this.#interactionState = { type: 'idle' };
    this.#selectedFeature = null;
    this.#selectedFeatureIds = new Set();
    this.#activeTool = null;
    this.#popupCoords = null;
    this.#selectedLayerId = null;
    this.#drawingState = { status: 'idle' };
    this.#drawingGeneration = 0;
  }
}

// ── Context helpers ──────────────────────────────────────────────────────────

export function setMapEditorState(): MapEditorState {
  return setContext(MAP_EDITOR_STATE_KEY, new MapEditorState());
}

export function getMapEditorState(): MapEditorState {
  return getContext<MapEditorState>(MAP_EDITOR_STATE_KEY);
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/__tests__/map-editor-state.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/stores/map-editor-state.svelte.ts apps/web/src/__tests__/map-editor-state.test.ts
git commit -m "feat: MapEditorState class — atomic state consolidation"
```

---

## Task 3: Import-Engine Parsers + Tests

**Skill:** `superpowers:test-driven-development`

**Files:**
- Create: `packages/import-engine/src/geojson.ts`
- Create: `packages/import-engine/src/csv.ts`
- Create: `packages/import-engine/src/shapefile.ts`
- Create: `packages/import-engine/src/kml.ts`
- Create: `packages/import-engine/src/gpx.ts`
- Create: `packages/import-engine/src/geopackage.ts`
- Create: `packages/import-engine/src/__tests__/*.test.ts`
- Modify: `packages/import-engine/src/index.ts`

**Source code to adapt:**
- `apps/web/src/lib/server/import/geojson.ts` → extract `parseGeoJSON` (lines 1-50 approx — the part before `createLayerAndInsertFeatures`)
- `apps/web/src/lib/server/import/csv.ts` → extract `parseCSV` function (returns `{ headers, rows }`)
- `apps/web/src/lib/server/import/shapefile.ts` → extract `parseShapefile` function (returns `ShpFeature[]`)
- `apps/web/src/lib/server/import/xmlgeo.ts` → extract `parseKML` and `parseGPX` (the XML→Feature[] logic)
- `apps/web/src/lib/server/import/geopackage.ts` → extract `parseGpkgBlob`, `gpkgGeomTypeToLayerType`, and the GeoPackage read logic
- `services/worker/src/index.ts` → reference for divergences (worker uses WKB hex for GeoPackage)

**Return type contract:**
- `parseGeoJSON(filePath): Promise<ParsedFeature[]>`
- `parseCSV(filePath): Promise<ParsedCsv>` (headers + rows — coordinate detection is a separate step)
- `csvRowsToFeatures(headers, rows): ParsedFeature[]` (uses geo-engine's `detectCoordinateColumns`)
- `parseShapefile(filePath): Promise<ParsedFeature[]>`
- `parseKML(filePath): Promise<ParsedFeature[]>`
- `parseGPX(filePath): Promise<ParsedFeature[]>`
- `parseGeoPackage(filePath): Promise<{ features: ParsedWkbFeature[]; layerType: LayerType; tableName: string }>`

- [ ] **Step 1: Write test for geojson parser**

Test with inline GeoJSON written to a temp file. Cases:
- Valid FeatureCollection → `ParsedFeature[]`
- Single Feature (not wrapped in FeatureCollection) → `[ParsedFeature]`
- Bare Geometry → `[ParsedFeature]` with empty properties
- Empty FeatureCollection → `[]`
- Invalid JSON → throws

Run: `cd packages/import-engine && npx vitest run src/__tests__/geojson.test.ts`
Expected: FAIL

- [ ] **Step 2: Implement geojson parser**

Adapt from `apps/web/src/lib/server/import/geojson.ts` — the `JSON.parse` + feature extraction logic. Strip the `createLayerAndInsertFeatures` call.

Run: `cd packages/import-engine && npx vitest run src/__tests__/geojson.test.ts`
Expected: PASS

- [ ] **Step 3: Write test + implement csv parser**

`parseCSV` returns `{ headers, rows }`. `csvRowsToFeatures` does coordinate detection via `detectCoordinateColumns` from `@felt-like-it/geo-engine`.

Test: write a CSV temp file with lat/lng columns. Verify headers and parsed rows. Verify `csvRowsToFeatures` produces `ParsedFeature[]` with Point geometries.

Adversarial: CSV with no coordinate columns → `csvRowsToFeatures` throws.

- [ ] **Step 4: Write test + implement shapefile parser**

Adapt from `apps/web/src/lib/server/import/shapefile.ts`.

Test: use a small .zip shapefile fixture (create minimal test fixture or mock `shpjs`). Verify returns `ParsedFeature[]` with geometries and properties.

- [ ] **Step 5: Write test + implement KML parser**

Adapt from `apps/web/src/lib/server/import/xmlgeo.ts` — the KML-specific branch.

Test: KML string with Point and Polygon placemarks → `ParsedFeature[]`.

- [ ] **Step 6: Write test + implement GPX parser**

Adapt from `apps/web/src/lib/server/import/xmlgeo.ts` — the GPX-specific branch.

Test: GPX string with waypoints and tracks → `ParsedFeature[]`.

- [ ] **Step 7: Write test + implement GeoPackage parser**

Adapt from `apps/web/src/lib/server/import/geopackage.ts`. Keep `parseGpkgBlob` and `gpkgGeomTypeToLayerType` as exported helpers (they're already tested in `apps/web/src/__tests__/import-geopackage.test.ts`).

Return type: `{ features: ParsedWkbFeature[]; layerType: LayerType; tableName: string }`.

- [ ] **Step 8: Update index.ts with all exports**

```typescript
export * from './types.js';
export * from './sanitize.js';
export * from './geojson.js';
export * from './csv.js';
export * from './shapefile.js';
export * from './kml.js';
export * from './gpx.js';
export * from './geopackage.js';
```

- [ ] **Step 9: Run full package test suite**

Run: `cd packages/import-engine && npx vitest run`
Expected: All tests PASS

- [ ] **Step 10: Commit**

```bash
git add packages/import-engine/
git commit -m "feat: import-engine parsers — single source for all format parsing"
```

---

## Task 4: Wire MapEditor + Children to MapEditorState

**Skill:** `superpowers:test-driven-development`
**Codebooks:** `interactive-spatial-editing`

**Files:**
- Modify: `apps/web/src/lib/components/map/MapEditor.svelte`
- Modify: `apps/web/src/lib/components/map/DrawingToolbar.svelte`
- Modify: `apps/web/src/lib/components/map/MapCanvas.svelte`
- Modify: `apps/web/src/lib/components/data/DataTable.svelte`
- Delete: `apps/web/src/lib/components/map/useInteractionBridge.svelte.ts`

This task is sequential internally — MapEditor must provide context before children can consume it.

- [ ] **Step 1: Update MapEditor.svelte**

Replace:
```typescript
import { interactionModes } from '$lib/stores/interaction-modes.svelte.js';
import { selectionStore } from '$lib/stores/selection.svelte.js';
// Remove useInteractionBridge import
```

With:
```typescript
import { setMapEditorState } from '$lib/stores/map-editor-state.svelte.js';

const editorState = setMapEditorState();
```

Replace the `useInteractionBridge(...)` call with two simple effects:
```typescript
$effect(() => {
  editorState.handleSectionChange(activeSection);
});

$effect(() => {
  editorState.handleDesignModeChange(designMode);
});
```

Replace all `interactionModes.state` reads with `editorState.interactionState`.
Replace all `interactionModes.transitionTo(...)` with `editorState.transitionTo(...)`.
Replace all `selectionStore.*` reads/calls with `editorState.*`.

The `handleFeatureDrawn` function calls `transitionTo({ type: 'featureSelected', ... })` — update to use `editorState.selectFeature(...)` instead (atomic).

- [ ] **Step 2: Update DrawingToolbar.svelte**

Replace:
```typescript
import { selectionStore } from '$lib/stores/selection.svelte.js';
import { drawingStore } from '$lib/stores/drawing.svelte.js';
```

With:
```typescript
import { getMapEditorState } from '$lib/stores/map-editor-state.svelte.js';
const editorState = getMapEditorState();
```

Replace:
- `selectionStore.activeTool` → `editorState.activeTool`
- `selectionStore.setActiveTool(...)` → `editorState.setActiveTool(...)`
- `drawingStore.isReady` → `editorState.isDrawingReady`
- `drawingStore.instance` → `editorState.drawingInstance`
- `drawingStore.init(map)` → `editorState.initDrawing(map)`
- `drawingStore.stop()` → `editorState.stopDrawing()`

The `DT:syncToolToTerraDraw` effect stays — it reads `editorState.activeTool` and syncs to Terra Draw. Same logic, different source.

- [ ] **Step 3: Update MapCanvas.svelte**

Replace `selectionStore` import with `getMapEditorState()`.
Replace:
- `selectionStore.activeTool` → `editorState.activeTool`
- `selectionStore.selectFeature(...)` → `editorState.selectFeature(...)`
- `selectionStore.clearSelection()` → `editorState.clearSelection()`
- `selectionStore.selectedFeatureIds` → `editorState.selectedFeatureIds`

- [ ] **Step 4: Update DataTable.svelte**

Replace `selectionStore` import with `getMapEditorState()`.
Replace:
- `selectionStore.selectFeature(...)` → `editorState.selectFeature(...)`
- `selectionStore.selectedFeatureIds` → `editorState.selectedFeatureIds`
- `selectionStore.toggleFeatureId(...)` → `editorState.toggleFeatureId(...)`

- [ ] **Step 5: Delete useInteractionBridge.svelte.ts**

```bash
rm apps/web/src/lib/components/map/useInteractionBridge.svelte.ts
```

Verify no remaining imports:
Run: `grep -rn 'useInteractionBridge' apps/web/src/`
Expected: no matches

- [ ] **Step 6: Run full test suite**

Run: `cd apps/web && npx vitest run`
Expected: All tests PASS (some old tests may need import updates — see step 7)

- [ ] **Step 7: Fix any broken test imports**

Tests importing `interactionModes` from the old store need to import from `map-editor-state.svelte.js` instead. Update `interaction-modes.test.ts` type imports:
```typescript
import type { SelectedFeature, PickedFeatureRef } from '$lib/stores/map-editor-state.svelte.js';
```

- [ ] **Step 8: Verify build**

Run: `pnpm check`
Expected: no type errors

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: wire MapEditor tree to MapEditorState — delete useInteractionBridge"
```

---

## Task 5: Wire Web Imports + Worker to Import-Engine

**Skill:** `superpowers:test-driven-development`

**Files:**
- Modify: `apps/web/src/lib/server/import/geojson.ts`
- Modify: `apps/web/src/lib/server/import/csv.ts`
- Modify: `apps/web/src/lib/server/import/shapefile.ts`
- Modify: `apps/web/src/lib/server/import/xmlgeo.ts`
- Modify: `apps/web/src/lib/server/import/geopackage.ts`
- Modify: `apps/web/src/lib/server/import/sanitize.ts`
- Modify: `services/worker/src/index.ts`
- Modify: `services/worker/package.json`
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add import-engine dependency to web and worker**

In `apps/web/package.json`, add:
```json
"@felt-like-it/import-engine": "workspace:*"
```

In `services/worker/package.json`, add:
```json
"@felt-like-it/import-engine": "workspace:*"
```

Run: `pnpm install`

- [ ] **Step 2: Rewrite web geojson.ts as thin wrapper**

```typescript
import { parseGeoJSON } from '@felt-like-it/import-engine';
import { createLayerAndInsertFeatures } from './shared.js';
import type { ImportResult } from './shared.js';

export async function importGeoJSON(
  filePath: string,
  mapId: string,
  layerName: string,
  jobId: string,
): Promise<ImportResult> {
  const features = await parseGeoJSON(filePath);
  if (features.length === 0) throw new Error('GeoJSON contains no valid features');
  return createLayerAndInsertFeatures({ mapId, jobId, layerName, features });
}
```

- [ ] **Step 3: Rewrite web csv.ts as thin wrapper**

Keep the geocoding path in-place (it needs DB progress updates). Replace inline `parseCSV` with import-engine's `parseCSV`. Replace coordinate column detection with `csvRowsToFeatures`.

- [ ] **Step 4: Rewrite web shapefile.ts as thin wrapper**

```typescript
import { parseShapefile } from '@felt-like-it/import-engine';
import { createLayerAndInsertFeatures } from './shared.js';
import type { ImportResult } from './shared.js';

export async function importShapefile(
  filePath: string, mapId: string, layerName: string, jobId: string,
): Promise<ImportResult> {
  const features = await parseShapefile(filePath);
  if (features.length === 0) throw new Error('Shapefile contains no features');
  return createLayerAndInsertFeatures({ mapId, jobId, layerName, features });
}
```

- [ ] **Step 5: Rewrite web xmlgeo.ts to use import-engine**

```typescript
import { parseKML, parseGPX } from '@felt-like-it/import-engine';
import { createLayerAndInsertFeatures } from './shared.js';
import type { ImportResult } from './shared.js';

export async function importKML(filePath: string, mapId: string, layerName: string, jobId: string): Promise<ImportResult> {
  const features = await parseKML(filePath);
  if (features.length === 0) throw new Error('KML contains no placemarks with geometry');
  return createLayerAndInsertFeatures({ mapId, jobId, layerName, features });
}

export async function importGPX(filePath: string, mapId: string, layerName: string, jobId: string): Promise<ImportResult> {
  const features = await parseGPX(filePath);
  if (features.length === 0) throw new Error('GPX contains no features');
  return createLayerAndInsertFeatures({ mapId, jobId, layerName, features });
}
```

- [ ] **Step 6: Rewrite web geopackage.ts to use import-engine**

Import `parseGeoPackage` from import-engine. Keep the DB layer creation + WKB insert logic in this file.

- [ ] **Step 7: Update web sanitize.ts to re-export**

```typescript
export { sanitizeFilename } from '@felt-like-it/import-engine';
```

- [ ] **Step 8: Rewrite worker to use import-engine**

In `services/worker/src/index.ts`:
- Replace `processGeoJSON` inline parsing with `parseGeoJSON` from import-engine
- Replace `processCSV` inline parsing with `parseCSV` + `csvRowsToFeatures` from import-engine
- Replace `processShapefile` inline parsing with `parseShapefile` from import-engine
- Replace `processXmlGeo` inline parsing with `parseKML` / `parseGPX` from import-engine
- Replace `processGeoPackage` inline parsing with `parseGeoPackage` from import-engine
- Keep: `insertFeaturesBatch` (raw SQL), `updateJobStatus`, worker setup, shutdown

The worker's `processImportJob` dispatch function stays — it calls import-engine parsers then does DB inserts.

- [ ] **Step 9: Run existing import tests**

Run: `cd apps/web && npx vitest run src/__tests__/import-geojson.test.ts src/__tests__/import-shapefile.test.ts src/__tests__/import-geopackage.test.ts`
Expected: All PASS

- [ ] **Step 10: Run full monorepo test suite**

Run: `pnpm test`
Expected: All packages pass

- [ ] **Step 11: Verify build**

Run: `pnpm build`
Expected: Clean build

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: wire web + worker to import-engine — single parser source"
```

---

## Task 6: Cleanup — Delete Old Stores + Duplicate Code

**Skill:** `none`

**Files:**
- Delete: `apps/web/src/lib/stores/interaction-modes.svelte.ts`
- Delete: `apps/web/src/lib/stores/selection.svelte.ts`
- Delete: `apps/web/src/lib/stores/drawing.svelte.ts`
- Modify: `apps/web/src/__tests__/drawing-store.test.ts` (delete or migrate)
- Modify: `apps/web/src/__tests__/interaction-modes.test.ts` (update imports)

- [ ] **Step 1: Check for remaining imports of old stores**

Run: `grep -rn "from.*stores/interaction-modes\|from.*stores/selection\|from.*stores/drawing" apps/web/src/ --include='*.ts' --include='*.svelte' | grep -v node_modules | grep -v __tests__`

Expected: no matches (all consumers rewired in Task 4)

- [ ] **Step 2: Delete old store files**

```bash
rm apps/web/src/lib/stores/interaction-modes.svelte.ts
rm apps/web/src/lib/stores/selection.svelte.ts
rm apps/web/src/lib/stores/drawing.svelte.ts
```

- [ ] **Step 3: Migrate drawing-store.test.ts**

The drawing lifecycle tests should be merged into `map-editor-state.test.ts` (they test `initDrawing`, `stopDrawing`, generation guard — all now on MapEditorState).

Delete `apps/web/src/__tests__/drawing-store.test.ts` after confirming coverage exists in `map-editor-state.test.ts`.

- [ ] **Step 4: Check for remaining inline parsers in worker**

Run: `grep -n 'function process\(GeoJSON\|CSV\|Shapefile\|XmlGeo\|GeoPackage\)' services/worker/src/index.ts`

Expected: no matches (all replaced by import-engine calls in Task 5)

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: All PASS

- [ ] **Step 6: Run lint + check**

Run: `pnpm lint && pnpm check`
Expected: Clean

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: delete old stores + duplicate worker parsers"
```

---

## Open Questions

### Wave 1
- **Task 2: MapEditorState**
  - Q: Do private class fields (`#field`) with `$state()` work correctly in Svelte 5 vitest? (The existing `drawing-store.test.ts` proves module-level `$state` works — but class-based `$state` with private fields is a newer pattern)
    - Sub-Q: If private fields fail, can we use TypeScript `private` keyword instead of `#`?
  - Q: Does `resolveFeatureId` need to be imported in the class file, or should it be inlined? (Check if it has side effects or imports that break in non-component context)

- **Task 3: Import-engine parsers**
  - Q: The web's `geopackage.ts` uses `sql.js` (WASM SQLite). Does it work when imported from a monorepo package vs. directly from the app? (WASM binary resolution may be path-dependent)
  - Q: The worker's CSV parser doesn't support geocoding (address → coordinates). Should `csvRowsToFeatures` include geocoding, or should that remain in the consumer? (Recommended: consumer-only, since geocoding needs progress callbacks and API keys)

### Wave 2
- **Task 4: Wire MapEditor**
  - Q: Are there any components importing `selectionStore` or `interactionModes` that weren't identified in the consumer grep? (Run `grep -rn` before starting)
  - Q: The `handleFeatureDrawn` callback in MapEditor calls `transitionTo` with a constructed `SelectedFeature`. With atomic `selectFeature`, the GeoJSON feature needs to be constructed from the draw event — verify the shape matches.

- **Task 5: Wire imports**
  - Q: The worker's `processGeoPackage` has its own `parseGpkgBlob` implementation. Does it diverge from the web's version? (Need diff comparison — the worker may handle edge cases differently)
  - (none for other parsers — the split point is clean)

### Wave 3
- **Task 6: Cleanup**
  - (none — fully specified, contingent on Wave 2 completing cleanly)

---

## Assumptions

1. Svelte 5 class-based `$state()` with private fields works in vitest with `@vitest-environment node` (proven for module-level `$state` by existing store tests)
2. `pnpm-workspace.yaml` already includes `packages/*` (verified: yes)
3. Turbo's `^build` already handles topological package builds (verified: yes in turbo.json)
4. The worker's parser implementations are functionally equivalent to web's (needs verification for GeoPackage)
5. No components outside `apps/web/src/lib/components/map/` and `data/DataTable.svelte` import the 3 stores being consolidated

---

<!-- PLAN_MANIFEST_START -->
| File | Action | Marker |
|------|--------|--------|
| `packages/import-engine/package.json` | create | `@felt-like-it/import-engine` |
| `packages/import-engine/tsconfig.json` | create | `moduleResolution` |
| `packages/import-engine/vitest.config.ts` | create | `defineConfig` |
| `packages/import-engine/src/types.ts` | create | `ParsedFeature` |
| `packages/import-engine/src/index.ts` | create | `export * from` |
| `packages/import-engine/src/sanitize.ts` | create | `sanitizeFilename` |
| `packages/import-engine/src/geojson.ts` | create | `parseGeoJSON` |
| `packages/import-engine/src/csv.ts` | create | `parseCSV` |
| `packages/import-engine/src/shapefile.ts` | create | `parseShapefile` |
| `packages/import-engine/src/kml.ts` | create | `parseKML` |
| `packages/import-engine/src/gpx.ts` | create | `parseGPX` |
| `packages/import-engine/src/geopackage.ts` | create | `parseGeoPackage` |
| `apps/web/src/lib/stores/map-editor-state.svelte.ts` | create | `class MapEditorState` |
| `apps/web/src/__tests__/map-editor-state.test.ts` | create | `MapEditorState` |
| `apps/web/src/lib/components/map/MapEditor.svelte` | patch | `setMapEditorState` |
| `apps/web/src/lib/components/map/DrawingToolbar.svelte` | patch | `getMapEditorState` |
| `apps/web/src/lib/components/map/MapCanvas.svelte` | patch | `getMapEditorState` |
| `apps/web/src/lib/components/data/DataTable.svelte` | patch | `getMapEditorState` |
| `apps/web/src/lib/components/map/useInteractionBridge.svelte.ts` | delete | |
| `apps/web/src/lib/stores/interaction-modes.svelte.ts` | delete | |
| `apps/web/src/lib/stores/selection.svelte.ts` | delete | |
| `apps/web/src/lib/stores/drawing.svelte.ts` | delete | |
| `apps/web/src/lib/server/import/geojson.ts` | patch | `from '@felt-like-it/import-engine'` |
| `apps/web/src/lib/server/import/csv.ts` | patch | `from '@felt-like-it/import-engine'` |
| `apps/web/src/lib/server/import/shapefile.ts` | patch | `from '@felt-like-it/import-engine'` |
| `apps/web/src/lib/server/import/xmlgeo.ts` | patch | `from '@felt-like-it/import-engine'` |
| `apps/web/src/lib/server/import/geopackage.ts` | patch | `from '@felt-like-it/import-engine'` |
| `apps/web/src/lib/server/import/sanitize.ts` | patch | `from '@felt-like-it/import-engine'` |
| `services/worker/src/index.ts` | patch | `from '@felt-like-it/import-engine'` |
| `services/worker/package.json` | patch | `@felt-like-it/import-engine` |
| `apps/web/package.json` | patch | `@felt-like-it/import-engine` |
<!-- PLAN_MANIFEST_END -->
