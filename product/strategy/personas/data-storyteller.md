# Persona — Data Storyteller

**Archetype:** Non-GIS stakeholder who marks up a map for a one-off communication — a report, a briefing, a client review. The Felt native.

**Primary job-to-be-done:** Create one-off spatial annotations and markup on maps for stakeholder communication **without learning a GIS layer data model**.

## Current tools / workarounds

- Felt, Google My Maps, or PowerPoint over a map screenshot.
- Quick pin/line/polygon drawing with a flat attribute panel.
- No templating or multi-step workflows — each annotation is a throwaway.

## Pain points (cited)

- Felt's model is flat key-value attributes (no template authoring). `docs/felt-annotations/BIBLE-SPEC.md §2`
- "Annotations are best for creating one-off data or storytelling" — layer conversion is a one-way escape hatch. `BIBLE-SPEC.md §6`
- Lists stay <500 items in practice — no pagination affordance. `BIBLE-SPEC.md §3` / `STATE-annotation-ui-shadow.md` Promise 12
- Our current UI does not expose styling (stroke width, dash, opacity, text style, show-label, endcaps) — the Storyteller's main lever for clarity.

## Switch trigger

FLI ships Felt-aligned annotation UI (12/14 promises closed) **and** closes the remaining 4 parity gaps (styling, groups, name+description first-class, annotation↔layer conversion). See the epic `felt-like-it-e92e`.

## Design implications

- Prioritize **visual polish** over API completeness: styling panel, groups/folders, name+description above everything else.
- Groups are the organizing primitive, not tags or search (per bible).
- Measurement stays a UI toggle — do not persist or require it. Persisting it would serve the Researcher, not the Storyteller.
- Keep the UI surface small and obvious: one Name field, one Description, one anchor type, one content body. Templates are not the Storyteller's ask.

## What this persona does NOT ask for

- REST API, versioning, or If-Match.
- Threaded replies (Felt doesn't have them; Storytellers use Slack or email).
- IIIF or slotted content — Felt doesn't expose it, users don't expect it.

## Source

- `BIBLE-SPEC.md` §2, §3, §6
- `STATE-annotation-ui-shadow.md` — "Felt-surface gaps"
- `research-cycle-01.md` §Q1 Persona 2
