# Evolution Analysis

> How this codebase got here, what forces shaped it, and where the trajectory leads.

**Cross-references:** [infrastructure](infrastructure.md) | [risk-map](risk-map.md) | [subsystems](subsystems.md)

---

## Timeline

| Era | Dates | Commits | Character |
|-----|-------|---------|-----------|
| Genesis | Feb 24 2026 | ~20 | Rapid prototype — `0.1`, loose docs, `changes`, `more` commits |
| Buildout | Late Feb 2026 | ~80 | Feature sprint — admin, export, logging, E2E, shared test-utils |
| Hardening | Early Mar 2026 | ~100 | Refactoring wave — shared helpers, type debt reduction, module extraction |
| Remediation | Mid Mar 2026 | ~120 | Design reskin, shadow walk, brownfield UX waves, optimistic concurrency |
| Consolidation | Late Mar 2026 | ~70 | Store unification, import-engine extraction, codebase simplification |

**Total:** ~390 commits across 5 weeks. Velocity is high; the codebase is young but has undergone significant structural revision already.

## Churn Hotspots

```
File                        Commits   Trend
────────────────────────────────────────────
MapEditor.svelte              63      ▼ cooling (decomposed to orchestrator)
AnnotationPanel.svelte        40      → stable (no active refactor)
DrawingToolbar.svelte         26      ▼ cooling (delegated to MapEditorState)
MapCanvas.svelte              25      → stable (contains diagenetic workarounds)
```

**MapEditor** was the highest-churn file in the codebase. The store consolidation (3 stores into MapEditorState class) is designed to reduce its future churn by eliminating the bridge-effect synchronization that drove most edits. The component is now an orchestrator, not a god-component. Churn should drop sharply if the consolidation holds.

## Fault Lines

### Resolved

| Fault | Resolution | Status |
|-------|-----------|--------|
| Store fragmentation (drawing + selection + interaction-modes) | Consolidated into `MapEditorState` class | Uncommitted, working tree |
| 5 bridge effects (`useInteractionBridge`) | Replaced by synchronous method calls | Uncommitted, working tree |
| Collaboration dead code (5 stub components) | Removed | Committed (brownfield waves) |
| God-component MapEditor | Decomposed to thin orchestrator | Uncommitted, working tree |

### Active

| Fault | Location | Tension |
|-------|----------|---------|
| Dual import path | `server/import/` (ORM) vs `worker/` (raw SQL) | Parsing unified via import-engine; orchestration still diverges. Two paths to insert features with different validation guarantees |
| Import-engine extraction | `packages/import-engine/` | Parsing complete and tested. Layer creation, batch insert, progress tracking remain duplicated in `server/import/shared.ts` and `worker/src/index.ts` |
| Worker raw SQL bypass | `services/worker/src/index.ts` | 669 LOC with raw PostGIS SQL bypassing Drizzle ORM. No tests. Data corruption risk |
| CI has no quality gate | `.github/workflows/ci.yml` | 73 test files, ESLint, svelte-check exist but none enforced in pipeline |

## Diagenetic Code

Lithified temporaries now load-bearing:

### 1. `queueMicrotask` in MapCanvas (3 call sites)

```
apps/web/src/lib/components/map/MapCanvas.svelte: lines 479, 772, 841
```

Workaround for Svelte 5 effect depth limit. Defers state updates to avoid hitting the iteration ceiling during click handlers and map interaction callbacks. Safe (runs before next paint frame) but invisible in debug traces. **Removal condition:** Svelte 5 raises its effect iteration limit or provides an escape hatch.

### 2. `sanitize.ts` re-export shim

```
apps/web/src/lib/server/import/sanitize.ts
```

Single-line re-export: `export { sanitizeFilename } from '@felt-like-it/import-engine'`. Exists solely to preserve import paths for modules that referenced the old location. All actual logic lives in import-engine. **Removal condition:** Update all consumers to import directly from `@felt-like-it/import-engine`, then delete this file.

## Metamorphic Modules

Modern surface, ancient assumptions underneath:

### Worker Raw SQL Insertion (`services/worker/src/index.ts`)

The worker wraps raw PostGIS SQL (`INSERT INTO features ... ST_GeomFromGeoJSON`) inside modern TypeScript with proper types, async/await, and import-engine parsers. But the SQL itself:
- Bypasses the Drizzle ORM that every other write path uses
- Has no schema validation beyond what PostGIS rejects
- Has no test coverage
- Could silently insert malformed data that the ORM path would reject

This is the most significant metamorphic module: it looks modern but carries the assumptions of the genesis era when speed-to-insert mattered more than validation consistency.

## Architectural Drift Record

| Decision | Era | Still Holds? | Drift |
|----------|-----|-------------|-------|
| Server-first mutations, no optimistic UI | Buildout | Yes | Optimistic concurrency added (version columns) but mutations still server-first |
| Discriminated unions for interaction modes | Buildout | Evolved | Now encapsulated in MapEditorState class rather than standalone store |
| Dual API surface (tRPC + REST v1) | Buildout | Yes | REST v1 serves Research-Narratives; no drift |
| Three-sublayer rendering | Buildout | Yes | No changes to rendering strategy |
| Soft-delete users | Buildout | Yes | No changes |
| Tamper-evident audit log | Buildout | Yes | SHA-256 hash chain intact |

## What Era Is This Codebase In?

**Late Hardening / Early Maturation.**

The codebase has passed through rapid genesis and feature buildout into a sustained hardening phase. Evidence:

1. **Structural investment is active.** The store consolidation and import-engine extraction show the team investing in architecture rather than shipping features. This is characteristic of a codebase transitioning from "make it work" to "make it right."

2. **The churn pattern is healthy.** High-churn files are cooling (MapEditor decomposed, drawing logic consolidated). New abstractions (MapEditorState, import-engine) are absorbing complexity rather than spreading it.

3. **Debt is identified and bounded.** The risk map is explicit. Diagenetic code is documented. The dual import path is a known fault, not a hidden one.

4. **No era divergence.** All code uses ESM, async/await, TypeScript strict, Node 22, Svelte 5 runes. There are no legacy pockets requiring migration.

## Trajectory

```
NOW ──────────────────────────────────────────────── NEXT

Store consolidation (uncommitted) ─── commit + test ──► stable state management
Import-engine parsing (done) ──── orchestration ──────► unified insert path
Worker raw SQL (untested) ──── add tests + ORM ───────► validated writes
CI no gate (known) ──── wire test/lint steps ─────────► quality enforcement
queueMicrotask (load-bearing) ──── Svelte 5 update ──► remove workarounds
sanitize.ts shim (residual) ──── update imports ──────► delete shim
```

**The single highest-leverage next step** is committing the store consolidation (MapEditorState) with tests, then wiring CI quality gates. Everything else (import-engine orchestration unification, worker testing) builds on having a stable, tested core.

---

*Last updated: 2026-03-29*
