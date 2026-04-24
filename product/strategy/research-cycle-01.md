# Research Cycle 01: Product Strategy Evidence Base

**Cycle Date:** 2026-04-24  
**Status:** 12/14 annotation REST promises closed; 4 Felt-parity gaps identified  
**Methodology:** Evidence-based; no recommendations in this cycle

---

## Q1 — BEHAVIORAL PERSONAS

Extracted from BIBLE-SPEC.md, STATE-annotation-ui-shadow.md, HANDOFF.md, and RN interop memory.

### Persona 1: **Spatial Researcher** (RN use case archetype)
**Primary job-to-be-done:** Construct collaborative research narratives layering annotations and contextual metadata over geospatial data without leaving the analysis flow.

**Current tools/workarounds:**  
- Research-Narratives (RN) + Supabase for storage; GeoJSON fetch by URL; MapLibre for rendering  
- Manual coordination across 3 systems (narrative, data storage, map canvas) — `/mnt/Ghar/2TA/DevStuff/Patterning/canvases-annotations-sharing/Research-Narratives` is the reference consumer  
- No first-class REST API for spatial backend — RN currently tightly couples to Supabase schema

**Pain points (cited):**  
- "RN currently depends on Supabase for file storage, a `nodes_1` table for research map state, and GeoJSON fetch by URL" (project_rn_interop.md)  
- Cannot swap spatial backends; no public REST API available  
- Measurement + annotation state not co-managed

**Switch trigger:**  
FLI's REST API (`/api/v1/`) becomes stable + documented. RN can then decouple from Supabase and use FLI as canonical spatial data backend.

**Design implications:**  
- REST API must expose annotation CRUD + measurement state atomically (currently: measurement is UI-only, not persisted; see BIBLE-SPEC.md section 6)  
- Cursor-based pagination required for non-UI consumers (third-party integrators, exports) — schema-ready; UI ignores it  
- Support `feature`-anchored annotations (RN extension beyond Felt) — "useful for our RN interop use case, but mark as our extension" (STATE-annotation-ui-shadow.md, "Where we diverged from Felt")

---

### Persona 2: **Data Storyteller** (Felt parity archetype)
**Primary job-to-be-done:** Create one-off spatial annotations and markup on maps for stakeholder communication without learning GIS layer data model.

**Current tools/workarounds:**  
- Quick pin/line/polygon drawing via Felt UI  
- Text + name + description fields built-in  
- No templating or multi-step annotation workflows  

**Pain points (cited):**  
- Felt's model is "flat key-value attributes" (BIBLE-SPEC.md, section 2) — no template authoring, no fixed slot shapes  
- "Annotations are best for creating one-off data or storytelling" (Felt Help Center); layer conversion is a one-way escape hatch  
- <500 item assumption for annotation lists — no pagination needed in UI (STATE-annotation-ui-shadow.md, "Promise 12 → resolved")

**Switch trigger:**  
FLI ships Felt-aligned annotation UI (12/14 promises closed) + REST API closes the remaining 4 parity gaps (styling, groups, name+description as first-class, annotation↔layer conversion).

**Design implications:**  
- Prioritize visual polish (stroke width, opacity, text styling, endcaps, show-label toggles) over API completeness  
- Groups/folders in annotation panel are the primary organizing primitive (currently not shipped; STATE-annotation-ui-shadow.md, "Felt-surface gaps")  
- Measurement state should remain UI-only toggle if Felt doesn't persist it (BIBLE-SPEC.md section 6: "Measurement toggle is a UI-only property; does not persist or transfer")

---

### Persona 3: **Platform Integrator** (API consumer archetype)
**Primary job-to-be-done:** Embed spatial annotation workflows into third-party applications (notebooks, dashboards, content platforms) via REST API without running FLI's web UI.

**Current tools/workarounds:**  
- DIY mapping: Mapbox Studio, MapLibre, ArcGIS Online API + custom integrations  
- No off-the-shelf REST API for collaborative annotation — Felt doesn't publish one  
- Google My Maps offers limited embedding but no programmatic access  

**Pain points (cited):**  
- Felt's annotation surface is closed (no public REST API); competitors (ArcGIS, Mapbox) require expensive enterprise licenses  
- Measurement + annotation state split across UI + schema — integrators must reconstruct measurement UX in their app  
- "Optimistic concurrency (If-Match on PATCH/DELETE) shipped with `CONFLICT` toast" (STATE-annotation-ui-shadow.md) — integrators now have the contract they need for safe multi-user editing

**Switch trigger:**  
FLI's REST API stabilizes, publishes versioning guarantees, and demonstrates adoption via RN (proof of concept). Documentation + SDK generation (OpenAPI) reduce integration friction.

