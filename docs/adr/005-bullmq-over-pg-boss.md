# ADR 005 — BullMQ over pg-boss

**Status:** Accepted
**Date:** 2025-01
**Deciders:** Initial project setup

---

## Context

Felt Like It supports importing geospatial files (GeoJSON, CSV, Shapefile, KML, GPX, GeoPackage) into PostGIS layers. File imports are long-running operations — parsing a 50 MB Shapefile, reprojecting geometries, and batch-inserting features can take tens of seconds. This work must happen in a background job queue, not in the HTTP request cycle.

Two options were evaluated:

1. **BullMQ** (Redis-backed) — TypeScript-first job queue built on Redis streams.
2. **pg-boss** (PostgreSQL-backed) — Job queue that uses PostgreSQL tables for persistence and `SKIP LOCKED` for job dispatch.

---

## Decision

Use **BullMQ 5** with **ioredis** and **Redis 7** as the job queue infrastructure. The worker process runs as a separate Node.js service (`services/worker`).

---

## Rationale

### For BullMQ

1. **Battle-tested at scale.** BullMQ is widely deployed in production Node.js systems. Its Redis-streams-based architecture has well-understood performance characteristics and failure modes.

2. **Retry and backoff control.** BullMQ provides configurable retry strategies with exponential backoff out of the box. Import jobs that fail due to transient database contention or OOM can retry with increasing delays without custom logic.

3. **Sub-millisecond job dispatch.** Redis `XADD`/`XREADGROUP` delivers jobs to workers with negligible latency. Import jobs are throughput-sensitive — batch INSERTs of 500 features per chunk benefit from fast job-to-worker handoff.

4. **Dashboard ecosystem.** Bull Board provides a ready-made web UI for inspecting queued, active, completed, and failed jobs. This is valuable for debugging import failures in development and production.

5. **Backpressure handling.** BullMQ's concurrency limiter and rate limiter prevent the worker from overwhelming PostgreSQL with concurrent batch INSERTs. pg-boss has no equivalent built-in mechanism.

### Against pg-boss

1. **Simpler infrastructure** (fewer moving parts — only PostgreSQL, no Redis) is pg-boss's primary advantage. However, this project already benefits from Redis for other reasons (session store and future Yjs pub/sub in Phase 6).

2. **Slower dispatch.** pg-boss uses `SELECT ... FOR UPDATE SKIP LOCKED` polling with a configurable interval (default 2 seconds). This adds latency between job creation and worker pickup that is noticeable in the import progress UI.

3. **Limited retry control.** pg-boss supports retries but with less granular configuration than BullMQ's per-job backoff strategies.

4. **No built-in dashboard.** Inspecting job state requires direct SQL queries against pg-boss's internal tables.

---

## Consequences

- Redis 7 is added to the Docker Compose stack. This is an acceptable tradeoff — the Redis Alpine image uses ~5 MB of memory at idle and will also serve as a session/cache store when Phase 6 adds Yjs WebSocket pub/sub.
- The worker runs as a separate `services/worker` Node.js process. It must be started independently (`pnpm --filter @felt-like-it/worker dev`) or via Docker Compose.
- Job progress is communicated to the client via polling (`layers.getImportStatus` tRPC query). There is no server-push mechanism for job updates — this is adequate for the import use case where progress updates every few seconds.
- If Redis becomes unavailable, job dispatch stops entirely. Import requests will fail until Redis recovers. PostgreSQL data is unaffected.
