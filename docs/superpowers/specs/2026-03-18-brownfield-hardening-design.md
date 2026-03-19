# Brownfield Hardening: Bugs, Refinements & Polish

**Date**: 2026-03-18
**Scope**: Multi-iteration brownfield sweep across reactive stability, UX flows, MapEditor decomposition, and test coverage.

## Context

The project has undergone rapid feature development (annotations, drawing tools, interaction state refactoring, TanStack Query migration). Recent commits show reactive stability fixes (`effect_update_depth_exceeded`, circular dependencies), suggesting the system is still settling. A systematic sweep is needed to catch latent bugs, harden UX flows, and establish safety nets before further feature work.

## Iteration Plan

Work is organized into 4 iterations, ordered by risk (bugs first, then structural improvements, then polish):

---

## Iteration 1: Bug Fixes & Silent Failures

Highest-impact issues that affect users right now.

### 1.1 AnnotationPanel: Cancel button doesn't reset form
**File**: `apps/web/src/lib/components/annotations/AnnotationPanel.svelte:617,628`
**Bug**: Clicking "Cancel" toggles `showForm = false` but does NOT call `resetForm()`. Stale form data (text, emoji, selected image, coordinates, anchor type) persists. Reopening the form shows previous partial input.
**Fix**: Add `resetForm()` call alongside `showForm = !showForm` in both cancel button handlers (lines 617, 628).

### 1.2 AnnotationPanel: Image upload error leaves stale formImageUrl
**File**: `apps/web/src/lib/components/annotations/AnnotationPanel.svelte:497-503`
**Bug**: If `uploadImageFile()` fails, the outer catch prevents mutation — good. But if a *previous* successful upload set `formImageUrl`, and a retry upload fails, `formImageUrl` still holds the old URL. The form displays stale state.
**Fix**: Clear `formImageUrl = ''` before the upload attempt (inside the `if` block at line 497, before `await`).

### 1.3 Comment submission: No validation feedback
**File**: `apps/web/src/lib/components/annotations/AnnotationPanel.svelte:151-155`, `apps/web/src/lib/components/map/GuestCommentPanel.svelte:46-56`
**Bug**: Submitting whitespace-only comments silently returns. No error message, no disabled state, no placeholder hint.
**Fix**: Disable submit button when `body.trim()` is empty. Add helper text "Write a comment..." as placeholder.

### 1.4 DrawingToolbar: Failed save leaves orphaned Terra Draw geometry
**File**: `apps/web/src/lib/components/map/DrawingToolbar.svelte:189-191`
**Bug**: If `saveFeature()` throws (network error, invalid geometry), toast shows error (line 191) but the drawn geometry's Terra Draw overlay persists visually. The catch block at line 189 doesn't remove the failed feature from Terra Draw's internal state.
**Fix**: In the catch block (line 189), call `drawingStore.instance.removeFeatures([f.id])` to clean up the failed geometry before the toast.

### 1.5 ImportDialog: Stalled poll timeout detection
**File**: `apps/web/src/lib/components/data/ImportDialog.svelte:82-104`
**Bug**: Import poll loop has no timeout. If the server stalls (job stays `processing` indefinitely), the modal stays open with a frozen progress bar and no way out. Error parsing for upload failures is already reasonable (lines 62-63 parse response body).
**Fix**: Add a max poll duration (e.g., 5 minutes). After timeout, show "Import is taking longer than expected. Check back later." and allow modal dismissal.

---

## Iteration 2: UX Flow Hardening

Issues that degrade user experience but don't cause data loss.

### 2.1 Annotation form: No inline validation feedback
**File**: `apps/web/src/lib/components/annotations/AnnotationPanel.svelte:954-961`
**Issue**: Submit button disabled logic is thorough but no text explains WHY it's disabled. Users can't tell if they need text, an emoji, or an anchor.
**Fix**: Add conditional helper text below submit button: "Add text, emoji, or image to save."

### 2.2 Orphaned annotations: No repair action
**File**: `apps/web/src/lib/components/annotations/AnnotationPanel.svelte:988`, `apps/web/src/lib/components/annotations/AnnotationContent.svelte:11-12`
**Issue**: Feature-anchored annotations whose features are deleted show as greyed-out (`opacity-60`) with no way to fix. Users must delete and recreate.
**Fix**: Add "Convert to point" action button on orphaned annotations that changes anchor type to `point` using the feature's last known centroid.

### 2.3 Drawing: No Escape key to cancel mid-draw
**File**: `apps/web/src/lib/components/map/DrawingToolbar.svelte`
**Issue**: No keyboard shortcut to abandon a partial drawing. Users must complete the geometry or switch tools (which silently discards).
**Fix**: Add Escape key handler that cancels current Terra Draw operation and transitions to idle.

### 2.4 Drawing: Silent discard on tool switch
**File**: `apps/web/src/lib/components/map/DrawingToolbar.svelte`
**Issue**: Switching drawing tools mid-draw silently discards partial geometry with no confirmation.
**Fix**: If Terra Draw has an active (incomplete) geometry, show confirmation before switching tools.

### 2.5 Export: Blob URL revocation race
**File**: `apps/web/src/lib/components/data/ExportDialog.svelte`
**Issue**: `URL.revokeObjectURL()` called immediately after triggering download. On slow connections, download may fail.
**Fix**: Delay revocation with `setTimeout(() => URL.revokeObjectURL(url), 60_000)`.

### 2.6 GeoprocessingPanel: No cancel for long-running operations
**File**: `apps/web/src/lib/components/geoprocessing/GeoprocessingPanel.svelte`
**Issue**: Once "Run" is clicked, no cancel button. User stuck waiting on server-side processing.
**Fix**: Add AbortController and cancel button that aborts the tRPC call.