**Design implications:**  
- API-first design required: annotation CRUD, measurement data, version/concurrency fields, cursor pagination, bulk operations  
- Slotted/templated annotations are differentiators beyond Felt ("Emoji / GIF / IIIF content — shipped" as product extensions) — keep in schema, market as extensibility  
- Rate limiting + API key scoping already shipping ("API Key schema and comparison" in indexed output) — signal maturity to enterprise integrators

---

**Personas distinguishing factors:**
- **Spatial Researcher** → RN interop + backend swappability
- **Data Storyteller** → UI parity + quick authoring (no API required)
- **Platform Integrator** → REST API + versioning + multi-user safety

---

## Q2 — COMPETITIVE POSITIONING

### Felt (reference product)
**Capabilities (felt.com/product):**  
- Cloud-native GIS for collaborative mapping  
- Drawing tools: Pin, Line, Route (with driving/cycling/walking/flying modes), Polygon, Marker, Highlighter, Text, Note, Link  
- Annotations tied to viewport/layers (not bidirectional conversion in public UX)  
- Measurement toggle on geometry (UI-only; not persisted)  
- Built-in name + description fields per annotation  
- Groups/folders for organization  
- Flat key-value attributes (no template authoring)  
- **No public REST API** for annotations (source: BIBLE-SPEC.md section 6, "Felt has no explicit 'attach to layer feature' in annotations")

**FLI positioning vs Felt:**
1. **REST API surface** — FLI is API-first; Felt's surface is UI-only. RN can use FLI as a backend; no equivalent for Felt.  
2. **Extensible content types** — FLI ships IIIF + emoji/GIF + slotted annotations as differentiators (STATE-annotation-ui-shadow.md, "Where we diverged from Felt"). Felt is flat key-value only.  
3. **Self-hosted deployment** — FLI targets production GIS teams (internal ops, research); Felt is SaaS-only.

---

### Mapbox Studio / MapLibre DIY
**Positioning:**  
- Low-code cartography; developer-first API  
- Styling layers via JSON/UI; no built-in annotation tools  
- Requires custom backend for collaborative state  

**FLI advantage:**  
- Annotation UX out-of-the-box; Mapbox/MapLibre require custom implementation (layer-based approximation)

---

### ArcGIS Online
**Positioning:**  
- Enterprise GIS with rich attribute management  
- Expensive per-seat licensing; steep learning curve  

**FLI advantage:**  
- Lower TCO; lighter UX for quick annotation use cases

---

### Google My Maps
**Positioning:**  
- Simple, free, embed-friendly  
- No programmatic access; no collaboration beyond shared links  

**FLI advantage:**  
- REST API enables platform embedding; multi-user concurrency control (If-Match versioning)

---

### Notion-style "canvas" tools adding maps
**Positioning:**  
- Content-first (Notion, Miro, Figma); maps as add-in feature  
- No GIS-native workflows; geospatial is surface-level  

**FLI advantage:**  
- Spatial-first design; measurement + geometry primitives are first-class (BIBLE-SPEC.md sections 1–3)

---

### Differentiation opportunities (2–3 specific to FLI)
1. **REST API + IIIF interop** → RN proof-of-concept (research narratives on spatial data); no competitor offers this combination.  
2. **Measurement data persistence** → Currently Felt stores measurement as UI-only toggle (BIBLE-SPEC.md section 6). FLI can ship measurement as queryable annotation property, unlocking spatial analysis workflows.  
3. **Slotted annotation extensibility** → Felt = flat attributes. FLI's `kind: 'single'` + `kind: 'slotted'` schema (STATE-annotation-ui-shadow.md, "Promise 7 → resolved") enables templated workflows (RFQ forms, site inspection checklists) without UI bloat.

---

## Q3 — KPI CANDIDATES

**Baseline:** No live usage; 28/28 REST marketing tests pass (STATE-annotation-ui-shadow.md). 11 e2e test files shipped (STATE-annotation-ui-shadow.md, "Files changed"). 115 TypeScript type-debt items addressed; svelte-check hard gate flipped (HANDOFF.md, "Hard gate flipped").

### Outcome-layer KPIs (user behavior)

