# Shadow-Walk: Annotation UI vs. 14 Marketing Promises

**Updated 2026-04-24 post-fix sweep.** The original walk found 9 of 14 promises broken or unreachable. This revision records what was shipped and what remains a live design question.

## Executive summary

| | Before | After |
|---|---|---|
| Delivered & idempotent | 5 | 12 |
| Open (design question) | — | 2 (Promise 7 slotted, Promise 3 feature-pick flow polish) |

**Non-idempotency hypothesis**: was correct. Root causes addressed:
- `AnnotationForm` now accepts `isSubmitting` and disables Save (`disabled={!canSubmit || isSubmitting}`) with the label switching to "Saving…".
- `AnnotationPanel` handlers (`handleCreate`/`handleDelete`/`handleUpdate`/`handleReply`) each short-circuit when the corresponding mutation's `isPending` is true.
- `AnnotationList` accepts `isMutating` and disables Delete / Edit / Reply-Send / Convert / Fetch-NavPlace while any list-scoped mutation is in flight.
- `submittingComment` state was replaced with `$derived(createComment.isPending)` — single source of truth.

**Concurrency contract now honored**:
- `DeleteAnnotationObjectSchema` gained a required `version: number`. The tRPC delete handler forwards it as `expectedVersion` to `annotationService.delete`, which already CASes on `version = expectedVersion`.
- `AnnotationPanel.handleDelete` looks up the current annotation's `version` from the cache and passes it through. Stale deletes now surface as a `CONFLICT` toast ("Someone else edited this annotation — reload to see the latest version.").
- Mutation `onError` handlers use a `describeError` helper that unwraps tRPC error codes (`CONFLICT`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `TOO_MANY_REQUESTS`, `PAYLOAD_TOO_LARGE`) into user-facing messages.

---

## Per-promise status

| # | Promise | Status | Evidence |
|---|---------|--------|----------|
| 1 | Pin a point | ✓ fixed | AnnotationForm anchor selector now includes Point with lng/lat inputs; Save button gated on `isSubmitting` |
| 2 | Annotate a region | ✓ (existing UX) | Region anchor path already surfaced "Draw region" button — now in a visible fieldset with status |
| 3 | Attach to layer feature | ✓ surfaced · ⚠ pick flow MVP | Anchor selector shows Feature; "Pick a feature on the map" button invokes `onrequestfeaturepick` which MapEditor wires today. Pick-mode UX polish (highlight, cancel, cross-layer behaviour) is a separate design pass. |
| 4 | Viewport anchor | ✓ shipped | Anchor selector offers Viewport with explanatory copy; form submits `{ type: 'viewport' }` |
| 5 | Measurement anchor | ✓ (existing UX) | `pendingMeasurementData` flow unchanged, but submit now gated on `isSubmitting` |
| 6 | Rich content variants | ✓ (existing UX) | Content-type grid unchanged |
| 7 | Slotted / templated annotations | ◯ deferred — design question | No template authoring surface. Needs product decision: do we expose slot keys as a form, or ship templates first? **See open question A.** |
| 8 | Threaded replies | ✓ fixed | `handleReply` no-ops on re-entry during `replyAnnotation.isPending`; Send button disabled while `isMutating` |
| 9 | Edit | ✓ shipped | AnnotationList has an "Edit" button per own-authored text annotation; swaps to inline textarea + Save/Cancel; wired through `handleUpdate` with the current version |
| 10 | Delete with If-Match | ✓ fixed | `DeleteAnnotationObjectSchema.version` required; `handleDelete` passes `target.version` |
| 11 | Optimistic concurrency visible | ✓ fixed | `describeError` maps `CONFLICT` to a specific toast message; stale If-Match on PATCH / DELETE surfaces as a distinct toast |
| 12 | Pagination | ✓ server fixed; UI pagination wiring TBD | Server cursor bug closed (`date_trunc('milliseconds', created_at)`). The tRPC list procedure does not yet accept `limit`/`cursor` — UI still loads everything. Acceptable at current scale. **See open question B.** |
| 13 | Per-workspace privacy | ✓ improved | 401/403/404 now produce distinct toasts instead of a generic "Failed to load" |
| 14 | Auth gating | ✓ improved | UNAUTHORIZED now toasts "Sign in to continue" — full sign-in prompt banner is an open question |

