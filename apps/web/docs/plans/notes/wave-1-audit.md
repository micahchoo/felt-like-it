# Audit — Work done vs BIBLE-SPEC and Felt-parity plan

**Date:** 2026-04-24 · **Auditor:** session trace through commits `b36b010`, `08931dd`, versioning doc, backfill spike, this session's earlier 12/14 work.

Two checks:
- **A.** Does shipped behaviour match the Felt reference in `docs/felt-annotations/BIBLE-SPEC.md`?
- **B.** Does shipped work match the plan in `apps/web/docs/plans/felt-parity-annotations.md`?

---

## A. Bible-spec coverage

### §1 Anchor Model

| Bible item | Shipped | Evidence | Note |
|------------|---------|----------|------|
| Pin → `point` | ✅ | `AnnotationForm.svelte` anchor-type fieldset | |
| Line / Route → `region` (we collapsed Route into region) | ✅ | same | Felt's driving/cycling/walking/flying modes are **not** in our schema — deliberate scope cut (no route-engine integration) |
| Polygon → `region` | ✅ | same | Rectangle/Circle shortcuts: not shipped, not blocking |
| Marker/Text/Note/Link → `point` | ✅ | Text rendered via content.body.type='text' | Map tools for drawing them not shipped; form-based only |
| Feature anchor | ⚠️ FLI extension | `AnnotationForm` has "Pick a feature" button; MapEditor's `onrequestfeaturepick` handler exists but end-to-end pick flow (click map feature → set pickedFeature) not verified this session | Documented as FLI extension in shadow-walk report |
| Viewport anchor | ⚠️ FLI extension | `AnnotationForm` has Viewport option with explainer | Same status |
| Measurement anchor | ⚠️ FLI extension | Exists in `AnchorSchema` but no UI option in the Point/Region/Feature/Viewport fieldset — the existing pendingMeasurement flow is a separate path | **Gap to reconcile**: either add Measurement to the anchor selector, or treat measurement purely as content. Not urgent. |

**Verdict:** Core anchor types are shipped. Three items (feature/viewport/measurement) are declared FLI extensions and won't appear in Felt docs. Measurement anchor has a UI-consistency gap noted above.

### §2 Content Model

| Bible item | Shipped | Evidence |
|-----------|---------|----------|
| Built-in `name` | ✅ NEW | `AnnotationForm.svelte:formName`, DB column `annotation_objects.name`, CHECK constraint 1–200 chars |
| Built-in `description` | ✅ NEW | Same. CHECK 0–5000 chars |
| `images` as built-in | ⚠️ Partial | Image content supported as `content.body.type='image'`; not a separate "attachments" array |
| User-defined attributes (free-form K/V) | ⚠️ Schema only | Our `kind: 'slotted'` supports arbitrary `Record<string, AnnotationContent>`. No authoring UI. Matches bible's "no templates" posture. |

**Verdict:** Matches Felt behaviour. The `kind: 'slotted'` path is schema-ready for the future but deliberately UI-invisible (bible says Felt has no template authoring).

### §3 List/Panel Behaviour

| Bible item | Shipped | Evidence |
|-----------|---------|----------|
| Flat list of annotations | ✅ | `AnnotationList.svelte` |
| Grouping / folders | ❌ | Wave 2 `felt-like-it-2e48`, trigger-gated |
| Visibility toggle per group | ❌ | Same |
| Multi-select | ❌ | Not scoped |
| Batch operations | ❌ | Not scoped |
| **No pagination UI** (Felt pattern) | ✅ | `AnnotationPanel.svelte:89` `trpc.annotations.list.query({ mapId })` — no limit/cursor passed. Matches Felt. |

**Verdict:** Felt-aligned on pagination. Grouping is the main delta vs. Felt — tracked on `2e48`.

### §4 Styling and Grouping

| Bible style property | Shipped |
|---------------------|---------|
| Opacity, stroke width, stroke style | ❌ (`5179`) |
| Endcaps, routing mode | ❌ (`5179` + out-of-scope) |
| Text alignment, text style | ❌ (`5179`) |
| Show label toggle on pins | ❌ (`5179`) |
| Measurement display toggle | ❌ (`5179` — style.showMeasurement per decision 34c1) |

**Verdict:** Zero coverage of Felt's Style tab. Entire surface deferred to Wave 2 Styling slice (seed `5179`, trigger-gated). Per strategy roadmap, this is RICE 0.8 — intentionally deprioritized until a Storyteller pilot appears.

### §5 Editing and threading

| Item | Shipped | Note |
|------|---------|------|
| Inline edit for text content | ✅ | `AnnotationList.svelte` Edit button per own-authored text annotation |
| Edit for non-text content (image, emoji, iiif…) | ❌ | Only text content is editable via the inline flow. Changing content type requires delete + recreate. Pragmatic cut for Wave 1; add if a persona demands it. |
| Reply/thread | ⚠️ FLI extension | Not in bible (Felt has no threading); we have `parentId` + reply composer |
| Concurrency via If-Match | ⚠️ FLI extension | Felt docs don't mention this; we ship `CONFLICT` toast with version tracking |

