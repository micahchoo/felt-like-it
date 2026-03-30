# REST API v1 — Behavior (L8)

## 1. Request Flow: API Key Authentication

```
Client Request (Bearer flk_...)
  │
  ├──▶ hooks.server.ts: handle()
  │     ├─ Detects "Bearer flk_" prefix
  │     ├─ SHA-256 hash of raw key
  │     ├─ DB lookup: apiKeys WHERE keyHash = hash
  │     ├─ DB lookup: users WHERE id = keyRow.userId (+ disabledAt check)
  │     ├─ Sets event.locals.user (used by non-v1 routes)
  │     ├─ Fire-and-forget: UPDATE api_keys SET last_used_at = now()
  │     └─ resolve(event) → continues to route handler
  │
  ├──▶ Route handler (e.g. GET /api/v1/maps/:id)
  │     ├─ resolveAuth({ request, url })     ← v1 middleware (independent re-auth)
  │     │   ├─ Detects "Bearer flk_" again
  │     │   ├─ SHA-256 hash (same computation, second time)
  │     │   ├─ DB lookup: apiKeys (with scope)
  │     │   ├─ DB lookup: users (disabledAt check)
  │     │   ├─ Fire-and-forget: UPDATE last_used_at (second time)
  │     │   └─ Returns ApiAuth { userId, scope, mapScope: null }
  │     │
  │     ├─ rateLimit(auth)                   ← sliding window check
  │     ├─ assertMapAccess(auth, mapId)      ← mapScope check (no-op for API keys)
  │     ├─ requireMapAccess(userId, mapId, role) ← DB access check
  │     ├─ DB query (business logic)
  │     ├─ Serialize via toMapDetail/etc
  │     └─ envelope(data, meta, links) → jsonResponse()
  │
  └──▶ hooks.server.ts: request log
        └─ logger.info/warn/error with { method, path, status, ms }
```

**Observation**: The dual auth path means each API key request performs 2x DB lookups for the key and 2x DB lookups for the user. The `last_used_at` is also updated twice (fire-and-forget). This is redundant but not harmful -- the v1 middleware needs `scope` which the global hook does not extract.

## 2. Request Flow: Share Token Authentication

```
Client Request (?token=abc123)
  │
  ├──▶ hooks.server.ts: handle()
  │     ├─ No "Bearer flk_" in Authorization header
  │     ├─ Falls through to session cookie path
  │     ├─ No session cookie → event.locals.user = null
  │     └─ resolve(event)
  │
  ├──▶ Route handler
  │     ├─ resolveAuth({ request, url })
  │     │   ├─ No Bearer header → checks ?token query param
  │     │   ├─ DB lookup: shares WHERE token = token
  │     │   └─ Returns ApiAuth { userId: null, scope: 'read', mapScope: shareRow.mapId }
  │     │
  │     ├─ rateLimit(auth)                   ← keyed by "share:{mapId}", limit 30/s
  │     ├─ assertMapAccess(auth, mapId)      ← checks mapScope === mapId
  │     ├─ requireMapAccess SKIPPED           ← userId is null, only assertMapAccess runs
  │     └─ ... business logic ...
```

**Share tokens are read-only**: scope is always `read`, any POST/PATCH/DELETE returns 403.

## 3. GeoJSON Cache: Hit/Miss Flow

```
GET /api/v1/maps/:mapId/layers/:layerId/geojson?bbox=...&limit=...
  │
  ├─ Auth + rate limit (standard)
  ├─ Verify layer exists on map (DB query)
  │
  ├─ Build cache key: "${layerId}:${bbox ?? 'all'}:${limit}"
  ├─ getCachedGeoJSON(key)
  │
  ├── CACHE HIT (entry exists AND Date.now() <= expiresAt):
  │   ├─ Check If-None-Match header against cached ETag
  │   ├── ETag MATCH: → 304 Not Modified (empty body)
  │   └── ETag MISMATCH or no If-None-Match:
  │       → 200 with cached body, ETag, Cache-Control: private, max-age=10
  │
  └── CACHE MISS (no entry OR expired):
      ├─ Expired entry is deleted from Map
      ├─ DB query: COUNT(*) for totalFeatures
      ├─ DB query: SELECT id, ST_AsGeoJSON(geometry), properties
      │   (with optional ST_Intersects bbox filter, LIMIT applied)
      ├─ JSON.stringify the FeatureCollection
      ├─ setCachedGeoJSON(key, body):
      │   ├─ If cache.size >= 200 → delete first-inserted entry (FIFO)
      │   ├─ Generate ETag: md5(body).hex().slice(0, 16)
      │   └─ Store { body, etag, expiresAt: now + 30s }
      └─ 200 with body, ETag, X-Total-Features, Cache-Control: private, max-age=10
```

