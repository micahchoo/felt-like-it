# Group 2 Content Flows (F09, F10, F11) — Handoff

## Current Status

### Waves Completed

**Wave 1: F09 Measurement (COMPLETE)**

- Task 1: MeasurementStore class with 9 unit tests ✅
- Task 2: MeasurementTooltip component ✅
- Task 3: MapEditor wiring + M keyboard shortcut ✅
- Task 4: MeasurementPanel verification ✅
- Commit: 9489784

**Wave 2: F10 Annotations (COMPLETE)**

- Task 5: AnnotationMutations.ts module with 8 factory functions ✅
- Task 6: AnnotationForm.svelte component (6 content types, image upload, measurement pre-fill) ✅
- Task 7: AnnotationList.svelte component ✅
- Task 8: AnnotationPanel orchestrator rewritten from 1280 to ~350 lines ✅
- Commit: 373a14d

**Wave 3: F11 Export (COMPLETE)**

- Task 9: ExportStore class with 11 unit tests ✅
- Task 10: Unified POST /api/export + SSE progress endpoint ✅
- Task 11: ExportDialog wired to ExportStore ✅
- Task 12: Existing GET routes verified via characterization tests ✅
- Commits: 6f1880c, f645bfe, [TASK11_COMMIT]

### Test Status

- 838/848 tests passing (10 pre-existing failures from pg/sql.js infrastructure)
- All new tests pass (11 export-store + 9 export-api)
- ExportDialog: no new svelte-check errors

## Completed Work

### Task 11: ExportDialog Wiring

**Changes made to `apps/web/src/lib/components/data/ExportDialog.svelte`:**

1. ✅ Import ExportStore and create instance
2. ✅ Replace 4 boolean states (exportingGeoJSON, exportingGpkg, exportingShp, exportingPdf) with ExportStore
3. ✅ Keep PNG and annotations exports separate (different patterns)
4. ✅ Add `subscribeToProgress()` for SSE progress tracking
5. ✅ Add `handleExport()` unified handler for POST /api/export
6. ✅ Update progress bar to show real progress from ExportStore
7. ✅ Update all export buttons to use ExportStore state

**Architecture:**

- Simple exports (GeoJSON, GeoPackage, Shapefile): immediate download via 200 OK
- Async exports (PDF): 202 Accepted → SSE progress → download when complete
- PNG export: stays client-side via html-to-image (no server job)
- Annotations export: stays on existing GET endpoint

### Task 12: Existing GET Route Verification

**Files verified:**

- `apps/web/src/routes/api/export/[layerId]/+server.ts` - unchanged, still works for direct exports
- Characterization tests confirm backward compatibility

## Key Design Decisions

1. **ExportStore Pattern:** Unified state machine (idle → pending → processing → complete/error)
2. **Async Exports:** PDF creates jobs; simple exports return immediately
3. **SSE Progress:** Reuses F02 pattern from import jobs
4. **Backward Compatibility:** Existing GET endpoints preserved
5. **PNG Export:** Stays separate (client-side, no server round-trip)
6. **Annotations Export:** Stays on separate endpoint (different data source)

## Files Created/Modified

**New files:**

- `apps/web/src/lib/stores/export-store.svelte.ts`
- `apps/web/src/__tests__/export-store.test.ts`
- `apps/web/src/routes/api/export/+server.ts`
- `apps/web/src/routes/api/export/progress/+server.ts`
- `apps/web/src/__tests__/export-api.test.ts`

**Modified files:**

- `apps/web/src/lib/components/data/ExportDialog.svelte` (387 → ~470 lines)

## Open Questions (Resolved)

1. ✅ PNG export stays separate (client-side, no ExportStore needed)
2. ✅ Annotations export stays on separate endpoint
3. ✅ ZIP creation for multi-layer exports deferred to future iteration

## Next Steps

1. Commit Task 11 changes
2. Run Wave 4 verification (full test suite + svelte-check + lint)
3. Close F11 feature group
