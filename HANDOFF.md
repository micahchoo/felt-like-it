# Handoff: TanStack Query Mutation Invalidation

## Goal

Add `@tanstack/svelte-query` to fix 11 broken mutation flows where UI doesn't update after data changes (annotations, comments, features, geoprocessing). Includes a hot/cold overlay pattern for large vector tile layers.

## Progress

### Completed

- **Shadow walk of all drawing/annotation flows** — identified 14 usability bugs across 4 dimensions (annotation mutations, drawing flows, reactive data flow, edge cases)
- **Root cause identified** — no query cache invalidation layer; all mutations rely on manual parent→child callback refetch chains that are frequently incomplete
- **Design spec written and approved (rev 3)** at `docs/superpowers/specs/2026-03-15-tanstack-query-mutation-invalidation-design.md`
  - Evaluated against two industry reference docs (Felt/Figma/tldraw/Mapbox patterns)
  - Passed spec review with all critical issues resolved
  - Covers 11 mutation flows, hot/cold overlay for large layers, QueryClient config, excluded flows, future considerations

### Not Started

- Implementation plan (next step — invoke `writing-plans` skill)
- All code changes

## What Worked

- Parallel shadow walk agents (4 agents, each focused on a different UX dimension) found far more issues than the initial type-system-focused code review
- The CLAUDE.md "Shadow" protocol (trace handler → state → API → cache → re-render) was the right lens for finding the "changes don't stick" class of bugs
- Industry reference docs caught a critical design flaw: imperative `setTiles()` conflicts with `svelte-maplibre-gl`'s declarative source management → replaced with hot/cold overlay pattern

## What Didn't Work

- First code review focused narrowly on the discriminated union refactor's type correctness and completely missed real usability bugs — don't review type system changes without also walking user flows
- Agent output files are full transcripts (40-60k tokens), not just results — use `ctx_execute` to extract final result sections rather than trying to `Read` them directly

## Key Decisions

1. **Targeted scope** — only 11 broken flows, not full migration (reduces risk, establishes pattern for incremental adoption)
2. **Hot/cold overlay for large layers** — NOT imperative `setTiles()` cache-busting (conflicts with svelte-maplibre-gl). Recently-drawn features render in a GeoJSON "hot" overlay; Martin tiles serve stable "cold" base
3. **Optimistic for deletes/resolves, refetch for creates** — deletes feel instant with rollback on error; creates wait for server data (need IDs/timestamps)
4. **Annotation pins derived from query cache** — MapEditor subscribes to `['annotations', 'list']` query, pins are `$derived` from query data. Eliminates `onannotationchange` data-refresh callback (kept only for interaction state transitions, renamed to `onannotationsaved`)
5. **`createQuery` at component top-level only** — Svelte 5 + TanStack footgun: queries must be initialized in `<script>` block, never inside `$effect` or conditionally
6. **staleTime: 30s** — natural read debounce; `refetchOnWindowFocus: false` to avoid surprise refetches mid-editing

## Next Steps

1. **Invoke `writing-plans` skill** with the spec at `docs/superpowers/specs/2026-03-15-tanstack-query-mutation-invalidation-design.md` to create a chunked implementation plan. **IMPORTANT: Nothing from the spec should be deferred — all 11 flows, the hot/cold overlay, QueryClient config, annotation pin reactivity, and tests must be in the plan. The spec IS the scope.**
2. **Create git worktree** for the feature branch (use `using-git-worktrees` skill)
3. **Implement in order:**
   - Chunk 1: Infrastructure (install dep, QueryClient, query keys, provider setup)
   - Chunk 2: Hot overlay helpers (`map-sources.ts`)
   - Chunk 3: Annotation mutations (Flows 1-3a in AnnotationPanel)
   - Chunk 4: Comment mutations (Flows 4-6 in AnnotationPanel)
   - Chunk 5: Feature/drawing mutations (Flows 7-9 in DrawingToolbar + MapEditor)
   - Chunk 6: Geoprocessing + annotation pin reactivity (Flow 10 + MapEditor derived pins)
   - Chunk 7: Tests
4. **Run `mulch learn` + `mulch record`** after implementation

## Context Files

| File | Why |
|------|-----|
| `docs/superpowers/specs/2026-03-15-tanstack-query-mutation-invalidation-design.md` | **THE SPEC** — all decisions, flows, architecture, constraints |
| `apps/web/src/lib/components/annotations/AnnotationPanel.svelte` | Flows 1-6 + 3a: all annotation/comment mutations to wrap |
| `apps/web/src/lib/components/map/MapEditor.svelte` | Orchestrator: annotation pins, feature handling, interaction state |
| `apps/web/src/lib/components/map/DrawingToolbar.svelte` | Flows 7-9: feature upsert, undo/redo |
| `apps/web/src/lib/utils/trpc.ts` | Current tRPC client setup (plain httpBatchLink, no query layer) |
| `docs/reference/How mapping teams manage annotation mutation state.md` | Industry patterns informing the design |
| `docs/reference/Twelve architectural patterns for mutable map and canvas annotation state.md` | Additional patterns (hot/cold, signals, batching) |
