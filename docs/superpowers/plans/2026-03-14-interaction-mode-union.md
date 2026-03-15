# Interaction Mode Discriminated Union — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 5 boolean interaction mode flags in MapEditor.svelte with a single discriminated union type, eliminating invalid state combinations and the fragile `clearInteractionModes(keep?)` function.

**Architecture:** A single `let interactionState: InteractionState = $state({ type: 'idle' })` replaces `annotationRegionMode`, `annotationRegionGeometry`, `featurePickMode`, `pickedFeature`, `activeFeature`, and `pendingMeasurementAnnotation`. All effects, handlers, and template conditionals are rewritten to pattern-match on `interactionState.type`. Child component interfaces (MapCanvas, DrawActionRow, AnnotationPanel) remain unchanged — MapEditor derives their props from the union.

**Tech Stack:** Svelte 5 ($state runes), TypeScript discriminated unions

**Spec:** `docs/superpowers/specs/2026-03-14-interaction-mode-union-design.md`

---

## Chunk 1: Test State Machine Rewrite

The existing test file (`apps/web/src/__tests__/interaction-modes.test.ts`) extracts the state machine from MapEditor.svelte into a standalone `createInteractionModes()` function. We rewrite that function to use the discriminated union internally while preserving the same public API and behavioral assertions. This validates the union model before touching the component.

### Task 1: Rewrite test state machine internals

**Files:**
- Modify: `apps/web/src/__tests__/interaction-modes.test.ts`

**Context:** The test file defines `createInteractionModes()` (lines 47-263) with ~6 individual state variables and a `clearInteractionModes(keep?)` function. We replace the internals with a single `interactionState` discriminated union while keeping all the same public getters and action methods.

- [ ] **Step 1: Add the InteractionState type and replace state variables**

In `apps/web/src/__tests__/interaction-modes.test.ts`, replace the state variable block and types at the top of `createInteractionModes()`. Keep all existing type interfaces (`ActiveFeature`, `PickedFeature`, etc.) but add the new union type and replace the 6 individual variables with one.

Replace lines 46-60 (inside `createInteractionModes`):
```typescript
/** Minimal reproduction of MapEditor interaction-mode state machine. */
function createInteractionModes() {
	// ── State ──
	let annotationRegionMode = false;
	let annotationRegionGeometry: { type: 'Polygon'; coordinates: number[][][] } | undefined;
	let featurePickMode = false;
	let pickedFeature: PickedFeature | undefined;
	let activeFeature: ActiveFeature | null = null;
	let pendingMeasurementAnnotation: PendingMeasurementAnnotation | null = null;
```

With:
```typescript
/** Minimal reproduction of MapEditor interaction-mode state machine (discriminated union). */
function createInteractionModes() {
	// ── Discriminated union state ──
	type InteractionState =
		| { type: 'idle' }
		| { type: 'featureSelected'; feature: ActiveFeature }
		| { type: 'drawRegion'; geometry?: { type: 'Polygon'; coordinates: number[][][] } }
		| { type: 'pickFeature'; picked?: PickedFeature }
		| { type: 'pendingMeasurement'; measurement: PendingMeasurementAnnotation };

	let interactionState: InteractionState = { type: 'idle' };
```

**Note:** The test's `PendingMeasurementAnnotation` type uses `{ geometry, result }` fields (test-local shape), not the spec's `{ anchor, content }` (MapEditor-local shape). This is fine — the test state machine is a behavioral model, not a type-for-type mirror. The MapEditor implementation (Chunk 2) uses the spec's `{ anchor, content }` fields. What matters is that the test's getters and actions preserve the same external behavior.

Keep `designMode`, `activeSection`, `analysisTab`, `activeTool`, `measureResult` as-is — they're not part of the union.

- [ ] **Step 2: Replace `clearInteractionModes` with `resetInteraction`**

Replace the `clearInteractionModes` function (lines 67-81):

```typescript
	// ── Core cleanup (MapEditor line 239) ──
	function clearInteractionModes(keep?: 'region' | 'featurePick' | 'measure' | 'activeFeature') {
		if (keep !== 'region') {
			annotationRegionMode = false;
			annotationRegionGeometry = undefined;
		}
		if (keep !== 'featurePick') {
			featurePickMode = false;
		}
		if (keep !== 'measure') {
			pendingMeasurementAnnotation = null;
		}
		if (keep !== 'activeFeature') {
			activeFeature = null;
		}
	}
```

