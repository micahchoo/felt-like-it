# Audit: sveltekit-remote-functions

**Skill:** `~/.claude/plugins/cache/svelte-skills-kit/svelte-skills/1.3.0/skills/sveltekit-remote-functions/SKILL.md`
**Skill last-verified:** SvelteKit **2.58.0** (2026-04-24)
**Project:** `@sveltejs/kit ^2.15.1` (`apps/web/package.json:L?` — verified line `"@sveltejs/kit": "^2.15.1"`)
**Status:** experimental, requires `kit.experimental.remoteFunctions: true`

## Compatibility verdict

**INCOMPATIBLE without upgrade.** Remote functions require SvelteKit 2.58+; project is on `^2.15.1`. `svelte.config.js` has no `experimental.remoteFunctions` flag. Adopting remote functions today requires a minor-version bump (`^2.15` → `^2.58`) plus the experimental opt-in.

## Skill prescriptive force

Re-read of SKILL.md text: zero "must" / "required" claims. Strongest verbs: "**Prefer** `form()` over `command()` where progressive enhancement matters" (L79) and "Use `prerender()` for data that changes at most once per deployment" (L80). The skill **does not identify any pattern as mandatory**; everything is opt-in alternative to load functions / form actions / fetch routes. tRPC + tanstack-query is not called out as an anti-pattern.

## Findings

### F1 — LOW — Auth form actions are idiomatic, no migration needed
- `apps/web/src/routes/auth/signup/+page.server.ts:21` `export const actions`
- `apps/web/src/routes/auth/login/+page.server.ts:23`
- `apps/web/src/routes/auth/logout/+page.server.ts:5`
- `apps/web/src/routes/(app)/settings/+page.server.ts:71`
- `apps/web/src/routes/(app)/dashboard/+page.server.ts:97`
- Paired with `use:enhance` at `routes/auth/signup/+page.svelte:2,19` and `routes/auth/login/+page.svelte:2,19`.
- Skill guidance (L79): `form()` is preferred *over `command()`* — i.e. when you would otherwise fire a non-progressive event-handler mutation. Native form actions + `use:enhance` already deliver progressive enhancement; skill explicitly endorses them as the baseline (`sveltekit-data-flow` skill territory). No fix.

### F2 — LOW (missed-opportunity, not bug) — `<form onsubmit={handler}>` JS-only forms could become `form()`
- `lib/components/annotations/AnnotationForm.svelte:284`
- `lib/components/annotations/AnnotationPanel.svelte:423`
- `lib/components/annotations/AnnotationGroups.svelte:206`
- `lib/components/geoprocessing/GeoprocessingPanel.svelte:372`
- `lib/components/map/ShareDialog.svelte:273`
- `lib/components/map/LayerPanel.svelte:316`
- `lib/components/map/GuestCommentPanel.svelte:109`
- These submit through tRPC mutations via JS `onsubmit` — they break with JS disabled. Skill says "prefer `form()` where progressive enhancement matters" (SKILL.md:L79). Whether progressive enhancement matters here is a product decision: these are SPA-mode authenticated map UI panels (annotation/geoprocessing/share) gated behind a heavy MapLibre canvas that itself requires JS. Progressive enhancement is **not load-bearing for this surface**, so the skill's "where it matters" qualifier is not triggered.
- Code: e.g. `AnnotationGroups.svelte:206` — `<form class="mt-1 flex gap-1" onsubmit={handleCreate}>`.
- Fix: none required. If progressive enhancement is later prioritized for any panel, that specific form is a candidate for `form()` migration once SvelteKit ≥2.58.

### F3 — N/A — No `prerender = true` routes
- Grep found zero `export const prerender` or `prerender = true`. Skill's `prerender()` guidance (L80, "data that changes at most once per deployment") has no current target. No fix.

### F4 — LOW — tRPC reads as `query()` candidates
- tRPC + `@tanstack/svelte-query` powers all dynamic reads. Skill positions `query()` as an alternative, not a replacement. tRPC delivers end-to-end type-safety, batched links, and matching client-cache semantics — all behaviors `query()` provides individually but not as a unified system. No skill text classifies tRPC as wrong. No fix.

## Prior-finding reconciliation

Prior audit (`svelte-skills-audit.md` §7) flagged: "no `.remote.ts` files; tRPC + tanstack-query is the cross-tier mechanism by design. Not a bug, may be a missed opportunity."

**Confirmed.** Skill text does not contradict this. Two added constraints the prior audit missed:
1. **Version gate:** project SvelteKit `^2.15` is below the `2.58` floor — adoption is blocked on an upgrade, not just a stylistic choice.
2. **Experimental flag:** even after upgrade, requires `kit.experimental.remoteFunctions: true` plus `compilerOptions.experimental.async: true` for in-component `await`. Not free.

## Recommendation

No action required. If/when SvelteKit is upgraded to ≥2.58 and the team decides progressive-enhancement matters for a specific public-facing form (e.g. `GuestCommentPanel.svelte:109` — the only flow likely reachable by non-authenticated readers), revisit migrating that one form to `form()`. Defer everything else.
