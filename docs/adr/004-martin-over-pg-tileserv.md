# ADR 004 — Martin over pg_tileserv

**Status:** Accepted
**Date:** 2025-01
**Deciders:** Initial project setup

---

## Context

Felt Like It needs vector tile serving for PostGIS layers that exceed 10K features. At that scale, loading an entire GeoJSON payload into the browser is impractical — panning and zooming triggers full re-renders of thousands of features, and the initial transfer can exceed several MB.

Three options were evaluated:

1. **Martin** (MapLibre team) — Rust-based MVT tile server that auto-discovers PostGIS geometry tables.
2. **pg_tileserv** (CrunchyData) — Go-based tile server with CrunchyData-specific configuration model.
3. **Custom tile server** — Hand-rolled Node.js service generating MVT tiles via `ST_AsMVT`.

---

## Decision

Use the stock `ghcr.io/maplibre/martin` Docker image. Martin auto-discovers PostGIS geometry tables in the `public` schema and serves MVT vector tiles at `/table_name/{z}/{x}/{y}`.

---

## Rationale

### For Martin

1. **Zero configuration for table discovery.** Martin scans `public` schema geometry columns on startup and exposes them as tile endpoints automatically. No manifest file, no SQL function registration, no per-table config. Adding a new spatial table to the database makes it available as a tile source immediately.

2. **Same ecosystem as MapLibre GL JS.** Martin is maintained by the MapLibre organisation. The tile format, coordinate conventions, and metadata responses align with MapLibre GL JS expectations without compatibility shims.

3. **Single environment variable.** Martin accepts `DATABASE_URL` and starts serving. No application code to write, no middleware, no build step. The Docker Compose service definition is five lines.

4. **Rust performance.** Martin generates MVT tiles from PostGIS in single-digit milliseconds for typical viewport queries. Tile generation is CPU-bound (geometry clipping and simplification), and Rust's performance characteristics are well-suited for this workload.

### Against pg_tileserv

1. **CrunchyData-specific configuration.** pg_tileserv requires explicit function registration or configuration files for non-default table discovery. The configuration model is oriented toward CrunchyData's managed PostgreSQL service.

2. **Slower release cadence.** pg_tileserv releases are less frequent than Martin's, and the project has fewer active contributors.

3. **No MapLibre alignment.** pg_tileserv is ecosystem-agnostic, which means its metadata responses require adaptation for MapLibre-specific features like source attribution and tile bounds.

### Against custom tile server

1. **Unbounded maintenance burden.** Implementing `ST_AsMVT`-based tile generation, tile caching, coordinate system handling, and geometry simplification is non-trivial. Martin solves all of these out of the box.

2. **Performance ceiling.** A Node.js implementation cannot match Rust's throughput for CPU-bound tile generation without significant architectural complexity (worker threads, native modules).

---

## Consequences

- The project is tied to Martin's table-discovery convention: geometry columns must be in the `public` schema to be auto-discovered. Tables in other schemas require explicit Martin configuration.
- Layers exceeding 10K features automatically switch from `GeoJSONSource` to `VectorTileSource` on the client, using Martin's tile endpoint.
- Martin adds one container to the Docker Compose stack (Alpine-based, ~20 MB image).
- Set `PUBLIC_MARTIN_URL=""` in the environment to disable Martin integration entirely (all layers fall back to GeoJSON regardless of feature count).
- Martin does not support authentication. Tile endpoints are open to anyone who can reach the Martin port. In production, a reverse proxy must restrict access or Martin must be on an internal network.
