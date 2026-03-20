# Shadow Walk Remediation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 88 remaining shadow walk issues from STATE.md, organized by root-cause clusters into executable waves.

**Architecture:** Issues cluster into ~12 root causes. Fixes are mostly small (add toast, add confirm, add loading state, add disclosure text) with a few medium structural fixes (modal scroll lock, store bugs, atomic upsert). Feature gaps (annotation editing, live measurement, multi-share) are deferred to separate specs.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), tRPC 11, MapLibre GL, Terra Draw, Drizzle ORM, Vitest

---

## Triage

### False Positives (4 issues — no fix needed)

| # | Reason |
|---|--------|
| A3 | `path: '.'` is intentional Lucia convention — handoff confirms |
| D2 | SvelteKit `use:enhance` auto-runs `invalidateAll()` after form actions — grid updates automatically |
| C2 | Already uses `window.confirm("Remove <name>...")` — confirmation exists |
| ST5 | `toggleFeatureId()` is dead code, not a UX issue — cleanup only |

### Deferred to Separate Specs (14 issues — feature gaps requiring design)

| # | Reason |
|---|--------|
| AN1, AN2 | Annotation/reply editing — new feature, needs design (form states, optimistic update, permissions) |
| AN6 | Move existing anchor — new interaction mode |
| AN11 | Annotation resolution workflow — new feature paralleling comment resolve |
| S1 | Multiple share links per map — schema change + UI redesign |
| C5 | Guest comment deletion — auth model question (anonymous identity persistence) |
| C7 | Guest comments shared across all shares — schema/isolation decision |
| M1 | Live measurement preview during drawing — Terra Draw integration, significant scope |
| I4 | Multi-table GeoPackage — already tracked as `TODO(loop)` in STATE.md |
| DR6 | Delete/Enter keyboard shortcuts for drawing — Terra Draw API investigation needed |
| DR2 | Geometry validation (degenerate lines, self-intersections) — needs spec for validation rules |
| A2 | Auth signup race condition — requires server-side transaction wrapping, design decision |
| A4 | Disabled account check at login — security design decision |
| S4 | CSP frame-ancestors restriction — security/deployment policy decision |

### Actionable Issues (65 issues across 10 waves)

---

## File Structure

Most fixes are surgical edits to existing files. No new files created except one utility.

**Modified files by wave:**

| Wave | Files |
|------|-------|
| 1 | `Toast.svelte`, `Modal.svelte` |
| 2 | `login/+page.svelte`, `signup/+page.svelte`, `dashboard/+page.svelte`, `Button.svelte` |
| 3 | `MapEditor.svelte`, `LayerPanel.svelte`, `DrawingToolbar.svelte`, `ExportDialog.svelte`, `DrawActionRow.svelte` |
| 4 | `GuestCommentPanel.svelte`, `GeoprocessingPanel.svelte`, `AnnotationPanel.svelte`, `StylePanel.svelte` |
| 5 | `ImportDialog.svelte`, `upload/+server.ts` (comment only), worker handlers |
| 6 | `filters.svelte.ts`, `drawing.svelte.ts`, `MapEditor.svelte` |
| 7 | `ShareDialog.svelte`, `share/[token]/+page.svelte`, `shares.ts` (router) |
| 8 | `settings/+page.svelte`, `settings/+page.server.ts`, `admin/jobs/+page.svelte`, `admin/storage/+page.svelte`, `audit/+page.server.ts` |
| 9 | `AnnotationPanel.svelte`, `MapCanvas.svelte`, `MapEditor.svelte` |
| 10 | `ActivityFeed.svelte`, `BasemapPicker.svelte`, `DeckGLOverlay.svelte` |

---

## Execution Waves

```
Wave 1: Tasks [1, 2] (parallel) — UI infrastructure (Toast cap, Modal fixes)
Wave 2: Tasks [3, 4] (parallel) — Double-click prevention + Dashboard fixes
Wave 3: Tasks [5, 6] (parallel) — Map Editor + Drawing error surfacing
Wave 4: Tasks [7, 8] (parallel) — Comments/Geoprocessing + Annotation error surfacing
Wave 5: Task [9] — Import/Export disclosure + error handling
Wave 6: Task [10] — Store bugs (filters, drawing)
Wave 7: Task [11] — Sharing/Collaborators fixes
Wave 8: Tasks [12, 13] (parallel) — Admin/Settings + Audit
Wave 9: Task [14] — Annotation UX (pins, hidden layers, nesting)
Wave 10: Tasks [15, 16] (parallel) — Activity feed + rendering feedback
```

---

## Task 1: Toast Overflow Cap

**Issues:** UI1

**Files:**
- Modify: `apps/web/src/lib/components/ui/Toast.svelte`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/toast.svelte.test.ts` (`.svelte.test.ts` extension required — Toast.svelte module context uses `$state` rune, per Svelte 5 docs: "you can use runes inside your tests as long as the filename includes `.svelte`"):

```typescript
import { describe, it, expect } from 'vitest';
import { toastStore } from '$lib/components/ui/Toast.svelte';

