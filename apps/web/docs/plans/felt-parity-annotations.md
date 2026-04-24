# Felt-Parity Annotations — Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four identified Felt-parity gaps on annotations — first-class name/description, groups/folders in the panel, per-annotation styling, and bidirectional annotation ↔ layer conversion — so our product matches Felt's public annotation surface.

**Architecture:** Four vertical slices, each schema → service → API → UI → tests. Slice 1 (name+description) is a prerequisite for Slice 4 (convert), so Slice 4 waits. Slices 2 (groups) and 3 (styling) are independent and parallelize against each other and against Slice 1. All migrations are additive-first (NULLABLE cols, optional payload fields) — no destructive changes until the UI has shipped round-trip.

**Tech Stack:** Drizzle ORM + Postgres, SvelteKit + Svelte 5 runes, TanStack Query v6, tRPC 11, Zod, Playwright (e2e), Vitest (unit).

**Source spec:** `docs/felt-annotations/BIBLE-SPEC.md`. **Tracking epic:** seeds `felt-like-it-e92e` (child tasks: `06b2`, `2e48`, `5179`, `41c9`).

## Strategic Brief (from product-strategy cycle 01)

**Target personas**:
- **Data Storyteller** — served by Wave 1 (name/description), Wave 2 Groups, Wave 2 Styling. See `product/strategy/personas/data-storyteller.md`.
- **Spatial Researcher** — served by Wave 3 Convert (bidirectional annotation↔layer); indirectly by Wave 1. See `personas/spatial-researcher.md`.
- **Platform Integrator** — passively served (schema additions flow through `/api/v1/`). Their direct needs (versioning policy, OpenAPI/SDK) are tracked on separate seeds `felt-like-it-1674` and `-d40a`.

**Success metrics** (from `product/strategy/kpis.md`):
- **Out1** — Felt-parity gap closure: 0/4 → 4/4 by end of Q2 2026.
- **Out2** — REST API test coverage: maintain 100% (currently 28/28 marketing tests).
- **O1** — Annotation creation rate ≥ 3 / workspace / week at 8 weeks post-launch.

**Priority rationale**: RICE score 4.0 for Wave 1 (name + description); 2.1 for Wave 3 (convert); 0.8 for Wave 2 Groups and Styling. See `product/strategy/roadmap.md`.

**Constraints / out-of-scope**: No template authoring, no pagination UI, no tags/search, no threading redesign. See `product/strategy/vision.md` "Locked decisions".

**Competitive context**: Felt has no public REST API and no self-host; FLI closes the UI gap here while preserving those differentiators. The four tasks are parity with Felt's Sidebar List + Style tab + conversion flow.


---

## Flow Map

Annotation write path (unchanged by this plan, shown for context):

```
AnnotationForm.handleSubmit
 → AnnotationPanel.handleCreate (or handleUpdate)
 → AnnotationMutations.create/update MutationOptions
 → trpc.annotations.create/update.mutate
 → annotationsRouter (tRPC)  ← we extend inputs here for 06b2 + 5179
 → annotationService.create/update  ← we extend signatures here
 → drizzle insert into annotation_objects  ← we add columns / new table here
```

Annotation read path:

```
AnnotationPanel.annotationsQuery (trpc.annotations.list)
 → annotationsRouter.list
 → annotationService.list
 → drizzle select from annotation_objects
 → serialize via toAnnotation
 → AnnotationList renders rows (optionally grouped)  ← 2e48 changes rendering
 → AnnotationRenderer paints on map  ← 5179 changes paint expressions
```

Convert path (new in Slice 4):

```
Right-click annotation → "Convert to layer" menu entry
 → AnnotationPanel.handleConvertToLayer
 → trpc.annotations.convertToLayer.mutate
 → annotationsRouter.convertToLayer
 → annotationService.convertToLayer (builds layer features + deletes source annotations in txn)
 → layer + map list invalidation
```

---

## File Structure

| File | Role | Touched by |
|------|------|------------|
| `apps/web/src/lib/server/db/schema.ts` | Drizzle table defs | 06b2, 2e48, 5179 |
| `apps/web/drizzle/migrations/NNNN_*.sql` | New migration files (one per slice) | 06b2, 2e48, 5179 |
| `packages/shared-types/src/schemas/annotation-object.ts` | Zod schemas, tRPC input types | 06b2, 2e48, 5179 |
| `packages/shared-types/src/schemas/annotation-style.ts` (new) | Dedicated style schema | 5179 |
| `packages/shared-types/src/schemas/annotation-group.ts` (new) | Dedicated group schema | 2e48 |
| `apps/web/src/lib/server/annotations/service.ts` | Service create/update/list/delete + new convertToLayer | all four |
| `apps/web/src/lib/server/annotations/groups.ts` (new) | Group CRUD service | 2e48 |
| `apps/web/src/lib/server/annotations/convert.ts` (new) | Conversion service | 41c9 |
| `apps/web/src/lib/server/trpc/routers/annotations.ts` | tRPC router | 06b2, 2e48, 5179, 41c9 |
| `apps/web/src/lib/server/api/serializers.ts` | REST DTO shape | 06b2, 2e48, 5179 |
| `apps/web/src/routes/api/v1/maps/[mapId]/annotations/+server.ts` | REST POST/GET/PATCH payload parsing | 06b2, 2e48, 5179 |
| `apps/web/src/routes/api/v1/maps/[mapId]/annotation-groups/+server.ts` (new) | REST CRUD for groups | 2e48 |
| `apps/web/src/routes/api/v1/maps/[mapId]/convert-annotations-to-layer/+server.ts` (new) | Conversion REST endpoint | 41c9 |
| `apps/web/src/lib/components/annotations/AnnotationForm.svelte` | Top-of-form name/description; style tab | 06b2, 5179 |
| `apps/web/src/lib/components/annotations/AnnotationList.svelte` | Row label fallback; group headers | 06b2, 2e48 |
| `apps/web/src/lib/components/annotations/AnnotationGroups.svelte` (new) | Group tree + drag-drop reorder | 2e48 |
| `apps/web/src/lib/components/annotations/AnnotationStylePanel.svelte` (new) | Right-panel Style tab | 5179 |
| `apps/web/src/lib/components/annotations/AnnotationMutations.ts` | createGroup / updateGroup / convertToLayer options | 2e48, 41c9 |
| `apps/web/src/lib/components/map/AnnotationRenderer.svelte` | Paint expressions consume style fields | 5179 |

