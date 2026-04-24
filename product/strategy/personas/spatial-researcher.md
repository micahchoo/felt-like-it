# Persona — Spatial Researcher

**Archetype:** Researcher composing collaborative, narrated analyses over geospatial data. Our canonical reference consumer: the Research-Narratives (RN) project.

**Primary job-to-be-done:** Layer annotations and contextual metadata over geospatial data **without leaving the analysis flow**. The map is a notebook page, not a destination.

## Current tools / workarounds

- Narrative host + Supabase for object storage; GeoJSON fetch by URL; MapLibre for rendering.
- Manual coordination across three systems (narrative, storage, map canvas).
- No first-class spatial API — RN today tightly couples to Supabase schema.

## Pain points (cited)

- RN depends on Supabase for file storage, a `nodes_1` table for research map state, and GeoJSON fetch by URL. `~/.claude/projects/-mnt-Ghar-2TA-DevStuff-felt-like-it/memory/project_rn_interop.md`
- Cannot swap spatial backends — no public REST API available from competitors (Felt, Google My Maps). `product/strategy/research-cycle-01.md §Q2`
- Measurement + annotation state not co-managed. `product/strategy/research-cycle-01.md §Q1-P1`

## Switch trigger

FLI's `/api/v1/` becomes stable and documented. RN decouples from Supabase and uses FLI as canonical spatial data backend.

## Design implications (evidence-backed)

- REST API must expose annotation CRUD **and** measurement state atomically. Today measurement is UI-only per bible §6 — a gap for this persona.
- Cursor-based pagination must work for non-UI consumers even when the UI doesn't use it. Server-side cursor ships today; consumers can rely on it.
- `feature`-anchored annotations (our extension beyond Felt) map cleanly to RN's "this note is about this layer feature" use case. Keep and document as ours, not Felt's.
- Bulk operations (reorder, batch-update) become first-class once RN starts authoring programmatically.

## What this persona does NOT ask for

- Visual styling polish (stroke dashes, text caps). That's the Storyteller's ask.
- Pagination UI or group folders inside the FLI panel — RN's own UI is where the reader lives.

## Source

- `project_rn_interop.md` — memory file
- `BIBLE-SPEC.md` §6 (measurement as UI-only toggle)
- `STATE-annotation-ui-shadow.md` — "Where we diverged from Felt"
- `research-cycle-01.md` §Q1 Persona 1
