# ADR 003 — UUID Primary Keys

**Status:** Accepted
**Date:** 2025-01
**Deciders:** Initial project setup

---

## Context

Every table in the application needs a primary key. The common options are:

| Option | Example | Notes |
|---|---|---|
| Serial integer | `1, 2, 3, …` | Simple; predictable; reveals row count |
| `BIGSERIAL` | `1, 2, 3, …` | Like above, 64-bit |
| UUID v4 | `a1b2c3d4-…` | Random; globally unique; no ordering |
| UUID v7 | `019487ab-…` | Time-ordered UUID; monotonically increasing |
| NanoID / CUID | `V1StGXR8_Z5j`… | Short; URL-safe; not standard SQL |

The application is a self-hosted single-tenant platform (one instance per team). It has:
- Share-via-link URLs that expose the map/layer/token IDs.
- A potential future multi-region replication or merge scenario.
- No current need for globally distributed ID generation.

---

## Decision

Use **UUID v4** (PostgreSQL `gen_random_uuid()`) as the primary key for all tables **except** `sessions`.

The `sessions` table uses a **text primary key** managed entirely by Lucia Auth.

---

## Rationale

### Security: IDs appear in URLs

Map IDs appear in `/map/{id}` URLs. Layer IDs appear in export URLs `/api/export/{layerId}`. Share tokens appear in share URLs `/share/{token}`.

If serial integers were used:
- An attacker can enumerate all maps/layers by incrementing the ID.
- The application has a SSRF-style vulnerability: a user who finds `map/3` can try `map/1`, `map/2`, etc. to find other users' maps.

UUID v4 IDs are 128-bit random values. They are not guessable. The authorization check (does `users.id == maps.user_id`?) remains the primary access control mechanism, but UUIDs add defence-in-depth.

### Simplicity vs. UUID v7

UUID v7 is time-ordered, which gives better B-tree index performance for insert-ordered workloads (new rows cluster at the end). However:
- PostgreSQL 16 does not have a native `gen_uuid_v7()` function (added in PostgreSQL 17).
- Drizzle ORM's `uuid().defaultRandom()` uses PostgreSQL's `gen_random_uuid()` (v4).
- The current write volume (a few thousand features per import job) does not justify index fragmentation concerns.
- UUID v7 adoption in tooling (ORMs, client libraries) is still uneven.

UUID v4 with `gen_random_uuid()` is simpler, standard, and sufficient for Phase 1-3 scale.

### Drizzle ORM native support

Drizzle's `uuid()` column type maps directly to PostgreSQL's `uuid` type, and `.defaultRandom()` emits `DEFAULT gen_random_uuid()`. No extension is required (unlike `uuid-ossp`). The `@types/uuid` package and `crypto.randomUUID()` in Node.js produce compatible values for application-side ID generation (seed script, tests).

### Sessions exception: Lucia manages session IDs

Lucia v3 generates its own session IDs as opaque strings (currently base32-encoded random bytes). The `DrizzlePostgreSQLAdapter` requires the sessions table `id` column to be `text`, not `uuid`. Changing this would require forking Lucia's ID generation. The trade-off is acceptable: session IDs are never exposed in URLs, are always validated server-side by Lucia, and are short-lived.

---

## Consequences

- All `INSERT` statements must either rely on `DEFAULT gen_random_uuid()` (database-generated) or supply a `crypto.randomUUID()` value (application-generated). There is no auto-increment to fall back on.
- Join queries on UUID columns are slightly slower than integer joins due to wider key size. This is negligible at the expected data volumes (tens of thousands of features per map, not billions).
- UUID values are less human-readable than integers. Log messages and debug output include 36-character strings. This is a minor usability inconvenience, mitigated by always logging alongside meaningful context (e.g., map title, user email).
- The `sessions` table `id` is `text` not `uuid`. Code that joins `sessions` to other tables must not assume UUID format for `sessions.id`.
- Future migration to UUID v7 is possible: a new migration can `ALTER TABLE ... ALTER COLUMN id SET DEFAULT gen_uuid_v7()` once PostgreSQL 17+ is in use without changing application code.
