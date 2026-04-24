# Roadmap — Cycle 01 (RICE-prioritized)

**Framework:** RICE. Reach × Impact × Confidence ÷ Effort. Chosen over MoSCoW (too coarse for cross-stream compare) and Impact-Effort (lacks Confidence — we have real evidence gaps).

**Scoring conventions:**
- **Reach** — number of distinct personas served, scaled 1 (one persona) → 3 (all three).
- **Impact** — 0.25 (minimal) / 0.5 (low) / 1 (medium) / 2 (high) / 3 (massive).
- **Confidence** — 0.5 (guess) / 0.8 (informed) / 1.0 (evidence-backed).
- **Effort** — person-weeks estimate.
- **Score** = (Reach × Impact × Confidence) ÷ Effort.

## Candidate bets

| Bet | Primary persona | Reach | Impact | Conf | Effort | **RICE** | Evidence |
|---|---|---|---|---|---|---|---|
| Ship 12/14 promises (done this cycle) | All three | 3 | 2 | 1.0 | 1 (done) | **6.0** | `STATE-annotation-ui-shadow.md` |
| 1. Name + description first-class (`06b2`) | Storyteller + Researcher | 2 | 2 | 1.0 | 1 | **4.0** | bible §2 §6 |
| 2. Security H-series close-out (H1–H7 + M9) | Integrator (platform trust) | 1 | 3 | 1.0 | 1.5 | **2.0** | `sd ready` security bucket; adversarial-2026-04-24 |
| 3. Annotation ↔ layer conversion (`41c9`) | Storyteller + Researcher | 2 | 2 | 0.8 | 1.5 | **2.1** | bible §6 |
| 4. Groups / folders (`2e48`) | Storyteller | 1 | 2 | 0.8 | 2 | **0.8** | bible §3 |
| 5. Styling panel (`5179`) | Storyteller | 1 | 2 | 0.8 | 2 | **0.8** | bible §4 |
| 6. Measurement persistence (new) | Researcher | 1 | 2 | 0.8 | 1.5 | **1.1** | research-cycle-01 §Q1 P1 |
| 7. Flow audit seeds F09–F14 | All three | 3 | 1 | 0.8 | 3 | **0.8** | `audit-2026-03-30` |
| 8. New-flow seeds N01–N03 | Storyteller | 1 | 2 | 0.5 | 3 | **0.3** | same |
| 9. OpenAPI + SDK generation | Integrator | 1 | 2 | 0.8 | 1 | **1.6** | persona `platform-integrator` |
| 10. `/api/v1/` versioning policy doc | Integrator | 1 | 1 | 1.0 | 0.25 | **4.0** | persona `platform-integrator` |

## Prioritization output (rank)

1. **Versioning policy doc** (#10, RICE 4.0) — one day's work, unblocks the Integrator persona's switch trigger.
2. **Name + description first-class** (#1, RICE 4.0) — prerequisite for convert; direct Storyteller win.
3. **Security H-series close-out** (#2, RICE 2.0) — not negotiable for platform trust; gates `/api/v1/` GA.
4. **Annotation ↔ layer conversion** (#3, RICE 2.1) — depends on #1.
5. **OpenAPI + SDK generation** (#9, RICE 1.6) — needed before RN integrates at scale.
6. **Measurement persistence** (#6, RICE 1.1) — conditional on KPI O2 being adopted.
7. **Groups / folders**, **Styling** (#4, #5, RICE 0.8 each) — Storyteller-only; ship after the platform bets land.
8. **Flow audit seeds** (#7, RICE 0.8) — batch into a cleanup sweep.
9. **New-flow seeds N01–N03** (#8, RICE 0.3) — defer; low confidence, large effort, unclear persona.

## Parallel-stream composition (Q2 2026)

The top of the rank list does not execute serially — four streams run alongside each other this quarter:

1. **Integrator stream** — versioning policy (`1674`) → OpenAPI + SDK (`d40a`). 1–2 person-weeks total.
2. **Security close-out** — H1–H7 + M9. Gates `/api/v1/` GA. 1.5 person-weeks.
3. **Felt-parity plan (`apps/web/docs/plans/felt-parity-annotations.md`)** — revised order: Wave 0 → Wave 1 → Wave 3 → [Wave 2 trigger-gated]. Wave 2 (Groups + Styling) is **on hold** until a Storyteller pilot materializes or the Integrator + Security streams finish first.
4. **Measurement decision** — seed `34c1`. Must resolve before Felt-parity Wave 3 starts; determines whether convert must carry measurement fields.

Scheduling constraints:
- Felt-parity Wave 1 can start today; does not block on any other stream.
- Felt-parity Wave 3 is blocked by `34c1`.
- Integrator OpenAPI + SDK task benefits from Felt-parity Wave 1's schema additions (name/description) being merged first — but does not require it.
- Security stream is the only stream that can gate a `/api/v1/` announcement.

The **rank list above** orders individual items for prioritization; the **stream composition here** describes how they land on the calendar.

## What we are explicitly NOT doing this cycle

- **Template authoring** for slotted content. Locked out by bible §2.
- **Pagination UI** in the side panel. Locked out by bible §3.
- **Threading redesign.** Our threading is an invention beyond Felt; keep as-is until a persona demands changes.
- **Tags / search on annotations.** Felt doesn't have them; no persona has asked.
- **Native mobile client.** All three personas live on web/desktop.

## Explicit trade-offs

- Prioritizing platform plumbing (#1–5) over Felt polish (#7, #8) means the Storyteller's marketing story lags the Integrator's by one quarter. Acceptable because RN (Researcher) is our only committed consumer today.
- Deferring **Measurement persistence** until the KPI decision means O2 stays provisional for 8 weeks.
- Deferring **Groups + Styling** means the Storyteller cannot yet produce stakeholder-grade marked-up maps — they'll use screenshots + Figma overlays in the meantime.

## Seeds linkage

Tracked issues:
- `felt-like-it-e92e` (epic): #1, #3, #4, #5 via sub-seeds.
- `felt-like-it-a721` … `-b5dc` (H1–H7), `felt-like-it-135c` (M9): #2 bucket.
- `felt-like-it-8e8e`, `-4b0d`, `-da4a`, `-1c79`, `-d2d6` (F09–F14): #7.
- `felt-like-it-319b`, `-a38b`, `-bb9f` (N01–N03): #8 (deferred).

No seed exists yet for **#10 (versioning policy doc)** or **#9 (OpenAPI+SDK)** or **#6 (measurement persistence)** — these will be created on approval.

## Sources

- `product/strategy/research-cycle-01.md` — evidence
- `product/strategy/personas/*.md` — persona definitions
- `product/strategy/vision.md` — locked decisions
- `product/strategy/kpis.md` — KPI framework
- Live backlog: `sd ready` 2026-04-24