---

## Iteration 3: MapEditor Decomposition

Structural improvements to reduce the 1051-line MapEditor and make concerns independently testable.

### 3.1 Extract annotation GeoJSON derivations
**From**: `apps/web/src/lib/components/map/MapEditor.svelte:339-430`
**To**: `apps/web/src/lib/stores/annotation-geo.svelte.ts`
**What**: 4 `$derived` blocks (annotationPins, annotationRegions, annotatedFeaturesIndex, measurementAnnotationData) are pure computation from query cache data. Zero side effects, zero coupling.
**Benefit**: -90 LOC from MapEditor, independently testable, reusable.
**Risk**: None — pure derivation.

### 3.2 Extract interaction state machine
**From**: `apps/web/src/lib/components/map/MapEditor.svelte:212-330` (type definition + transitionTo + 4 effects)
**To**: `apps/web/src/lib/stores/interaction-modes.svelte.ts`
**What**: InteractionState discriminated union, `transitionTo()` function, and the 4 effects that coordinate mode cleanup. Existing test at `apps/web/src/__tests__/interaction-modes.test.ts` already models the state machine accurately.
**Benefit**: -90 LOC, testable (test already exists and mirrors this exactly), centralizes all mode logic.
**Risk**: Low — effects need access to `selectionStore` and `activeSection` as inputs.

### 3.3 Extract viewport pagination
**From**: `apps/web/src/lib/components/map/MapEditor.svelte:108-185,446-457`
**To**: `apps/web/src/lib/stores/viewport.svelte.ts`
**What**: 7 viewport state vars (lines 108-116: viewportAbort, viewportRows, viewportTotal, viewportPage, viewportPageSize, viewportSortBy, viewportSortDir, viewportLoading) + `fetchViewportFeatures()` (line 118) + `handleMoveEnd()` (line 162) + page/size/sort handlers (lines 170-185) + map moveend lifecycle (lines 446-457).
**Benefit**: -80 LOC, decouples pagination from map rendering, reusable for other paginated views.
**Risk**: Medium — async coordination with map lifecycle, needs careful AbortController management.

### 3.4 Extract measurement panel
**From**: `apps/web/src/lib/components/map/MapEditor.svelte:195-197,207-209,867-965`
**To**: `apps/web/src/lib/components/map/MeasurementPanel.svelte`
**What**: Measurement units state (distUnit, areaUnit, periUnit at lines 195-197), measureActive derived + effect (lines 207-209), and the analysisContent markup (lines 867-965).
**Benefit**: -100 LOC from MapEditor markup, self-contained component.
**Risk**: Low — just UI + local state.

---

## Iteration 4: Characterization Tests (Safety Nets)

Establish test coverage for high-risk untested modules before any further modification.

### 4.1 `apps/web/src/lib/stores/drawing.svelte.ts` — Terra Draw lifecycle
**Priority**: CRITICAL (recently refactored, race condition fixes, manages external library lifecycle)
**Characterize**: init/start/stop sequencing, generation guard behavior, concurrent init handling, cleanup on destroy.

### 4.2 `apps/web/src/lib/stores/map.svelte.ts` — Map store
**Priority**: CRITICAL (recent $effect.pre refactor, 5 exports, MapLibre integration)
**Characterize**: center/zoom/bounds tracking, mapInstance lifecycle, effect initialization order.

### 4.3 `apps/web/src/lib/stores/selection.svelte.ts` — Selection store
**Priority**: HIGH (no tests, drives interaction state, feature/annotation selection)
**Characterize**: activeTool switching, selectedFeature/selectedLayerId coordination, clear behavior.

### 4.4 `apps/web/src/lib/server/annotations/service.ts` — Annotation service
**Priority**: HIGH (336 lines, 5+ mutations, orphan flagging, recent cascade logic)
**Characterize**: create/update/delete flows, orphan flagging on feature delete, thread operations.

### 4.5 `apps/web/src/lib/utils/resolve-feature-id.ts` — Feature ID resolver
**Priority**: MEDIUM (recently refactored, FeatureUUID branded type, UUID vs tile ID distinction)
**Characterize**: promoted property resolution, vector tile source handling, GeoJSON source handling, null/undefined inputs.

### 4.6 `apps/web/src/lib/server/geo/access.ts` — Access control
**Priority**: MEDIUM (100% mocked in existing tests, guards all mutations, security-critical)
**Characterize**: owner fast-path, editor/viewer role checks, nonexistent map handling.

---

## Locked Decisions

1. **Iteration order is fixed**: bugs (I1) → UX hardening (I2) → decomposition (I3) → test coverage (I4). Rationale: fix what's broken before restructuring; restructure before adding safety nets (tests should cover the final structure, not the pre-decomposition one).

2. **MapEditor decomposition extracts to stores, not sub-components** for annotation GeoJSON and interaction state. Rationale: these are logic concerns, not rendering concerns. Stores are testable without DOM.

3. **Characterization tests come AFTER decomposition** so they document the decomposed structure, not the monolithic one. Exception: `drawing.svelte.ts` and `map.svelte.ts` tests can be written anytime (they're already separate modules).

4. **No feature additions in this sweep**. Every change is a bug fix, UX improvement, structural extraction, or test addition. No new capabilities.

5. **Orphaned annotation "Convert to point"** (2.2) is a small feature addition but justified because the current state is a DEAD END — users have no path to fix orphaned annotations.

## Referenced Documents

- `docs/superpowers/plans/2026-03-16-annotation-hardening.md` — recent annotation work context
- `docs/superpowers/plans/2026-03-14-interaction-mode-union.md` — interaction state machine design
- `docs/superpowers/plans/2026-03-15-tanstack-query-mutation-invalidation.md` — query/mutation patterns