With:
```typescript
	// ── Core cleanup — replaces clearInteractionModes(keep?) ──
	function resetInteraction() {
		interactionState = { type: 'idle' };
	}
```

- [ ] **Step 3: Rewrite effects to use union state**

Replace `effectActiveSectionChange` (lines 86-94):
```typescript
	/** Simulates $effect for activeSection change (line 258) */
	function effectActiveSectionChange() {
		if (activeSection !== 'annotations') {
			if (
				interactionState.type === 'drawRegion' ||
				interactionState.type === 'pickFeature' ||
				interactionState.type === 'pendingMeasurement'
			) {
				interactionState = { type: 'idle' };
			}
		}
	}
```

Replace `effectDesignModeToggle` (lines 97-102):
```typescript
	/** Simulates $effect for designMode toggle (line 271) */
	function effectDesignModeToggle() {
		if (designMode) {
			interactionState = { type: 'idle' };
			activeTool = 'select';
		}
	}
```

Keep `effectMeasureActive` unchanged (it only touches `measureResult`, not the union).

Replace `effectToolSwitch` (lines 112-120):
```typescript
	/** Simulates $effect for tool switch (line 295) */
	function effectToolSwitch() {
		if (activeTool && activeTool !== 'select') {
			if (interactionState.type === 'featureSelected') {
				interactionState = { type: 'idle' };
			}
			// Don't clear drawRegion when tool is 'polygon' (user is drawing the region)
			if (interactionState.type === 'drawRegion' && activeTool !== 'polygon') {
				interactionState = { type: 'idle' };
			}
		}
	}
```

Replace `effectFeaturePickCapture` (lines 123-131):
```typescript
	/** Simulates $effect for featurePickMode selection capture (line 307) */
	function effectFeaturePickCapture(selectedFeature: { id: string; geometry: Geometry } | null, selectedLayerId: string | null) {
		if (interactionState.type === 'pickFeature' && !interactionState.picked
			&& selectedFeature && selectedLayerId) {
			const fid = String(selectedFeature.id ?? '');
			if (fid) {
				interactionState = {
					type: 'pickFeature',
					picked: { featureId: fid, layerId: selectedLayerId },
				};
			}
		}
	}
```

- [ ] **Step 4: Rewrite user action methods to use union state**

Replace `handleEscape` (lines 136-141):
```typescript
	/** Escape key handler (line 527) */
	function handleEscape() {
		if (interactionState.type === 'drawRegion' || interactionState.type === 'pickFeature') {
			interactionState = { type: 'idle' };
			activeTool = 'select';
		}
	}
```

Replace `requestRegion` (lines 144-149):
```typescript
	/** AnnotationPanel onrequestregion (line 820) */
	function requestRegion() {
		interactionState = { type: 'drawRegion' };
		activeTool = 'polygon';
	}
```

Replace `requestFeaturePick` (lines 152-157):
```typescript
	/** AnnotationPanel onrequestfeaturepick (line 821) */
	function requestFeaturePick() {
		interactionState = { type: 'pickFeature' };
		activeTool = 'select';
	}
```

Replace `onRegionDrawn` (lines 160-163):
```typescript
	/** Region drawn callback (line 697) */
	function onRegionDrawn(geometry: { type: 'Polygon'; coordinates: number[][][] }) {
		if (interactionState.type === 'drawRegion') {
			interactionState = { type: 'drawRegion', geometry };
		}
	}
```

Replace `drawActionAnnotate` (lines 166-173):
```typescript
	/** DrawActionRow "Annotate" (line 721) — data moves between variants */
	function drawActionAnnotate() {
		if (interactionState.type === 'featureSelected') {
			const { feature } = interactionState;
			interactionState = {
				type: 'pickFeature',
				picked: { featureId: feature.featureId, layerId: feature.layerId },
			};
		} else {
			interactionState = { type: 'idle' };
		}
		activeSection = 'annotations';
	}
```

Replace `drawActionMeasure` (lines 176-186):
```typescript
	/** DrawActionRow "Measure" (line 727) */
	function drawActionMeasure() {
		if (interactionState.type !== 'featureSelected') return;
		const { geometry } = interactionState.feature;
		interactionState = { type: 'idle' };
		if (geometry.type === 'LineString' || geometry.type === 'Polygon') {
			measureResult = { type: geometry.type, value: 42, unit: 'km' };
		}
		activeSection = 'analysis';
		analysisTab = 'measure';
	}
```