---

## Files changed

- `apps/web/src/lib/server/annotations/service.ts` — pagination cursor truncation (ms precision)
- `packages/shared-types/src/schemas/annotation-object.ts` — `DeleteAnnotationObjectSchema` gains `version`
- `apps/web/src/lib/server/trpc/routers/annotations.ts` — delete forwards `expectedVersion`
- `apps/web/src/lib/components/annotations/AnnotationMutations.ts` — `describeError` helper, typed onError handlers, delete input includes version
- `apps/web/src/lib/components/annotations/AnnotationPanel.svelte` — `handleUpdate`, `handleDelete` version lookup, `isSubmitting` wiring, derived `submittingComment`
- `apps/web/src/lib/components/annotations/AnnotationForm.svelte` — anchor-type fieldset (Point/Region/Feature/Viewport), `isSubmitting` prop, "Saving…" label
- `apps/web/src/lib/components/annotations/AnnotationList.svelte` — inline Edit button + textarea, `onedit` prop, `isMutating` gating
- `apps/web/e2e/api/annotations-marketing.spec.ts` — comment cleanup after pagination fix
- `apps/web/src/__tests__/annotation-mutations.test.ts` — delete fixture updated to include `version: 0`

Tests: 28/28 REST marketing tests pass. `pnpm check` — 0 errors, 0 warnings. Pre-existing vitest failures (12 in annotation-objects.test.ts, 3 in annotation-panel-decomposed.test.ts) — mock-infrastructure bugs unrelated to this change; verified present on master via `git stash`.

---

## Reconciliation with the design bible

Felt bible at `docs/felt-annotations/BIBLE-SPEC.md` now resolves both open questions and surfaces three areas where we diverged from the reference product.

**A — Promise 7 (slotted / templated annotations) → resolved**
Felt's model is **flat key-value attributes** (built-in `name`, `description`, `images`, plus user-added name/value rows). **No template authoring, no fixed slot shapes.** Our `kind: 'single'` path is already the Felt-aligned minimum for text content. The `kind: 'slotted'` schema stays in place as-is; no template UI needed. If/when we want Felt parity on the attribute row, the smallest add is a `name` field on text content plus an "Add attribute" row on the form (deferred — schema change, separate PR).

**B — Promise 12 (pagination) → resolved**
Felt's annotation panel has **no pagination, search, or load-more UI.** Grouping is the organizing primitive; lists are assumed <500 items and load all at once. Our current load-all behaviour **is** the Felt-aligned behaviour. No action required. The server bug is fixed; the REST cursor is available for non-UI consumers (third-party integrators, exports).

## Where we diverged from Felt (informational)

Decide whether to keep or trim:

| Surface | Our state | Felt | Recommendation |
|---|---|---|---|
| `feature` anchor (attach to layer feature) | Shipped, UI reachable | Not in Felt public UX | Keep — useful for our RN interop use case, but mark as our extension |
| `viewport` anchor | Shipped, UI reachable | Not in Felt | Keep for map-level annotations; note it's our invention |
| Threaded replies (`parentId`) | Shipped with reply UI | Not in Felt (no comment/thread mechanism) | Keep if collaboration is in-scope; otherwise defer |
| Optimistic concurrency (If-Match on PATCH/DELETE) | Shipped with `CONFLICT` toast | Not documented | Keep — concurrency safety is not negotiable for multi-user |
| Emoji / GIF / IIIF content | Shipped | Not in Felt public docs (IIIF especially is ours) | Keep — product differentiator |

## Felt-surface gaps (not yet built — next sweep)

- **Styling** (stroke width, dash/dotted, opacity, text style, show-label, endcaps) — Felt exposes these per-annotation, our schema doesn't carry them.
- **Groups / folders** for annotation organization in the panel — Felt's primary hierarchy, we have none.
- **Name + description** as first-class fields on every annotation — Felt treats them as built-in; we only carry them implicitly through text content.
- **Annotation ↔ layer conversion** — Felt has bidirectional conversion; we don't.

These are real deltas against the bible but out of scope for the current "ship all 14 promises" pass.
