# SvelteKit Structure Audit — felt-like-it

**Skill:** `sveltekit-structure` v2025-01-11
**Source root:** `apps/web/src`
**Date:** 2026-04-24
**Method:** Read-only, static. Skill + 5 references applied; route inventory + grep on naming/SSR/error/boundary primitives.

---

## Summary

3 layouts, 9 pages, 31 +server.ts endpoints, 2 hooks files. Idiomatic naming and route grouping. **One HIGH gap (no error boundaries anywhere)**, three LOW issues, prior audit findings confirmed.

---

## HIGH

### H1. Zero `+error.svelte`, zero `<svelte:boundary>`
- **Files:** entire `apps/web/src/routes/**` (verified: `find -name '+error.svelte'` → 0 results; `grep 'svelte:boundary' src/` → 0 results)
- **Skill rule:** `error-handling.md` — "`+error.svelte` must be _above_ the failing route in the hierarchy." `svelte-boundary.md` — component-level error catching with reset.
- **Violation:** When a `+page.server.ts` `load` throws (or a component subtree errors during render), SvelteKit falls back to its built-in default error page. No route-segment customization, no component-level recovery, no reset affordance for the user. With this app's surface area (auth, dashboard, map, share, embed, admin, 31 API routes) the default page is the user's only recourse for unexpected errors.
- **Note:** `hooks.server.ts:113` and `hooks.client.ts:8` define `handleError` (logging only — correct), and the root `+layout.svelte:46-49` registers `window.error`/`unhandledrejection` listeners (defense-in-depth). Neither replaces the missing UI boundary.
- **Fix:**
  1. `src/routes/+error.svelte` — global fallback (status, message, "go home"). Catches everything beneath root layout.
  2. `src/routes/(app)/+error.svelte` — authenticated-shell fallback that preserves nav.
  3. `src/routes/(public)/share/[token]/+error.svelte` and `(public)/embed/[token]/+error.svelte` — token-scoped (404/expired/revoked share-link UX is load-bearing for F13.3).
  4. Wrap the MapLibre/TerraDraw subtree inside `(app)/map/[id]/+page.svelte` in `<svelte:boundary>` with a `failed` snippet exposing `reset` — map stack is the most likely component-level crash site and a full route-level error there is harsh UX.

---

## MEDIUM

### M1. Root `+layout.svelte` swallows errors from its own error reporter — by design but not documented in a boundary
- **File:** `apps/web/src/routes/+layout.svelte:16-18` (`reportError` swallow comment), `:46-55` (window listeners)
- **Skill rule:** `svelte-boundary.md` "Error Tracking Integration" — boundaries pair with `onerror` handlers; bare `window.error` listeners don't catch render-phase errors that SvelteKit hydration absorbs.
- **Violation:** The root layout assumes `window.error` covers uncaught errors, but Svelte 5 component errors during hydration/render are caught by Svelte's own machinery and only surface to a `<svelte:boundary onerror>` or `+error.svelte` — not `window.error`. Coverage gap.
- **Fix:** Add `<svelte:boundary onerror={reportError}>` wrapping `{@render children()}` at line 61 (or rely on H1's `+error.svelte` files which receive errors via SvelteKit's own pipeline and can call the same reporter).

---

## LOW

### L1. No per-route SSR/CSR/prerender flags anywhere
- **Files:** `grep -E 'export const (ssr|csr|prerender|trailingSlash)' src/routes` → 0 results
- **Skill rule:** `ssr-hydration.md` — "Disable SSR (Not Recommended) … only when absolutely necessary (e.g., heavy Canvas/WebGL)."
- **Status:** Not a violation — defaults (SSR on, CSR on) are correct posture. Flagged only because `(app)/map/[id]/+page.svelte` mounts MapLibre (heavy WebGL) and hydration cost may be measurable. **Action:** none required; revisit if first-paint perf becomes an issue, then consider `export const ssr = false` scoped to that single route.