Replace `drawActionDismiss` (lines 189-191):
```typescript
	/** DrawActionRow "Dismiss" (line 740) */
	function drawActionDismiss() {
		if (interactionState.type === 'featureSelected') {
			interactionState = { type: 'idle' };
		}
	}
```

Replace `onAnnotationChange` (lines 194-200):
```typescript
	/** onannotationchange (line 808) — resets annotation modes but preserves featureSelected */
	function onAnnotationChange() {
		if (interactionState.type !== 'featureSelected') {
			interactionState = { type: 'idle' };
		}
	}
```

Replace `simulateFeatureSelect` (lines 222-223):
```typescript
	/** Set an active feature (simulates selection tracking effect).
	 *  Only transitions to featureSelected from idle or featureSelected —
	 *  doesn't clobber drawRegion, pickFeature, or pendingMeasurement. */
	function simulateFeatureSelect(feature: ActiveFeature | null) {
		if (feature && (interactionState.type === 'idle' || interactionState.type === 'featureSelected')) {
			interactionState = { type: 'featureSelected', feature };
		} else if (!feature && interactionState.type === 'featureSelected') {
			interactionState = { type: 'idle' };
		}
	}
```

Replace `setPendingMeasurement` (lines 226-228):
```typescript
	/** Set pending measurement annotation */
	function setPendingMeasurement(m: PendingMeasurementAnnotation | null) {
		if (m) {
			interactionState = { type: 'pendingMeasurement', measurement: m };
		} else if (interactionState.type === 'pendingMeasurement') {
			interactionState = { type: 'idle' };
		}
	}
```

- [ ] **Step 5: Rewrite state accessors (getters) to derive from union**

Replace the return object's getters (lines 231-262):
```typescript
	return {
		// State accessors — derived from interactionState
		get annotationRegionMode() { return interactionState.type === 'drawRegion'; },
		get annotationRegionGeometry() {
			return interactionState.type === 'drawRegion' ? interactionState.geometry : undefined;
		},
		get featurePickMode() {
			return interactionState.type === 'pickFeature' && !interactionState.picked;
		},
		get pickedFeature() {
			return interactionState.type === 'pickFeature' ? interactionState.picked : undefined;
		},
		get activeFeature() {
			return interactionState.type === 'featureSelected' ? interactionState.feature : null;
		},
		get pendingMeasurementAnnotation() {
			return interactionState.type === 'pendingMeasurement' ? interactionState.measurement : null;
		},
		get designMode() { return designMode; },
		get activeSection() { return activeSection; },
		get analysisTab() { return analysisTab; },
		get activeTool() { return activeTool; },
		get measureResult() { return measureResult; },
		get measureActive() { return getMeasureActive(); },
		// For tests that need to inspect the raw state
		get interactionState() { return interactionState; },

		// Actions
		resetInteraction,
		handleEscape,
		requestRegion,
		requestFeaturePick,
		onRegionDrawn,
		drawActionAnnotate,
		drawActionMeasure,
		drawActionDismiss,
		onAnnotationChange,
		toggleDesignMode,
		setActiveSection,
		setActiveTool,
		simulateFeatureSelect,
		setPendingMeasurement,
		effectFeaturePickCapture,
		effectMeasureActive,
	};
```

- [ ] **Step 6: Update test assertions that reference `clearInteractionModes`**

Several tests call `modes.clearInteractionModes()` directly. These need updating:

1. **"clearInteractionModes with no keep clears all modes"** (line 335) — rename test to "resetInteraction clears all modes", change `modes.clearInteractionModes()` to `modes.resetInteraction()`, keep assertions the same.

2. **"clearInteractionModes preserves the kept mode only"** (line 349) — this test verifies the `keep` parameter which no longer exists. The union doesn't need `keep` because transitions move data between variants. **Delete this test** — it tests the old API's mechanism, not a behavioral contract.

3. Update the test at line 539 ("DrawActionRow Annotate clears activeFeature..."). The old bug where `clearInteractionModes()` nullified `activeFeature` before capture is now fixed by the union. The test currently asserts the buggy behavior (`pickedFeature` is `undefined`). Update to assert the **correct** behavior:

```typescript
		it('DrawActionRow Annotate captures activeFeature into pickedFeature and switches to annotations', () => {
			modes.requestRegion();
			modes.simulateFeatureSelect(SAMPLE_FEATURE);

			modes.drawActionAnnotate();

			// Union model: data moves from featureSelected → pickFeature variant
			// No race condition — feature data is captured atomically
			expect(modes.pickedFeature).toEqual({
				featureId: SAMPLE_FEATURE.featureId,
				layerId: SAMPLE_FEATURE.layerId,
			});
			expect(modes.activeFeature).toBeNull();
			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.activeSection).toBe('annotations');
		});
```

4. The companion test at line 555 ("DrawActionRow Annotate would set pickedFeature if activeFeature captured before clear") documents the workaround for the old bug. **Delete this test** — the bug is fixed, the workaround documentation is no longer needed.

5. Test at line 586 ("DrawActionRow Dismiss only clears activeFeature") — the assertion `expect(modes.annotationRegionMode).toBe(true)` will fail because `simulateFeatureSelect` now transitions the union to `featureSelected`, overwriting the `drawRegion` state. This test's setup is testing an invalid state combination (region mode + activeFeature simultaneously) which the union correctly prevents. Update the test:

```typescript
		it('DrawActionRow Dismiss returns to idle from featureSelected', () => {
			modes.simulateFeatureSelect(SAMPLE_FEATURE);

			modes.drawActionDismiss();

			expect(modes.activeFeature).toBeNull();
			expect(modes.interactionState).toEqual({ type: 'idle' });
		});
```

6. Test "featurePickMode survives click on non-feature area" (line 633) — `featurePickMode` getter now returns `true` only when `type === 'pickFeature' && !picked`. The assertion still works: the test passes `null` to effectFeaturePickCapture, which is a no-op, so the state stays `{ type: 'pickFeature' }` and `featurePickMode` returns `true`. No change needed.

7. Test "entering region mode while measure is active clears measure-related state" (line 644) — uses `setPendingMeasurement` then `requestRegion`. `requestRegion` now just sets `interactionState = { type: 'drawRegion' }`, which implicitly clears the pending measurement. Assertions should still pass. No change needed.

- [ ] **Step 7: Run tests to verify all pass**

Run: `cd /mnt/Ghar/2TA/DevStuff/felt-like-it && pnpm --filter web test -- --reporter verbose apps/web/src/__tests__/interaction-modes.test.ts`

Expected: All tests pass (with the updated/deleted tests from Step 6).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/__tests__/interaction-modes.test.ts
git commit -m "refactor(tests): rewrite interaction mode state machine to use discriminated union

Validates the union model preserves all behavioral contracts before
applying to MapEditor.svelte. Fixes the onannotate race condition
test to assert correct behavior (data moves atomically between variants)."
```

---

## Chunk 2: MapEditor.svelte Refactor

Apply the same discriminated union pattern to the actual component. The test state machine from Chunk 1 serves as the behavioral reference.

### Task 2: Update `handleFeatureDrawn`

**Files:**
- Modify: `apps/web/src/lib/components/map/MapEditor.svelte:480`

- [ ] **Step 1: Replace `activeFeature` assignment in `handleFeatureDrawn`**

Replace line 480:
```typescript
      activeFeature = { featureId: String(fid), layerId, geometry: geom };
```

With:
```typescript
      interactionState = { type: 'featureSelected', feature: { featureId: String(fid), layerId, geometry: geom } };
```

### Task 3: Replace state variables with InteractionState union (MapEditor)

**Files:**
- Modify: `apps/web/src/lib/components/map/MapEditor.svelte:198-253`

- [ ] **Step 1: Add the InteractionState type and replace state variables**

Replace lines 198-253 (the state variable declarations and `clearInteractionModes`):

```typescript
  // ── Annotation region drawing ─────────────────────────────────────────────
  // ...existing comments...
  let annotationRegionMode = $state(false);
  let annotationRegionGeometry = $state<{ type: 'Polygon'; coordinates: number[][][] } | undefined>(undefined);

  // ── Feature-pick mode ─────────────────────────────────────────────────────
  // ...
  // ── Pending measurement annotation ─────────────────────────────────────────
  let pendingMeasurementAnnotation = $state<{...} | null>(null);

  let scrollToAnnotationFeatureId = $state<string | null>(null);

  let featurePickMode = $state(false);
  let pickedFeature = $state<{ featureId: string; layerId: string } | undefined>();

  // ── Active feature (post-draw / selection action row) ─────────────────────
  let activeFeature = $state<{...} | null>(null);

  // ── Centralized mode cleanup ─────────────────────────────────────────────
  function clearInteractionModes(keep?: ...) { ... }
