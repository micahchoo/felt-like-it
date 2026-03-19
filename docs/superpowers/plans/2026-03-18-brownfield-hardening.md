# Brownfield Hardening Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix bugs, harden UX flows, decompose MapEditor, and add characterization tests — 4 iterations of brownfield polish.

**Architecture:** Iteration 1 fixes 5 confirmed bugs in existing components. Iteration 2 hardens 6 UX flows with validation, cancel, and error feedback. Iteration 3 extracts 4 concerns from the 1051-line MapEditor into stores/components. Iteration 4 adds characterization tests for 6 untested modules.

**Tech Stack:** SvelteKit 5 (runes), MapLibre GL, Terra Draw, TanStack Query, tRPC 11, Vitest

---

## File Structure

### Iteration 1 (Bug Fixes) — Modify Only
- `apps/web/src/lib/components/annotations/AnnotationPanel.svelte` (cancel reset, image upload)
- `apps/web/src/lib/components/map/GuestCommentPanel.svelte` (comment validation)
- `apps/web/src/lib/components/map/DrawingToolbar.svelte` (save error cleanup)
- `apps/web/src/lib/components/data/ImportDialog.svelte` (poll timeout)

### Iteration 2 (UX Hardening) — Modify Only
- `apps/web/src/lib/components/annotations/AnnotationPanel.svelte` (validation hint, orphan repair)
- `apps/web/src/lib/components/annotations/AnnotationContent.svelte` (orphan action)
- `apps/web/src/lib/components/map/DrawingToolbar.svelte` (escape key, tool switch)
- `apps/web/src/lib/components/data/ExportDialog.svelte` (blob URL race)
- `apps/web/src/lib/components/geoprocessing/GeoprocessingPanel.svelte` (cancel)
- `apps/web/src/lib/server/annotations/service.ts` (convertToPoint mutation)
- `apps/web/src/lib/server/trpc/routers/annotations.ts` (convertToPoint endpoint)

### Iteration 3 (MapEditor Decomposition) — Create + Modify
- Create: `apps/web/src/lib/stores/annotation-geo.svelte.ts`
- Create: `apps/web/src/lib/stores/interaction-modes.svelte.ts`
- Create: `apps/web/src/lib/stores/viewport.svelte.ts`
- Create: `apps/web/src/lib/components/map/MeasurementPanel.svelte`
- Modify: `apps/web/src/lib/components/map/MapEditor.svelte`

### Iteration 4 (Characterization Tests) — Create Only
- Create: `apps/web/src/__tests__/drawing-store.test.ts`
- Create: `apps/web/src/__tests__/map-store.test.ts`
- Create: `apps/web/src/__tests__/selection-store.test.ts`
- Create: `apps/web/src/__tests__/annotation-service.test.ts`
- Create: `apps/web/src/__tests__/resolve-feature-id.test.ts`
- Create: `apps/web/src/__tests__/geo-access.test.ts`

---

## Execution Waves

- **Wave 1**: Tasks 1-5 (Iteration 1 bug fixes — all independent, parallel)
- **Wave 2**: Tasks 6-11, 8b (Iteration 2 UX hardening — all independent, parallel)
- **Wave 3**: Task 12 first (annotation-geo store), then Tasks 13-15 (parallel — interaction-modes store, viewport store, measurement panel). All depend on Task 12 completing first only because they all modify MapEditor.svelte.
- **Wave 4**: Tasks 16-21 (Iteration 4 characterization tests — all independent, parallel). Tasks 16-17 can start in Wave 1 since drawing.svelte.ts and map.svelte.ts are already separate modules.

---

## Iteration 1: Bug Fixes

### Task 1: AnnotationPanel — Cancel button must reset form

**Files:**
- Modify: `apps/web/src/lib/components/annotations/AnnotationPanel.svelte:617,628`

<interfaces>
<!-- AnnotationPanel internal state (not exported, modify in-place) -->
function resetForm(): void
// Resets: formType, formText, formEmoji, formEmojiLabel, formGifUrl, formAltText,
// formImageUrl, formCaption, formLinkUrl, formLinkTitle, formLinkDesc,
// formManifestUrl, formIiifLabel, formAnchorType, formLng, formLat,
// selectedImageFile, gpsExtracted, pendingMeasurementData
// Also revokes imagePreviewUrl blob if present
</interfaces>

- [ ] **Step 1: Write failing test for cancel-reset behavior**

This is a UX bug in a Svelte component without component tests. Instead of adding a component test framework, verify manually after the fix. Skip to implementation.

- [ ] **Step 2: Fix the cancel buttons**

At line 617 (non-embedded cancel):
```svelte
onclick={() => { showForm = !showForm; createError = null; }}
```
Change to:
```svelte
onclick={() => { if (showForm) resetForm(); showForm = !showForm; createError = null; }}
```

At line 628 (embedded cancel) — identical fix:
```svelte
onclick={() => { if (showForm) resetForm(); showForm = !showForm; createError = null; }}
```

- [ ] **Step 3: Verify**

Run: `cd apps/web && npx vite build 2>&1 | tail -5`
Expected: Build succeeds (no type errors)

- [ ] **Step 4: Manual verification logic**