### L2. `(app)/settings/+page.svelte:36` uses `window.location.href` for navigation
- **File:** `apps/web/src/routes/(app)/settings/+page.svelte:36`
- **Skill rule:** `ssr-hydration.md` — `window` access in component bodies is OK (only runs client-side post-hydration), but full-page reload via `window.location.href` defeats SvelteKit's client navigation, drops query state, and bypasses hooks.
- **Fix:** `import { goto } from '$app/navigation'; await goto(result.location);` — preserves SPA semantics. (LOW because it's likely a logout/redirect path where a hard nav is acceptable; verify intent before changing.)

### L3. `<svelte:head>` placement — confirmed clean
- **Files:** 9 occurrences, all top-level inside `+page.svelte`. Skill rule satisfied.

### L4. Layout/page coverage gap: `(public)` group has no `+layout.svelte`
- **Files:** `routes/(public)/share/[token]/+page.svelte`, `(public)/embed/[token]/+page.svelte` — render directly under root `+layout.svelte`, which loads Toast/OfflineBanner/InstallPrompt/UpdateBanner.
- **Skill rule:** `layout-patterns.md` — "Layout Groups" pattern; embed/share are typically chrome-free.
- **Violation (mild):** Embedded share/embed views inherit toast + install-prompt UI from root layout. For an `<iframe>`-embedded map, install-prompt is jarring.
- **Fix:** Add `(public)/+layout.svelte` rendering only `{@render children()}` (a "reset" layout per `layout-patterns.md` Reset Layout). Move toast/banner UI to `(app)/+layout.svelte` so authed shell owns chrome.

---

## Prior-audit reconciliation

| Prior finding | Status | Evidence |
| --- | --- | --- |
| HIGH: zero `+error.svelte`, zero `<svelte:boundary>` | **CONFIRMED** | grep both returned 0 |
| LOW: duplicate `DataTable.svelte` | OUT OF SCOPE for this skill (component dup, not routing) | n/a |
| Clean: `<svelte:head>` top-level only | **CONFIRMED** | 9 occurrences, all top-level |
| Clean: route groups idiomatic | **CONFIRMED** | `(app)`/`(public)`/`auth` non-colliding; `auth` deliberately ungrouped (cleaner URL `/auth/login`) |
| Clean: adapter-node minimal | OUT OF SCOPE (adapter, not structure) | n/a |

---

## Skill-rule compliance (positive findings)

- **File naming:** all `+page.svelte`, `+page.server.ts`, `+layout.svelte`, `+layout.server.ts`, `+server.ts` — canonical. No `+page.ts` (universal load) — fine, every page uses server load.
- **`{@render children()}`:** all 3 layouts call it (`+layout.svelte:61`, `auth/+layout.svelte:11`, `(app)/+layout.svelte:15`). No layout swallows children.
- **Layout nesting depth:** max 2 (root → `(app)` or root → `auth`). `(app)/admin/+layout.server.ts` adds an auth-only server layout without a `+layout.svelte` — valid (server-only nested layout for `isAdmin` check).
- **Hooks:** `hooks.server.ts` exports `handle` (auth + request logging) and `handleError` (correct signature). `hooks.client.ts` exports `handleError` only. Both follow the skill's pattern.
- **Route groups:** no collisions — `(app)` and `(public)` have disjoint child paths; `auth` and `api` are real path segments.
- **Client-only imports in layouts:** root `+layout.svelte` accesses `window` only inside `onMount` (`:46-55`) — skill-compliant per `ssr-hydration.md` "Solution: Check for Browser → Option 2: onMount."

---

## Action checklist (priority order)

1. **[H1]** Add `+error.svelte` at root + `(app)` + `(public)/share/[token]` + `(public)/embed/[token]`.
2. **[H1]** Wrap MapLibre subtree in `<svelte:boundary>` inside `(app)/map/[id]/+page.svelte`.
3. **[L4]** Add `(public)/+layout.svelte` reset-layout; move toast/banner chrome into `(app)/+layout.svelte`.
4. **[M1]** Wire `reportError` to boundary `onerror` (not just `window.error`).
5. **[L2]** Verify `settings/+page.svelte:36` `window.location.href` intent; switch to `goto()` if SPA nav suffices.