```

With:

```typescript
  // ── Interaction state (discriminated union) ───────────────────────────────
  // Replaces: annotationRegionMode, annotationRegionGeometry, featurePickMode,
  // pickedFeature, activeFeature, pendingMeasurementAnnotation.
  // Compiler enforces mutual exclusivity — no invalid flag combinations.
  type SelectedFeature = {
    featureId: string;
    layerId: string;
    geometry: Geometry;
  };

  type PickedFeatureRef = {
    featureId: string;
    layerId: string;
  };

  type InteractionState =
    | { type: 'idle' }
    | { type: 'featureSelected'; feature: SelectedFeature }
    | { type: 'drawRegion'; geometry?: { type: 'Polygon'; coordinates: number[][][] } }
    | { type: 'pickFeature'; picked?: PickedFeatureRef }
    | { type: 'pendingMeasurement'; anchor: {
        type: 'measurement';
        geometry: { type: 'LineString'; coordinates: [number, number][] } | { type: 'Polygon'; coordinates: [number, number][][] };
      }; content: {
        type: 'measurement';
        measurementType: 'distance' | 'area';
        value: number;
        unit: string;
        displayValue: string;
      } };

  let interactionState: InteractionState = $state({ type: 'idle' });

  let scrollToAnnotationFeatureId = $state<string | null>(null);

  function resetInteraction() {
    interactionState = { type: 'idle' };
  }
```

- [ ] **Step 2: Run svelte-check to catch type errors from removed variables**

Run: `cd /mnt/Ghar/2TA/DevStuff/felt-like-it && pnpm --filter web exec svelte-check 2>&1 | head -60`

Expected: Many errors — every reference to the old variables is now broken. This is intentional; it gives us a precise list of locations to update.

### Task 4: Rewrite effects

**Files:**
- Modify: `apps/web/src/lib/components/map/MapEditor.svelte:255-316`

- [ ] **Step 1: Rewrite the activeSection change effect (lines 258-268)**

Replace:
```typescript
  $effect(() => {
    const section = activeSection; // track
    if (section !== 'annotations') {
      annotationRegionMode = false;
      annotationRegionGeometry = undefined;
      featurePickMode = false;
      pickedFeature = undefined;
      pendingMeasurementAnnotation = null;
    }
  });
```

With:
```typescript
  $effect(() => {
    const section = activeSection; // track
    if (section !== 'annotations') {
      if (
        interactionState.type === 'drawRegion' ||
        interactionState.type === 'pickFeature' ||
        interactionState.type === 'pendingMeasurement'
      ) {
        interactionState = { type: 'idle' };
      }
    }
  });
```

- [ ] **Step 2: Rewrite the designMode toggle effect (lines 271-276)**

Replace:
```typescript
  $effect(() => {
    if (designMode) {
      clearInteractionModes();
      selectionStore.setActiveTool('select');
    }
  });
```

With:
```typescript
  $effect(() => {
    if (designMode) {
      interactionState = { type: 'idle' };
      selectionStore.setActiveTool('select');
    }
  });
```

- [ ] **Step 3: Rewrite the selection → activeFeature effect (lines 278-291)**

Replace:
```typescript
  $effect(() => {
    const feat = selectionStore.selectedFeature;
    const lid = selectionStore.selectedLayerId;
    if (feat && lid) {
      const geom = feat.geometry as Geometry | undefined;
      const fid = String(feat.id ?? '');
      if (geom && fid) {
        activeFeature = { featureId: fid, layerId: lid, geometry: geom };
      }
    } else {
      activeFeature = null;
    }
  });
```

With:
```typescript
  // Only transition to featureSelected from idle or featureSelected —
  // don't clobber drawRegion, pickFeature, or pendingMeasurement states
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
```

- [ ] **Step 4: Rewrite the drawing tool switch effect (lines 293-305)**

Replace:
```typescript
  $effect(() => {
    const tool = selectionStore.activeTool;
    if (tool && tool !== 'select') {
      activeFeature = null;
      if (tool !== 'polygon' || !annotationRegionMode) {
      }
    }
  });
