# CLAUDE.md

> Project-specific standards. Workflow is handled by superpowers skills.

## Types

No `any` without `// TYPE_DEBT: <reason>`. Single source of truth. Narrow first. Schema changes → typed reversible tested migrations first. Unresolvable → `// TODO(loop):`.

## Tests

Encode contracts, not implementations. These rules apply on top of superpowers:test-driven-development:

- **Stub check**: trivial stub passes → test is too weak.
- **No magic literals**: assert relationships, not hardcoded values.
- **≥1 adversarial case per file**: empty, max, malformed, concurrent.
- **Names = spec**: `rejects negative quantities` not `test_3`.
- **Don't test compiler guarantees.**

## Lint

Bug fix → can a **project-wide** rule prevent this **category** everywhere? Yes → add it now. Prefer structural rules. `TODO(loop)` at 3+ rounds → escalate.

## Docs (when applicable)

One task per doc: does → how → expect → troubleshoot. User's words. Walk it as a new user. Changed in app → changed in docs same round. Delete docs that restate types.

## UI (when applicable)

**Wiring**: Trace render → data source. Wire types end-to-end. Lint for: missing props, unhandled loading/error, stale subscriptions.

**Shadow**: Walk every user-facing flow through the code as a first-time user. Don't suggest fixes — report what the user experiences.

- For each flow: what renders first → what can the user do → trace handler → state → re-render → what if they do nothing → what if they do it wrong.
- Happy path first, then sad, then weird (back button, refresh, double-click, slow network). Branch on roles/flags → walk each.
- Flag: DEAD END (no obvious action) · SILENT FAIL (error caught, not shown) · NO FEEDBACK (state changes invisibly) · ASSUMPTION (jargon, unlabelled inputs) · RACE (stale data, flash states) · NAV TRAP (loses state) · HIDDEN REQ (validation only on submit).
- Every claim → file:line. Every flag → can a test or lint rule catch it permanently? Add it.
- Report per flow in STATE.md: entry, steps, issues with category and location.

**UI tests**: Assert user-visible outcomes only. Never DOM structure, CSS classes, or component internals.

<!-- mulch:start -->
## Project Expertise (Mulch)
<!-- mulch-onboard-v:1 -->

This project uses [Mulch](https://github.com/jayminwest/mulch) for structured expertise management.

**At the start of every session**, run:
```bash
mulch prime
```

This injects project-specific conventions, patterns, decisions, and other learnings into your context.
Use `mulch prime --files src/foo.ts` to load only records relevant to specific files.

**Before completing your task**, review your work for insights worth preserving — conventions discovered,
patterns applied, failures encountered, or decisions made — and record them:
```bash
mulch record <domain> --type <convention|pattern|failure|decision|reference|guide> --description "..."
```

Link evidence when available: `--evidence-commit <sha>`, `--evidence-bead <id>`

Run `mulch status` to check domain health and entry counts.
Run `mulch --help` for full usage.
Mulch write commands use file locking and atomic writes — multiple agents can safely record to the same domain concurrently.

### Before You Finish

1. Discover what to record:
   ```bash
   mulch learn
   ```
2. Store insights from this work session:
   ```bash
   mulch record <domain> --type <convention|pattern|failure|decision|reference|guide> --description "..."
   ```
3. Validate and commit:
   ```bash
   mulch sync
   ```
<!-- mulch:end -->
