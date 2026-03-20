# Handoff

## Goal
Build a public REST API for FLI (felt-like-it) that external apps like Research-Narratives can use to consume spatial data, annotations, and comments. The API should be general-purpose enough for any app adding a narrative layer on top of FLI's spatial data.

## Progress
- ✅ Compared FLI and Research-Narratives codebases — identified RN's 3 Supabase contracts (file storage, nodes_1 table, GeoJSON fetch)
- ✅ Designed API spec through brainstorming (5 design questions resolved) — `docs/superpowers/specs/2026-03-19-public-rest-api-design.md`
- ✅ Spec reviewed 2 rounds (10 issues found round 1, 2 found round 2, all fixed)
- ✅ Implementation plan written — `docs/superpowers/plans/2026-03-19-public-rest-api-v1.md`
- ✅ Plan reviewed 1 round (7 issues found, all fixed)
- ✅ Worktree created at `.worktrees/public-rest-api-v1` (branch `public-rest-api-v1`, deps installed)
- 🔄 Execution started — executing-plans skill invoked but no tasks begun yet
- ⬚ Entry gate (hybrid-research + characterization testing on annotationService.list)
- ⬚ Wave 0: Tasks 1-2 (DB migration + error codes)
- ⬚ Wave 1: Tasks 3-5 (middleware, serializers/links/pagination, annotationService pagination)
- ⬚ Wave 2: Tasks 6-11 (all route handlers — maps, layers, geojson, features, tiles, annotations, comments)
- ⬚ Wave 3: Tasks 12-13 (file upload/download + integration tests)
- ⬚ Pre-completion gate (wiring analysis + characterization tests)
- ⬚ Finishing branch (requesting-code-review)

## What Worked
- Context MCP `ctx_batch_execute` for gathering both codebases in parallel — very efficient
- `get_docs` for Drizzle ORM insert/returning patterns, Vitest mocking, Zod safeParse
- Studying existing `+server.ts` routes (`api/upload/`, `api/export/`, `api/job/`) to match codebase conventions
- Spec review loop caught real issues (share token auth had no implementable path, PATCH/DELETE had no shapes)
- Plan review caught compile errors before implementation (listLinks undefined, rateLimit signature mismatch)

## What Didn't Work
- Svelte/SvelteKit context package doesn't have routing docs (RequestHandler, +server.ts patterns) — had to derive from existing code instead
- Initial spec missed several response shapes (list endpoints, comments, PATCH/DELETE) — caught by reviewer

## Key Decisions
All locked in spec section 6 — the 10 most important:
1. **Approach 2** — standalone REST alongside tRPC (not adapter, not replacement)
2. **Two-tier auth** — API keys (Bearer flk_) + share tokens (?token=), no OAuth2
3. **API key scope** — `read` | `read-write` column on apiKeys table
4. **Write surface** — annotations, comments, files only (no layer/feature CRUD)
5. **GeoJSON** — bare `application/geo+json`, no envelope wrapping
6. **Envelope** — `{ data, meta, links }` for everything else (HATEOAS-lite)
7. **Cursor pagination** — createdAt+id composite, base64url encoded
8. **URL versioning** — `/api/v1/`
9. **middleware.ts is a utility module** — not a SvelteKit hook, no hooks.server.ts changes
10. **Features list omits geometry** — use GeoJSON endpoint for shapes

## Active Skills & Routing
- `brainstorming` → completed (spec produced and approved)
- `writing-plans` → completed (plan produced and reviewed)
- `executing-plans` → **active, Subagent Mode** — next agent should invoke this skill with the plan path
  - Entry gate not yet started — must do hybrid-research + characterization-testing first
  - The only existing file being modified is `annotationService.list` (adding cursor/limit params)
- `handoff` → writing this file now

## Codebase Conventions (for implementing agent)
Documented in the plan header, but critical ones:
- Destructure event: `async ({ params, request, url }) =>` not `async (event) =>`
- Env vars: `import { env } from '$env/dynamic/private'` not `process.env`
- Crypto: `import { randomUUID } from 'crypto'` (no `node:` prefix)
- File ops: `import { writeFile } from 'fs/promises'` (no `node:` prefix)
- TRPCError handling: catch and map to API error codes when calling `requireMapAccess`

## Next Steps
1. **Start executing-plans skill** with `docs/superpowers/plans/2026-03-19-public-rest-api-v1.md`
   - Use Subagent Mode (Claude Code has subagent support)
   - Begin with Entry Gate: hybrid-research on `annotationService.list` (only existing code being modified), then characterization tests
2. **Execute Wave 0** (Tasks 1-2): DB migration + error codes module
3. **Execute Wave 1** (Tasks 3-5): Middleware, helpers, service changes
4. **Execute Wave 2** (Tasks 6-11): All route handlers in parallel
5. **Execute Wave 3** (Tasks 12-13): Files + tests
6. **Pre-completion gate**: Wiring analysis + characterization tests
7. **Finish branch**: requesting-code-review skill

## Context Files
- `docs/superpowers/specs/2026-03-19-public-rest-api-design.md` — the full API spec (response shapes, auth model, error codes)
- `docs/superpowers/plans/2026-03-19-public-rest-api-v1.md` — the implementation plan (13 tasks, 4 waves, complete code)
- `apps/web/src/lib/server/annotations/service.ts` — the one existing file being modified (adding pagination)
- `apps/web/src/hooks.server.ts` — existing Bearer auth pattern to replicate in middleware.ts
- `apps/web/src/routes/api/upload/+server.ts` — reference for SvelteKit route handler conventions