```

With:
```typescript
  $effect(() => {
    const tool = selectionStore.activeTool;
    if (tool && tool !== 'select') {
      if (interactionState.type === 'featureSelected') {
        interactionState = { type: 'idle' };
      }
      if (interactionState.type === 'drawRegion' && tool !== 'polygon') {
        interactionState = { type: 'idle' };
      }
    }
  });
```

- [ ] **Step 5: Rewrite the feature pick capture effect (lines 307-316)**

Replace:
```typescript
  $effect(() => {
    if (featurePickMode && selectionStore.selectedFeature && selectionStore.selectedLayerId) {
      const feat = selectionStore.selectedFeature;
      const fid = String(feat.id ?? '');
      if (fid) {
        pickedFeature = { featureId: fid, layerId: selectionStore.selectedLayerId };
        featurePickMode = false;
      }
    }
  });
```

With:
```typescript
  $effect(() => {
    if (interactionState.type === 'pickFeature' && !interactionState.picked
        && selectionStore.selectedFeature && selectionStore.selectedLayerId) {
      const feat = selectionStore.selectedFeature;
      const fid = String(feat.id ?? '');
      if (fid) {
        interactionState = {
          type: 'pickFeature',
          picked: { featureId: fid, layerId: selectionStore.selectedLayerId },
        };
      }
    }
  });
```

### Task 5: Rewrite handlers and callbacks

**Files:**
- Modify: `apps/web/src/lib/components/map/MapEditor.svelte:524-945`

- [ ] **Step 1: Rewrite the Escape key handler (lines 527-532)**

Replace:
```typescript
    if (e.key === 'Escape') {
      if (featurePickMode || annotationRegionMode) {
        clearInteractionModes();
        selectionStore.setActiveTool('select');
        return;
      }
    }
```

With:
```typescript
    if (e.key === 'Escape') {
      if (interactionState.type === 'drawRegion' || interactionState.type === 'pickFeature') {
        interactionState = { type: 'idle' };
        selectionStore.setActiveTool('select');
        return;
      }
    }
```

- [ ] **Step 2: Rewrite the MapCanvas `onregiondrawn` prop (line 697)**

Replace:
```svelte
        {...(annotationRegionMode ? { onregiondrawn: (g: { type: 'Polygon'; coordinates: number[][][] }) => { annotationRegionGeometry = g; annotationRegionMode = false; } } : {})}
```

With:
```svelte
        {...(interactionState.type === 'drawRegion' ? { onregiondrawn: (g: { type: 'Polygon'; coordinates: number[][][] }) => { interactionState = { type: 'drawRegion', geometry: g }; } } : {})}
