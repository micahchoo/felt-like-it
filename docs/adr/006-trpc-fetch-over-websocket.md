# ADR 006 — tRPC Fetch adapter over trpc-sveltekit WebSocket

**Status:** Accepted
**Date:** 2025-01
**Deciders:** Phase 1 implementation review

---

## Context

The original architectural vision specified `trpc-sveltekit`, a community package that adds WebSocket transport to tRPC within SvelteKit. This would enable tRPC subscriptions for real-time features such as collaborative editing cursors and live layer updates.

During Phase 1 implementation, this decision was reconsidered. The only use case for WebSocket transport (concurrent document editing) was deferred to Phase 6. Meanwhile, `trpc-sveltekit` introduced dependency risk: it is a community-maintained package that must track breaking changes in both tRPC's adapter API and SvelteKit's server internals.

---

## Decision

Use the **tRPC 11 native Fetch adapter** mounted at `/api/trpc/[...trpc]/+server.ts`. No WebSocket transport is provided through tRPC. Real-time collaborative editing will use a separate Yjs WebSocket server in Phase 6.

---

## Rationale

### For tRPC Fetch adapter

1. **First-party support.** The Fetch adapter is maintained by the tRPC team as part of the core `@trpc/server` package. It will not break on tRPC minor/major upgrades independently of the framework adapter.

2. **Zero custom server configuration.** The Fetch adapter integrates with SvelteKit's `+server.ts` catch-all route. No custom Node.js HTTP server, no WebSocket upgrade handler, no `vite.config.ts` plugin. The entire integration is a single route file.

3. **Works with `adapter-node` out of the box.** SvelteKit's `adapter-node` produces a standalone HTTP server. The tRPC Fetch adapter runs inside SvelteKit's request handling — no additional ports, no separate process.

4. **Request context is standard.** The Fetch adapter receives SvelteKit's `RequestEvent`, making `event.locals` (where Lucia stores the session) directly available in `createContext`. No adapter-specific context wiring is needed.

### Against trpc-sveltekit

1. **Community package with uncertain tRPC 11 compatibility.** `trpc-sveltekit` must track breaking changes in tRPC's internal adapter API. A blocking incompatibility during a tRPC upgrade would prevent the project from receiving security patches.

2. **WebSocket complexity without a use case.** tRPC subscriptions require a persistent WebSocket connection per client. In Phases 1 through 5, no feature requires server-to-client push. Adding WebSocket infrastructure for unused capabilities increases surface area.

3. **Custom server requirement.** `trpc-sveltekit` with WebSocket transport requires a custom Vite plugin or a custom Node.js server to handle the WebSocket upgrade. This conflicts with the goal of a standard `adapter-node` deployment.

### Separate Yjs WebSocket for Phase 6

Real-time collaborative editing (the only confirmed WebSocket use case) will use Yjs's native WebSocket provider (`y-websocket`). Yjs has its own binary sync protocol optimised for CRDT document updates. Running this over tRPC subscriptions would add serialisation overhead and couple the CRDT layer to the RPC framework unnecessarily.

---

## Consequences

- No tRPC subscriptions are available. The server cannot push data to clients through tRPC. All client-side data freshness relies on polling or manual refetch.
- Import job progress uses client-side polling (`setInterval` calling `layers.getImportStatus`). This is adequate — progress updates every few seconds and polling adds negligible server load.
- Phase 6 will introduce a separate WebSocket server for Yjs CRDT sync. This server will run alongside the SvelteKit app (same process or sidecar) but will not share the tRPC router or context.
- If a future feature requires lightweight server-to-client push before Phase 6 (e.g., notification badges), Server-Sent Events (SSE) via a standard SvelteKit streaming endpoint would be the preferred approach over retrofitting tRPC subscriptions.