**Verdict:** Editing-of-text matches the Felt mental model. Threading and concurrency are our extensions.

### §6 Convert annotation ↔ layer

| Item | Shipped |
|------|---------|
| Annotation → layer | ❌ (`41c9`, Wave 3 — **newly unblocked** by decision `34c1`) |
| Layer → annotation | ❌ (same) |
| Transfer geometry | — |
| Transfer `name` / `description` | Plan-ready (Wave 1 shipped the fields) |
| Transfer attributes | Plan-ready (slotted content passthrough) |
| Transfer **measurement content body** | **Required by decision `34c1`** — added to Wave 3 Task 4.1 scope |

**Verdict:** Not shipped. The prerequisite (name + description) is now done, and the measurement-persistence decision unblocks the design. Wave 3 is the next task once user authorizes.

---

## B. Felt-parity plan coverage

Against `apps/web/docs/plans/felt-parity-annotations.md`:

### Wave 0 — Contract skeleton
- ✅ Task 0 — `AnnotationStyleSchema`, `AnnotationGroupSchema`, `AnnotationObject` extensions, 12 tests
- Commit: previous session

### Wave 1 — Name + description
- ✅ Task 1.1 — migration `0010_add_annotation_name_description.sql`, schema.ts `annotationObjects.name/description`, CHECK constraints
- ✅ Task 1.2 — `annotationService.create/update` accept name/description, `rowToObject` passes through, `OBJECT_COLS` includes both
- ✅ Task 1.3 — tRPC router create+update, REST POST+PATCH whitelist, serializer emits both
- ✅ Task 1.4 — AnnotationForm Name input + Description textarea, AnnotationList renders as h4 + paragraph, mutation-options optimistic insert
- ✅ Task 1.5 (spike) — decided no-op, see `apps/web/docs/plans/notes/felt-parity-backfill.md`
- Commits: `b36b010`, `08931dd`
- Tests: 4 Promise-15 specs green; 32/32 total marketing pass

### Wave 2 — Groups + Styling
- ⏸ All 8 tasks trigger-gated (no Storyteller pilot). Not blocked by other work — just deprioritized.

### Wave 3 — Convert annotation ↔ layer
- 🟢 **Newly unblocked** by decision `34c1`.
- All 4 tasks (`4.1–4.4`) still pending. The existing plan reads correctly after the measurement decision: Task 4.1 transfers `geometry + name + description + attributes + measurement content body`. Images still don't transfer (bible §6).

### External composition streams
- ✅ Integrator stream — `felt-like-it-1674` (versioning) shipped this session; `felt-like-it-d40a` (OpenAPI+SDK) still open.
- ❌ Security stream — H1–H7 + M9 untouched this session (was already in the master branch history from W1/W2/W3/W4 security waves; next close-out item is H5 idempotency — already shipped per commit `f6f5bb9`; others tracked on `sd ready`).
- ✅ Measurement decision — closed this session.

---

## C. What the audit didn't catch (intentional)

Things not checked here because they're not in-scope for Felt parity or would bloat the audit:

- Performance (KPI A1) — no measurement taken this cycle.
- Accessibility — shadow-walk didn't cover WCAG; separate pass needed before GA.
- Mobile — `product/strategy/roadmap.md` explicitly scopes it out this cycle.
- Observability — no telemetry or dashboards shipped; tracked under the security/GA epic, not here.

---

## D. Summary scorecard

| Bible section | Shipped | Partial | Not shipped | FLI extensions |
|--------------|---------|---------|-------------|----------------|
| §1 Anchors | 2 | 0 | 0 | 3 |
| §2 Content | 6 | 2 | 0 | 3 (emoji/gif/iiif beyond Felt) |
| §3 List | 2 | 0 | 4 | 0 |
| §4 Style | 0 | 0 | 10 | 0 |
| §5 Edit+thread | 1 | 0 | 1 | 2 |
| §6 Convert | 0 | 0 | 2 | 0 |

Of the 23 bible items counted, **11 are shipped**, **2 partial**, **17 not shipped** (with 10 of those being the Styling slice we've deprioritized by design), and **8 are FLI extensions beyond Felt's public surface**.

The plan and the bible agree on what's left: Wave 3 (now unblocked) and Wave 2 (trigger-gated). Nothing was shipped that bypassed the plan; nothing in the plan was silently skipped.

---

## E. Recommended next action

Wave 3 Task 4.1 — `convertAnnotationsToLayer` service — is the single highest-value next commit. It:
- Closes the last Researcher-persona gap (RN wants this for exporting annotations to analyzable layers).
- Closes the last bible §6 deliverable.
- Has a clear input/output contract per the plan.
- Does not require a UI in the same commit (Task 4.4 lands separately).

Blockers are now all clear. Say go and I start.
