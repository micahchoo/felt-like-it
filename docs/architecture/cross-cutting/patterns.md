# Cross-Cutting Patterns

Patterns observed across 2+ subsystems in felt-like-it.

> Updated 2026-03-29 with findings from all 8 subsystem drills (19 patterns total).

## 1. Server-First Mutations (No Optimistic UI) — with Exceptions

**Observed in:** Map Editor, Layer Management, Annotation System, Collaboration

All mutations follow: mutate → await server → invalidate query → re-fetch. No TanStack Query optimistic updates are used anywhere. The one exception is `hotOverlay` in DrawingToolbar, which is a bespoke manual preview layer (not TanStack's optimistic update API).

**Exception — Layer Management optimistic split (NEW from drill):** Layer Management uses optimistic updates for toggle/reorder/style but non-optimistic for create/delete. Decision criteria:
- **Optimistic** when the operation is visually immediate, reversible without data loss, and failure can be silently retried (visibility toggle, drag-reorder, style change)
- **Non-optimistic** when the operation creates or destroys server-side state where rollback would cause data loss or orphaned references (layer create, layer delete)

This split is intentional and well-bounded. Other subsystems considering optimistic updates should apply these same criteria.

**Assessment:** Intentional — aligns with the `undo-after-server-confirm` decision (mx-2f016d). The Layer Management exception is principled, not drift.

## 2. TanStack Query Cache as Coordination Mechanism (NEW)

**Observed in:** Map Editor (MapEditor + DrawingToolbar), Data Pipeline (import completion → cache invalidation)

Cache unification resolved a prior bug where `MapEditor.loadLayerData()` fetched directly via `trpc.features.list.query()` while DrawingToolbar invalidated TanStack cache keys — the two paths never coordinated. Now all feature data flows through TanStack Query:

- **DrawingToolbar** mutation `onSuccess` → `invalidateQueries(queryKeys.features.list({ layerId }))`
- **MapEditor** `loadLayerData()` → `fetchQuery()` through TanStack Query cache → sees invalidation, re-fetches

This pattern extends to the data pipeline: import job completion triggers cache invalidation so the map editor picks up newly imported features without explicit messaging.

**Assessment:** Unified. Cache invalidation is the sole coordination mechanism between mutation sites and read sites. No dual-path divergence remains on the client side.

## 3. Effect-Tracker Discipline

**Observed in:** MapEditor, MapCanvas, DrawingToolbar (likely project-wide)

All `$effect` blocks wrapped with `effectEnter`/`effectExit` calls tagged with component prefix codes (`ME:`, `MC:`, `DT:`). Used for debugging reactive dependency cycles in Svelte 5.

**Assessment:** Consistent convention. Not a standard Svelte pattern — project-specific instrumentation.

## 4. Generation Counters for Async Race Guards

**Observed in:** MapEditorState (formerly drawingStore, mapStore)

Pattern: increment counter before async operation, compare after completion. If stale, discard result. Used for Terra Draw dynamic import and viewport flyTo cycle prevention. Now consolidated inside `MapEditorState` rather than spread across two stores.

**Assessment:** Lightweight alternative to AbortController. Consistent implementation, improved locality after store consolidation.

## 5. Svelte 5 Context-Based State Injection (NEW)

**Observed in:** Map Editor (MapEditorState), Drawing Tools (via MapEditorState), Geoprocessing (reads interaction state), DataTable (reads selection state)

The project uses a class-based Svelte 5 runes pattern for state management:
```typescript
class FooState {
  #field = $state(...)
  #computed = $derived(...)
}
export function setFooState() { return setContext(KEY, new FooState()) }
export function getFooState() { return getContext<FooState>(KEY) }
```

`MapEditorState` is the canonical example — consolidated from 3 former stores + 5 bridge effects into a single class distributed via `setContext`/`getContext`. Consumers across subsystem boundaries:
- **DataTable** (data pipeline UI) → `getMapEditorState()` for `selectedFeatureIds`, `toggleFeatureId()`, `selectFeature()`
- **Geoprocessing** → reads interaction state from MapEditorState for measurement mode
- **useKeyboardShortcuts** → type-only import for keyboard dispatch

**Assessment:** Clean dependency injection. The DataTable coupling is the only inbound crossing from outside the map-editor subsystem — medium separability (could pass via props but context avoids prop drilling through deep nesting).

## 6. Thin Wrapper Delegation Pattern (NEW)

**Observed in:** Data Pipeline (web import wrappers), Worker (import processors)

All import paths follow: **parse (pure) → side effects (DB insert)**. The `import-engine` package owns all parsing logic; consumers are thin wrappers that delegate parsing and handle DB operations:

| Wrapper | Parser | Thickness |
|---------|--------|-----------|
| `geojson.ts` (25 LOC) | `parseGeoJSON` | Thin — textbook delegation |
| `shapefile.ts` (23 LOC) | `parseShapefile` | Thin |
| `xmlgeo.ts` (37 LOC) | `parseKML` / `parseGPX` | Thin |
| `csv.ts` (101 LOC) | `parseCSV` + `csvRowsToFeatures` | Thick — geocoding path |
| `geopackage.ts` (79 LOC) | `parseGeoPackage` | Medium — WKB-specific insert |

**Divergence:** The worker duplicates the same parse→insert pattern with raw SQL instead of Drizzle ORM. Bug fixes must be applied in two places. This is the primary structural duplication in the codebase.

**Assessment:** The delegation pattern itself is sound. The divergence between web wrappers (Drizzle) and worker (raw SQL) is the real risk — schema changes require dual updates.

## 7. tRPC Router Pattern (NEW)

**Observed in:** All server subsystems (12 routers, ~47 procedures)

Uniform three-tier procedure hierarchy across all routers:
- `publicProcedure` — unauthenticated (shares, public comments)
- `protectedProcedure` — session-authenticated
- `adminProcedure` — admin-only

All map-scoped operations gate through `requireMapAccess(role)` within the procedure. The pattern is consistent: input validation (Zod) → auth gate → business logic → return typed result. No router deviates from this shape.

**Assessment:** The most uniform cross-cutting pattern. Zero drift detected across all 12 routers.

## 8. Author Name Denormalization

**Observed in:** annotations, annotation_objects, comments (3 tables)

Author name captured at insert time as a denormalized column. Survives user deletion without requiring JOIN. All three tables follow identical pattern.

**Assessment:** Intentional — supports soft-delete user model (mx-b84f7c).

## 9. Discriminated Unions for State

**Observed in:** InteractionState, DrawingState, ContentType, AnchorType, GeoprocessingOp, BasemapId, DrawTool

Consistent use of TypeScript discriminated unions or string literal types for state modeling. Pattern aligns with decision mx-b66438.

**Dual-state resolution:** The former overlap between `mapStore.InteractionMode` and `interactionModes.InteractionState` is resolved — `MapEditorState` is now the single canonical source for interaction state.

## 10. localStorage Persistence

**Observed in:** filterStore (per-map filters), ActivityFeed (filter category)

No cross-tab sync. No conflict resolution. Keyed by mapId.

## 11. Three-Sublayer Rendering

**Observed in:** MapCanvas (all layers), Export (type detection)

Every layer renders 3 sublayers (Fill + Line + Circle) regardless of geometry type. Pattern aligns with decision mx-894289 (mixed geometry sublayers).

## 12. requireMapAccess Role Hierarchy

**Observed in:** All tRPC routers, REST v1, page loads

Single function gates all map-scoped operations. Role levels: viewer(0) < commenter(1) < editor(2). Owner always passes. Non-collaborators get NOT_FOUND (hides map existence).

## 13. Fire-and-Forget Audit/Activity Logging

**Observed in:** MapEditor (logActivity), Audit log (appendAuditLog), API key (lastUsedAt)

Logging calls are intentionally non-blocking. Errors swallowed. Callers use `void` prefix. Trade-off: observability loss on logging failure, but mutations are never blocked by logging.

## 14. Dual Auth Paths (ENHANCED from drill)

**Observed in:** tRPC (session cookies via Lucia), REST v1 (Bearer API keys + share tokens)

Two independent auth systems running in parallel with divergent behavior:
- **Session auth (Lucia):** handled in `hooks.server.ts`, populates `event.locals.user`. Used by all tRPC procedures. No disabledAt check, no rate limiting
- **API key auth:** handled in REST v1 middleware, validates `flk_`-prefixed Bearer tokens. Enforces disabledAt check, in-memory rate limiting, scope enforcement

**Redundancy (NEW):** REST API endpoints receive both auth paths because `hooks.server.ts` runs for all requests (including `/api/v1/*`). The session auth result is populated but ignored by v1 middleware, which re-authenticates via API key. This is redundant but not harmful — the v1 middleware is authoritative for its routes.

Annotation image upload uses a third path (REST side-channel outside tRPC).

## 15. Viewport Sync Protocol (NEW from drill)

**Observed in:** MapCanvas (MapLibre GL ↔ Svelte 5 reactive state)

MapCanvas uses a `viewportVersion` generation counter to break bidirectional update cycles between MapLibre's native viewport state and Svelte 5 reactive bindings. The protocol:

1. User pans/zooms → MapLibre `moveend` event → update Svelte state → increment `viewportVersion`
2. Programmatic viewport change (e.g., flyTo) → increment `viewportVersion` first → set MapLibre viewport → ignore the resulting `moveend` callback if version matches

This is a general pattern for two-way reactive bindings in Svelte 5 where one side is an imperative library (MapLibre, deck.gl, etc.) and the other is reactive state. The generation counter prevents infinite update loops without requiring debouncing or `$effect.root` escape hatches.

**Assessment:** Clean solution to a fundamental Svelte 5 + imperative library integration problem. Reusable pattern for any two-way binding with an external imperative API.

## 16. Activity Feed Write-Only Dead End (NEW from drill)

**Observed in:** Collaboration (eventsRouter), API/Auth (map_events table)

Backend infrastructure for activity tracking exists but has zero UI consumers:
- `eventsRouter` in tRPC defines procedures for writing map events
- `map_events` table in PostgreSQL stores activity records
- `logActivity()` calls fire-and-forget from MapEditor and other mutation sites
- **No read path exists** — no UI component fetches or displays activity events

The `ActivityFeed` component referenced in localStorage patterns (#10) only manages filter state for a feed that is never rendered. The write path spans collaboration + API subsystems, making this a cross-cutting dead end rather than a single-subsystem orphan.

**Assessment:** Technical debt. The infrastructure cost is low (fire-and-forget writes are cheap), but the unused table will grow unbounded. Either build the read path or remove the write path to avoid confusion and unbounded storage growth.

## 17. Runtime Validation Gaps (NEW from drill)

**Observed in:** Redis queue boundary, REST v1 boundary, tRPC boundary, Worker↔DB boundary, shared-types import boundary

Only **2 of 5 identified process boundaries** have Zod validation at runtime:

| Boundary | Runtime Zod validation | Status |
|----------|----------------------|--------|
| tRPC input | Yes — all procedures validate via `.input(zodSchema)` | Covered |
| REST v1 input | Yes — middleware validates request bodies | Covered |
| Redis queue payload | No — BullMQ jobs serialized/deserialized without validation | **Gap** |
| Worker DB results | No — raw SQL results used without schema validation | **Gap** |
| shared-types imports | No — consumers import types but no runtime check at boundary | **Gap** |

Each boundary has different risk characteristics:
- **Redis gap** is highest risk — queue payloads cross process boundaries and survive restarts, so schema drift between web and worker is silent
- **Worker DB gap** is medium risk — raw SQL results bypass Drizzle's type narrowing
- **shared-types gap** is low risk — TypeScript catches most issues at compile time, though runtime shape mismatches are possible with dynamic data

**Assessment:** The covered boundaries (tRPC, REST) are the most externally exposed, so the highest-severity gaps are addressed. The Redis boundary gap is the most dangerous because it crosses process boundaries with no compile-time safety net.

## 18. Import-Engine Pure Parsing Boundary (NEW from drill)

**Observed in:** import-engine (package), data-pipeline (web wrappers), import-worker (worker consumers)

The `import-engine` package enforces a clean architectural boundary: all file parsing is pure (no DB, no framework dependencies), and all side effects (DB insertion, file cleanup) live in consumer wrappers. This enables:
- Shared parsing logic between web (Drizzle ORM) and worker (raw SQL) paths
- Unit-testable parsing without DB fixtures
- Format-specific behavior isolated from transport concerns

The boundary is enforced by package structure (separate `packages/import-engine/`) rather than runtime checks. See pattern #6 (Thin Wrapper Delegation) for the consumer side.

**Assessment:** Sound architectural boundary. The remaining risk is the Drizzle-vs-raw-SQL divergence in consumers, not the parsing layer itself.

## 19. MapEditorState as Cross-Subsystem Hub (NEW from drill)

**Observed in:** Map Editor, Drawing Tools, Layer Management, Data Pipeline (DataTable), Geoprocessing

`MapEditorState` (consolidated from 3 former stores + 5 bridge effects) serves as the central state hub across 5 subsystems. Cross-subsystem access patterns:

| Consumer | Accesses | Direction |
|----------|----------|-----------|
| DrawingTools | interaction mode, active layer, selected features | Read/Write |
| LayerManagement | layer list, active layer ID | Read/Write |
| DataTable | selectedFeatureIds, toggleFeatureId, selectFeature | Read/Write |
| Geoprocessing | interaction state (measurement mode) | Read-only |
| useKeyboardShortcuts | type-only import for dispatch typing | Type-only |

This is the highest-coupling component in the system. Changes to MapEditorState's API have a blast radius of 5 subsystems. The Svelte 5 context injection pattern (#5) mitigates this by making the coupling explicit via `getMapEditorState()` calls rather than implicit global imports.

**Assessment:** Acceptable coupling for an orchestrator component, but the DataTable crossing is the weakest seam — it would benefit from an extracted selection interface to reduce the API surface exposed to the data-pipeline subsystem.

---

## Cross-Frame Interaction Analysis

### Era-Distance Weighting

All 13 boundary crossings from the map-editor subsystem are uniform 2024+ era. No era-distance penalties apply — there are no legacy-to-modern seams that would amplify coupling cost.

### Knot Complement (Parallelism Map)

Independent refactoring zones that can be worked in parallel without interference:

| Zone | Subsystems | Can change without affecting others |
|------|-----------|-------------------------------------|
| **A: Import parsing** | import-engine | Pure functions, no DB, no framework deps |
| **B: Worker DB path** | worker | Raw SQL — independent of web's Drizzle path |
| **C: Annotation UI** | annotation-collab | Isolated after collaboration/ stub removal |
| **D: Auth/API** | api-auth | No drift detected, stable contract surface |
| **E: Geoprocessing** | geoprocessing | Minor line-number drift corrected, otherwise stable |

**Entangled zone:** Map Editor ↔ DataTable (data pipeline UI). The `getMapEditorState()` crossing means changes to MapEditorState's selection API affect DataTable. This is the only cross-subsystem entanglement detected.

### Response Growth Prediction

| Potential refactoring | Subsystems affected | Predicted response radius |
|----------------------|---------------------|--------------------------|
| Unify worker + web DB insertion | data-pipeline, worker | 2 subsystems, contained — shared module extraction |
| Remove orphaned deps | web, worker | 0 behavior change — package.json only |
| Add upload file cleanup | data-pipeline, worker | 2 subsystems — add `unlink()` in both paths |
| Extract DataTable selection interface | map-editor, data-pipeline | 2 subsystems — interface extraction, low risk |
