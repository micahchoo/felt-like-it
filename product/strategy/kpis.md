# KPIs — Cycle 01

Three-layer model per product-strategy skill. Baseline = today (pre-launch). Targets are 8–24 weeks post-launch. Each KPI names the persona it validates and the measurement mechanism.

## Outcome layer (user behaviour)

### O1 — Annotation Creation Rate

- **Persona:** Storyteller + Researcher.
- **Metric:** Count of annotation objects created (UI + REST), grouped by workspace, rolling 7d.
- **Baseline:** 0 (pre-launch).
- **Target:** ≥3 annotations / workspace / week at 8-week post-launch. Indicates non-pilot adoption.
- **Leading indicator:** Annotation-form completion events (UI); `POST /api/v1/maps/:mapId/annotations` success rate (REST).
- **Measurement method:** event table write on `POST /annotations` success + UI form telemetry.
- **Timeframe:** 8 weeks.
- **Why this matters:** behavioural proof that either UI or API is landing with at least one persona.

### O2 — Measurement Engagement on region anchors

- **Persona:** Researcher.
- **Metric:** % of region-anchored annotations that include measurement content; + % REST requests that carry measurement payloads.
- **Baseline:** ~0 (no UI persistence today; measurement is a UI-only toggle per bible §6 — **this KPI pressures us to persist it, which would serve the Researcher but not the Storyteller**).
- **Target:** ≥60% measurement adoption at 12 weeks **if** we commit to persisting measurement. If we match Felt and keep it UI-only, this KPI is dropped and replaced with O3.
- **Leading indicator:** `MeasurementPanel` open events; measurement content-type payloads on POST.
- **Decision required:** do we ship measurement persistence? Until then, treat O2 as provisional.

### O3 — API-driven adoption (Integrator validation)

- **Persona:** Integrator.
- **Metric:** % of create/update/delete operations that hit `/api/v1/*` rather than tRPC via UI; distinct API-key owners ("unique integrator apps") creating annotations.
- **Baseline:** 1 known consumer (RN) at launch.
- **Target:** ≥5 distinct integrator apps **and** ≥40% of writes through `/api/v1/*` by 24 weeks. Validates the platform play.
- **Leading indicator:** API-key creation rate; traffic split on the path prefix.
- **Measurement method:** request log grouped by prefix + `api_keys` table rowcount.

## Output layer (shipped features)

### Out1 — Felt-parity gap closure

- **Metric:** Count of shipped + tested Felt-parity features from `felt-like-it-e92e`: (1) name+description first-class, (2) groups/folders, (3) styling, (4) annotation↔layer conversion.
- **Baseline:** 0 / 4. **Target:** 4 / 4 by end of Q2 2026.
- **Leading indicator:** PRs merged closing sub-seeds `06b2` / `2e48` / `5179` / `41c9` + e2e coverage added per feature (expect +4 spec files).

### Out2 — REST API contract coverage

- **Metric:** Count of REST annotation endpoints with passing e2e + contract tests.
- **Baseline:** 28 / 28 marketing tests pass (`annotations-marketing.spec.ts`).
- **Target:** Maintain 100% + add a concurrency-focused spec covering stale-If-Match, idempotency-key replay, cross-tenant access. Must grow to match new endpoints shipped by Out1.
- **Leading indicator:** CI gate status (typecheck, lint, e2e already hard-gated per `.github/workflows/ci.yml`).

## Activity layer (operational)

### A1 — API p95 latency, annotation CRUD

- **Metric:** p95 latency in ms for `POST` / `PATCH` / `DELETE` `/api/v1/maps/:mapId/annotations*`.
- **Baseline estimation:** TRPC + Postgres single-tenant test ≈ 150–300 ms.
- **Target:** p95 ≤ 200 ms sustained under 10 concurrent users.
- **Leading indicator:** slow-query log; pg connection-pool contention.

## Source

- Proposed in `product/strategy/research-cycle-01.md §Q3`.
- Baselines from `STATE-annotation-ui-shadow.md` and `annotations-marketing.spec.ts`.