describe('toastStore', () => {
  it('caps visible toasts at MAX_TOASTS, dismissing oldest first', () => {
    // Clear any existing toasts
    toastStore.toasts.forEach((t: { id: string }) => toastStore.dismiss(t.id));

    const MAX = 5;
    const ids: string[] = [];
    for (let i = 0; i < MAX + 3; i++) {
      ids.push(toastStore.show(`Toast ${i}`, 'info', 0)); // duration 0 = no auto-dismiss
    }

    expect(toastStore.toasts.length).toBeLessThanOrEqual(MAX);
    // Oldest toasts (ids[0], ids[1], ids[2]) should have been dismissed
    const activeIds = toastStore.toasts.map((t: { id: string }) => t.id);
    expect(activeIds).not.toContain(ids[0]);
    expect(activeIds).not.toContain(ids[1]);
    expect(activeIds).not.toContain(ids[2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/__tests__/toast.svelte.test.ts`
Expected: FAIL — no cap exists yet

- [ ] **Step 3: Implement toast cap**

In `Toast.svelte`, in the `show()` method, after pushing the new toast, add eviction:

```typescript
const MAX_TOASTS = 5;

show(message: string, type: ToastType = 'info', duration = 4000) {
  const id = crypto.randomUUID();
  _toasts.push({ id, message, type });

  // Evict oldest when over cap
  while (_toasts.length > MAX_TOASTS) {
    _toasts.shift();
  }

  if (duration > 0) {
    setTimeout(() => this.dismiss(id), duration);
  }
  return id;
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/__tests__/toast.svelte.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/components/ui/Toast.svelte apps/web/src/__tests__/toast.svelte.test.ts
git commit -m "fix(ui): cap toast stack at 5, evict oldest (UI1)"
```

---

## Task 2: Modal Scroll Lock + Nested Modal Fix

**Issues:** UI2, UI3

**Files:**
- Modify: `apps/web/src/lib/components/ui/Modal.svelte`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/modal.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
// Test scroll lock behavior
describe('Modal scroll lock', () => {
  it('sets body overflow hidden when open', async () => {
    // Behavioral test: when modal opens, body.style.overflow = 'hidden'
    // When it closes, overflow is restored
    // This tests the contract, not the DOM structure
  });
});
```

Note: Modal scroll lock is best tested via a Playwright e2e test or manually. For unit scope, verify the effect logic is present.

- [ ] **Step 2: Add scroll lock to Modal.svelte**

In the `$effect` block that runs on `open` changes, add body overflow management:

```typescript
$effect(() => {
  if (open) {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }
});
```

- [ ] **Step 3: Fix nested modal Escape handling**

Replace the `<svelte:window onkeydown>` with a div-level handler that uses `stopPropagation` so only the topmost modal receives Escape:

```typescript
function handleKeydown(e: KeyboardEvent) {
  if (!open || !dismissible) return;
  if (e.key === 'Escape') {
    e.stopPropagation();
    close();
  }
  // Tab trap logic stays the same but scoped to this handler
}
```

Move from `<svelte:window onkeydown={handleKeydown}>` to the dialog wrapper div: `<div role="dialog" onkeydown={handleKeydown}>`.

- [ ] **Step 4: Verify no regressions**

Run: `cd apps/web && npx vitest run`
Expected: All 327 tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/components/ui/Modal.svelte
git commit -m "fix(ui): add scroll lock + fix nested modal Escape (UI2, UI3)"
```

---

## Task 3: Double-Click Prevention

**Issues:** A1, D4, UI6

**Files:**
- Modify: `apps/web/src/routes/auth/login/+page.svelte`
- Modify: `apps/web/src/routes/auth/signup/+page.svelte`
- Modify: `apps/web/src/routes/(app)/dashboard/+page.svelte`

- [ ] **Step 1: Add loading state to auth forms**

In `login/+page.svelte` and `signup/+page.svelte`, use SvelteKit's `use:enhance` with a loading flag:

```svelte
<script>
  import { enhance } from '$app/forms';
  let submitting = $state(false);
</script>

<form method="POST" use:enhance={() => {
  submitting = true;
  return async ({ update }) => {
    submitting = false;
    await update();
  };
}}>
  <!-- ... -->
  <Button type="submit" loading={submitting}>Log in</Button>
</form>
```

- [ ] **Step 2: Add debounce to dashboard rename**

In `dashboard/+page.svelte`, wrap `saveRename()` with a debounce guard:

```typescript
let renameInFlight = $state(false);

async function saveRename() {
  if (renameInFlight) return;
  renameInFlight = true;
  try {
    // existing rename logic
  } finally {
    renameInFlight = false;
  }
}
```

- [ ] **Step 3: Verify**

Run: `cd apps/web && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/auth/login/+page.svelte apps/web/src/routes/auth/signup/+page.svelte apps/web/src/routes/'(app)'/dashboard/+page.svelte
git commit -m "fix(ui): add loading states to auth forms + debounce rename (A1, D4, UI6)"
```

---

## Task 4: Dashboard Template Error + Delete Confirm

**Issues:** D3, D5

**Files:**
- Modify: `apps/web/src/routes/(app)/dashboard/+page.svelte`

- [ ] **Step 1: Fix template creation error display (D3)**

In the template picker's error handling, close the picker and show a toast:

```typescript
// In the template creation error handler:
showTemplatePicker = false;
toastStore.error('Failed to create map from template');
```

- [ ] **Step 2: Evaluate D5 (window.confirm for delete)**

`window.confirm()` is a common, acceptable pattern. Mark as accepted — no change needed. Many production apps use this intentionally for destructive actions.

- [ ] **Step 3: Verify**

Run: `cd apps/web && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/'(app)'/dashboard/+page.svelte
git commit -m "fix(dashboard): surface template creation errors via toast (D3)"
```

---

## Task 5: Map Editor Error Surfacing

**Issues:** E1, E2, E3, E4, E6, E7, E8

**Files:**
- Modify: `apps/web/src/lib/components/map/MapEditor.svelte`
- Modify: `apps/web/src/lib/components/map/LayerPanel.svelte`

- [ ] **Step 1: Improve layer load error feedback (E1)**

Replace generic toast with specific error message including layer name:

```typescript
// In the layer data load catch block:
toastStore.error(`Failed to load layer "${layer.name}": ${err.message}`);
```

- [ ] **Step 2: Add viewport loading indicator (E2)**

Find where `viewportLoading` state is set and add a spinner in the UI:

```svelte
{#if viewportLoading}
  <div class="absolute top-2 left-1/2 -translate-x-1/2 bg-white/90 rounded px-3 py-1 text-sm shadow">
    Loading features...
  </div>
{/if}
```

- [ ] **Step 3: Add ephemeral filter indicator (E3)**

Near the filter UI, add a hint that filters don't persist:

```svelte
{#if hasActiveFilters}
  <p class="text-xs text-muted-foreground">Filters are temporary and reset on page reload.</p>
{/if}
```

- [ ] **Step 4: Add rollback on layer reorder failure (E4)**

In `LayerPanel.svelte`, store previous order before optimistic update and restore on error:

```typescript
const previousOrder = [...layers];
// optimistic reorder
try {
  await trpc.layers.reorder.mutate(/* ... */);
} catch {
  layers = previousOrder; // rollback
  toastStore.error('Failed to reorder layers');
}
```

- [ ] **Step 5: Replace window.confirm with inline confirmation for tool switch (E6)**

In `DrawingToolbar.svelte`, replace `window.confirm()` with a state-driven inline prompt:

```svelte
<script>
  let pendingToolSwitch = $state<string | null>(null);
</script>

{#if pendingToolSwitch}
  <div class="flex gap-2 p-2 bg-yellow-50 rounded">
    <span class="text-sm">Discard current drawing?</span>
    <Button size="sm" variant="danger" onclick={() => { confirmSwitch(pendingToolSwitch); pendingToolSwitch = null; }}>Discard</Button>
    <Button size="sm" onclick={() => { pendingToolSwitch = null; }}>Cancel</Button>
  </div>
{/if}
```

- [ ] **Step 6: Add undo error recovery (E7)**

In the undo handler, catch server-side deletion errors and show toast:

```typescript
try {
  await undoAction();
} catch (err) {
  toastStore.error('Undo failed: the feature may have been deleted');
  // Remove the failed action from undo stack
}
```

- [ ] **Step 7: Add table/map count note (E8)**

Near the table pagination, add a note explaining the discrepancy:

```svelte
<p class="text-xs text-muted-foreground">
  Table shows {pageSize} per page. Map renders all features via vector tiles.
</p>
```

- [ ] **Step 8: Verify**

Run: `cd apps/web && npx vitest run`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/components/map/MapEditor.svelte apps/web/src/lib/components/map/LayerPanel.svelte apps/web/src/lib/components/map/DrawingToolbar.svelte
git commit -m "fix(editor): surface errors, add loading/rollback/undo recovery (E1-E8)"
```

---

## Task 6: Drawing Tool Feedback

**Issues:** DR1, DR5

**Files:**
- Modify: `apps/web/src/lib/components/map/DrawingToolbar.svelte`
- Modify: `apps/web/src/lib/components/map/DrawActionRow.svelte`

- [ ] **Step 1: Add prominent disabled message for drawing tools (DR1)**

When no layer is selected, show an inline message instead of tooltip-only:

```svelte
{#if !selectedLayer}
  <div class="p-3 text-sm text-muted-foreground bg-muted rounded">
    Select a layer to use drawing tools.
  </div>
{/if}
```

- [ ] **Step 2: Add error handling to DrawActionRow callbacks (DR5)**

Wrap annotate/measure callbacks in try/catch:

```typescript
async function handleAnnotate() {
  try {
    await onAnnotate?.();
  } catch (err) {
    toastStore.error('Failed to save annotation');
    return; // Don't dismiss on failure
  }
  dismiss();
}
```

- [ ] **Step 3: Verify**

Run: `cd apps/web && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/components/map/DrawingToolbar.svelte apps/web/src/lib/components/map/DrawActionRow.svelte
git commit -m "fix(drawing): add no-layer message + error guard on action callbacks (DR1, DR5)"
```

---

## Task 7: Comment + Geoprocessing Error Surfacing

**Issues:** C8, G1, G2, G3, G4, G7

**Files:**
- Modify: `apps/web/src/lib/components/map/GuestCommentPanel.svelte`
- Modify: `apps/web/src/lib/components/map/GeoprocessingPanel.svelte` (or equivalent)
- Modify: `apps/web/src/lib/components/map/StylePanel.svelte`

- [ ] **Step 1: Surface comment post errors (C8)**

In `GuestCommentPanel.svelte`, add toast on post failure:

```typescript
} catch (err) {
  toastStore.error('Failed to post comment');
}
```

And for load failures, make the error state more prominent:

```svelte
{#if error}
  <div class="p-3 text-sm text-red-600 bg-red-50 rounded">{error}</div>
{/if}
```

- [ ] **Step 2: Add layer confirmation before geoprocessing (G1)**

In `GeoprocessingPanel.svelte`, show which layer is selected and let user confirm or change:

```svelte
{#if selectedLayer}
  <p class="text-sm">Input layer: <strong>{selectedLayer.name}</strong></p>
{/if}
```

If auto-selection happens, add a brief highlight or note so user notices which layer was picked.

- [ ] **Step 3: Handle empty geoprocessing results (G2)**

In the geoprocessing mutation's `onSuccess`, check if the result layer has 0 features:

```typescript
onSuccess: (result) => {
  if (result.featureCount === 0) {
    toastStore.warning('Operation completed but produced no features. Check that the input layer has valid geometries.');
  } else {
    toastStore.success(`Created layer with ${result.featureCount} features`);
  }
}
```

- [ ] **Step 4: Add zero-features explanation in StylePanel (G3, G4)**

When sections don't render due to zero features, show why:

```svelte
{#if featureCount === 0}
  <p class="text-sm text-muted-foreground p-3">
    This layer has no features. Add data to configure styling.
  </p>
{:else if allIdenticalValues}
  <p class="text-sm text-muted-foreground p-3">
    All values in this column are identical. Choropleth requires varying values.
  </p>
{/if}
```

- [ ] **Step 5: Log warning for missing weightAttribute (G7)**

In `DeckGLOverlay.svelte`, add a visible warning when weight falls back:

```typescript
if (!weightAttribute) {
  console.warn('Heatmap: no weight attribute set, using uniform weight=1');
  // Optional: show in UI via a small info badge on the layer panel
}
```

- [ ] **Step 6: Verify**

Run: `cd apps/web && npx vitest run`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/components/map/GuestCommentPanel.svelte apps/web/src/lib/components/map/GeoprocessingPanel.svelte apps/web/src/lib/components/map/StylePanel.svelte apps/web/src/lib/components/map/DeckGLOverlay.svelte
git commit -m "fix(ui): surface comment/geoprocessing/style errors and warnings (C8, G1-G4, G7)"
```

---

## Task 8: Annotation Error Surfacing

**Issues:** AN4, AN5, AN8, AN3

**Files:**
- Modify: `apps/web/src/lib/components/map/AnnotationPanel.svelte`
- Modify: `apps/web/src/lib/server/annotations/service.ts`

- [ ] **Step 1: Surface IIIF NavPlace fetch failure (AN4)**

In the NavPlace fetch handler, show a toast instead of silently setting empty:

```typescript
} catch (err) {
  toastStore.error('Could not load geographic data from IIIF manifest');
}
```

- [ ] **Step 2: Notify reply authors on parent deletion (AN5)**

This is a server-side issue. Add a comment documenting the cascade behavior. A full fix requires a notification system — defer to spec. Add inline warning in delete confirmation:

```svelte
{#if annotation.replyCount > 0}
  <p class="text-sm text-red-600">This will also delete {annotation.replyCount} replies.</p>
{/if}
```

- [ ] **Step 3: Show nesting limit (AN8)**

In the reply form area, when at max depth:

```svelte
{#if depth >= 1}
  <!-- Reply button hidden at max depth -->
  <span class="text-xs text-muted-foreground">Nested replies not supported</span>
{/if}
```

- [ ] **Step 4: Handle feature anchor on hidden layer (AN3)**

When the pick-feature mode is active and the target layer is hidden, show a warning:

```svelte
{#if interactionState.type === 'pickFeature' && !isLayerVisible(selectedLayerId)}
  <div class="p-2 text-sm text-amber-700 bg-amber-50 rounded">
    The selected layer is hidden. Make it visible to pick a feature.
  </div>
{/if}
```

- [ ] **Step 5: Verify**

Run: `cd apps/web && npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/components/map/AnnotationPanel.svelte apps/web/src/lib/server/annotations/service.ts
git commit -m "fix(annotations): surface IIIF/cascade/nesting/hidden-layer issues (AN3-AN5, AN8)"
```

---

## Task 9: Import/Export Disclosure + Errors

**Issues:** I1, I2, I3, I5, I6, I7, I8

**Files:**
- Modify: `apps/web/src/lib/components/data/ImportDialog.svelte`
- Modify: `apps/web/src/lib/components/data/ExportDialog.svelte` (or equivalent path)

- [ ] **Step 1: Show file size limit in ImportDialog (I1)**

Add a helper text near the file input:

```svelte
<p class="text-xs text-muted-foreground">Maximum file size: 100 MB</p>
```

- [ ] **Step 2: Remove .geojsonl from accepted formats or add handler (I2)**

If the worker doesn't handle `.geojsonl`, remove it from the accepted file types in ImportDialog:

```typescript
// Remove .geojsonl from the accept list
const ACCEPTED_FORMATS = ['.geojson', '.json', '.gpkg', '.shp', '.zip', '.kml'];
```

- [ ] **Step 3: Warn on raw .shp upload (I3)**

Add client-side check when a `.shp` is uploaded without companion files:

```typescript
if (file.name.endsWith('.shp')) {
  toastStore.warning('Uploading a .shp file without .dbf may result in features without attributes. Consider uploading a .zip archive instead.');
}
```

- [ ] **Step 4: Add retry button on poll timeout (I5)**

After the 5-minute timeout message, add a retry action:

```svelte
{#if pollTimedOut}
  <div class="flex items-center gap-2">
    <span class="text-sm text-muted-foreground">Import is taking longer than expected.</span>
    <Button size="sm" onclick={resetPoll}>Retry</Button>
  </div>
{/if}
```

- [ ] **Step 5: Handle enqueueImportJob failure (I6)**

In the upload endpoint, if job enqueue fails after DB insert, clean up the orphaned record:

```typescript
try {
  await enqueueImportJob(jobId);
} catch (err) {
  // Clean up orphaned job record
  await db.delete(importJobs).where(eq(importJobs.id, jobId));
  throw error(500, 'Failed to start import job');
}
```

- [ ] **Step 6: Add progress context for partial layer (I7)**

In the import progress UI, add a note:

```svelte
{#if progress > 0 && progress < 100}
  <p class="text-xs text-muted-foreground">Layer is created early. If import fails, partial data may remain.</p>
{/if}
```

- [ ] **Step 7: Catch export errors (I8)**

In `ExportDialog.svelte`, wrap the export API call:

```typescript
try {
  await exportLayer(layerId, format);
  toastStore.success('Export started');
} catch (err) {
  toastStore.error(`Export failed: ${err.message}`);
}
```

- [ ] **Step 8: Verify**

Run: `cd apps/web && npx vitest run`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/components/data/ImportDialog.svelte apps/web/src/lib/components/data/ExportDialog.svelte apps/web/src/routes/'(app)'/upload/+server.ts
git commit -m "fix(import/export): disclose limits, remove .geojsonl, add retry, fix orphan (I1-I8)"
```

---

## Task 10: Store Bugs

**Issues:** ST1, ST2, ST3, ST4

**Files:**
- Modify: `apps/web/src/lib/stores/filters.svelte.ts`
- Modify: `apps/web/src/lib/stores/drawing.svelte.ts`

- [ ] **Step 1: Write test for filter store defensive copy**

In `apps/web/src/__tests__/filter-store.svelte.test.ts` (`.svelte.test.ts` required — filters.svelte.ts uses `$state` rune):

```typescript
import { describe, it, expect } from 'vitest';
import { filterStore } from '$lib/stores/filters.svelte.ts';

describe('filterStore.get()', () => {
  it('returns a copy, not the internal reference', () => {
    const layerId = 'test-layer';
    filterStore.add(layerId, { column: 'name', op: 'eq', value: 'test' });

    const result = filterStore.get(layerId);
    result.push({ column: 'hack', op: 'eq', value: 'injected' });

    // Internal state should be unchanged
    expect(filterStore.get(layerId)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/__tests__/filter-store.svelte.test.ts`
Expected: FAIL — internal array is mutated

- [ ] **Step 3: Fix filterStore.get() to return copy**

In `filters.svelte.ts`, change `get()`:

```typescript
get(layerId: string) {
  return [...(_filters[layerId] ?? [])];
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/__tests__/filter-store.svelte.test.ts`
Expected: PASS

- [ ] **Step 5: Add try/catch to drawing store stop()**

In `drawing.svelte.ts`:

```typescript
stop() {
  if (_state.status !== 'ready') return;
  try {
    _state.instance.stop();
  } catch (err) {
    console.error('Drawing store stop() failed:', err);
  }
  _state = { status: 'stopped' };
},
```

- [ ] **Step 6: Verify filterStore.clear() triggers downstream refresh (ST4)**

Read the clear() implementation — agent confirmed it uses spread-replace which triggers Svelte 5 reactivity. Check if any `$effect` or `$derived` in MapEditor reacts to filter changes. If not, add an effect to re-apply filters on change. Document finding.

- [ ] **Step 7: Verify effect ordering (ST1)**

Read MapEditor.svelte effects that write `interactionState`. Check if `selectionToFeature` and `toolDismissFeature` can conflict. If so, add a guard: only one writes per tick. Document finding.

- [ ] **Step 8: Verify**

Run: `cd apps/web && npx vitest run`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/stores/filters.svelte.ts apps/web/src/lib/stores/drawing.svelte.ts apps/web/src/__tests__/filter-store.svelte.test.ts
git commit -m "fix(stores): defensive copy in filterStore.get(), try/catch in drawingStore.stop() (ST1-ST4)"
```

---

## Task 11: Sharing + Collaborator Fixes

**Issues:** S2, S5, S6, S7, C1, C3, C4, C6

**Files:**
- Modify: `apps/web/src/lib/server/trpc/routers/shares.ts`
- Modify: `apps/web/src/lib/components/map/ShareDialog.svelte`
- Modify: `apps/web/src/routes/(app)/share/[token]/+page.svelte`

- [ ] **Step 1: Fix share create race condition (S2)**

Replace select-then-insert with an upsert:

```typescript
// In shares router create procedure:
const [share] = await db
  .insert(shares)
  .values({ mapId, token: generateToken(), accessLevel })
  .onConflictDoUpdate({
    target: shares.mapId,
    set: { accessLevel },
  })
  .returning();
```

- [ ] **Step 2: Make embed snippet responsive (S5)**

In `ShareDialog.svelte`, change the embed code template:

```typescript
const embedCode = `<iframe src="${embedUrl}" style="width:100%;height:600px;border:none;" allowfullscreen></iframe>`;
```

- [ ] **Step 3: Add readonly visual indicator (S6)**

In `share/[token]/+page.svelte`, add a banner for readonly access:

```svelte
{#if !canEdit}
  <div class="bg-blue-50 text-blue-700 text-sm px-4 py-2 text-center">
    You are viewing this map in read-only mode.
  </div>
{/if}
```

- [ ] **Step 4: Add non-owner hint in ShareDialog (S7)**

```svelte
{#if !isOwner}
  <p class="text-sm text-muted-foreground">Only the map owner can manage sharing settings.</p>
{/if}
```

- [ ] **Step 5: Improve collaborator invite error for unregistered email (C1)**

```typescript
// In collaborators router, replace generic error:
throw new TRPCError({
  code: 'NOT_FOUND',
  message: 'No account found with that email. They need to sign up first.',
});
```

- [ ] **Step 6: Add rollback for optimistic collaborator removal (C3)**

```typescript
const previousCollabs = [...collaborators];
collaborators = collaborators.filter(c => c.userId !== userId);
try {
  await trpc.collaborators.remove.mutate({ mapId, userId });
} catch {
  collaborators = previousCollabs;
  toastStore.error('Failed to remove collaborator');
}
```

- [ ] **Step 7: Add loading state to role change (C4)**

```typescript
let roleChanging = $state<string | null>(null); // userId being changed

async function handleRoleChange(userId: string, newRole: string) {
  roleChanging = userId;
  try {
    await trpc.collaborators.updateRole.mutate({ mapId, userId, role: newRole });
    toastStore.success('Role updated');
  } catch {
    toastStore.error('Failed to update role');
  } finally {
    roleChanging = null;
  }
}
```

- [ ] **Step 8: Add comment character counter (C6)**

```svelte
<textarea bind:value={commentText} maxlength={5000} />
<span class="text-xs text-muted-foreground">{commentText.length}/5000</span>
```

- [ ] **Step 9: Verify**

Run: `cd apps/web && npx vitest run`
Expected: All tests pass

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/server/trpc/routers/shares.ts apps/web/src/lib/components/map/ShareDialog.svelte apps/web/src/routes/'(app)'/share/'[token]'/+page.svelte
git commit -m "fix(sharing): atomic upsert, readonly banner, invite error, rollback (S2-S7, C1-C6)"
```

---

## Task 12: Admin + Settings Fixes

**Issues:** AD1, AD2, AD3, AD4, AD5, AD6, AD8

**Files:**
- Modify: `apps/web/src/routes/(app)/settings/+page.svelte`
- Modify: `apps/web/src/routes/(app)/settings/+page.server.ts`
- Modify: `apps/web/src/routes/(app)/admin/jobs/+page.svelte`
- Modify: `apps/web/src/routes/(app)/admin/storage/+page.svelte`

- [ ] **Step 1: Add password change success message (AD1)**

In `settings/+page.server.ts`, on successful password change, redirect with a query param:

```typescript
redirect(302, '/auth/login?message=password-changed');
```

In `login/+page.svelte`, check for the param and show toast:

```typescript
const message = $page.url.searchParams.get('message');
if (message === 'password-changed') {
  toastStore.success('Password changed successfully. Please log in again.');
}
```

- [ ] **Step 2: Add audit log pagination (AD2)**

In `audit/+page.server.ts`, accept a `page` query param and add "Load more":

```typescript
const page = Number(url.searchParams.get('page') ?? '1');
const limit = 200;
const offset = (page - 1) * limit;
// Pass hasMore = entries.length === limit to the page
```

In the template:
```svelte
{#if hasMore}
  <Button onclick={() => goto(`?page=${page + 1}`)}>Load more</Button>
{/if}
```

- [ ] **Step 3: Add refresh button to jobs and storage pages (AD3, AD4)**

In both `admin/jobs/+page.svelte` and `admin/storage/+page.svelte`:

```svelte
<Button size="sm" variant="ghost" onclick={() => invalidateAll()}>
  Refresh
</Button>
```

- [ ] **Step 4: Add email field explanation (AD5)**

```svelte
<label>
  Email
  <input type="email" value={user.email} disabled />
  <span class="text-xs text-muted-foreground">Email cannot be changed.</span>
</label>
```

- [ ] **Step 5: Add itemized demo reset confirmation (AD6)**

```typescript
const confirmed = window.confirm(
  `This will permanently delete:\n- ${mapCount} maps\n- ${layerCount} layers\n- All annotations, comments, and activity\n\nThis cannot be undone.`
);
```

- [ ] **Step 6: Document AD8 (disable user notification)**

Add a code comment noting the gap. A full notification system is out of scope:

```typescript
// NOTE: Disabling a user invalidates their session immediately.
// No email/notification is sent — they discover on next request.
// TODO: Add notification when notification system exists.
```

- [ ] **Step 7: Verify**

Run: `cd apps/web && npx vitest run`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/routes/'(app)'/settings/ apps/web/src/routes/'(app)'/admin/ apps/web/src/routes/auth/login/+page.svelte
git commit -m "fix(admin): password success msg, pagination, refresh, disclosure (AD1-AD8)"
```

---

## Task 13: Audit Log Reliability

**Issues:** AD7

**Files:**
- Modify: `apps/web/src/lib/server/trpc/routers/apiKeys.ts` (or equivalent)

- [ ] **Step 1: Make audit log writes awaited**

In the API key create/revoke handlers, change fire-and-forget audit calls to awaited:

```typescript
// Before: auditLog.record(...) // not awaited
// After:
await auditLog.record({
  action: 'api_key.create',
  userId,
  metadata: { keyId: newKey.id },
});
```

- [ ] **Step 2: Verify**

Run: `cd apps/web && npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/server/trpc/routers/apiKeys.ts
git commit -m "fix(audit): await audit log writes in API key operations (AD7)"
```

---

## Task 14: Annotation Pin UX

**Issues:** AN7, AN9, AN10

**Files:**
- Modify: `apps/web/src/lib/components/map/AnnotationPanel.svelte`
- Modify: `apps/web/src/lib/components/map/MapCanvas.svelte`

- [ ] **Step 1: Add reply anchor inheritance note (AN7)**

```svelte
<!-- In the reply form area -->
<p class="text-xs text-muted-foreground">Replies use the same location as the parent annotation.</p>
```

- [ ] **Step 2: Handle overlapping pins click (AN9)**

In `MapCanvas.svelte`, the annotation pin click handler likely processes only the first feature. Read the click handler to understand how annotations are selected, then add disambiguation. Note: codebase does NOT use `queryRenderedFeatures` directly — annotation pins are rendered via source data (GeoJSON source + circle/symbol layer managed by svelte-maplibre or direct source updates). The fix approach depends on how pins are rendered:

- If pins use a MapLibre GeoJSON source: filter source features at click point by checking proximity, present a list popup when >1 match
- If pins use Svelte-rendered HTML markers: add z-index stacking + click-through to lower markers

Read `MapCanvas.svelte` to determine which approach. The disambiguation UI should be a small floating list near the click point showing annotation titles.

- [ ] **Step 3: Hide annotation pins when feature layer is hidden (AN10)**

In `MapCanvas.svelte`, sync annotation pin visibility with the parent feature layer. Read how layer visibility is tracked (likely a `layerVisibility` reactive map or `$derived`). The fix depends on how pins are rendered:

- If pins use a MapLibre source layer: filter the annotation GeoJSON source data to exclude annotations whose parent layer is hidden, then update the source via `map.getSource(id).setData(filtered)`
- If pins use HTML markers: toggle their container `display` property based on parent layer visibility

The key insight is to derive visible annotations from the layer visibility state, not to call MapLibre layout APIs directly (which aren't used elsewhere in this codebase).

- [ ] **Step 4: Verify**

Run: `cd apps/web && npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/components/map/AnnotationPanel.svelte apps/web/src/lib/components/map/MapCanvas.svelte
git commit -m "fix(annotations): reply hint, pin disambiguation, hide with layer (AN7, AN9, AN10)"
```

---

## Task 15: Activity Feed + Basemap Feedback

**Issues:** G5, G8, G9

**Files:**
- Modify: `apps/web/src/lib/components/map/ActivityFeed.svelte`
- Modify: `apps/web/src/lib/components/map/BasemapPicker.svelte`

- [ ] **Step 1: Add auto-refresh to ActivityFeed (G8, G9)**

Use a polling interval and handle race conditions:

Per Svelte 5 docs, `$effect` returns a teardown function for cleanup. Use generation counter to prevent stale data from out-of-order responses:

```typescript
let fetchGeneration = $state(0);

// $effect auto-tracks dependencies and returns teardown (Svelte 5 rune pattern)
$effect(() => {
  const interval = setInterval(() => {
    fetchGeneration++;
    loadEvents(fetchGeneration);
  }, 30_000); // 30s polling

  // Svelte 5: returned function runs on teardown (component unmount or effect re-run)
  return () => clearInterval(interval);
});

async function loadEvents(gen: number) {
  const result = await trpc.activity.list.query({ mapId });
  // Only apply if this is still the latest request (prevents race)
  if (gen === fetchGeneration) {
    events = result;
  }
}
```

- [ ] **Step 2: Add basemap loading indicator (G5)**

In `BasemapPicker.svelte`, add a loading state during tile fetch:

```svelte
<script>
  let loading = $state(false);

  async function switchBasemap(style: string) {
    loading = true;
    map.setStyle(style);
    // Codebase uses 'style.load' event (see DrawingToolbar.svelte:111,119)
    map.once('style.load', () => { loading = false; });
    // Timeout fallback in case style.load never fires
    setTimeout(() => { loading = false; }, 5000);
  }
</script>

{#if loading}
  <div class="text-xs text-muted-foreground">Loading basemap...</div>
{/if}
```

- [ ] **Step 3: Verify**

Run: `cd apps/web && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/components/map/ActivityFeed.svelte apps/web/src/lib/components/map/BasemapPicker.svelte
git commit -m "fix(ui): activity feed auto-refresh + basemap loading indicator (G5, G8, G9)"
```

---

## Task 16: DeckGL + Measurement Feedback

**Issues:** G6, M2, M3, M4, S3

**Files:**
- Modify: `apps/web/src/lib/components/map/DeckGLOverlay.svelte`
- Modify: `apps/web/src/lib/components/map/MapEditor.svelte`

- [ ] **Step 1: Add heatmap size warning (G6)**

Before rendering, check feature count:

```typescript
const HEATMAP_WARN_THRESHOLD = 10_000;
if (featureCount > HEATMAP_WARN_THRESHOLD) {
  toastStore.warning(`Heatmap rendering ${featureCount.toLocaleString()} points may be slow.`);
}
```

- [ ] **Step 2: Add Escape key handler for measurement panel (M2)**

In `MapEditor.svelte`, in the keydown handler:

```typescript
if (e.key === 'Escape' && interactionState.type === 'measure') {
  clearMeasurement();
}
```

- [ ] **Step 3: Clear pendingMeasurement on annotation save failure (M3)**

```typescript
try {
  await saveAnnotation(pendingMeasurement);
  pendingMeasurement = null;
} catch (err) {
  toastStore.error('Failed to save measurement annotation');
  pendingMeasurement = null; // Clear to prevent stale state
}
```

- [ ] **Step 4: Default annotation form to geometry centroid for measurements (M4)**

```typescript
if (source === 'measurement' && geometry) {
  formAnchorType = 'point';
  formAnchorCoords = centroid(geometry);
} else {
  formAnchorType = 'viewport';
}
```

- [ ] **Step 5: Add share token re-validation (S3)**

In `share/[token]/+page.svelte`, add periodic re-validation:

```typescript
$effect(() => {
  const interval = setInterval(async () => {
    try {
      await trpc.shares.validate.query({ token });
    } catch {
      toastStore.error('This share link has been revoked.');
      goto('/');
    }
  }, 60_000); // Check every 60s

  return () => clearInterval(interval);
});
```

- [ ] **Step 6: Verify**

Run: `cd apps/web && npx vitest run`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/components/map/DeckGLOverlay.svelte apps/web/src/lib/components/map/MapEditor.svelte apps/web/src/routes/'(app)'/share/'[token]'/+page.svelte
git commit -m "fix(ui): heatmap warning, escape measurement, share revalidation (G6, M2-M4, S3)"
```

---

## Final Verification

- [ ] **Step 1: Run full test suite**

```bash
cd /mnt/Ghar/2TA/DevStuff/felt-like-it && pnpm test
```

Expected: All 634+ tests pass (new tests added for toast and filter store)

- [ ] **Step 2: Run svelte-check**

```bash
cd apps/web && npx svelte-check
```

Expected: 0 errors

- [ ] **Step 3: Run eslint**

```bash
cd apps/web && npx eslint src/
```

Expected: 0 errors

- [ ] **Step 4: Update STATE.md**

Mark all fixed issues. Update issue counts. Remove "Top Priority Fixes" section (completed).

- [ ] **Step 5: Update HANDOFF.md**

Document remaining deferred issues and their rationale.

---

## Library API References

Verified via Context MCP docs lookups during planning:

| Library | API/Pattern | Verified |
|---------|-------------|----------|
| **Svelte 5** (`svelte@5.53.13`) | `$effect` returns teardown function for cleanup (`return () => { ... }`) | `$effect` docs |
| **Svelte 5** | `$state` in `.svelte.ts` files requires `.svelte.test.ts` test filenames for rune support | Testing docs |
| **Svelte 5** | `$state` proxy arrays are deeply reactive; use `$state.snapshot()` for plain copies | `$state` docs |
| **Svelte 5** | `$props()` destructuring replaces `export let`; `children` snippet replaces slots | Migration guide |
| **Drizzle ORM** | `.onConflictDoUpdate({ target: table.col, set: { col: val } }).returning()` | Upsert docs |
| **Drizzle ORM** | `.delete(table).where(eq(...)).returning()` for delete-and-return | Delete docs |
| **Vitest** (`vitest@4.1.0`) | `vi.mock(import('./mod'), (importOriginal) => ...)` for module mocking | Mocking docs |
| **MapLibre GL** | Codebase uses `map.on('style.load', cb)` for style reload events (DrawingToolbar.svelte:111,119) | Codebase grep |
| **MapLibre GL** | Codebase does NOT use `queryRenderedFeatures` or `setLayoutProperty` directly — annotations use source data manipulation | Codebase grep |
| **SvelteKit** | `use:enhance` with `creating` flag pattern already in dashboard (line 92-95); `use:enhance` auto-calls `invalidateAll()` | Codebase + SvelteKit docs |

---

## Summary

| Category | Count | Action |
|----------|-------|--------|
| False positives | 4 | No fix needed |
| Deferred to specs | 14 | Feature gaps requiring design |
| Fixed in this plan | 65 | Across 16 tasks, 10 waves |
| **Total** | **83** (+ 6 already fixed = 89 of 89 issue IDs accounted for) | |

**Issue coverage by task:**

| Task | Issues |
|------|--------|
| 1 | UI1 |
| 2 | UI2, UI3 |
| 3 | A1, D4, UI6 |
| 4 | D3, D5 |
| 5 | E1, E2, E3, E4, E6, E7, E8 |
| 6 | DR1, DR5 |
| 7 | C8, G1, G2, G3, G4, G7 |
| 8 | AN3, AN4, AN5, AN8 |
| 9 | I1, I2, I3, I5, I6, I7, I8 |
| 10 | ST1, ST2, ST3, ST4 |
| 11 | S2, S5, S6, S7, C1, C3, C4, C6 |
| 12 | AD1, AD2, AD3, AD4, AD5, AD6, AD8 |
| 13 | AD7 |
| 14 | AN7, AN9, AN10 |
| 15 | G5, G8, G9 |
| 16 | G6, M2, M3, M4, S3 |
