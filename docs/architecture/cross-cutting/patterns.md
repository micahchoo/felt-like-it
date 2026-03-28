# Cross-Cutting Patterns

Patterns observed across 2+ subsystems in felt-like-it.

## 1. Server-First Mutations (No Optimistic UI)

**Observed in:** Map Editor, Layer Management, Annotation System, Collaboration

All mutations follow: mutate → await server → invalidate query → re-fetch. No TanStack Query optimistic updates are used anywhere. The one exception is `hotOverlay` in DrawingToolbar, which is a bespoke manual preview layer (not TanStack's optimistic update API).

**Assessment:** Intentional — aligns with the `undo-after-server-confirm` decision (mx-2f016d). Prevents phantom undo entries for failed saves.

## 2. Effect-Tracker Discipline

**Observed in:** MapEditor, MapCanvas, DrawingToolbar (likely project-wide)

All `$effect` blocks wrapped with `effectEnter`/`effectExit` calls tagged with component prefix codes (`ME:`, `MC:`, `DT:`). Used for debugging reactive dependency cycles in Svelte 5.

**Assessment:** Consistent convention. Not a standard Svelte pattern — project-specific instrumentation.

## 3. Generation Counters for Async Race Guards

**Observed in:** drawingStore, mapStore

Pattern: increment counter before async operation, compare after completion. If stale, discard result. Used for Terra Draw dynamic import and viewport flyTo cycle prevention.

**Assessment:** Lightweight alternative to AbortController. Consistent implementation across two stores.

## 4. Author Name Denormalization

**Observed in:** annotations, annotation_objects, comments (3 tables)

Author name captured at insert time as a denormalized column. Survives user deletion without requiring JOIN. All three tables follow identical pattern.

**Assessment:** Intentional — supports soft-delete user model (mx-b84f7c).

## 5. Discriminated Unions for State

**Observed in:** InteractionState, DrawingState, ContentType, AnchorType, GeoprocessingOp, BasemapId, DrawTool

Consistent use of TypeScript discriminated unions or string literal types for state modeling. Pattern aligns with decision mx-b66438.

**Dual-state issue:** `mapStore.InteractionMode` (legacy enum) overlaps with `interactionModes.InteractionState`. Only one should be canonical.

## 6. localStorage Persistence

**Observed in:** filterStore (per-map filters), ActivityFeed (filter category)

No cross-tab sync. No conflict resolution. Keyed by mapId.

## 7. Three-Sublayer Rendering

**Observed in:** MapCanvas (all layers), Export (type detection)

Every layer renders 3 sublayers (Fill + Line + Circle) regardless of geometry type. Pattern aligns with decision mx-894289 (mixed geometry sublayers).

## 8. requireMapAccess Role Hierarchy

**Observed in:** All tRPC routers, REST v1, page loads

Single function gates all map-scoped operations. Role levels: viewer(0) < commenter(1) < editor(2). Owner always passes. Non-collaborators get NOT_FOUND (hides map existence).

## 9. Fire-and-Forget Audit/Activity Logging

**Observed in:** MapEditor (logActivity), Audit log (appendAuditLog), API key (lastUsedAt)

Logging calls are intentionally non-blocking. Errors swallowed. Callers use `void` prefix. Trade-off: observability loss on logging failure, but mutations are never blocked by logging.

## 10. Dual Auth Paths

**Observed in:** tRPC (session cookies via Lucia), REST v1 (Bearer API keys + share tokens)

Two independent auth systems with divergent behavior:
- tRPC: no disabledAt check, no rate limiting
- REST v1: disabledAt check, in-memory rate limiting, scope enforcement

Annotation image upload uses a third path (REST side-channel outside tRPC).