`packages/shared-types` has **no** build step — exported schemas flow into `apps/web` through TS path mapping. After editing a schema, rerun `pnpm check` in `apps/web`.

---

## Cross-Cutting Migration Strategy

Applied to every slice that changes the DB:

1. **Additive forward migration.** Add columns NULLABLE; add new tables with no FK enforcement from existing tables. This lets the new code ship without a coordinated deploy.
2. **Dual-read / dual-write during rollout.** The UI reads the new fields with a fallback; the API accepts payloads with or without the new fields.
3. **Backfill pass as a separate task.** Only schedule after the UI has shipped and been verified. For 06b2: copy first line of existing text-content into `name` for legacy rows. For 2e48: all existing annotations start with `group_id = NULL` (root-level). For 5179: all style fields default to NULL (renderer uses current hard-coded paint).
4. **Tightening is a later wave.** `NOT NULL` constraints or dropping old content fields happen only after telemetry shows 100% of live traffic hits the new path.
5. **Rollback plan.** Each migration file has a paired `--down` SQL in a commit footer so reverting the migration does not strand data.

---

## Input Validation (Brainstorm Gate)

- ✓ **Feasibility.** Every file referenced in File Structure exists or is explicitly marked "(new)". Verified via `ls` / `grep`.
- ✓ **Scavenge.** Prior art: current pagination cursor fix (`apps/web/src/lib/server/annotations/service.ts:168`) and delete-with-version wiring (`packages/shared-types/src/schemas/annotation-object.ts:140`) are this week's work — same author, same patterns. Drizzle migration example: `apps/web/drizzle/migrations/0000_initial.sql`.
- ✓ **Completeness.** Four requirements from the bible map 1:1 onto four seeds issues; every seed maps to a Wave in this plan.
- ✓ **Shape / alternatives.** See each task's *Alternatives considered* note. Notable choice: style fields as a structured `jsonb` column (over per-column storage) — picked for schema flexibility and because Felt's style surface is still evolving.

---

## Wave 0 — Contract Skeleton

Before any implementation, land the type definitions in `packages/shared-types` so later waves agree on the shapes. One commit, four additions.

### Task 0: Shared-types contract skeleton

**Orient:** Land the schema shapes every later wave will consume so the tRPC router, REST handler, service, and UI compile in any order.
**Flow position:** Entry node — all downstream nodes read types from here.
**Skill:** `test-driven-development`
**Files:**
- Modify: `packages/shared-types/src/schemas/annotation-object.ts`
- Create: `packages/shared-types/src/schemas/annotation-style.ts`
- Create: `packages/shared-types/src/schemas/annotation-group.ts`
- Modify: `packages/shared-types/src/index.ts` (add exports)
- Test: `packages/shared-types/src/__tests__/felt-parity-schemas.test.ts`

<contracts>
**Downstream (this-node → all waves):**

```ts
// annotation-object.ts additions
name: z.string().min(1).max(200).nullable().optional();
description: z.string().max(5000).nullable().optional();
groupId: z.string().uuid().nullable().optional();
style: AnnotationStyleSchema.nullable().optional();

// annotation-style.ts
export const AnnotationStyleSchema = z.object({
  strokeWidth: z.number().min(0).max(40).optional(),
  strokeStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
  strokeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  strokeOpacity: z.number().min(0).max(1).optional(),
  fillColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  fillOpacity: z.number().min(0).max(1).optional(),
  endcaps: z.enum(['none', 'start', 'end', 'both']).optional(),
  textStyle: z.enum(['regular', 'italic', 'light', 'caps']).optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  showLabel: z.boolean().optional(),
}).strict();

// annotation-group.ts
export const AnnotationGroupSchema = z.object({
  id: z.string().uuid(),
  mapId: z.string().uuid(),
  parentGroupId: z.string().uuid().nullable(),
  name: z.string().min(1).max(200),
  ordinal: z.number().int(),
  visible: z.boolean(),
});
export const CreateAnnotationGroupSchema = AnnotationGroupSchema
  .omit({ id: true, ordinal: true })
  .extend({ ordinal: z.number().int().optional() });
```

Behavioral invariant: all four fields are **optional** on inputs (nullable in DB). Legacy clients that don't send them keep working.
</contracts>

- [ ] **Step 1: Write failing schema tests**

