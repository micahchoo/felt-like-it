# ADR 001 — SvelteKit over Next.js

**Status:** Accepted
**Date:** 2025-01
**Deciders:** Initial project setup

---

## Context

Felt Like It requires a server-rendered web framework to power its collaborative GIS editor. The primary candidates were SvelteKit and Next.js (App Router). Both are mature, support full-stack TypeScript, and have adapter-based deployment.

The application has specific requirements that influenced the decision:

- **Reactive map state**: The map editor requires fine-grained reactivity over a complex layer/feature data model. Frequent DOM reconciliation from re-renders would degrade map performance.
- **Form actions**: Auth flows (login, signup, settings) need progressive-enhancement-capable form handling without client-side JavaScript for the first interaction.
- **Bundle size**: MapLibre GL JS is already ~400 KB gzipped. Every additional KB of framework overhead compounds user load time.
- **Server load routes**: Per-route `load()` functions run on the server, making tRPC-via-server-side-call natural for initial page loads.

---

## Decision

Use **SvelteKit 2** with `adapter-node`, running **Svelte 5** with its runes system (`$state`, `$derived`, `$effect`).

---

## Rationale

### For SvelteKit

1. **Svelte 5 runes = fine-grained reactivity without VDOM.** Map state (viewport, layers, selected features) updates at 60fps. Svelte compiles away the overhead; React diffing is unsuitable for high-frequency map events.

2. **Smaller client bundle.** Svelte's compiler emits minimal runtime code. A baseline SvelteKit app ships ~30 KB of framework JS. React + Next.js starts at ~130 KB before any app code. Given the MapLibre payload, minimising total JS matters.

3. **Form actions are first-class.** SvelteKit `+page.server.ts` actions handle auth forms with zero client JS, providing progressive enhancement automatically. Next.js Server Actions add complexity in the App Router mental model.

4. **Simpler full-stack patterns.** `+page.server.ts` `load()` functions co-locate data fetching with pages. The tRPC `createContext(event)` pattern integrates naturally — `event.locals` is the canonical request context, not a separate auth provider hook.

5. **TypeScript integration.** SvelteKit generates `$types` per-route, giving strict typing for `load` return values and `Actions` without manual type wiring.

6. **`.svelte.ts` universal stores.** Svelte 5 allows reactive state in `.svelte.ts` files (not just `.svelte` components), making shared map/layer stores clean without Zustand/Jotai/Redux.

### Against Next.js

1. **VDOM overhead in map components.** React reconciles the entire component tree on state changes. Frequent map events (mousemove, zoom) would cause unnecessary re-renders across sibling components without aggressive memoisation.

2. **App Router complexity.** Next.js App Router's Server Components / Client Components boundary requires careful `'use client'` annotation. MapLibre (browser-only) and Terra Draw (browser-only) would require wrapping everything in client boundary components, adding boilerplate without benefit.

3. **Larger bundle.** `react` + `react-dom` is ~130 KB min+gzip before any app code. Combined with MapLibre, this substantially worsens initial load performance on mobile connections.

4. **No svelte-maplibre-gl.** The MIERUNE `svelte-maplibre-gl` library provides Svelte 5-native declarative layer composition (GeoJSONSource, CircleLayer, FillLayer). A React equivalent (`react-maplibre-gl`) exists but is less ergonomic for the reactive layer panel model required here.

---

## Consequences

- All developers must be familiar with Svelte 5 runes syntax, which differs significantly from Svelte 4 and from React.
- The `.svelte` template language is not JSX. LLM tooling and IDE support is slightly less mature than for React.
- Deployment uses `adapter-node` producing a standalone Node.js HTTP server. This is compatible with Docker and straightforward to run behind a reverse proxy (Nginx/Traefik).
- If the project later needs React Native mobile client, a separate React Native app would not share Svelte components. This is acceptable given the desktop-first GIS editor focus.
