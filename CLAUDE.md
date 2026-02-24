# CLAUDE.md

> Confirm which sections below apply before writing any code.

## Loop (mandatory)

ORIENT → BUILD → TEST → RECTIFY → SYNC. No skipping.

- ORIENT: Read STATE.md. Read ARCHITECTURE.md/ROADMAP.md on phase transitions or gaps.
- BUILD: Implement.
- TEST: Write/update tests.
- RECTIFY: Lint, type-check, fix.
- SYNC: Overwrite STATE.md (status, delta, gaps). Update ROADMAP/ARCHITECTURE only on structural changes.
- Exit: zero gaps, clean types, green tests, no pending migrations.

## Types

No `any` without `// TYPE_DEBT: <reason>`. Single source of truth. Narrow first. Schema changes → typed reversible tested migrations first. Unresolvable → `// TODO(loop):`.

## Tests

Encode contracts, not implementations.

- **Stub check**: trivial stub passes → test is too weak.
- **No magic literals**: assert relationships, not hardcoded values.
- **≥1 adversarial case per file**: empty, max, malformed, concurrent.
- **Names = spec**: `rejects negative quantities` not `test_3`.
- **Don't test compiler guarantees.**
- **UI**: assert user-visible outcomes only. Never DOM structure or component internals.

## Lint

Bug fix → can a **project-wide** rule prevent this **category** everywhere? Yes → add it now. Prefer structural rules. `TODO(loop)` at 3+ rounds → escalate.

## Docs (when applicable)

One task per doc. Structure: does → how → expect → troubleshoot. User's words. Walk it as a new user. Changed in app → changed in docs same round. Delete docs that restate types.

## UI (when applicable)

Trace render → data source. Wire types end-to-end. Lint for: missing props, unhandled loading/error, stale subscriptions.