# Handoff

## Goal
Tackle open items from previous sessions: merge adversarial bugs, fix Terra Draw bug, design lost updates concurrency, deploy to production.

## Progress
- ✅ `fix/api-adversarial-bugs` — already merged to master (commit `b62fa3d`)
- ✅ Terra Draw bug fixed — dual-write race in DrawingToolbar.svelte eliminated (commit `df08c08`)
- ✅ Optimistic concurrency — designed, implemented, merged to master (`feat/optimistic-concurrency`, 6 commits)
- ✅ Pre-existing test failures — all 7 fixed, 720/720 pass (commit `a862605`)
- ✅ Hook verification — startup ~420ms, tsc incremental 2.3x, cache warm works
- ✅ `anti-pattern-scan.sh:141` bug fixed — `grep -c` double-zero output
- 🔄 Deploy to production — infrastructure exists, migration needs running first

## Branch
`master` — all work merged. `feat/optimistic-concurrency` can be deleted.

## What Worked
- **Parallel investigation agents** — 3 agents (adversarial branch, Terra Draw, hook verification) dispatched simultaneously during brainstorming
- **Sequential mode for implementation** — subagents got blocked on Bash permissions; doing the work directly was faster
- **Spec review loop** — caught 5 real issues (phantom endpoints, deployment gap, reorder atomicity)

## What Didn't Work
- **Subagent mode for implementation** — agents got blocked on Bash permissions due to context-mode hooks suggesting MCP tools that don't exist in subagent scope. Do implementation directly or grant `bypassPermissions`.
- **DrawingToolbar stash/pop** — stashing the Terra Draw fix, branching for concurrency, then popping works but is fragile

## Key Decisions
- **Optimistic concurrency via integer version column** — not updatedAt (timestamp precision issues), not CRDTs (overkill for async collaboration). Version optional during rollout for backward compat. Stepping stone to real-time.
- **Terra Draw single-owner mode switch** — `$effect` is the only code path that calls `setMode()`. `setTool()` only sets `selectionStore.activeTool`. Eliminates dual-write race.
- **Reject stale writes, not last-write-wins** — zero data loss tolerance for the async phase. Toast + cache invalidation on CONFLICT.
- **Transactional layer reorder** — `layers.reorder` wrapped in `db.transaction`, entire batch fails atomically on any version mismatch.

## Active Skills & Routing
- **brainstorming** → design for lost updates concurrency (If-Match vs LWW)
- **writing-plans** → implementation plan for optimistic concurrency
- **executing-plans** → 3-wave implementation (schema → server mutations → client handling)
- **portainer-deploy** → needed for deploy to production (not yet invoked)

## Next Steps
1. **Run migration** — `DATABASE_URL=... pnpm migrate` to apply `0015_add_version_columns.sql` on dev/prod DB
2. **Deploy to production** — use `portainer-deploy` skill with existing `docker/` infrastructure (Dockerfile.web, build-push.sh, docker-compose.portainer.yml)
3. **Remove backward compat fallback** — once deployed and confirmed working, make `version` required (not optional) in UpdateMapSchema/UpdateLayerSchema

## Context Files
- `apps/web/src/lib/server/db/migrations/0015_add_version_columns.sql` — migration to run
- `apps/web/src/lib/server/trpc/routers/maps.ts` — maps.update with version check
- `apps/web/src/lib/server/trpc/routers/layers.ts` — layers.update + transactional reorder
- `apps/web/src/lib/components/map/DrawingToolbar.svelte` — Terra Draw fix
- `docker/docker-compose.portainer.yml` — production compose config
- `docs/superpowers/specs/2026-03-21-optimistic-concurrency-design.md` — concurrency spec