```ts
// Each of the four new shapes: round-trip one well-formed value, reject one malformed.
// Style: reject strokeOpacity 1.5; accept 0.5.
// Group: accept valid; reject name longer than 200.
// Name+description on UpdateAnnotationObjectSchema: accept partial update; reject 201-char name.
```

- [ ] **Step 2: Run tests** · Run: `pnpm -F @felt-like-it/shared-types test` · Expected: 4 failures, one per new shape.
- [ ] **Step 3: Implement the schemas.** Edit object schema to spread the four new optionals; create style + group files; wire exports in `index.ts`.
- [ ] **Step 4: Run tests** · Run: same · Expected: all pass.
- [ ] **Step 5: Run downstream type-check** · Run: `pnpm -F @felt-like-it/web check` · Expected: 0 errors (additive optionals should not break consumers).
- [ ] **Step 6: Commit** · `git commit -m "feat(annotations): shared-types contract skeleton for Felt-parity slices"`.

---

## Wave 1 — Name + Description (seeds 06b2)

**Why first:** Convert (Slice 4) reads these as transferable fields per bible §6; until they exist, Convert has nothing to copy to layer features. Groups and Styling do not depend on name/description but benefit from them cosmetically.

### Task 1.1: Schema + migration — add name, description to annotation_objects

**Orient:** Give every annotation a first-class label and body so Convert has something to transfer and the list can show a human-readable row even when content is non-text.
**Flow position:** DB node (upstream of service).
**Skill:** `test-driven-development`
**Codebooks:** `schema-evolution-migration`
**Files:**
- Modify: `apps/web/src/lib/server/db/schema.ts:219` (annotation_objects table)
- Create: `apps/web/drizzle/migrations/0020_annotation_name_description.sql`
- Test: `apps/web/src/__tests__/annotation-name-description.test.ts`

<contracts>
**Upstream (schema → service):** Row shape gains `name: string | null`, `description: string | null`.
**Downstream (service → callers):** `AnnotationObject` type gains optional `name`, `description` via the Wave 0 schema changes.
</contracts>