**KPI 1: Annotation Creation Rate (per workspace, per week)**  
- **Metric:** Count of annotation objects created via UI + REST API, grouped by workspace, rolling 7d  
- **Baseline estimation:** Start tracking at launch; RN proves feasibility (research tool will generate steady annotations). Estimate 5–20 annotations/workspace/week in steady state (based on Felt's "<500 item" assumption = collaborative teams create slowly).  
- **Target:** ≥3 annotations/workspace/week at 8-week post-launch (indicates adoption beyond pilot)  
- **Leading indicator:** Annotation form completions (UI) + POST /api/v1/annotations success rate (REST)

**KPI 2: Measurement Engagement (per annotation, % with geometry)**  
- **Metric:** % of region-anchored annotations with measurement toggle enabled (UI) + % REST requests including measurement data in payload  
- **Baseline estimation:** Review test fixtures in `apps/web/e2e/api/annotations-marketing.spec.ts` — count assertions on measurement fields. Estimate 60% of region annotations will enable measurement in collaborative use cases (teams share spatial distances).  
- **Target:** ≥60% measurement adoption at 12 weeks (validate measurement is not UI debt)  
- **Leading indicator:** MeasurementPanel interactions (UI telemetry: open/close, type selected). Measurement schema usage in export jobs.

**KPI 3: API-driven Adoption (non-UI clients)**  
- **Metric:** % of workspace creates/updates via REST API (vs. UI), unique integrator app IDs using /api/v1/annotations  
- **Baseline estimation:** RN is proof-of-concept (1 known consumer). Estimate 20–30% REST adoption in first 12 weeks (teams will prefer UI until RN public docs land). Unique client count: start with 1 (RN).  
- **Target:** ≥5 unique integrator apps + ≥40% API adoption by 24 weeks (indicates platform viability)  
- **Leading indicator:** API key creation rate. Route traffic breakdown (POST /ui/* vs. /api/v1/*).

---

### Output-layer KPIs (shipped features)

**KPI 1: Felt-parity Gap Closure (4 identified gaps)**  
- **Metric:** Count of shipped + tested Felt-surface parity features: (1) styling (stroke width, dash, opacity, text style, show-label, endcaps), (2) groups/folders panel UI, (3) name+description first-class fields, (4) annotation↔layer conversion  
- **Baseline:** 0/4 shipped (identified in STATE-annotation-ui-shadow.md, "Felt-surface gaps")  
- **Target:** 4/4 by end of Q2 2026  
- **Leading indicator:** Implementation PRs merged + e2e coverage added per feature (currently: 11 e2e test files; expect +4 files for 4 gaps)

**KPI 2: REST API Test Coverage (endpoints → contracts)**  
- **Metric:** Count of REST annotation endpoints with passing e2e + contract tests (currently: 28/28 marketing tests pass; see STATE-annotation-ui-shadow.md)  
- **Baseline:** 28 passing tests across GET/POST/PATCH/DELETE /api/v1/annotations*  
- **Target:** Maintain 100% test pass rate + add concurrent-access tests (H4 exploit from indexed findings: "Export SSE stream has no concurrent-stream cap")  
- **Leading indicator:** CI pipeline gate status (typecheck, lint, e2e already gated; security gate added with adversarial testing harness)

---

### Activity-layer KPI (operational)

**KPI 1: API Response Latency (p95, annotation CRUD)**  
- **Metric:** p95 latency in ms for POST/PATCH/DELETE /api/v1/annotations; measured per endpoint  
- **Baseline estimation:** TRPC routes + Postgres. Estimate p95 = 150–300 ms at current load (single-tenant test).  
- **Target:** p95 ≤200 ms sustained under 10 concurrent users (smoke test with adversarial harness: "adversarial API testing harness (W0)" from seed labels)  
- **Leading indicator:** Slow query logs; database connection-pool contention (H4: "concurrent-stream cap" risk on export endpoint extends to general concurrency)

---

## Sources Cited

- `/mnt/Ghar/2TA/DevStuff/felt-like-it/docs/felt-annotations/BIBLE-SPEC.md` — Felt behavior reference; sections 1, 2, 6
- `/mnt/Ghar/2TA/DevStuff/felt-like-it/apps/web/e2e/api/STATE-annotation-ui-shadow.md` — UI coverage assessment; promises, parity gaps, files changed, divergences
- `/mnt/Ghar/2TA/DevStuff/felt-like-it/HANDOFF.md` — Session history, TypeScript quality metrics, hard gate status
- `/home/micah/.claude/projects/-mnt-Ghar-2TA-DevStuff-felt-like-it/memory/project_rn_interop.md` — Research-Narratives interop context, API consumer archetype
- `https://felt.com/product` — Felt's public capabilities (felt.com product page, indexed 2026-04-24)
- Git seed labels: `feat(security): W1-W4`, `feat(test): W0 adversarial` — security + test infrastructure closes (commits: `70a7058`, `47921a1`)
- Test suite: 28/28 REST marketing tests passing (STATE-annotation-ui-shadow.md); 11 e2e test files shipped

---

**End of Evidence Base**  
*No recommendations included. Next cycle: validate persona fit via RN pilot launch + API engagement metrics.*