Open the app, create an annotation, fill in text + emoji, click Cancel, click "+ Add" again. Form should be blank.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/components/annotations/AnnotationPanel.svelte
git commit -m "fix: reset annotation form state when cancel button is clicked"
```

---

### Task 2: AnnotationPanel — Clear stale formImageUrl before upload retry

**Files:**
- Modify: `apps/web/src/lib/components/annotations/AnnotationPanel.svelte:497-503`

- [ ] **Step 1: Add formImageUrl clearing before upload**

At line 497, the current code is:
```typescript
if (formType === 'image' && selectedImageFile) {
  uploading = true;
  try {
    formImageUrl = await uploadImageFile(selectedImageFile);
  } finally {
    uploading = false;
  }
}
```

Change to:
```typescript
if (formType === 'image' && selectedImageFile) {
  uploading = true;
  formImageUrl = ''; // Clear stale URL from any previous upload attempt
  try {
    formImageUrl = await uploadImageFile(selectedImageFile);
  } finally {
    uploading = false;
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd apps/web && npx vite build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/components/annotations/AnnotationPanel.svelte
git commit -m "fix: clear stale formImageUrl before annotation image upload retry"
```

---

### Task 3: GuestCommentPanel — Add validation feedback for empty comments

**Files:**
- Modify: `apps/web/src/lib/components/map/GuestCommentPanel.svelte`

<interfaces>
<!-- Current handleSubmit (line ~47): -->
async function handleSubmit(e: Event) {
  e.preventDefault();
  const body = newBody.trim();
  const name = authorName.trim();
  if (!body || !name) return;  // <-- silent rejection
  // ...
}
// State vars: authorName, newBody, submitting, error
</interfaces>

- [ ] **Step 1: Add disabled state to submit button and placeholder text**

Find the submit button in the template (it uses `<Button type="submit">`). Add `disabled` prop:
```svelte
<Button type="submit" size="sm" loading={submitting} disabled={!newBody.trim() || !authorName.trim()}>
  Post
</Button>
```

Add `placeholder="Your name"` to the author input and `placeholder="Write a comment..."` to the body textarea if not already present.

- [ ] **Step 2: Verify build**

Run: `cd apps/web && npx vite build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/components/map/GuestCommentPanel.svelte
git commit -m "fix: disable comment submit when name or body is empty"
```

---

### Task 4: DrawingToolbar — Clean up Terra Draw geometry on failed save

**Files:**
- Modify: `apps/web/src/lib/components/map/DrawingToolbar.svelte:189-191`

<interfaces>
<!-- saveFeature function (line 133-191): -->
async function saveFeature(f: GeoJSONStoreFeatures) {
  // ... upsert via tRPC mutation ...
  // On success: calls onfeaturedrawn callback, then removeFeatures clears overlay
  // On failure (line 189-191):
  } catch (err) {
    console.error('[DrawingToolbar] saveFeature failed:', err);
    toastStore.error('Failed to save drawn feature.');
    // BUG: Terra Draw overlay geometry persists after failed save
  }
}
// drawingStore.instance.removeFeatures([id]) — removes feature from Terra Draw state
// f.id — the Terra Draw feature ID (not the database UUID)
</interfaces>

- [ ] **Step 1: Add geometry cleanup to catch block**

Change lines 189-191 from:
```typescript
} catch (err) {
  console.error('[DrawingToolbar] saveFeature failed:', err);
  toastStore.error('Failed to save drawn feature.');
}
```

To:
```typescript
} catch (err) {
  console.error('[DrawingToolbar] saveFeature failed:', err);
  toastStore.error('Failed to save drawn feature.');
  // Clean up the failed geometry from Terra Draw's internal state
  // so it doesn't persist visually or corrupt future draw operations.
  try {
    drawingStore.instance?.removeFeatures([f.id]);
  } catch (cleanupErr) {
    console.warn('[DrawingToolbar] cleanup after failed save:', cleanupErr);
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd apps/web && npx vite build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/components/map/DrawingToolbar.svelte
git commit -m "fix: clean up Terra Draw geometry when feature save fails"
```

---

### Task 5: ImportDialog — Add poll timeout detection

**Files:**
- Modify: `apps/web/src/lib/components/data/ImportDialog.svelte`

<interfaces>
<!-- Current poll mechanism: -->
// State: jobId, pollInterval, uploading, progress
// handleUpload() sets pollInterval = setInterval(pollJob, 1500)
// pollJob() checks job.status === 'done' | 'failed', clears interval
// No timeout — if server stalls, modal stays open forever
// reset() clears: selectedFile, layerName, jobId, progress, uploading, pollInterval
</interfaces>

- [ ] **Step 1: Add poll start timestamp and timeout check**

Add state variable near other poll state:
```typescript
let pollStartedAt: number | null = null;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
```

In `handleUpload()`, after `pollInterval = setInterval(pollJob, 1500)`, add:
```typescript
pollStartedAt = Date.now();
```

In `pollJob()`, add timeout check at the beginning (after `if (!jobId) return;`):
```typescript
if (pollStartedAt && Date.now() - pollStartedAt > POLL_TIMEOUT_MS) {
  clearInterval(pollInterval!);
  pollInterval = null;
  uploading = false;
  toastStore.error('Import is taking longer than expected. Check back later or try a smaller file.');
  return;
}
```

In `reset()`, add:
```typescript
pollStartedAt = null;
```

- [ ] **Step 2: Verify build**

Run: `cd apps/web && npx vite build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/components/data/ImportDialog.svelte
git commit -m "fix: add 5-minute timeout for import poll to prevent infinite modal"
```

---

## Iteration 2: UX Flow Hardening

### Task 6: AnnotationPanel — Add inline validation feedback

**Files:**
- Modify: `apps/web/src/lib/components/annotations/AnnotationPanel.svelte:954-961`

- [ ] **Step 1: Add helper text below submit button**

Find the submit button area (~line 954). After the submit button, add conditional helper text:
```svelte
{#if !canSubmit}
  <p class="text-xs text-slate-500 mt-1">
    {#if formAnchorType === 'feature' && !pickedFeature && formAnchorType !== 'viewport'}
      Pick a feature on the map to anchor this annotation.
    {:else if formType === 'text' && !formText.trim()}
      Write some text to save this annotation.
    {:else}
      Add content (text, emoji, image, or link) to save.
    {/if}
  </p>
{/if}
```

Where `canSubmit` mirrors the existing disabled logic. Extract the disabled condition into a `$derived`:
```typescript
const canSubmit = $derived(/* existing disabled logic inverted */);
```

- [ ] **Step 2: Verify build**

Run: `cd apps/web && npx vite build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/components/annotations/AnnotationPanel.svelte
git commit -m "feat: add inline validation hints to annotation form"
```

---

### Task 7: Orphaned annotations — Add "Convert to point" repair action

**Files:**
- Modify: `apps/web/src/lib/server/annotations/service.ts` (add convertAnchorToPoint function)
- Modify: `apps/web/src/lib/server/trpc/routers/annotations.ts` (add convertToPoint endpoint)
- Modify: `apps/web/src/lib/components/annotations/AnnotationContent.svelte` (add repair button)
- Modify: `apps/web/src/lib/components/annotations/AnnotationPanel.svelte` (wire mutation)
- Test: `apps/web/src/__tests__/annotation-objects.test.ts` (add conversion test)

<interfaces>
<!-- AnnotationContent props (line 7-17): -->
interface Props {
  content: AC;
  authorName: string;
  createdAt: Date;
  anchorType?: string;
  featureDeleted?: boolean;
  compact?: boolean;
}
// Currently renders opacity-60 + warning banner when featureDeleted=true
// Need to add: onconverttopoint callback prop

<!-- annotation service (service.ts): -->
// Uses db, annotations table, annotationObjects table
// Each annotation has anchor: { type: 'feature' | 'point' | 'region' | 'viewport', ... }
// Need: function to update anchor from feature→point using feature's last known centroid
</interfaces>

- [ ] **Step 1: Write failing test for convertToPoint**

In `apps/web/src/__tests__/annotation-objects.test.ts`, add:
```typescript
describe('annotations.convertToPoint', () => {
  it('converts feature-anchored annotation to point anchor', async () => {
    // Setup: mock annotation with feature anchor
    // Call: convertToPoint procedure
    // Assert: anchor type changed to 'point', coordinates present
  });

  it('rejects conversion of non-feature-anchored annotations', async () => {
    // Setup: mock annotation with viewport anchor
    // Call: convertToPoint procedure
    // Assert: throws BAD_REQUEST
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/__tests__/annotation-objects.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: FAIL — convertToPoint not defined

- [ ] **Step 3: Add convertAnchorToPoint to annotation service**

In `apps/web/src/lib/server/annotations/service.ts`, add:
```typescript
export async function convertAnchorToPoint(
  annotationId: string,
  mapId: string,
  coordinates: [number, number],
): Promise<void> {
  await db
    .update(annotations)
    .set({ anchor: { type: 'point', geometry: { type: 'Point', coordinates } } })
    .where(and(eq(annotations.id, annotationId), eq(annotations.mapId, mapId)));
}
```

- [ ] **Step 4: Add tRPC endpoint**

In `apps/web/src/lib/server/trpc/routers/annotations.ts`, add:
```typescript
convertToPoint: protectedProcedure
  .input(z.object({
    mapId: z.string().uuid(),
    annotationId: z.string().uuid(),
    coordinates: z.tuple([z.number(), z.number()]),
  }))
  .mutation(async ({ input, ctx }) => {
    await requireMapAccess(ctx.user.id, input.mapId, 'editor');
    await convertAnchorToPoint(input.annotationId, input.mapId, input.coordinates);
  }),
```

- [ ] **Step 5: Run tests**

Run: `cd apps/web && npx vitest run src/__tests__/annotation-objects.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 6: Add repair button to AnnotationContent**

In `apps/web/src/lib/components/annotations/AnnotationContent.svelte`, add prop:
```typescript
onconverttopoint?: () => void;
```

In the `featureDeleted` banner section (~line 46), add after the warning text:
```svelte
{#if featureDeleted}
  <div class="flex items-center gap-2 text-xs text-amber-400 mb-1">
    <span>Anchored feature was deleted.</span>
    {#if onconverttopoint}
      <button class="underline hover:text-amber-300" onclick={onconverttopoint}>Convert to point</button>
    {/if}
  </div>
{/if}
```

- [ ] **Step 7: Wire mutation in AnnotationPanel**

In AnnotationPanel, add a `convertToPointMutation` using `createMutation`, and pass the callback to AnnotationContent.

- [ ] **Step 8: Verify build + commit**

Run: `cd apps/web && npx vite build 2>&1 | tail -5`

```bash
git add apps/web/src/lib/components/annotations/AnnotationContent.svelte \
       apps/web/src/lib/components/annotations/AnnotationPanel.svelte \
       apps/web/src/lib/server/annotations/service.ts \
       apps/web/src/lib/server/trpc/routers/annotations.ts \
       apps/web/src/__tests__/annotation-objects.test.ts
git commit -m "feat: add 'Convert to point' repair action for orphaned annotations"
```

---

### Task 8: DrawingToolbar — Add Escape key to cancel mid-draw

**Files:**
- Modify: `apps/web/src/lib/components/map/DrawingToolbar.svelte`

<interfaces>
<!-- DrawingToolbar has access to: -->
// drawingStore.instance: TerraDraw | null (has .stop(), .removeFeatures(), .getSnapshot())
// selectionStore.setActiveTool(tool: DrawTool)
// The component already handles tool switching; needs keyboard listener
// MapEditor.svelte:515-533 handles Escape at the MapEditor level for some modes
// Check if MapEditor Escape handler already covers drawing — if so, wire it through
</interfaces>

- [ ] **Step 1: Check existing Escape handling in MapEditor**

Read `MapEditor.svelte:515-533` to see if Escape already cancels drawing. If it does, this task reduces to ensuring Terra Draw geometry is cleaned up.

- [ ] **Step 2: Add Escape key handler to DrawingToolbar**

Add a `$effect` that listens for Escape when a drawing tool is active:
```typescript
$effect(() => {
  if (!drawingStore.isReady) return;
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      // Get any in-progress features and remove them
      const snapshot = drawingStore.instance?.getSnapshot();
      if (snapshot) {
        const inProgress = snapshot.filter((f) => f.properties?.mode !== 'static');
        if (inProgress.length > 0) {
          drawingStore.instance?.removeFeatures(inProgress.map((f) => f.id!));
        }
      }
      selectionStore.setActiveTool('select');
    }
  }
  document.addEventListener('keydown', handleKeydown);
  return () => document.removeEventListener('keydown', handleKeydown);
});
```

- [ ] **Step 3: Verify build + commit**

Run: `cd apps/web && npx vite build 2>&1 | tail -5`

```bash
git add apps/web/src/lib/components/map/DrawingToolbar.svelte
git commit -m "feat: add Escape key to cancel in-progress drawing"
```

---

### Task 8b: DrawingToolbar — Confirm before discarding partial geometry on tool switch

**Files:**
- Modify: `apps/web/src/lib/components/map/DrawingToolbar.svelte`

<interfaces>
<!-- DrawingToolbar tool sync effect (existing): -->
// $effect that watches selectionStore.activeTool and syncs to Terra Draw mode
// drawingStore.instance.getSnapshot() returns current features including in-progress ones
// In-progress features have properties.mode !== 'static'
</interfaces>

- [ ] **Step 1: Add in-progress geometry check before tool switch**

In the existing `$effect` that syncs `selectionStore.activeTool` to Terra Draw mode, add a check before switching:
```typescript
// Before changing Terra Draw mode, check for in-progress geometry
const snapshot = drawingStore.instance?.getSnapshot() ?? [];
const inProgress = snapshot.filter((f) => f.properties?.mode !== 'static');
if (inProgress.length > 0) {
  const confirmed = window.confirm('You have an unfinished drawing. Discard it?');
  if (!confirmed) {
    // Revert the tool selection to the current drawing tool
    return;
  }
  // User confirmed — remove in-progress features
  drawingStore.instance?.removeFeatures(inProgress.map((f) => f.id!));
}
```

Note: `window.confirm` is acceptable for an MVP. A custom modal can replace it in a future polish pass.

- [ ] **Step 2: Verify build + commit**

Run: `cd apps/web && npx vite build 2>&1 | tail -5`

```bash
git add apps/web/src/lib/components/map/DrawingToolbar.svelte
git commit -m "feat: confirm before discarding partial geometry on drawing tool switch"
```

---

### Task 9: ExportDialog — Fix blob URL revocation race

**Files:**
- Modify: `apps/web/src/lib/components/data/ExportDialog.svelte`

<interfaces>
<!-- downloadLayer function (current): -->
async function downloadLayer(format: string, extension: string): Promise<void> {
  // ... fetch, blob ...
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);  // <-- immediate revocation
}
</interfaces>

- [ ] **Step 1: Delay blob URL revocation**

Change the immediate revocation to a delayed one:
```typescript
a.click();
// Delay revocation to ensure browser has time to start the download,
// especially on slow connections.
setTimeout(() => URL.revokeObjectURL(url), 60_000);
```

- [ ] **Step 2: Verify build + commit**

Run: `cd apps/web && npx vite build 2>&1 | tail -5`

```bash
git add apps/web/src/lib/components/data/ExportDialog.svelte
git commit -m "fix: delay blob URL revocation to prevent download race on slow connections"
```

---

### Task 10: GeoprocessingPanel — Add cancel button for long-running operations

**Files:**
- Modify: `apps/web/src/lib/components/geoprocessing/GeoprocessingPanel.svelte`

<interfaces>
<!-- Current state: -->
// let running = $state(false);
// Form submit handler calls tRPC mutation, sets running=true/false
// No AbortController, no cancel mechanism
// Button: <Button type="submit" size="sm" loading={running} disabled={...}>Run</Button>
</interfaces>

- [ ] **Step 1: Add AbortController and cancel button**

Add state:
```typescript
let abortController: AbortController | null = null;
```

In the submit handler, wrap the tRPC call:
```typescript
abortController = new AbortController();
running = true;
try {
  const result = await trpc.geoprocessing.run.mutate(input, { signal: abortController.signal });
  // ... handle success
} catch (err) {
  if (abortController.signal.aborted) {
    error = null; // User cancelled — don't show error
  } else {
    error = (err as Error).message;
  }
} finally {
  running = false;
  abortController = null;
}
```

Add cancel button next to Run:
```svelte
{#if running}
  <Button variant="ghost" size="sm" onclick={() => abortController?.abort()}>Cancel</Button>
{/if}
```

- [ ] **Step 2: Verify build + commit**

Run: `cd apps/web && npx vite build 2>&1 | tail -5`

```bash
git add apps/web/src/lib/components/geoprocessing/GeoprocessingPanel.svelte
git commit -m "feat: add cancel button for long-running geoprocessing operations"
```

---

### Task 11: AnnotationPanel — Add disabled state for comment submission

**Files:**
- Modify: `apps/web/src/lib/components/annotations/AnnotationPanel.svelte:151-155`

<interfaces>
<!-- Current comment reply handling (~line 151): -->
// Comment input + submit inside AnnotationThread or AnnotationPanel
// handleReply checks body.trim(), silently returns if empty
</interfaces>

- [ ] **Step 1: Add disabled state to reply/comment submit buttons**

Find the comment submit button in the template. Add:
```svelte
disabled={!replyBody.trim()}
```

Add placeholder text to the reply textarea:
```svelte
placeholder="Write a reply..."
```

- [ ] **Step 2: Verify build + commit**

Run: `cd apps/web && npx vite build 2>&1 | tail -5`

```bash
git add apps/web/src/lib/components/annotations/AnnotationPanel.svelte
git commit -m "fix: disable annotation reply submit when body is empty"
```

---

## Iteration 3: MapEditor Decomposition

### Task 12: Extract annotation GeoJSON derivations to store

**Files:**
- Create: `apps/web/src/lib/stores/annotation-geo.svelte.ts`
- Modify: `apps/web/src/lib/components/map/MapEditor.svelte:339-430`
- Test: `apps/web/src/__tests__/annotation-geo.test.ts`

<interfaces>
<!-- Input: annotationPinsQuery.data (from TanStack Query) -->
// Type: Array<{ id, anchor: Anchor, authorName, createdAt, content: AC, parentId? }>
// where Anchor = { type: 'point', geometry } | { type: 'feature', featureId, layerId, featureDeleted? } | { type: 'region', geometry } | { type: 'viewport' } | { type: 'measurement', geometry }

<!-- Output types (used by MapCanvas): -->
// AnnotationPinCollection = FeatureCollection (Point features)
// AnnotationRegionCollection = FeatureCollection (Polygon features)
// annotatedFeaturesIndex = Map<featureId, count>
// measurementAnnotationData = FeatureCollection (LineString/Polygon with measurement properties)
</interfaces>

- [ ] **Step 1: Write test for annotation GeoJSON derivations**

Create `apps/web/src/__tests__/annotation-geo.test.ts`:
```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { deriveAnnotationPins, deriveAnnotationRegions, deriveAnnotatedFeaturesIndex, deriveMeasurementData } from '$lib/stores/annotation-geo.svelte.js';

describe('annotation-geo derivations', () => {
  const mockAnnotations = [
    { id: 'a1', anchor: { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } }, authorName: 'Test', createdAt: new Date(), content: { type: 'text', body: 'hello' } },
    { id: 'a2', anchor: { type: 'feature', featureId: 'f1', layerId: 'l1' }, authorName: 'Test', createdAt: new Date(), content: { type: 'text', body: 'note' } },
    { id: 'a3', anchor: { type: 'region', geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] } }, authorName: 'Test', createdAt: new Date(), content: { type: 'text', body: 'area' } },
  ];

  it('derives point pins from point-anchored annotations', () => {
    const result = deriveAnnotationPins(mockAnnotations);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.type).toBe('Point');
  });

  it('derives regions from region-anchored annotations', () => {
    const result = deriveAnnotationRegions(mockAnnotations);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.type).toBe('Polygon');
  });

  it('builds annotated features index', () => {
    const index = deriveAnnotatedFeaturesIndex(mockAnnotations);
    expect(index.get('f1')).toBe(1);
  });

  it('returns empty collections for empty input', () => {
    expect(deriveAnnotationPins([]).features).toHaveLength(0);
    expect(deriveAnnotationRegions([]).features).toHaveLength(0);
    expect(deriveAnnotatedFeaturesIndex([]).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/__tests__/annotation-geo.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: FAIL — module not found

- [ ] **Step 3: Create annotation-geo store**

Create `apps/web/src/lib/stores/annotation-geo.svelte.ts` by extracting the 4 `$derived` blocks from MapEditor.svelte:339-430 into pure functions. Export both the pure functions (for testing) and reactive `$derived` wrappers (for component use).

```typescript
import type { FeatureCollection } from 'geojson';

// Pure derivation functions (testable without Svelte runtime)
export function deriveAnnotationPins(rows: AnnotationRow[]): FeatureCollection { ... }
export function deriveAnnotationRegions(rows: AnnotationRow[]): FeatureCollection { ... }
export function deriveAnnotatedFeaturesIndex(rows: AnnotationRow[]): Map<string, number> { ... }
export function deriveMeasurementData(rows: AnnotationRow[]): FeatureCollection { ... }

// Reactive store (for use in components)
export function createAnnotationGeoStore(queryDataFn: () => AnnotationRow[]) {
  const rows = $derived(queryDataFn());
  const pins = $derived(deriveAnnotationPins(rows));
  const regions = $derived(deriveAnnotationRegions(rows));
  const index = $derived(deriveAnnotatedFeaturesIndex(rows));
  const measurements = $derived(deriveMeasurementData(rows));
  return { get pins() { return pins; }, get regions() { return regions; }, get index() { return index; }, get measurements() { return measurements; } };
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/web && npx vitest run src/__tests__/annotation-geo.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 5: Update MapEditor to use the store**

Replace lines 339-430 in MapEditor.svelte with:
```typescript
import { createAnnotationGeoStore } from '$lib/stores/annotation-geo.svelte.js';
const annotationGeo = createAnnotationGeoStore(() => annotationPinsQuery.data ?? []);
```

Replace all references: `annotationPins` → `annotationGeo.pins`, `annotationRegions` → `annotationGeo.regions`, `annotatedFeaturesIndex` → `annotationGeo.index`, `measurementAnnotationData` → `annotationGeo.measurements`.

- [ ] **Step 6: Run full test suite**

Run: `cd apps/web && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 7: Verify build + commit**

Run: `cd apps/web && npx vite build 2>&1 | tail -5`

```bash
git add apps/web/src/lib/stores/annotation-geo.svelte.ts \
       apps/web/src/__tests__/annotation-geo.test.ts \
       apps/web/src/lib/components/map/MapEditor.svelte
git commit -m "refactor: extract annotation GeoJSON derivations to dedicated store"
```

---

### Task 13: Extract interaction state machine to store

**Files:**
- Create: `apps/web/src/lib/stores/interaction-modes.svelte.ts`
- Modify: `apps/web/src/lib/components/map/MapEditor.svelte:212-330`
- Modify: `apps/web/src/__tests__/interaction-modes.test.ts` (update imports)

<interfaces>
<!-- InteractionState discriminated union: -->
type InteractionState =
  | { type: 'idle' }
  | { type: 'featureSelected'; feature: SelectedFeature }
  | { type: 'drawRegion'; geometry?: { type: 'Polygon'; coordinates: number[][][] } }
  | { type: 'pickFeature'; picked?: PickedFeatureRef }
  | { type: 'pendingMeasurement'; anchor: { ... }; content: { ... } };

<!-- selectionStore interface (consumed): -->
// selectionStore.activeTool: DrawTool
// selectionStore.setActiveTool(tool: DrawTool)
// selectionStore.selectedFeature: GeoJSONFeature | null
// selectionStore.selectedLayerId: string | null
// selectionStore.clearSelection(): void
</interfaces>

- [ ] **Step 1: Create interaction-modes store**

Create `apps/web/src/lib/stores/interaction-modes.svelte.ts` with:
- Exported types: `InteractionState`, `SelectedFeature`, `PickedFeatureRef`
- Exported `transitionTo(next: InteractionState)` function
- Exported `interactionModes` store object with reactive `state` getter
- The 4 effect functions as named exports that can be called from MapEditor's `$effect` blocks (they need external state like `activeSection` and `designMode` as parameters)

- [ ] **Step 2: Update existing test to import from store**

Modify `apps/web/src/__tests__/interaction-modes.test.ts` to import types from the new store instead of redeclaring them inline.

- [ ] **Step 3: Run tests**

Run: `cd apps/web && npx vitest run src/__tests__/interaction-modes.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 4: Update MapEditor to use the store**

Replace lines 212-330 in MapEditor.svelte with imports from the store. Keep the `$effect` blocks in MapEditor but have them delegate to the store's transition logic.

- [ ] **Step 5: Run full test suite + build**

Run: `cd apps/web && npx vitest run --reporter=verbose 2>&1 | tail -20`
Run: `cd apps/web && npx vite build 2>&1 | tail -5`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/stores/interaction-modes.svelte.ts \
       apps/web/src/__tests__/interaction-modes.test.ts \
       apps/web/src/lib/components/map/MapEditor.svelte
git commit -m "refactor: extract interaction state machine to dedicated store"
```

---

### Task 14: Extract viewport pagination to store

**Files:**
- Create: `apps/web/src/lib/stores/viewport.svelte.ts`
- Modify: `apps/web/src/lib/components/map/MapEditor.svelte:108-185,446-457`
- Test: `apps/web/src/__tests__/viewport-store.test.ts`

<interfaces>
<!-- Viewport state (MapEditor lines 108-116): -->
// viewportAbort: AbortController | null
// viewportRows: Array<{ id: string; properties: Record<string, unknown>; geometryType: string }>
// viewportTotal: number
// viewportPage: number (default 1)
// viewportPageSize: number (default 50)
// viewportSortBy: 'created_at' | 'updated_at' | 'id' (default 'created_at')
// viewportSortDir: 'asc' | 'desc' (default 'asc')
// viewportLoading: boolean

<!-- External dependencies: -->
// trpc.features.listPaged.query({ layerId, bbox, limit, offset, sortBy, sortDir })
// mapStore.mapInstance.getBounds() → { getWest, getSouth, getEast, getNorth }
// layersStore.active: Layer | null
// isLargeLayer(layer): boolean
</interfaces>

- [ ] **Step 1: Write test for viewport store**

Create `apps/web/src/__tests__/viewport-store.test.ts`:
```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('viewport store', () => {
  const mockTrpc = {
    features: {
      listPaged: {
        query: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
      },
    },
  };

  const mockMap = {
    getBounds: vi.fn(() => ({
      getWest: () => -180, getSouth: () => -90,
      getEast: () => 180, getNorth: () => 90,
    })),
    on: vi.fn(),
    off: vi.fn(),
  };

  it('starts with default state (page 1, pageSize 50, sortBy created_at, asc)');
  it('changePage updates page and fetches');
  it('changePageSize resets page to 1 and fetches');
  it('changeSortBy resets page to 1 and fetches');
  it('aborts previous fetch when a new one starts');
  it('handleMoveEnd debounces and resets page to 1');
  it('does not fetch if no active layer');
  it('does not fetch if active layer is not large');
  it('cleanup removes moveend listener');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/__tests__/viewport-store.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: FAIL — module not found

- [ ] **Step 3: Create viewport store**

Create `apps/web/src/lib/stores/viewport.svelte.ts`:
```typescript
import type { Map as MapLibreMap } from 'maplibre-gl';

type SortBy = 'created_at' | 'updated_at' | 'id';
type SortDir = 'asc' | 'desc';
type Row = { id: string; properties: Record<string, unknown>; geometryType: string };

interface ViewportDeps {
  trpc: { features: { listPaged: { query: (input: unknown) => Promise<{ rows: Row[]; total: number }> } } };
  getActiveLayer: () => { id: string } | null;
  isLargeLayer: (layer: { id: string }) => boolean;
  getMap: () => MapLibreMap | undefined;
}

export function createViewportStore(deps: ViewportDeps) {
  let _abort: AbortController | null = null;
  let rows = $state<Row[]>([]);
  let total = $state(0);
  let page = $state(1);
  let pageSize = $state(50);
  let sortBy = $state<SortBy>('created_at');
  let sortDir = $state<SortDir>('asc');
  let loading = $state(false);
  let _moveEndTimer: ReturnType<typeof setTimeout> | undefined;

  async function fetch() {
    const layer = deps.getActiveLayer();
    if (!layer || !deps.isLargeLayer(layer)) return;
    const map = deps.getMap();
    if (!map) return;

    const bounds = map.getBounds();
    const bbox: [number, number, number, number] = [
      bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(),
    ];

    _abort?.abort();
    const controller = new AbortController();
    _abort = controller;
    loading = true;

    try {
      const result = await deps.trpc.features.listPaged.query({
        layerId: layer.id, bbox,
        limit: pageSize, offset: (page - 1) * pageSize,
        sortBy, sortDir,
      });
      if (!controller.signal.aborted) {
        rows = result.rows;
        total = result.total;
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('[viewport] fetch failed:', err);
    } finally {
      loading = false;
    }
  }

  function handleMoveEnd() {
    clearTimeout(_moveEndTimer);
    _moveEndTimer = setTimeout(() => { page = 1; fetch(); }, 300);
  }

  return {
    get rows() { return rows; },
    get total() { return total; },
    get page() { return page; },
    get pageSize() { return pageSize; },
    get sortBy() { return sortBy; },
    get sortDir() { return sortDir; },
    get loading() { return loading; },
    fetch,
    handleMoveEnd,
    changePage(p: number) { page = p; fetch(); },
    changePageSize(s: number) { pageSize = s; page = 1; fetch(); },
    changeSortBy(col: SortBy, dir: SortDir) { sortBy = col; sortDir = dir; page = 1; fetch(); },
    bindMap(map: MapLibreMap) {
      map.on('moveend', handleMoveEnd);
      fetch();
      return () => { map.off('moveend', handleMoveEnd); clearTimeout(_moveEndTimer); };
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/web && npx vitest run src/__tests__/viewport-store.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 5: Update MapEditor to use the store**

Replace lines 108-185 and 446-457 in MapEditor.svelte. Import `createViewportStore` and instantiate with deps. Replace all `viewportRows`, `viewportPage`, etc. references with store getters. Replace `handleMoveEnd`, `fetchViewportFeatures`, `handlePageChange`, `handlePageSizeChange`, `handleSortChange` with store methods. Replace the `$effect` at lines 446-457 with `viewportStore.bindMap(map)`.

- [ ] **Step 6: Run full suite + build**

Run: `cd apps/web && npx vitest run --reporter=verbose 2>&1 | tail -20`
Run: `cd apps/web && npx vite build 2>&1 | tail -5`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/stores/viewport.svelte.ts \
       apps/web/src/__tests__/viewport-store.test.ts \
       apps/web/src/lib/components/map/MapEditor.svelte
git commit -m "refactor: extract viewport pagination to dedicated store"
```

---

### Task 15: Extract measurement panel to component

**Files:**
- Create: `apps/web/src/lib/components/map/MeasurementPanel.svelte`
- Modify: `apps/web/src/lib/components/map/MapEditor.svelte:195-197,207-209,867-965`

<interfaces>
<!-- Measurement state (MapEditor): -->
// let distUnit = $state<DistanceUnit>('km');
// let areaUnit = $state<AreaUnit>('km2');
// let periUnit = $state<DistanceUnit>('km');
// Props needed: measureResult: MeasurementResult | null
// Imports: formatDistance, formatArea from utils
// Type: MeasurementResult = { type: 'distance', distanceKm } | { type: 'area', areaKm2, perimeterKm }
</interfaces>

- [ ] **Step 1: Create MeasurementPanel component**

Extract the measurement markup (lines 867-965) and measurement unit state (lines 195-197) into `MeasurementPanel.svelte`. Props: `measureResult: MeasurementResult | null`.

- [ ] **Step 2: Update MapEditor**

Replace the `analysisContent` snippet's measurement section with `<MeasurementPanel {measureResult} />`. Remove `distUnit`, `areaUnit`, `periUnit` state from MapEditor.

- [ ] **Step 3: Build + commit**

Run: `cd apps/web && npx vite build 2>&1 | tail -5`

```bash
git add apps/web/src/lib/components/map/MeasurementPanel.svelte \
       apps/web/src/lib/components/map/MapEditor.svelte
git commit -m "refactor: extract measurement panel from MapEditor to dedicated component"
```

---

## Iteration 4: Characterization Tests

### Task 16: Characterization tests for drawing.svelte.ts

**Files:**
- Create: `apps/web/src/__tests__/drawing-store.test.ts`

<interfaces>
<!-- drawingStore exports: -->
export const drawingStore = {
  get state(): DrawingState;      // idle | importing | ready | stopped
  get isReady(): boolean;
  get instance(): TerraDraw | null;
  async init(map: MapLibreMap): Promise<TerraDraw | null>;
  stop(): void;
  reset(): void;
};
// DrawingState = { status: 'idle' } | { status: 'importing', generation } | { status: 'ready', instance, generation } | { status: 'stopped' }
</interfaces>

- [ ] **Step 1: Write characterization tests**

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock terra-draw and adapter
vi.mock('terra-draw', () => ({
  TerraDraw: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    removeFeatures: vi.fn(),
    getSnapshot: vi.fn(() => []),
  })),
  TerraDrawPointMode: vi.fn(),
  TerraDrawLineStringMode: vi.fn(),
  TerraDrawPolygonMode: vi.fn(),
  TerraDrawSelectMode: vi.fn(),
}));
vi.mock('terra-draw-maplibre-gl-adapter', () => ({
  TerraDrawMapLibreGLAdapter: vi.fn(),
}));

describe('drawingStore', () => {
  it('starts in idle state');
  it('transitions to importing then ready on init');
  it('returns null if a newer init supersedes');
  it('stop() transitions to stopped');
  it('reset() returns to idle');
  it('concurrent init — only latest generation wins');
});
```

- [ ] **Step 2: Run tests — observe actual behavior and assert it**

Run: `cd apps/web && npx vitest run src/__tests__/drawing-store.test.ts --reporter=verbose`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/__tests__/drawing-store.test.ts
git commit -m "test: add characterization tests for drawing store lifecycle"
```

---

### Task 17: Characterization tests for map.svelte.ts

**Files:**
- Create: `apps/web/src/__tests__/map-store.test.ts`

<interfaces>
<!-- mapStore exports: -->
export const mapStore = {
  get center(): [number, number];  // default [-98.35, 39.5]
  get zoom(): number;              // default 4
  get bearing(): number;
  get pitch(): number;
  get basemapId(): BasemapId;
  get basemapUrl(): string;
  get basemapOptions(): BasemapOption[];
  get interactionMode(): InteractionMode;
  get mapInstance(): MapLibreMap | undefined;
  get mapContainerEl(): HTMLElement | undefined;
  setCenter(c: [number, number]): void;
  setZoom(z: number): void;
  setBearing(b: number): void;
  setPitch(p: number): void;
  setBasemapId(id: BasemapId): void;
  setInteractionMode(m: InteractionMode): void;
  setMapInstance(m: MapLibreMap | undefined): void;
  setMapContainerEl(el: HTMLElement | undefined): void;
};
</interfaces>

- [ ] **Step 1: Write characterization tests**

Test defaults, setters, basemapUrl derivation, and that setMapInstance(undefined) cleans up.

- [ ] **Step 2: Run + assert actual behavior + commit**

```bash
git add apps/web/src/__tests__/map-store.test.ts
git commit -m "test: add characterization tests for map store"
```

---

### Task 18: Characterization tests for selection.svelte.ts

**Files:**
- Create: `apps/web/src/__tests__/selection-store.test.ts`

<interfaces>
<!-- selectionStore exports: -->
export const selectionStore = {
  get selectedFeatureIds(): Set<string>;
  get selectedFeature(): GeoJSONFeature | null;
  get activeTool(): DrawTool;
  get popupCoords(): { lng, lat } | null;
  get selectedLayerId(): string | null;
  get hasSelection(): boolean;
  selectFeature(feature, coords?, layerId?): void;
  clearSelection(): void;
  setActiveTool(tool: DrawTool): void;  // clears selection when tool !== null
};
</interfaces>

- [ ] **Step 1: Characterize selectFeature, clearSelection, setActiveTool behavior**

Key behaviors to lock down:
- `setActiveTool(non-null)` clears selection (side effect!)
- `clearSelection` is idempotent (early return if already clear)
- `selectFeature` sets all related state atomically

- [ ] **Step 2: Run + commit**

```bash
git add apps/web/src/__tests__/selection-store.test.ts
git commit -m "test: add characterization tests for selection store"
```

---

### Task 19: Characterization tests for annotation service

**Files:**
- Create: `apps/web/src/__tests__/annotation-service.test.ts`

<interfaces>
<!-- annotation service (server/annotations/service.ts): -->
// Uses drizzle db with: annotations, annotationObjects, annotationChangelog tables
// Key functions: create, update, delete, thread operations, flagOrphanedAnnotations
// flagOrphanedAnnotations(mapId, featureIds): marks annotations whose feature was deleted
</interfaces>

- [ ] **Step 1: Write characterization tests using drizzle mock chain pattern**

Follow existing test patterns from `annotation-objects.test.ts`. Mock db, mock access. Test:
- flagOrphanedAnnotations with matching feature IDs
- flagOrphanedAnnotations with no matching annotations (no-op)
- flagOrphanedAnnotations with empty featureIds array

- [ ] **Step 2: Run + commit**

```bash
git add apps/web/src/__tests__/annotation-service.test.ts
git commit -m "test: add characterization tests for annotation service"
```

---

### Task 20: Characterization tests for resolve-feature-id

**Files:**
- Create: `apps/web/src/__tests__/resolve-feature-id.test.ts`

<interfaces>
<!-- resolveFeatureId (utils/resolve-feature-id.ts): -->
export function resolveFeatureId(
  feat: { id?: string | number; properties?: Record<string, unknown> | null }
): FeatureUUID | null;
// Priority: properties._id > properties.id > feat.id
// Uses toFeatureUUID() which returns null for non-UUID strings
</interfaces>

- [ ] **Step 1: Write characterization tests**

```typescript
describe('resolveFeatureId', () => {
  it('resolves from properties._id (GeoJSON source pattern)');
  it('resolves from properties.id (Martin vector tile pattern)');
  it('falls back to feat.id');
  it('returns null for non-UUID strings');
  it('returns null for numeric IDs');
  it('returns null for null/undefined properties');
  it('prefers _id over id over feat.id');
});
```

- [ ] **Step 2: Run + commit**

```bash
git add apps/web/src/__tests__/resolve-feature-id.test.ts
git commit -m "test: add characterization tests for resolveFeatureId utility"
```

---

### Task 21: Characterization tests for geo/access.ts

**Files:**
- Create: `apps/web/src/__tests__/geo-access.test.ts`

<interfaces>
<!-- geo/access.ts exports: -->
export async function requireMapOwnership(userId: string, mapId: string): Promise<void>;
// Throws NOT_FOUND if map doesn't exist or user isn't owner

export async function requireMapAccess(userId: string, mapId: string, minRole: CollabRole | 'owner'): Promise<void>;
// Owner: always granted. minRole='owner': non-owners get NOT_FOUND
// Collaborator with role >= minRole: granted
// Collaborator with role < minRole: FORBIDDEN
// No collaborator record: NOT_FOUND
</interfaces>

- [ ] **Step 1: Write characterization tests**

Use drizzle mock chain pattern. Test the access matrix:
- Owner + any role → passes
- minRole='owner' + collaborator → NOT_FOUND
- Collaborator with editor + minRole=viewer → passes
- Collaborator with viewer + minRole=editor → FORBIDDEN
- No record → NOT_FOUND
- Nonexistent map → NOT_FOUND

- [ ] **Step 2: Run + commit**

```bash
git add apps/web/src/__tests__/geo-access.test.ts
git commit -m "test: add characterization tests for geo access control"
```

---

## Post-Implementation

After all 4 iterations:
1. Run full test suite: `cd apps/web && npx vitest run`
2. Run build: `cd apps/web && npx vite build`
3. Run lint: `cd apps/web && npx eslint .`
4. Verify MapEditor.svelte line count reduced by ~350 lines
5. Run `mulch learn` and record any new patterns/conventions