- [ ] **Step 1: Failing integration test** — insert annotation with name='Alpha', description='Body', read it back, expect both present. (Will fail: columns don't exist.)
- [ ] **Step 2: Run** · `pnpm vitest run src/__tests__/annotation-name-description.test.ts` · Expected: column undefined error.
- [ ] **Step 3: Write the migration** — add `name text`, `description text`, both nullable. Include `--down` SQL in commit body.
- [ ] **Step 4: Apply + generate drizzle types** · `pnpm db:migrate && pnpm db:generate` · Expected: schema.ts column entries present.
- [ ] **Step 5: Re-run test** · same · Expected: pass.
- [ ] **Step 6: Commit** · `git commit -m "feat(annotations): add name/description columns (Wave 1.1)"`.

### Task 1.2: Service — persist name/description on create/update

**Orient:** Let the service round-trip the two new fields through insert and update statements without touching their semantics elsewhere.
**Flow position:** Service node (service.ts create + update + rowToObject).
**Skill:** `test-driven-development`
**Files:**
- Modify: `apps/web/src/lib/server/annotations/service.ts` (rowToObject ~line 50, create ~line 85, update ~line 280)
- Test: existing `annotation-objects.test.ts` — extend two cases.

- [ ] **Step 1: Extend existing create test** to pass `name: 'x'`, assert returned object has `name: 'x'`. Will fail (service drops the field).
- [ ] **Step 2: Run** · `pnpm vitest run -t "annotationService.create"` · Expected: fail.
- [ ] **Step 3: Thread name/description through `create` input, `INSERT` SQL, `rowToObject` mapping, `update` SQL, and `update` input. Keep them optional.**
- [ ] **Step 4: Run** · same · Expected: pass. Also assert `update` can set description to null explicitly.
- [ ] **Step 5: Commit** · `git commit -m "feat(annotations): persist name/description (Wave 1.2)"`.

### Task 1.3: API — tRPC + REST accept and return name/description

**Orient:** Expose the new fields on both transport surfaces with the same nullability contract as the schema.
**Flow position:** API node (tRPC router + REST POST/PATCH handlers + serializer).
**Skill:** `test-driven-development`
**Files:**
- Modify: `apps/web/src/lib/server/trpc/routers/annotations.ts` (create + update pass input.name/description through)
- Modify: `apps/web/src/routes/api/v1/maps/[mapId]/annotations/+server.ts` (already reads the object schema; confirm `CreateAnnotationWithDepthLimit` picks up the new fields)
- Modify: `apps/web/src/lib/server/api/serializers.ts` (`toAnnotation` emits `name` and `description`)
- Test: `apps/web/e2e/api/annotations-marketing.spec.ts` — extend Promise 6 to assert name/description round-trip; add a fresh test creating with name+description and reading back.

- [ ] **Step 1:** Add one REST test: POST with `{ name: 'Alpha', description: 'Body', anchor, content }` → 201 → GET the id → assert body.data.name === 'Alpha'. Will fail (serializer drops fields).
- [ ] **Step 2: Run** · `pnpm exec playwright test --project=api -g "name and description"` · Expected: fail.
- [ ] **Step 3:** Pass input through in tRPC router; update `toAnnotation`; REST handler already spreads body → should auto-pick up.
- [ ] **Step 4: Run** · same · Expected: pass.
- [ ] **Step 5: Commit** · `git commit -m "feat(annotations): expose name/description on tRPC + REST (Wave 1.3)"`.

### Task 1.4: UI — name field above content; description below; list uses name as label

**Orient:** Replace the implicit "first-line-of-text" label with an explicit field the user controls, so the list rows are readable for non-text content.
**Flow position:** UI node (AnnotationForm + AnnotationList).
**Skill:** `frontend-design`
**Files:**
- Modify: `apps/web/src/lib/components/annotations/AnnotationForm.svelte` (add `formName`, `formDescription` state; render inputs; include in `oncreate` payload)
- Modify: `apps/web/src/lib/components/annotations/AnnotationList.svelte` (use `annotation.name` as row title with a content-type badge; fall back to content preview if null)
- Test: `apps/web/src/__tests__/annotation-form.test.ts` (already exists — extend)

- [ ] **Step 1:** Add a Vitest test that mounts AnnotationForm, types 'Hello' into the Name input, submits, asserts `oncreate` called with `name: 'Hello'`.
- [ ] **Step 2: Run** · `pnpm vitest run src/__tests__/annotation-form.test.ts` · Expected: fail (no input).
- [ ] **Step 3:** Add `formName` + `formDescription` state, Name input above the content-type grid, Description textarea below the per-type fields. Include in `oncreate` payload. Reset in `resetForm`.
- [ ] **Step 4:** In AnnotationList, replace content-body preview with `{annotation.name ?? preview}`.
- [ ] **Step 5: Run vitest + check** · Expected: pass, zero TS errors.
- [ ] **Step 6: Commit** · `git commit -m "feat(annotations): name+description UI (Wave 1.4)"`.

### Task 1.5: [SPIKE] Backfill policy for legacy rows

**Orient:** Decide whether to backfill `name` for existing annotations from their text content, or leave NULL and rely on the UI fallback.
**Flow position:** Data-layer decision.
**Skill:** `hybrid-research`
**Deliverable:** A 1-page doc at `apps/web/docs/plans/notes/felt-parity-backfill.md` answering:
- How many live rows have `content.body.type='text'` that would backfill cleanly? (query `annotation_objects`)
- Is the UI fallback sufficient at current volumes?
- Risk of surprising users by synthesizing names.

Time cap: 30 min. Output is a yes/no + one paragraph.

---

## Wave 2 — Groups / Folders (seeds 2e48) and Styling (seeds 5179) in parallel

Both touch the annotation object but along orthogonal axes — groups adds a FK, styling adds a jsonb column. They can run in parallel after Wave 1 lands, though they do not depend on Wave 1.

### Task 2.1 (Groups): Schema + migration — annotation_groups table, group_id FK

**Orient:** Let maps organize annotations into user-defined folders matching Felt's Sidebar List primary hierarchy.
**Flow position:** DB node.
**Skill:** `test-driven-development`
**Codebooks:** `schema-evolution-migration`
**Files:**
- Modify: `apps/web/src/lib/server/db/schema.ts` (new `annotationGroups` table; add `groupId` FK on `annotationObjects`)
- Create: `apps/web/drizzle/migrations/0021_annotation_groups.sql`
- Test: `apps/web/src/__tests__/annotation-groups.test.ts`

<contracts>
**Downstream:** `annotation_groups` rows with (id uuid PK, map_id uuid FK, parent_group_id uuid nullable FK self, name text, ordinal int, visible bool default true, created_at, updated_at). `annotation_objects.group_id uuid nullable FK → annotation_groups.id ON DELETE SET NULL`.
</contracts>

- [ ] **Step 1:** Failing test: create group, assign annotation to it, list groups → include the annotation count.
- [ ] **Step 2:** Write migration + schema.
- [ ] **Step 3:** `pnpm db:migrate` and rerun test.
- [ ] **Step 4: Commit** · `git commit -m "feat(annotations): groups table + FK (Wave 2.1)"`.

### Task 2.2 (Groups): Service — group CRUD + list projection

**Orient:** Provide CRUD for groups and a grouped-list projection the panel can consume in one query.
**Flow position:** Service node.
**Skill:** `test-driven-development`
**Files:**
- Create: `apps/web/src/lib/server/annotations/groups.ts`
- Modify: `apps/web/src/lib/server/annotations/service.ts` (new `listGrouped({ mapId })` returning `{ groups: Group[], ungrouped: AnnotationObject[] }`)
- Test: `apps/web/src/__tests__/annotation-groups.test.ts` (extend)

- [ ] **Step 1:** Failing test for `createGroup`, `updateGroup`, `deleteGroup`, `reorderGroups`.
- [ ] **Step 2:** Implement each. Ordinal increment on create; `reorderGroups` accepts an array of ids in target order and rewrites ordinals in a txn.
- [ ] **Step 3:** Failing test for `listGrouped` on a map with 2 groups + 3 ungrouped annotations.
- [ ] **Step 4:** Implement with one query + group-by in JS.
- [ ] **Step 5: Commit** · `git commit -m "feat(annotations): groups service (Wave 2.2)"`.

### Task 2.3 (Groups): API — tRPC + REST for groups

**Orient:** Expose group CRUD on both transports; exposed `list` now accepts `grouped=true` for the grouped projection.
**Flow position:** API node.
**Skill:** `test-driven-development`
**Files:**
- Modify: `apps/web/src/lib/server/trpc/routers/annotations.ts` (subrouter `groups`)
- Create: `apps/web/src/routes/api/v1/maps/[mapId]/annotation-groups/+server.ts` (GET list, POST create)
- Create: `apps/web/src/routes/api/v1/maps/[mapId]/annotation-groups/[id]/+server.ts` (PATCH, DELETE)
- Test: `apps/web/e2e/api/annotation-groups.spec.ts`

- [ ] **Steps:** TDD as per slice pattern. Use `adversarial-api-testing` skill for cross-tenant + version tests.
- [ ] **Commit** · `git commit -m "feat(annotations): group APIs (Wave 2.3)"`.

### Task 2.4 (Groups): UI — collapsible group headers, drag-drop reorder, visibility toggle

**Orient:** Let users create groups and drag annotations between them, matching Felt's Sidebar List.
**Flow position:** UI node.
**Skill:** `frontend-design`
**Codebooks:** `gesture-disambiguation`, `focus-management-across-boundaries`
**Files:**
- Create: `apps/web/src/lib/components/annotations/AnnotationGroups.svelte`
- Modify: `apps/web/src/lib/components/annotations/AnnotationList.svelte` (consumes grouped projection)
- Modify: `apps/web/src/lib/components/annotations/AnnotationMutations.ts` (createGroup / reorderGroups options)
- Test: `apps/web/src/__tests__/annotation-groups-ui.test.ts`

- [ ] **Steps:** TDD on group create, rename, delete, drag-drop reorder, eyeball visibility toggle.
- [ ] **Commit** · `git commit -m "feat(annotations): groups UI (Wave 2.4)"`.

### Task 3.1 (Styling): Schema + migration — style jsonb column

**Orient:** Give annotations a typed style payload the renderer can consume, matching Felt's stroke/opacity/text options.
**Flow position:** DB node.
**Skill:** `test-driven-development`
**Codebooks:** `schema-evolution-migration`
**Files:**
- Modify: `apps/web/src/lib/server/db/schema.ts` (add `style jsonb` nullable on annotationObjects)
- Create: `apps/web/drizzle/migrations/0022_annotation_style.sql`
- Test: `apps/web/src/__tests__/annotation-style.test.ts`

- [ ] **Step 1:** Failing test: create annotation with `style: { strokeWidth: 3, strokeStyle: 'dashed' }`, read back, assert payload intact.
- [ ] **Step 2:** Migration + schema.
- [ ] **Step 3:** Service round-trip (reuse service.create / update; the Wave 0 schema already allows the field).
- [ ] **Step 4: Commit** · `git commit -m "feat(annotations): style jsonb column (Wave 3.1)"`.

### Task 3.2 (Styling): API — tRPC + REST accept style

**Orient:** Passthrough style on the existing create/update endpoints; validate against `AnnotationStyleSchema`.
**Flow position:** API node.
**Skill:** `test-driven-development`
**Files:**
- Modify: `apps/web/src/lib/server/trpc/routers/annotations.ts`
- Modify: `apps/web/src/routes/api/v1/maps/[mapId]/annotations/+server.ts` (zod already re-validates via `CreateAnnotationWithDepthLimit`)
- Modify: `apps/web/src/lib/server/api/serializers.ts` (emit style)
- Test: `apps/web/e2e/api/annotations-marketing.spec.ts` — add a style round-trip test.

- [ ] **Commit** · `git commit -m "feat(annotations): expose style on APIs (Wave 3.2)"`.

### Task 3.3 (Styling): Renderer — paint expressions consume style fields

**Orient:** Make user-chosen style visible on the map.
**Flow position:** Renderer node.
**Skill:** `frontend-design`
**Codebooks:** `interactive-spatial-editing`
**Files:**
- Modify: `apps/web/src/lib/components/map/AnnotationRenderer.svelte` (paint expressions branch on `feature.properties.style`)
- Test: add a Playwright UI test asserting the stroke-dasharray attribute on a rendered annotation matches `style.strokeStyle === 'dashed'`.

- [ ] **Steps:** Define a `styleToPaint(style)` helper that returns the MapLibre paint properties, unit-test that directly. Then wire it into the SymbolLayer / LineLayer / FillLayer paint props.
- [ ] **Commit** · `git commit -m "feat(annotations): renderer honors style (Wave 3.3)"`.

### Task 3.4 (Styling): UI — Style tab in AnnotationStylePanel

**Orient:** Let users choose stroke width/style/opacity/text variant/show-label on a selected annotation.
**Flow position:** UI node.
**Skill:** `frontend-design`
**Files:**
- Create: `apps/web/src/lib/components/annotations/AnnotationStylePanel.svelte`
- Modify: `apps/web/src/lib/components/annotations/AnnotationPanel.svelte` (render the style panel when `selectedAnnotationId` is set)
- Test: `apps/web/src/__tests__/annotation-style-panel.test.ts`

- [ ] **Steps:** TDD on each control; shared "open stroke style popover → select dashed → assert updateAnnotation called with `style.strokeStyle='dashed'` and current version".
- [ ] **Commit** · `git commit -m "feat(annotations): style panel UI (Wave 3.4)"`.

---

## Wave 3 — Convert annotation ↔ layer (seeds 41c9)

Depends on Wave 1 having landed (name + description are the transferable fields).

### Task 4.1: Service — `convertAnnotationsToLayer`

**Orient:** Given N annotations on a map, create a new layer whose features are their geometries + name/description/attributes, then delete the source annotations in the same transaction.
**Flow position:** Service node.
**Skill:** `test-driven-development`
**Codebooks:** `distributed-state-sync` (for the txn semantics against concurrent annotation writes)
**Files:**
- Create: `apps/web/src/lib/server/annotations/convert.ts`
- Modify: `apps/web/src/lib/server/annotations/service.ts` (export convertToLayer)
- Test: `apps/web/src/__tests__/annotation-convert.test.ts`

<contracts>
**Input:** `{ mapId, annotationIds: string[], layerName: string }`. All annotation ids must belong to the same map. Annotations whose anchor is `viewport` have no geometry → skipped with a per-id warning in the response.
**Output:** `{ layerId, featureCount, skipped: Array<{ id, reason }> }`.
</contracts>

- [ ] **Steps:** TDD. Cover: happy path with mix of point + region + feature anchors; viewport anchor → skipped; slotted content → flatten keys into feature properties.
- [ ] **Commit** · `git commit -m "feat(annotations): convertToLayer service (Wave 4.1)"`.

### Task 4.2: Service — `convertLayerFeaturesToAnnotations`

**Orient:** Reverse operation. Given a layer id + feature ids, create annotations with `name`/`description` copied from feature properties.
**Flow position:** Service node.
**Skill:** `test-driven-development`
**Files:**
- Modify: `apps/web/src/lib/server/annotations/convert.ts`
- Test: extend `annotation-convert.test.ts`

- [ ] **Steps:** TDD. Point geometries → point anchors. Polygons → region anchors. LineStrings → measurement-anchor variant. Drop properties the schema doesn't accept.
- [ ] **Commit** · `git commit -m "feat(annotations): convertLayerFeaturesToAnnotations service (Wave 4.2)"`.

### Task 4.3: API — tRPC + REST for both conversions

**Orient:** Expose both conversions as mutations.
**Flow position:** API node.
**Skill:** `test-driven-development`
**Files:**
- Modify: `apps/web/src/lib/server/trpc/routers/annotations.ts`
- Create: `apps/web/src/routes/api/v1/maps/[mapId]/convert-annotations-to-layer/+server.ts`
- Create: `apps/web/src/routes/api/v1/maps/[mapId]/convert-features-to-annotations/+server.ts`
- Test: `apps/web/e2e/api/annotation-convert.spec.ts`

- [ ] **Commit** · `git commit -m "feat(annotations): conversion APIs (Wave 4.3)"`.

### Task 4.4: UI — context menu entries in AnnotationList and LayerPanel

**Orient:** Let the user right-click an annotation (or multi-selected annotations, or a layer feature) to trigger conversion.
**Flow position:** UI node.
**Skill:** `frontend-design`
**Files:**
- Modify: `apps/web/src/lib/components/annotations/AnnotationList.svelte` (context menu)
- Modify: `apps/web/src/lib/components/annotations/AnnotationMutations.ts` (convertToLayer options)
- Modify: `apps/web/src/lib/components/map/LayerPanel.svelte` (feature context menu)
- Test: `apps/web/src/__tests__/annotation-convert-ui.test.ts`

- [ ] **Steps:** TDD on the menu item and the resulting mutation call. Show skipped count in the success toast.
- [ ] **Commit** · `git commit -m "feat(annotations): conversion UI (Wave 4.4)"`.

---

## Execution Waves (revised after product-strategy cycle 01)

The cycle 01 vision (`product/strategy/vision.md`) reranks these waves. Groups + Styling serve only the Data Storyteller persona (RICE 0.8 each) and we have no committed Storyteller pilot yet. Convert serves Researcher + Storyteller (RICE 2.1) and its Researcher use case is already committed (RN). Therefore Wave 3 runs **before** Wave 2, and Wave 2 becomes a trigger-gated follow-on.

| Wave | Tasks | Order | Depends on | Trigger |
|------|-------|-------|------------|---------|
| **0** | Task 0 (shared-types contract skeleton) | single | — | always runs |
| **1** | 1.1 → 1.2 → 1.3 → 1.4, plus spike 1.5 | sequential | Wave 0 | always runs |
| **3** | 4.1 → 4.2 → 4.3 → 4.4 | sequential | Wave 1 complete + seed `felt-like-it-34c1` (measurement persistence decision) resolved | always runs |
| **2** | Groups chain 2.1–2.4 and Styling chain 3.1–3.4, each internally sequential, chains parallel to each other | parallel chains | Wave 1 complete | **Trigger-gated**: a committed Data Storyteller pilot signs up, OR an open-backlog window after the Integrator + Security streams ship. Do not schedule before the trigger. |

Wave 3 is now directly blocked by seed `felt-like-it-34c1`. The decision ("do we persist measurement data on annotations?") determines whether Task 4.1 (convertToLayer) must transfer measurement fields. Resolve the spike **before** starting Task 4.1.

## External Composition (streams running parallel to this plan)

This plan is **not the only thing shipping this cycle.** Three strategy-approved streams run alongside it. Executing-plans subagents consuming this plan should know which tasks they may touch and which they may not.

```
Wave 0 ── Wave 1 ── Wave 3 ── (Wave 2 on-hold)
             │         │
             │         └── blocked by seed felt-like-it-34c1 (measurement decision)
             │
   ┌─────────┼──────────────┐
   │         │              │
Integrator  Security     Measurement
stream      stream       decision
(1674→d40a) (H1-H7+M9)   (34c1)
parallel    parallel     must resolve
                         before Wave 3
```

- **Integrator stream** — seeds `felt-like-it-1674` (versioning policy, 1 day) → `felt-like-it-d40a` (OpenAPI + SDK). Runs parallel to Wave 1. Do not let this plan's changes break the `/api/v1/` contract without a versioning bump.
- **Security stream** — H1–H7 + M9 seeds from the adversarial audit. Gate for `/api/v1/` GA. Runs parallel to Wave 1. If a H-series fix changes REST error envelope shapes, Wave 1 and Wave 3 Task 4.3 must revalidate their assumptions.
- **Measurement decision** — seed `felt-like-it-34c1`. Must resolve before Wave 3 Task 4.1. If decision is "persist measurement", Task 4.1 scope grows (transfer measurement fields on conversion); write a follow-up task in the same wave.

These are *coordination* constraints, not dependencies. The plan does not wait on these streams — it runs its waves in the revised order above; the streams influence specific acceptance criteria within waves.

---

## Risk / Blast-Radius Assessment

| Task | Risk | Blast radius | Mitigation |
|------|------|--------------|------------|
| 0 (contract skeleton) | Low | All downstream files type-check against new optionals. | Nullable everywhere in Wave 0. |
| 1.1 (name/desc migration) | Low | `annotation_objects` table; all SELECTs. | Columns nullable; no FK. |
| 1.2–1.4 (name/desc service + API + UI) | Low | Serializer, UI form. | Dual-read pattern: list uses `name ?? preview`. |
| 1.5 (backfill spike) | Low (read-only) | None. | Time-capped. |
| 2.1 (groups migration) | **Medium** | New FK from `annotation_objects.group_id`. Every list query path. | FK is nullable + `ON DELETE SET NULL`; no backfill (legacy rows = ungrouped). |
| 2.2 (groups service) | Medium | `listGrouped` is a new projection; existing `list` unchanged. | Keep `list` as-is; panel opts into grouped projection behind a prop. |
| 2.3 (groups API) | Medium | Two new REST routes; tRPC subrouter. | Gate endpoints behind existing `requireMapAccess` guard. |
| 2.4 (groups UI) | Medium | AnnotationList rewrite. | Render ungrouped-flat if `groups.length === 0` so panels on legacy maps stay unchanged. |
| 3.1 (style jsonb) | Low | `annotation_objects` column add; no reader change until 3.3. | jsonb nullable. |
| 3.2 (style API) | Low | Serializer. | Schema-validated at boundary. |
| 3.3 (style renderer) | **Medium-high** | AnnotationRenderer paint expressions run for every map view. A bad expression can blank the layer. | `styleToPaint` pure function, unit-tested. Snapshot paint expressions pre/post. Fallback: if style null, use existing hard-coded paint. |
| 3.4 (style UI panel) | Low | New component. | Isolated; no impact when not selected. |
| 4.1 (convertToLayer service) | **High** | Creates layer + deletes annotations in one txn. Mis-implementation leaks data or orphans layers. | Transaction-scoped. Invariant test: rowcount(layer.features) + rowcount(skipped) === len(input). Reject on empty input. |
| 4.2 (reverse convert) | Medium | New annotation inserts; no deletes. | Fewer failure modes than 4.1. |
| 4.3 (convert APIs) | Medium | Two new endpoints, `editor` role required. | requireMapAccess(editor) gate. |
| 4.4 (convert UI) | Low | New context menu entries. | Confirm dialog before destructive conversion; show skipped count. |

Top-3 risks to watch: **3.3 (map blanks if paint expression misnamed)**, **4.1 (data-loss on failed txn commit)**, **2.4 (panel regression for legacy maps)**.

---

## Open Questions

### Flow Contracts
- Q: Does `annotationService.list` caller `AnnotationPanel` need to see groups inline, or as a sibling query? (Assumed sibling query for W2.4 — one query per concern.)
- Q: Does the existing `+server.ts` REST handler's JSON-depth cap (20) accept a `style` object of ~10 keys cleanly? (Assumed yes — `style` has flat fields.)

### Wave 0
- None (fully specified).

### Wave 1
- **Task 1.4:** Should the Name field be required in the UI even though the DB allows null? (Leaning yes for new annotations, lenient for edit of legacy rows.)
- **Task 1.5 (spike):** Blocking until answered — result determines whether Wave 4 needs a pre-step to backfill.

### Wave 2 — Groups
- **Task 2.1:** Max nesting depth? (Recommend 3 or flat-only for v1 — Felt docs don't commit.)
- **Task 2.4:** What gesture disambiguation between "drag annotation" and "drag group header"? (Load `gesture-disambiguation` codebook.)

### Wave 2 — Styling
- **Task 3.3:** Do we need per-zoom-level scaling of `strokeWidth`, or treat the user's value as literal? (Literal v1.)
- **Task 3.4:** Color picker component — reuse existing `StylePanel` from layers, or bespoke? (Reuse — check `apps/web/src/lib/components/map/StylePanel.svelte`.)

### Wave 3 — Convert
- **Task 4.1:** How do slotted content keys map into feature properties when types differ (image url → string? emoji → string?)? Decision: stringify non-text content to a URL or a placeholder, store the raw payload under `__annotation_content` for round-trip. **Blocking — confirm before starting.**
- **Task 4.2:** If the user converts a layer with 10k features to annotations, do we batch-create or reject? (Propose: cap at 500 per request, paginate client-side.)

---

## Structural Conventions

To record after Wave 0 lands (via `ml record`):

1. **Additive-first migration policy for annotation_objects.** All new columns nullable; backfill in a separate task; tightening in a later wave.
2. **Schema evolution across shared-types → apps/web.** shared-types has no build step; `pnpm check` in apps/web verifies propagation.
3. **Grouped-list projection belongs in service.ts, not in the panel.** Single query, group-by in JS — avoids N+1 on the client.

---

## Assumptions

- tRPC `annotations.list` will continue to return `AnnotationObject[]` (flat) after Wave 2; the grouped projection is a new procedure, not a replacement. Verified against current usage in `AnnotationPanel.svelte:87`.
- Drizzle migration runner uses `pnpm db:migrate` against the `DATABASE_URL` env; verified present in `package.json`.
- `requireMapAccess` accepts `'editor'` role. Verified at `apps/web/src/lib/server/geo/access.ts`.
- No existing integration relies on the absence of `name`/`description` fields. Verified by grepping for destructured annotation accesses — none assume the field is missing.

---

## Test Matrix

| Layer | Wave 1 | Wave 2 Groups | Wave 2 Styling | Wave 3 Convert |
|-------|--------|---------------|----------------|----------------|
| Zod schema | Task 0 | Task 0 | Task 0 | Task 0 |
| DB/service | 1.2 (vitest) | 2.2 | 3.1 | 4.1, 4.2 |
| tRPC | 1.3 | 2.3 | 3.2 | 4.3 |
| REST e2e | 1.3 (marketing spec) | 2.3 (new spec) | 3.2 (marketing spec) | 4.3 (new spec) |
| UI component | 1.4 | 2.4 | 3.4 | 4.4 |
| Renderer | — | — | 3.3 | — |

Each wave closes when: schema round-trips in isolation, service round-trips in integration, API round-trips end-to-end, UI allows authoring + editing, and the marketing-promises spec (or its extension) passes.

---

<!-- PLAN_MANIFEST_START -->
| File | Action | Marker |
|------|--------|--------|
| `packages/shared-types/src/schemas/annotation-style.ts` | create | `AnnotationStyleSchema` |
| `packages/shared-types/src/schemas/annotation-group.ts` | create | `AnnotationGroupSchema` |
| `packages/shared-types/src/schemas/annotation-object.ts` | patch | `name: z.string().min(1).max(200).nullable().optional()` |
| `packages/shared-types/src/__tests__/felt-parity-schemas.test.ts` | create | `Felt-parity schema` |
| `apps/web/drizzle/migrations/0020_annotation_name_description.sql` | create | `ADD COLUMN name` |
| `apps/web/drizzle/migrations/0021_annotation_groups.sql` | create | `CREATE TABLE annotation_groups` |
| `apps/web/drizzle/migrations/0022_annotation_style.sql` | create | `ADD COLUMN style` |
| `apps/web/src/lib/server/db/schema.ts` | patch | `annotationGroups = pgTable` |
| `apps/web/src/lib/server/annotations/service.ts` | patch | `listGrouped` |
| `apps/web/src/lib/server/annotations/groups.ts` | create | `createGroup` |
| `apps/web/src/lib/server/annotations/convert.ts` | create | `convertAnnotationsToLayer` |
| `apps/web/src/lib/server/trpc/routers/annotations.ts` | patch | `groups: router(` |
| `apps/web/src/routes/api/v1/maps/[mapId]/annotation-groups/+server.ts` | create | `export const POST` |
| `apps/web/src/routes/api/v1/maps/[mapId]/annotation-groups/[id]/+server.ts` | create | `export const PATCH` |
| `apps/web/src/routes/api/v1/maps/[mapId]/convert-annotations-to-layer/+server.ts` | create | `convertAnnotationsToLayer` |
| `apps/web/src/lib/components/annotations/AnnotationForm.svelte` | patch | `formName` |
| `apps/web/src/lib/components/annotations/AnnotationList.svelte` | patch | `annotation.name ?? preview` |
| `apps/web/src/lib/components/annotations/AnnotationGroups.svelte` | create | `<script lang="ts">` |
| `apps/web/src/lib/components/annotations/AnnotationStylePanel.svelte` | create | `<script lang="ts">` |
| `apps/web/src/lib/components/map/AnnotationRenderer.svelte` | patch | `styleToPaint` |
| `apps/web/e2e/api/annotation-groups.spec.ts` | create | `Promise: Groups` |
| `apps/web/e2e/api/annotation-convert.spec.ts` | create | `convert-annotations-to-layer` |
<!-- PLAN_MANIFEST_END -->

---

## Execution Handoff

Plan saved to `apps/web/docs/plans/felt-parity-annotations.md`. Next: materialize as a seeds DAG (the four parent tasks already exist; this plan fans them out into ~18 sub-tasks). Then execute via executing-plans in Sequential or Subagent mode.

**Locked decisions (from the bible):**
- No template authoring for slotted content (Promise 7 closed).
- No pagination UI in the panel (Promise 12 closed).
- Groups, not tags or filters, are the primary organization (from bible §3).
- Style is per-annotation, not per-group (from bible §4).

**Blocking open questions to resolve before Wave 3:** 4.1's attribute-mapping policy.
