# Brownfield Hardening Turn 3 Implementation Plan

> Wave 1 (9 tasks) landed on master. This plan covers Wave 2 (6 tasks).

## Wave 2 Tasks

### Task 1.2: Share/embed error handling
**Files**: `(public)/share/[token]/+page.server.ts`, `+page.svelte`, `(public)/embed/[token]/+page.server.ts`, `+page.svelte`
**Problem**: Invalid share/embed tokens hit SvelteKit error boundary (ugly 500). No user-friendly message.
**Fix**: In +page.server.ts, catch invalid-token errors and return `{ error: "not_found" }` via data (not `error()`). In +page.svelte, check `data.error` and show a "Link Not Found" message instead of the map.
**Decision**: Share/embed error via data return, not error boundary (mulch).
**Markers**: `data.error`, `Link Not Found`

### Task 1.4: API key copy feedback
**File**: `SettingsScreen.svelte`
**Problem**: Copying API key gives no feedback. Key visibility has no warning.
**Fix**: Add clipboard copy with toast confirmation. Add "won't be shown again" warning when revealing key.
**Marker**: `won't be shown again`

### Task 1.6: Admin confirm before disable
**Files**: `AdminScreen.svelte` or `(app)/admin/+page.svelte`
**Problem**: Admin can disable users with no confirmation — destructive action with no guard.
**Fix**: Add `window.confirm()` guard before disable action. Convention: destructive actions use window.confirm().
**Marker**: `Disable this user`

### Task 2.7: DrawingToolbar aria-labels
**File**: `DrawingToolbar.svelte`
**Problem**: Icon-only toolbar buttons have no accessible names.
**Fix**: Add descriptive `aria-label` attributes to all toolbar buttons.
**Marker**: `aria-label` (need more than the 2 existing)

### Task 2.9: Dashboard create-map loading state
**File**: `DashboardScreen.svelte`
**Problem**: "New Map" button has no loading state — user can double-click, creating duplicate maps.
**Fix**: Add `creatingMap` flag, disable button during creation, show spinner.
**Marker**: `creatingMap`

### Task 2.12: Password mismatch inline validation
**File**: `RegisterScreen.svelte`
**Problem**: Password mismatch only caught on submit (server-side). No inline feedback.
**Fix**: Add client-side check showing "Passwords must match" error inline when confirm field loses focus or on input.
**Marker**: `Passwords must match`

## Artifact Manifest

<!-- PLAN_MANIFEST_START -->
| File | Action | Marker |
|------|--------|--------|
| `apps/web/src/lib/components/ui/Modal.svelte` | patch | `previousFocus` |
| `apps/web/src/routes/(public)/share/[token]/+page.server.ts` | patch | `data.error` |
| `apps/web/src/routes/(public)/share/[token]/+page.svelte` | patch | `Link Not Found` |
| `apps/web/src/routes/(public)/embed/[token]/+page.server.ts` | patch | `data.error` |
| `apps/web/src/routes/(public)/embed/[token]/+page.svelte` | patch | `Link Not Found` |
| `apps/web/src/lib/utils/handle-error.ts` | patch | `Check your connection` |
| `apps/web/src/lib/screens/LoginScreen.svelte` | patch | `mailto:admin@feltlikei.it` |
| `apps/web/src/lib/screens/SettingsScreen.svelte` | patch | `won't be shown again` |
| `apps/web/src/routes/(app)/admin/+page.svelte` | patch | `Disable this user` |
| `apps/web/src/lib/components/map/MapEditor.svelte` | patch | `View Only` |
| `apps/web/src/lib/components/map/LayerPanel.svelte` | patch | `loadErrors` |
| `apps/web/src/lib/components/annotations/AnnotationPanel.svelte` | patch | `fieldErrors` |
| `apps/web/src/lib/components/ui/ConfirmDialog.svelte` | patch | `transition:fade` |
| `apps/web/src/lib/components/map/BasemapPicker.svelte` | patch | `transition:fly` |
| `apps/web/src/lib/components/data/DataTable.svelte` | patch | `No features to display` |
| `apps/web/src/app.css` | patch | `prefers-reduced-motion` |
| `apps/web/src/lib/screens/RegisterScreen.svelte` | patch | `Passwords must match` |
| `apps/web/src/lib/components/data/FilterPanel.svelte` | patch | `Showing {filteredCount}` |
| `apps/web/src/lib/components/map/DrawingToolbar.svelte` | patch | `aria-label` |
| `apps/web/src/lib/screens/DashboardScreen.svelte` | patch | `creatingMap` |
| `apps/web/src/lib/components/map/GuestCommentPanel.svelte` | patch | `visible to anyone` |
| `apps/web/src/lib/components/annotations/AnnotationThread.svelte` | patch | `Retry` |
| `apps/web/src/lib/components/geoprocessing/GeoprocessingPanel.svelte` | patch | `cancelling` |
| `apps/web/src/lib/components/style/StylePanel.svelte` | patch | `layersStore.updateStyle(layer.id, lastSavedStyle)` |
| `apps/web/src/lib/stores/interaction-modes.svelte.ts` | patch | `// pure state machine` |
| `apps/web/src/lib/components/ui/InstallPrompt.svelte` | patch | `try {` |
| `apps/web/src/lib/screens/AdminScreen.svelte` | patch | `Disable this user` |
| `apps/web/src/__tests__/style-panel-rollback.test.ts` | create | — |
| `apps/web/src/__tests__/drawing-undo-closure.test.ts` | create | — |
<!-- PLAN_MANIFEST_END -->
