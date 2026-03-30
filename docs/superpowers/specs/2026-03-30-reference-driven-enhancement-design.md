# Reference-Driven Enhancement Design

**Date:** 2026-03-30
**References:** `svelte-maplibre` (declarative MapLibre components), `allmaps` (IIIF georeferencing platform)
**Scope:** Audit → Simplify → Enhance → Feature → Simplify (Approach C: audit-first, flow-driven execution)

## Intent

Enhance, flesh out, and simplify FLI's feature sets and E2E flows using two reference repos as pattern sources. Every task is framed as an end-to-end flow (trigger → path → outcome).

## Constraints

- All work framed as E2E flows, never isolated components
- Svelte 5 runes, svelte-maplibre-gl (the Svelte 5 fork already in use)
- Existing test suite (582 tests + 12 E2E) must stay green
- No breaking changes to tRPC API surface (Research-Narratives depends on it)

## Audit Results

Phase 0 complete. 16 existing flows audited + 4 new flow opportunities identified.
**64 findings:** 1 critical bug, 18 debt, 11 simplifications, 22 enhancements, 12 missing features.
**Hottest files:** MapCanvas.svelte (887 LOC, 11 findings), MapEditor.svelte (738 LOC, 8 findings), AnnotationPanel.svelte (~1200 LOC, 6 findings).

Full findings: `docs/research/e2e-flow-problems.md`
Per-flow details: `docs/research/e2e-flow-audit.md`, `e2e-audit-flows-5-8.md`, `flow-audit-9-12.md`, `e2e-audit-flows-13-16.md`

## 20 Flow Problems (execution order)

### Wave 0 — Critical bug
| ID | Flow | Problem | Type |
|----|------|---------|------|
| F01 | Map creation | `handleCreate` infinite recursion + no onboarding | bug |

### Wave 1 — Foundation: layer rendering flow
| ID | Flow | Problem | Type |
|----|------|---------|------|
| F03 | Layer rendering | 887-line monolith blocks all map work; triple onclick duplication; untyped paint; no z-ordering | simplify |
| F04 | Feature interaction | Zero hover feedback; paint-based highlight; top-level popup; click dedup hack | simplify+enhance |

### Wave 2 — Core interaction flows
| ID | Flow | Problem | Type |
|----|------|---------|------|
| F05 | Drawing | Feature vanishes during round-trip; 8s auto-dismiss; no validation | enhance |
| F06 | Style editing | Full rebuild per cycle; no debounce; no undo; 4-file chain | simplify+enhance |
| F12 | Panel navigation | Three parallel systems; hidden side effects; no URL state; not collapsible | simplify |

### Wave 3 — Data pipeline flows
| ID | Flow | Problem | Type |
|----|------|---------|------|
| F02 | Data import | Blind upload; 100MB in-memory buffer; no progress; files never cleaned | simplify |
| F07 | Filtering | Split-brain dual paths; ephemeral; sparse field discovery; no spatial | simplify+enhance |
| F08 | Geoprocessing | Black box; no preview; no progress; PostGIS-coupled; no provenance | enhance |

### Wave 4 — Content flows
| ID | Flow | Problem | Type |
|----|------|---------|------|
| F09 | Measurement | Trapped in panel; scattered state; panel-switch on save | simplify+enhance |
| F10 | Annotations | 1200-line monolith; no versioning; no optimistic creates | simplify |
| F11 | Export | 6 boolean states; inconsistent API; no bulk; no progress | simplify+enhance |

### Wave 5 — New feature flows
| ID | Flow | Problem | Type |
|----|------|---------|------|
| N01 | Cluster exploration | Large point datasets render as undifferentiated mass | feature |
| N02 | Rich markers | Features limited to MapLibre circles/fills — no custom HTML markers | feature |
| N03 | Data joins | No way to merge external tabular data with map features | feature |

### Wave 6 — Sharing + embedding flows
| ID | Flow | Problem | Type |
|----|------|---------|------|
| F13 | Sharing | No viewport in URL; duplicated resolution; heavy viewer | simplify+enhance |
| F14 | Embedding | Scroll-jacks; ships full bundle; two snippets; permissive CSP | simplify+enhance |

### Wave 7 — Collaboration + commenting flows
| ID | Flow | Problem | Type |
|----|------|---------|------|
| F15 | Commenting | Split paths; stale; unmoderated guests; no editing | simplify+enhance |
| F16 | Collaboration | Invitation-only; no feedback; no accept/decline | enhance+feature |
| N04 | Image overlays | No raster/image overlay capability | feature |

## Locked Decisions

- **Audit-first:** No code changes until the audit document is complete and reviewed. ✅ Done.
- **E2E flow framing:** Every task is defined as trigger → path → outcome. No orphan component work.
- **Reference-driven:** Changes must cite a specific pattern from svelte-maplibre or Allmaps. No speculative refactoring.
- **Wave ordering follows dependency:** Layer rendering (Wave 1) is foundation. Interaction (Wave 2) builds on it. Data flows (Wave 3) need stable rendering. Content (Wave 4) needs stable data. Features (Wave 5+) land on clean substrate.
- **Each wave is a sandwich:** audit findings → simplify → enhance → feature → simplify.

## Open Questions

- Does FLI's `svelte-maplibre-gl` fork expose `manageHoverState`, `eventsIfTopMost`, nested `<Popup>`, `cluster` prop? Need to verify API parity before Wave 1.
- Image overlay flow (N04): full Allmaps-style GCP warping, or simpler bounding-box image placement? Deferred to Wave 7 scoping.
- Panel navigation (F12): Allmaps route-per-view vs unified store — which fits FLI's single-page editor better?

## Referenced Documents

- `docs/ROADMAP.md` — FLI feature status and phase structure
- `docs/ARCHITECTURE.md` — Current system architecture
- `docs/research/e2e-flow-problems.md` — 20 flow problems (canonical reference)
- `docs/research/e2e-flow-audit-consolidated.md` — 64 findings with IDs
- `/mnt/Ghar/2TA/DevStuff/Patterning/Maps/svelte-maplibre/` — Declarative MapLibre component library
- `/mnt/Ghar/2TA/DevStuff/Patterning/Maps/allmaps/` — IIIF georeferencing platform
