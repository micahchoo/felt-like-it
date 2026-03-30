<!-- Verified accurate as of 2026-03-29 -->
# API + Auth Cluster — Components & Security

## Auth Architecture

### Session Auth (tRPC)
- **Library:** Lucia v3 + @lucia-auth/adapter-drizzle → PostgreSQL
- **Flow:** hooks.server.ts validates every request via lucia.validateSession() → event.locals.user/session → tRPC context
- **Cookie:** sameSite: lax, secure conditional on HTTPS
- **Password:** @node-rs/argon2 (native Rust)

### API Key Auth (REST v1)
- **Format:** `flk_<64-hex>` (68 chars). Only SHA-256 hash stored.
- **Flow:** resolveAuth() per-handler → hash incoming key → lookup keyHash → check disabledAt → fire-and-forget lastUsedAt
- **Scope:** `'read' | 'read-write'` (text column, no DB constraint)

## tRPC Router Structure

~47 procedures across 12 routers:

| Router | Count | Auth |
|--------|-------|------|
| maps | 9 | protected |
| layers | 5 | protected |
| features | 3 | protected |
| shares | 4 | 3 protected + 1 public |
| comments | 6 | 4 protected + 2 public |
| collaborators | 4 | protected |
| geoprocessing | 1 | protected |
| annotations | 5 | protected |
| apiKeys | 3 | protected |
| events | 2 | protected |
| auditLog | 2 | protected (verify has inline isAdmin check) |
| admin | varies | adminProcedure |

Three tiers: `publicProcedure`, `protectedProcedure`, `adminProcedure`

## REST v1 Endpoints

All require resolveAuth() (Bearer API key or ?token share token):

```
/api/v1/files, /api/v1/files/[id]
/api/v1/maps, /api/v1/maps/[mapId]
/api/v1/maps/[mapId]/annotations, .../annotations/[id]
/api/v1/maps/[mapId]/comments, .../comments/[id]
/api/v1/maps/[mapId]/layers, .../layers/[layerId]
/api/v1/maps/[mapId]/layers/[layerId]/features
/api/v1/maps/[mapId]/layers/[layerId]/geojson
/api/v1/maps/[mapId]/layers/[layerId]/tiles
```

## Audit Log

- Hash chain: `SHA-256(JSON.stringify(content) + prevHash)`, GENESIS_HASH = '0'×64
- Serialized via `pg_advisory_xact_lock(1)` (single global lock)
- Verification: reads all rows, recomputes hashes, reports firstInvalidSeq
- Errors swallowed (fire-and-forget callers)

## Security Findings (Verified via Deep Drill)

### Disproved (initially flagged, verified as safe)

| Finding | Verdict | Evidence |
|---------|---------|----------|
| Disabled user retains tRPC access | **SAFE** | `hooks.server.ts` checks `disabledAt` upstream; invalidates session + sets `locals.user = null` before any tRPC procedure runs |
| No session invalidation on disable | **SAFE** | `admin.toggleDisabled` calls `lucia.invalidateUserSessions(userId)` when disabling |
| REST v1 missing resolveAuth() | **SAFE** | All 13 route files call `resolveAuth()` at top of every handler — 100% coverage |

### Confirmed

| Finding | Severity | Detail |
|---------|----------|--------|
| **auditLog.verify: inline isAdmin** | Low | Uses protectedProcedure + manual `isAdmin` guard instead of `adminProcedure`. Functionally correct but structurally inconsistent. |
| **Public tRPC procedures have no rate limiting** | Medium | `comments.listForShare` and `comments.createForShare` are `publicProcedure` with no IP-based rate limiting. REST v1 has `rateLimit()` but tRPC does not. |
| **API key scope: no DB constraint** | Medium | scope is text with no CHECK constraint. Invalid values silently pass. |
| **Rate limiter: in-memory only** | Medium | Resets on restart, doesn't work with horizontal scaling. |
| **API keys: no per-map scoping** | Low | Single key grants access to ALL user's maps. |
| **Audit lock bottleneck** | Low | Advisory lock key=1 serializes all audit writes globally. |

### Auth Flow (verified)

```
Every request → hooks.server.ts:
  1. lucia.validateSession(cookie)
  2. If user.disabledAt set → lucia.invalidateSession() → locals.user = null
  3. tRPC protectedProcedure checks ctx.user !== null → UNAUTHORIZED if null
  → Disabled users are correctly blocked at the hooks layer
```

**See also:** [subsystems](../subsystems.md)