```

- [ ] **Step 3: Rewrite overlay banners (lines 706-716)**

Replace:
```svelte
      {#if annotationRegionMode}
        <div class="absolute top-2 left-1/2 -translate-x-1/2 z-50 bg-blue-600 text-white text-xs px-3 py-1.5 rounded-full shadow-lg">
          Draw a polygon to define the annotation region ·
          <button class="underline ml-1" onclick={() => { clearInteractionModes(); selectionStore.setActiveTool('select'); }}>Cancel (Esc)</button>
        </div>
      {:else if featurePickMode}
        <div class="absolute top-2 left-1/2 -translate-x-1/2 z-50 bg-amber-600 text-white text-xs px-3 py-1.5 rounded-full shadow-lg">
          Click a feature to attach annotation ·
          <button class="underline ml-1" onclick={() => { clearInteractionModes(); selectionStore.setActiveTool('select'); }}>Cancel (Esc)</button>
        </div>
      {/if}
```

With:
```svelte
      {#if interactionState.type === 'drawRegion'}
        <div class="absolute top-2 left-1/2 -translate-x-1/2 z-50 bg-blue-600 text-white text-xs px-3 py-1.5 rounded-full shadow-lg">
          Draw a polygon to define the annotation region ·
          <button class="underline ml-1" onclick={() => { interactionState = { type: 'idle' }; selectionStore.setActiveTool('select'); }}>Cancel (Esc)</button>
        </div>
      {:else if interactionState.type === 'pickFeature' && !interactionState.picked}
        <div class="absolute top-2 left-1/2 -translate-x-1/2 z-50 bg-amber-600 text-white text-xs px-3 py-1.5 rounded-full shadow-lg">
          Click a feature to attach annotation ·
          <button class="underline ml-1" onclick={() => { interactionState = { type: 'idle' }; selectionStore.setActiveTool('select'); }}>Cancel (Esc)</button>
        </div>
      {/if}
```

- [ ] **Step 4: Rewrite DrawActionRow block (lines 718-743)**

Replace:
```svelte
      {#if activeFeature && !annotationRegionMode && !measureActive}
        <div class="absolute bottom-16 left-1/2 -translate-x-1/2 z-40">
          <DrawActionRow
            onannotate={() => {
              const feat = activeFeature;
              clearInteractionModes();
              activeSection = 'annotations';
              pickedFeature = feat !== null ? { featureId: feat.featureId, layerId: feat.layerId } : undefined;
            }}
            onmeasure={() => {
              if (!activeFeature) return;
              clearInteractionModes('activeFeature');
              const geom = activeFeature.geometry;
              if (geom.type === 'LineString') {
                measureResult = measureLine(geom.coordinates as [number, number][]);
              } else if (geom.type === 'Polygon') {
                measureResult = measurePolygon(geom.coordinates as [number, number][][]);
              }
              activeSection = 'analysis';
              analysisTab = 'measure';
              activeFeature = null;
            }}
            ondismiss={() => { activeFeature = null; }}
          />
        </div>
      {/if}
```

With:
```svelte
      {#if interactionState.type === 'featureSelected' && !measureActive}
        <div class="absolute bottom-16 left-1/2 -translate-x-1/2 z-40">
          <DrawActionRow
            onannotate={() => {
              if (interactionState.type === 'featureSelected') {
                const { feature } = interactionState;
                interactionState = {
                  type: 'pickFeature',
                  picked: { featureId: feature.featureId, layerId: feature.layerId },
                };
                activeSection = 'annotations';
              }
            }}
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
            ondismiss={() => { interactionState = { type: 'idle' }; }}
          />
        </div>
      {/if}
```

- [ ] **Step 5: Rewrite AnnotationPanel props and callbacks (lines 803-828)**

Replace:
```svelte
    <AnnotationPanel
      {mapId}
      embedded
      {...(userId !== undefined ? { userId } : {})}
      onannotationchange={(action) => {
        annotationRegionMode = false;
        annotationRegionGeometry = undefined;
        featurePickMode = false;
        pickedFeature = undefined;
        pendingMeasurementAnnotation = null;
        loadAnnotationPins();
        if (action) {
          logActivity(`annotation.${action}`);
        }
      }}
      onrequestregion={() => { clearInteractionModes('region'); annotationRegionMode = true; annotationRegionGeometry = undefined; selectionStore.setActiveTool('polygon'); }}
      onrequestfeaturepick={() => { clearInteractionModes('featurePick'); featurePickMode = true; pickedFeature = undefined; selectionStore.setActiveTool('select'); }}
      regionGeometry={annotationRegionGeometry}
      {pickedFeature}
      pendingMeasurement={pendingMeasurementAnnotation}
      scrollToFeatureId={scrollToAnnotationFeatureId}
      oncountchange={(a, c) => { annotationCount = a; commentCount = c; }}
    />
```

With:
```svelte
    <AnnotationPanel
      {mapId}
      embedded
      {...(userId !== undefined ? { userId } : {})}
      onannotationchange={(action) => {
        if (interactionState.type !== 'featureSelected') {
          interactionState = { type: 'idle' };
        }
        loadAnnotationPins();
        if (action) {
          logActivity(`annotation.${action}`);
        }
      }}
      onrequestregion={() => { interactionState = { type: 'drawRegion' }; selectionStore.setActiveTool('polygon'); }}
      onrequestfeaturepick={() => { interactionState = { type: 'pickFeature' }; selectionStore.setActiveTool('select'); }}
      regionGeometry={interactionState.type === 'drawRegion' ? interactionState.geometry : undefined}
      pickedFeature={interactionState.type === 'pickFeature' ? interactionState.picked : undefined}
      pendingMeasurement={interactionState.type === 'pendingMeasurement' ? { anchor: interactionState.anchor, content: interactionState.content } : null}
      scrollToFeatureId={scrollToAnnotationFeatureId}
      oncountchange={(a, c) => { annotationCount = a; commentCount = c; }}
    />
```

- [ ] **Step 6: Rewrite the "Save as annotation" button (lines 912-945)**

Replace:
```typescript
                onclick={() => {
                  if (!measureResult) return;
                  const mr = measureResult;
                  if (mr.type === 'distance') {
                    pendingMeasurementAnnotation = {
                      anchor: {
                        type: 'measurement',
                        geometry: { type: 'LineString', coordinates: mr.coordinates as [number, number][] },
                      },
                      content: {
                        type: 'measurement',
                        measurementType: 'distance',
                        value: mr.distanceKm * 1000,
                        unit: distUnit,
                        displayValue: formatDistance(mr.distanceKm, distUnit),
                      },
                    };
                  } else {
                    pendingMeasurementAnnotation = {
                      anchor: {
                        type: 'measurement',
                        geometry: { type: 'Polygon', coordinates: mr.coordinates as [number, number][][] },
                      },
                      content: {
                        type: 'measurement',
                        measurementType: 'area',
                        value: mr.areaM2,
                        unit: areaUnit,
                        displayValue: formatArea(mr.areaM2, areaUnit),
                      },
                    };
                  }
                  activeSection = 'annotations';
                }}
```

With:
```typescript
                onclick={() => {
                  if (!measureResult) return;
                  const mr = measureResult;
                  if (mr.type === 'distance') {
                    interactionState = {
                      type: 'pendingMeasurement',
                      anchor: {
                        type: 'measurement',
                        geometry: { type: 'LineString', coordinates: mr.coordinates as [number, number][] },
                      },
                      content: {
                        type: 'measurement',
                        measurementType: 'distance',
                        value: mr.distanceKm * 1000,
                        unit: distUnit,
                        displayValue: formatDistance(mr.distanceKm, distUnit),
                      },
                    };
                  } else {
                    interactionState = {
                      type: 'pendingMeasurement',
                      anchor: {
                        type: 'measurement',
                        geometry: { type: 'Polygon', coordinates: mr.coordinates as [number, number][][] },
                      },
                      content: {
                        type: 'measurement',
                        measurementType: 'area',
                        value: mr.areaM2,
                        unit: areaUnit,
                        displayValue: formatArea(mr.areaM2, areaUnit),
                      },
                    };
                  }
                  activeSection = 'annotations';
                }}
```

- [ ] **Step 7: Search for any remaining references to old variables**

Run: `cd /mnt/Ghar/2TA/DevStuff/felt-like-it && grep -n 'annotationRegionMode\|annotationRegionGeometry\|featurePickMode\|pickedFeature\|activeFeature\|pendingMeasurementAnnotation\|clearInteractionModes' apps/web/src/lib/components/map/MapEditor.svelte`

Expected: Zero matches (all references replaced).

### Task 6: Verify

**Files:** None (verification only)

- [ ] **Step 1: Run svelte-check**

Run: `cd /mnt/Ghar/2TA/DevStuff/felt-like-it && pnpm --filter web exec svelte-check`

Expected: 0 errors, 0 warnings

- [ ] **Step 2: Run interaction mode tests**

Run: `cd /mnt/Ghar/2TA/DevStuff/felt-like-it && pnpm --filter web test -- --reporter verbose apps/web/src/__tests__/interaction-modes.test.ts`

Expected: All tests pass

- [ ] **Step 3: Run full test suite**

Run: `cd /mnt/Ghar/2TA/DevStuff/felt-like-it && pnpm --filter web test`

Expected: 327 tests passing (same as before)

- [ ] **Step 4: Run ESLint**

Run: `cd /mnt/Ghar/2TA/DevStuff/felt-like-it && pnpm --filter web lint`

Expected: 0 errors, 0 warnings

- [ ] **Step 5: Run build**

Run: `cd /mnt/Ghar/2TA/DevStuff/felt-like-it && pnpm build`

Expected: Build passes

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/components/map/MapEditor.svelte
git commit -m "refactor: replace interaction mode booleans with discriminated union

Replace 5 boolean/nullable flags (annotationRegionMode, featurePickMode,
activeFeature, pickedFeature, pendingMeasurementAnnotation) with a single
InteractionState discriminated union. Eliminates clearInteractionModes(keep?)
and its fragile keep parameter.

Fixes: stale pickedFeature not cleared by clearInteractionModes
Fixes: onannotate race condition (mx-0e73ff) — data moves atomically
between union variants instead of clear-then-read."
```
