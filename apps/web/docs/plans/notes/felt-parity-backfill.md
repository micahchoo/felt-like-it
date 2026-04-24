# Spike 1.5 — Backfill policy for legacy `name`

**Task:** Felt-parity plan Wave 1 Task 1.5 (spike).
**Question:** Do we backfill `name` for existing annotations from their text content, or leave NULL and rely on the UI fallback?
**Time cap:** 30 min.
**Result:** Do nothing. Ship with the UI fallback. Details below.

---

## Evidence

Query against the dev Postgres (`felt-like-it-postgres-1`), 2026-04-24:

| Metric | Count |
|--------|-------|
| Total annotation rows | 2108 |
| Rows with `name IS NOT NULL` (post-migration, post-Wave-1 test runs) | 2 |
| Rows with `content.kind = 'single'` AND `content.body.type = 'text'` | 2100 |
| Rows eligible for first-line backfill (single-text, unnamed) | 2098 |

The dev DB is accumulated from fixture resets and a few thousand e2e runs. It is **not** a representative production dataset — real production has zero users today.

## Options considered

1. **Synthesize `name` from text content** — "first non-empty line, truncated at 80 chars, dedup suffix if collision." Pros: every row gets a readable label on day 1. Cons: we invent content the user didn't write; revision history confuses if we later allow editing; no equivalent for non-text content.
2. **Leave NULL; UI falls back to content preview** — AnnotationList already renders `{annotation.name ?? preview}`. No user-visible regression.
3. **Show an empty-state "Add a name" nudge on legacy rows** — product design, not a backfill.

## Decision

**Option 2 (UI fallback).** Rationale:

- The user base is ~0. Backfill solves a problem nobody has.
- Synthesizing names from content is a **write** operation with semantic weight. Once the row has `name = "First line of my note"`, the UI can no longer distinguish "user-named" from "system-synthesized" — and the Edit flow will happily let someone replace the synthesized name with a different value, leaving revision history that looks like the user originally wrote the synthesized value. That's a subtle source of truth corruption.
- The UI fallback (`AnnotationList.svelte` row 82-85, shipped in commit `08931dd`) already handles the legacy case cleanly.
- When production usage shows up, revisit: option 1 can be rerun non-destructively with a where-clause of `name IS NULL` at any time.

## Recommendation to the plan

- **Task 1.5 closed as "no-op".** Do not schedule backfill.
- **Task 4.1 (convert)** must still handle `name IS NULL` gracefully — write a unit test covering this case alongside the happy-path test.
- **Future spike trigger:** revisit when we have >50 real unnamed annotations owned by non-fixture users.

## Follow-up

- None tracked as a seed. If we change the decision later, open a new one.