## 4. Error Handling: What the Client Sees

| Scenario | Status | Response Body |
|----------|--------|---------------|
| No credentials (no Bearer, no ?token) | 401 | `{ error: { code: "UNAUTHORIZED", message: "UNAUTHORIZED", status: 401 } }` |
| Invalid API key (hash not found) | 401 | Same as above (resolveAuth returns null) |
| Disabled user account | 401 | Same as above (resolveAuth returns null) |
| Read-scope key attempting POST | 403 | `{ error: { code: "FORBIDDEN", message: "FORBIDDEN", status: 403 } }` |
| Share token accessing wrong map | 404 | `{ error: { code: "MAP_NOT_FOUND", ... } }` |
| Map/layer/annotation/comment not found | 404 | Resource-specific code (MAP_NOT_FOUND, LAYER_NOT_FOUND, etc.) |
| Invalid JSON body | 422 | `{ error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } }` |
| Missing required field | 422 | `{ error: { code: "VALIDATION_ERROR", message: "<field> is required..." } }` |
| Annotation version conflict | 409 | `{ error: { code: "VERSION_CONFLICT", ... } }` |
| Rate limit exceeded | 429 | `{ error: { code: "RATE_LIMITED", message: "RATE_LIMITED" } }` |
| Uncaught exception (500) | 500 | Handled by `handleError` in hooks.server.ts: `{ message: "An unexpected error occurred" }` |

**Note**: 500 errors go through SvelteKit's `handleError`, not the v1 error catalog. The response shape differs (no `error.code` field).

## 5. Rate Limiting Behavior

**Algorithm**: Fixed-window counter (not sliding window despite the comment in code). Resets every 1 second.

| Auth Type | Key | Limit | Window |
|-----------|-----|-------|--------|
| API key | `userId` | 100 req/s (configurable via `API_RATE_LIMIT` env) | 1 second |
| Share token | `"share:{mapScope}"` | 30 req/s | 1 second |

**Implementation**: In-memory `Map<string, { count, resetAt }>`. Process-local, not distributed. Multiple server instances each have independent counters.

**On exceed**: Returns `toErrorResponse('RATE_LIMITED')` (429).

## 6. Endorheic Basins (Unbounded Growth Risks)

### GeoJSON Cache -- BOUNDED

The cache is bounded at 200 entries with FIFO eviction and 30s TTL. Maximum memory per entry is constrained by the `MAX_LIMIT` of 50,000 features per GeoJSON response. Worst case: 200 entries x large FeatureCollections. This could still be significant memory (hundreds of MB) if many distinct bbox+limit combinations are requested for layers with large features.

**Risk**: Medium. The 200-entry cap prevents unbounded growth, but there is no per-entry size limit. A layer with 50K features each having large `properties` objects could produce a cached entry in the tens-of-MB range.

### Rate Limit Counters -- UNBOUNDED

The `counters` Map in middleware.ts grows with each unique userId or share token and entries are never cleaned up. The `resetAt` field only resets the count, it does not delete the entry.

**Risk**: Low-Medium. Each entry is tiny (~50 bytes), but over long uptime with many distinct users, the Map grows without bound. In practice, this is likely thousands of entries (negligible), but there is no cleanup sweep.

### File Uploads -- DISK-BOUNDED ONLY

`POST /api/v1/files` writes to disk at `$UPLOAD_DIR` with no database tracking, no quota per user, and no cleanup mechanism. The 50MB per-file limit exists but there is no total storage limit.

**Risk**: Medium. Without per-user quotas or garbage collection, disk usage grows monotonically.

## 7. Concurrency and Consistency

- **Annotations**: Use optimistic concurrency via `version` field. PATCH sends current version, server rejects with 409 if mismatched.
- **Comments**: No concurrency control needed (append-only, no updates).
- **Features/GeoJSON**: Read-only in the v1 API. Feature writes happen through tRPC (internal app).
- **Cache**: No locking on the in-memory Map. Node.js single-threaded event loop makes this safe for a single process, but stale reads are possible between processes.
