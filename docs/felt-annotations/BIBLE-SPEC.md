# Felt Annotations: Concrete Spec

**Source:** Felt Help Center (official product docs), Jan 2026. Scope: public annotation UX, not enterprise tiers.

---

## 1. Anchor Model

Felt uses **5 concrete drawing tools** to position annotations:

| Felt Tool | Our Anchor Type | How it works | Notes |
|-----------|-----------------|--------------|-------|
| **Pin** | `point` | Click map → coordinates auto-captured (or paste coordinates) | Single point; can create via Search too |
| **Line** | `region` | Draw freehand or routed path | Distance measurement toggleable |
| **Route** | `region` | Routed line (Driving/Cycling/Walking/Flying modes) | Includes endcaps, distance measurement |
| **Polygon** | `region` | Draw closed shape; Rectangle and Circle are shortcuts | Area/radius measurement toggleable |
| **Marker, Highlighter, Text, Note, Link** | `point` | UI elements anchored to map (not drawn; click-to-place) | Text/Notes support multi-line content; Links are not "data" |

**Unsupported in our schema:** `feature` (Felt has no explicit "attach to layer feature" in annotations — that's layer editing), `viewport` (Felt has no viewport-scoped annotation), `measurement` (Felt has measurement toggle UI, but measurement data is not an anchor type; see section 6).

**Felt terminology gap:** Felt calls all drawn/placed items "annotations"; we split into *anchor* (where) and *content* (what). Our `point` and `region` map cleanly; our `feature`, `viewport`, `measurement` are inventions beyond Felt's public UX.

---

## 2. Content Model

**Multi-field structure (the "slotted" answer):**

Felt allows **arbitrary key-value pairs** on any annotation:
- **Built-in fields** (always present): `name`, `description`, `images`
- **User-defined attributes** (unlimited): name-value pairs added via UI ("Add row" in Details tab)
- **No concept of templates**: Each annotation is a flat object; slot keys are free-form

**Answer to Promise 7 (templates):**
Felt's design does **not** expose a notion of "templates" or "fixed slot shapes." Users add attributes one-by-one per annotation or batch-apply to grouped annotations. There is no template authoring surface, no template gallery, no per-workspace template registry.

**Implication for our schema:**
- We support `kind: 'slotted'` with arbitrary `Record<string, AnnotationContent | null>`
- Felt's model is closer to our `single` (title/description/attachments as built-ins, plus a flat metadata map)
- Felt does **not** support our notion of "this annotation has 3 configurable fields" (fixed shape per type)
- **Recommendation:** Keep slotted support in schema; ship UI with simple key-value entry (match Felt's UX), defer template authoring to future

---

## 3. List/Panel Behaviour

**Sidebar List** appearance:
- Flat list grouped by **annotation groups** (user-created folders)
- **Visibility toggle** (eyeball icon per group)
- **Selection** (click group → select all contents; multi-select supported)
- **Batch operations** (update pin icons, add attributes to multiple at once via "Select group contents")
- **No search, no pagination, no infinite scroll**

**Constraints:** Felt docs do not document pagination UI. Lists are assumed <500 items (common scale); no affordances for "Load more" or "Page 2."

**Answer to Promise 12 (pagination):**
Felt's public UI shows **no pagination or search in the annotation panel.** Grouping is the primary organizing pattern. At <500 items, no load-more affordance is visible in docs.

**Implication:** We can choose either load-all + virtualization OR load-more pagination. Felt's observed behaviour suggests they load-all. No filtering/search is documented.

---

## 4. Styling and Grouping

**Per-annotation styling options** (right panel, "Style" tab):

| Property | Applies to | Values |
|----------|-----------|--------|
| **Opacity** | Routes, Lines, Polygons, Markers, Highlighters, Images | 0–100% (per-fill and per-stroke for polygons) |
| **Stroke Width** | Routes, Lines, Polygons | pixels |
| **Stroke Style** | Routes, Lines, Polygons | Solid, Dashed, Dotted |
| **Endcaps** | Routes only | Start, End |
| **Routing Mode** | Routes only | Driving, Cycling, Walking, Flying |
| **Text Alignment** | Text, Notes | Left, Center, Right |
| **Text Style** | Text, Notes | Italic, Light, Regular, CAPS |
| **Show Label** | Pins | toggle `name` visibility |
| **Measurements** | Lines/Routes (distance), Circles (radius), Polygons (area) | toggle display |

**Groups:**
- User-created folders in Sidebar List
- Support visibility toggling (eyeball icon)
- Multi-select all annotations in a group
- Batch icon change for pins within a group
- Batch attribute application

**Legend:** Groups appear in Felt's legend (not documented in detail, but implied via "allow for visibility control in the legend").

**Schema gap:** Our schema does not track:
- Stroke style (we have color, width, but not solid/dashed/dotted)
- Endcaps (Routes only, niche)
- Routing mode (Routes only, not in public UX as annotation property)
- Text alignment or style variants

**Recommendation:** Add `strokeStyle` enum; others are low-priority (Routes are rarely exposed in public UX).

---

## 5. Editing and Threading

**Felt's documentation does not cover:**
- Inline vs. modal edit UX (no detailed screenshots)
- Reply/thread conventions (no comments or threading visible in public docs)
- Concurrency handling (last-write-wins assumed, not documented)
- Conflict resolution

**Inferred from "Adding attributes" section:**
- Edits are done in a right-side Details panel (not inline on map)
- Changes are immediate (optimistic or server-side assumed)
- No notion of "edit history" or "versions" documented

**Answer to Promise 8 (threaded replies):**
Felt's public docs show **no reply/comment functionality.** Annotations are standalone objects; there is no visible thread or reply UX.

**Implication:** Our threading model is an invention beyond Felt's public product. We built it; Felt didn't document it.

---

## 6. Conversion annotation ↔ layers

**Convert annotations → layers (right-click > Actions > Convert to layer):**
Converts drawn annotations into a data layer. Useful when annotations have accumulated attributes you want to style or analyse as a dataset.

**Which fields transfer:**
- Geometry (point, line, polygon)
- `name` → layer feature `name` property
- `description` → layer feature `description` property
- All user-defined attributes (key-value pairs)
- **Images do NOT transfer** (implied: attributes are metadata; files are not)

**Convert specific layer features → annotations:**
Reverse operation: layer features become annotation objects on the map (implied geometry + name + description + attributes).

**Measurement state:** Not mentioned. Measurement toggle is a UI-only property; does not persist or transfer.

---

## 7. Our 14-Promise Delta

| # | Promise | Felt's Behaviour | Our Gap | Our Overbuilding |
|---|---------|------------------|---------|------------------|
| 1 | Pin a point | Click → capture coordinates ✓ | None | None |
| 2 | Annotate a region | Draw polygon/line ✓ | None | Measurement toggle UI (we gated on submit, Felt shows in panel) |
| 3 | Attach to layer feature | Not in Felt's public UX | Felt has no "pick feature" flow; we invented it | None |
| 4 | Viewport anchor | Not in Felt's public UX | Felt has no viewport-scoped annotation | None |
| 5 | Measurement anchor | Measurement toggle on routes/lines/polygons ✓ | Measurement is UI option, not anchor type (we call it anchor type) | Measurement as first-class anchor (Felt treats it as toggle) |
| 6 | Rich content variants | Text, emoji, link, image, gif ✓ | Felt has no emoji/gif support in public docs; IIIF is absent | Emoji/gif/IIIF (we went beyond Felt) |
| 7 | Slotted / templated annotations | Free-form attributes, no templates ◐ | **DESIGN QUESTION**: We need product decision on template shape + authoring | None (but schema support ready) |
| 8 | Threaded replies | Not in Felt's public UX | Felt has no comment/thread mechanism; we invented it | Threading model (entirely novel) |
| 9 | Edit | Right-panel details edit (inferred) ✓ | Felt doesn't document inline vs. modal choice | None |
| 10 | Delete with If-Match | Not in Felt's public UX | Felt doesn't expose version/CAS; we added it | Optimistic concurrency + version checking (beyond Felt) |
| 11 | Optimistic concurrency visible | Not in Felt's public UX | Felt doesn't document conflict UX | Toast-driven conflict feedback (beyond Felt) |
| 12 | Pagination | No pagination visible | **DESIGN QUESTION**: Felt shows no pagination affordance; load-all assumed | None (depends on Promise 12 choice) |
| 13 | Per-workspace privacy | Not documented | Felt doesn't show 401/403/404 flow | Distinct auth toasts (beyond Felt) |
| 14 | Auth gating | Not documented | Felt doesn't show sign-in prompt | Sign-in banner (beyond Felt) |

**Summary:** We match Felt on core UX (1, 2, 6). We invented or overbuilt on concurrency (10, 11), threading (8), and auth (13, 14). Two open design questions remain (7, 12). Three anchor types (3, 4, 5) diverge significantly from Felt's model.

---

## Implementation Notes

- **Felt's anchor term "Line/Route/Polygon"** → Our `region` type covers all
- **Felt's "Marker/Highlighter/Text/Note/Link"** → Our `point` type, though some (Link) are non-spatial
- **Content "attributes"** in Felt → Our `slotted` kind, but Felt has no template definition UX
- **Measurement toggle** is UI state in Felt, not an anchor type; we generalized it
- **Groups/folders** are well-supported in Felt; our schema has no group nesting (likely OK for MVP)
- **Stroke styles** (dashed, dotted) and **text variants** (italic, caps) are styling properties Felt exposes but our schema doesn't track

---

**Last reviewed:** Felt Help Center, Jan 2026 (via help.felt.com public docs)
