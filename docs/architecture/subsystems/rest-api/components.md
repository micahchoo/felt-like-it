# REST API v1 — Components (L5)

## File Map

```
apps/web/src/
├── hooks.server.ts                          # Global SvelteKit hook — dual auth (API key + session)
├── routes/api/v1/
│   ├── middleware.ts                        # resolveAuth, rateLimit, envelope, jsonResponse, requireScope, assertMapAccess, stripNullBytes
│   ├── errors.ts                           # ErrorCodes catalog + toErrorResponse()
│   ├── maps/
│   │   ├── +server.ts                      # GET /maps (list, paginated)
│   │   └── [mapId]/
│   │       ├── +server.ts                  # GET /maps/:id (detail)
│   │       ├── layers/
│   │       │   ├── +server.ts              # GET /maps/:id/layers (list)
│   │       │   └── [layerId]/
│   │       │       ├── +server.ts          # GET /maps/:id/layers/:id (detail)
│   │       │       ├── features/+server.ts # GET (paginated feature list)
│   │       │       ├── geojson/+server.ts  # GET (full FeatureCollection, cached)
│   │       │       └── tiles/+server.ts    # GET (TileJSON metadata)
│   │       ├── annotations/
│   │       │   ├── +server.ts              # GET (list) / POST (create)
│   │       │   └── [id]/+server.ts         # GET / PATCH / DELETE
│   │       └── comments/
│   │           ├── +server.ts              # GET (list) / POST (create)
│   │           └── [id]/+server.ts         # GET (detail, read-only)
│   └── files/
│       ├── +server.ts                      # POST (upload)
│       └── [id]/+server.ts                # GET (download)
└── lib/server/api/
    ├── serializers.ts                      # toMapSummary, toMapDetail, toLayerSummary, toLayerDetail, toAnnotation, toComment, toFeatureSummary
    ├── pagination.ts                       # encodeCursor, decodeCursor, parsePaginationParams
    ├── links.ts                            # mapLinks, layerLinks, annotationLinks, commentLinks, listLinks (HATEOAS)
    └── geojson-cache.ts                    # In-memory FIFO cache (Map<string, CacheEntry>)
```

## Component Inventory

### 1. Middleware (`routes/api/v1/middleware.ts`)

| Export | Purpose |
|--------|---------|
| `resolveAuth(event)` | Resolves `ApiAuth` from Bearer key or `?token` share token |
| `requireScope(auth, required)` | Throws if auth scope insufficient |
| `assertMapAccess(auth, mapId)` | Throws if share token scoped to a different map |
| `rateLimit(auth)` | Returns 429 Response if over limit, null if OK |
| `envelope(data, meta, links)` | Wraps response in `{ data, meta, links }` |
| `jsonResponse(body, status)` | Creates JSON Response with correct Content-Type |
| `stripNullBytes(value)` | Recursively removes `\0` from strings (PostgreSQL safety) |

### 2. Error Catalog (`routes/api/v1/errors.ts`)

| Code | HTTP | Usage |
|------|------|-------|
| `UNAUTHORIZED` | 401 | No credentials provided or invalid key/token |
| `FORBIDDEN` | 403 | Scope insufficient (e.g. `read` scope attempting write) |
| `MAP_NOT_FOUND` | 404 | Map does not exist or user lacks access |
| `LAYER_NOT_FOUND` | 404 | Layer not on map |
| `ANNOTATION_NOT_FOUND` | 404 | Annotation not found or wrong map |
| `COMMENT_NOT_FOUND` | 404 | Comment not found or wrong map |
| `FILE_NOT_FOUND` | 404 | Uploaded file not found |
| `VALIDATION_ERROR` | 422 | Invalid input (JSON parse, missing fields) |
| `LIMIT_EXCEEDED` | 422 | Resource limit exceeded |
| `VERSION_CONFLICT` | 409 | Optimistic concurrency conflict (annotations) |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `INTERNAL_ERROR` | 500 | Uncaught server error |

### 3. Serializers (`lib/server/api/serializers.ts`)

Six serializer functions normalize dual-casing (snake_case SQL rows vs camelCase Drizzle results):

- `toMapSummary` / `toMapDetail` (adds `viewport`)
- `toLayerSummary` / `toLayerDetail` (adds `style`, `sourceFileName`)
- `toAnnotation` (anchor, content, parentId, templateId, version)
- `toComment` (body, resolved, authorName)
- `toFeatureSummary` (id, geometryType, properties, createdAt)

All carry `// TYPE_DEBT` — accept `any` due to dual-casing fallback pattern.

### 4. Pagination (`lib/server/api/pagination.ts`)

Cursor-based pagination using `(createdAt, id)` composite cursor encoded as base64url.

- `parsePaginationParams(url)`: reads `?cursor` and `?limit` (default 20, max 100)
- `encodeCursor(createdAt, id)`: produces opaque cursor string
- `decodeCursor(cursor)`: returns `{ createdAt, id }` or null

### 5. HATEOAS Links (`lib/server/api/links.ts`)

All responses include `links` object with navigable URLs:

- `mapLinks(mapId)`: `{ self, layers, annotations, comments }`
- `layerLinks(mapId, layerId)`: `{ self, geojson, features, tiles, map }`
- `annotationLinks(mapId, annotationId)`: `{ self, map }`
- `commentLinks(mapId, commentId)`: `{ self, map }`
- `listLinks(basePath, nextCursor, extra)`: `{ self, next? }`

### 6. GeoJSON Cache (`lib/server/api/geojson-cache.ts`)

In-memory cache for GeoJSON FeatureCollection responses.

- **Storage**: `Map<string, CacheEntry>` (process-local, not shared across instances)
- **Key**: `${layerId}:${bbox ?? 'all'}:${limit}`
- **TTL**: 30 seconds
- **Max entries**: 200 (FIFO eviction, not LRU)
- **ETag**: MD5 hash of body, truncated to 16 hex chars

### 7. Dual Auth System (`hooks.server.ts` + `middleware.ts`)

Two parallel auth paths exist:

| Layer | Bearer API Key | Share Token |
|-------|---------------|-------------|
| **Global hook** (`hooks.server.ts`) | Resolves `Bearer flk_*` -> sets `event.locals.user` | Not handled |
| **v1 middleware** (`middleware.ts`) | Resolves `Bearer flk_*` -> returns `ApiAuth` | Resolves `?token` -> returns `ApiAuth` |
| **Identity** | `{ userId, scope, mapScope: null }` | `{ userId: null, scope: 'read', mapScope }` |

The v1 middleware performs its own independent auth resolution, not relying on `event.locals` from the global hook. Both paths hash the key with SHA-256 and look up `apiKeys.keyHash`.
