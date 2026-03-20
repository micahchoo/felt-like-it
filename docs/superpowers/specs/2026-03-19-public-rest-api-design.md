# Public REST API v1 Design Spec

> FLI exposes a public REST API that lets external apps (narrative layers, research tools, dashboards, embeds) consume spatial data, annotations, and collaboration features without coupling to FLI's internal tRPC surface.

## Context

Research-Narratives (RN) and similar apps add narrative, canvas, or storytelling layers on top of spatial data. Today they depend on Supabase or bespoke backends. FLI already stores the spatial data, annotations, and collaboration state these apps need — it just lacks a public API.

This spec defines a standalone REST API surface alongside FLI's existing tRPC layer. Routes call FLI's existing services directly (Approach 2 — no tRPC adapter, no tRPC replacement).

### Referenced Documents

- `apps/web/src/lib/server/annotations/service.ts` — annotation CRUD service
- `apps/web/src/lib/server/geo/access.ts` — `requireMapAccess` authorization helper
- `apps/web/src/lib/server/db/schema.ts` — DB table definitions
- `apps/web/src/hooks.server.ts` — existing Bearer auth + session resolution
- `docs/ARCHITECTURE.md` — system architecture
- `docs/ROADMAP.md` — feature status by phase
- `docs/reference/api.md` — existing tRPC procedure reference

---

## 1. Resource Model & URL Structure

All endpoints under `/api/v1/`. Maps are the top-level scope.

### Read Endpoints

```
GET  /api/v1/maps                                    # list maps accessible to this key
GET  /api/v1/maps/:mapId                             # map detail
GET  /api/v1/maps/:mapId/layers                      # list layers
GET  /api/v1/maps/:mapId/layers/:layerId             # layer detail
GET  /api/v1/maps/:mapId/layers/:layerId/geojson     # GeoJSON FeatureCollection
GET  /api/v1/maps/:mapId/layers/:layerId/features    # paginated feature rows
GET  /api/v1/maps/:mapId/layers/:layerId/tiles       # Martin tile URL info
GET  /api/v1/maps/:mapId/annotations                 # list annotations
GET  /api/v1/maps/:mapId/annotations/:id             # single annotation
GET  /api/v1/maps/:mapId/comments                    # list comments
GET  /api/v1/maps/:mapId/comments/:id                # single comment
```

### Write Endpoints (annotations + comments only)

```
POST   /api/v1/maps/:mapId/annotations               # create annotation
PATCH  /api/v1/maps/:mapId/annotations/:id            # update annotation
DELETE /api/v1/maps/:mapId/annotations/:id            # delete annotation
POST   /api/v1/maps/:mapId/comments                   # create comment
```

### File Endpoints

```
POST   /api/v1/files                                  # upload file, returns public URL
GET    /api/v1/files/:id                              # retrieve / download
```

### Design Rationale

- **Maps are the top-level scope** — everything hangs off a map, matching FLI's data model.
- **GeoJSON and features are separate endpoints** on the same layer — GeoJSON for rendering (hand directly to MapLibre), features for data inspection (tables, search, attributes).
- **Tiles endpoint returns the Martin URL** rather than proxying tiles — keeps FLI out of the tile-serving hot path.
- **Files are map-independent** — uploaded once, referenced from annotations on any map.

---

## 2. Auth & Access Control

Two-tier model composing FLI's existing primitives.

### API Key Auth (app-level)

```
Authorization: Bearer flk_<64hex>
```

- Resolves to a FLI user via existing `apiKeys` table + SHA-256 lookup.
- Inherits that user's map access (owns their maps, collaborator roles on shared maps).
- New `scope` field on API keys: `read` or `read-write`.

### Share Token Auth (map-level, anonymous)

```
GET /api/v1/maps/:mapId/layers?token=<share_token>
```

- Uses existing `shares` table (`access_level`: public/unlisted).
- Always read-only. No writes, no annotation creation.
- Only accesses the single map the token was issued for.
- No API key required.
- **Access path:** Share tokens bypass `requireMapAccess` entirely. Instead, `resolveAuth` validates the token against the `shares` table (`SELECT map_id FROM shares WHERE token = $1`), confirms the `mapId` in the URL matches the token's `map_id`, and returns a synthetic auth context: `{ userId: null, scope: 'read', mapScope: mapId }`. Route handlers check `auth.mapScope` — if set, the request is locked to that single map and skips `requireMapAccess`.

### Resolution Order (middleware)

1. Check `Authorization: Bearer` header -> API key path.
2. Check `?token=` query param -> share token path.
3. Neither -> `401 Unauthorized`.

### Scope Matrix

| Operation | API key `read` | API key `read-write` | Share token |
|---|---|---|---|
| List/get maps, layers, features, GeoJSON | yes | yes | yes (single map) |
| List/get annotations, comments | yes | yes | yes |
| Create/update/delete annotations | no | yes | no |
| Create comments | no | yes | no |
| Upload files | no | yes | no |

### Rate Limiting

- Per API key: 100 req/s (configurable via `API_RATE_LIMIT` env var).
- Per share token: 30 req/s.
- Returns `429 Too Many Requests` with `Retry-After` header.
- **Storage:** In-memory sliding window counter for single-instance deployments. FLI already runs Redis for BullMQ — if multi-instance deployment is needed, swap to Redis-backed counters using the existing `ioredis` connection. Rate limiting is implemented in `middleware.ts` and called from each route handler, not as a SvelteKit hook.

---

## 3. Response Envelope & Shapes

### Envelope

Every response (except GeoJSON) wraps in:

```json
{
  "data": {},
  "meta": {},
  "links": {}
}
```

### Pagination

Cursor-based on all list endpoints. Query params: `?cursor=<opaque>&limit=20` (max 100, default 20).

```json
{
  "meta": { "totalCount": 342, "limit": 20, "nextCursor": "abc123" },
  "links": { "self": "...", "next": "...?cursor=abc123" }
}
```

**Implementation notes:**
- `totalCount` is the total number of matching items across all pages. Computed via a parallel `COUNT(*)` query.
- Per-endpoint behavior: maps, layers, annotations, comments always include `totalCount` (small cardinality). Features sets `totalCount: null` when `?where` or `?bbox` filters are applied (spatial count is expensive); unfiltered feature lists include the count (uses the cached `featureCount` on the layer record).
- Cursor encodes `createdAt` (ISO 8601) + `id` (UUID) as a base64 string. The composite key avoids ambiguity when multiple rows share the same `createdAt` timestamp. Consumers must treat cursor values as opaque — the encoding is not part of the API contract and may change.

### GET /api/v1/maps (list)

```json
{
  "data": [
    {
      "id": "uuid",
      "title": "SF Parks Analysis",
      "description": "...",
      "basemap": "osm",
      "createdAt": "2026-03-01T...",
      "updatedAt": "2026-03-18T..."
    }
  ],
  "meta": { "totalCount": 12, "limit": 20, "nextCursor": null },
  "links": { "self": "/api/v1/maps" }
}
```

Omits `viewport` from list items for brevity. Use the single-map endpoint for full detail.

### GET /api/v1/maps/:mapId

```json
{
  "data": {
    "id": "uuid",
    "title": "SF Parks Analysis",
    "description": "...",
    "basemap": "osm",
    "viewport": { "center": [-122.4, 37.7], "zoom": 12 },
    "createdAt": "2026-03-01T...",
    "updatedAt": "2026-03-18T..."
  },
  "links": {
    "self": "/api/v1/maps/:mapId",
    "layers": "/api/v1/maps/:mapId/layers",
    "annotations": "/api/v1/maps/:mapId/annotations",
    "comments": "/api/v1/maps/:mapId/comments"
  }
}
```

### GET /api/v1/maps/:mapId/layers/:layerId

```json
{
  "data": {
    "id": "uuid",
    "mapId": "uuid",
    "name": "Parks",
    "type": "polygon",
    "featureCount": 1247,
    "style": { "version": 1, "config": {} },
    "visible": true,
    "zIndex": 2,
    "sourceFileName": "sf-parks.geojson"
  },
  "links": {
    "self": "/api/v1/maps/:mapId/layers/:layerId",
    "geojson": "/api/v1/maps/:mapId/layers/:layerId/geojson",
    "features": "/api/v1/maps/:mapId/layers/:layerId/features",
    "tiles": "/api/v1/maps/:mapId/layers/:layerId/tiles",
    "map": "/api/v1/maps/:mapId"
  }
}
```

### GET /api/v1/maps/:mapId/layers (list)

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Parks",
      "type": "polygon",
      "featureCount": 1247,
      "visible": true,
      "zIndex": 2
    }
  ],
  "meta": { "totalCount": 5, "limit": 20, "nextCursor": null },
  "links": { "self": "/api/v1/maps/:mapId/layers", "map": "/api/v1/maps/:mapId" }
}
```

List items omit `style` and `sourceFileName` for brevity. Use the single-layer endpoint for full detail.

### GET /api/v1/maps/:mapId/layers/:layerId/geojson

**No envelope.** Returns bare GeoJSON with `Content-Type: application/geo+json`.

Filters via query params:

```
?where=population>10000&bbox=-122.5,37.7,-122.3,37.8&limit=5000
```

Consumable directly by `map.addSource({ type: "geojson", data: response })`.

### GET /api/v1/maps/:mapId/layers/:layerId/tiles

```json
{
  "data": {
    "tilejson": "3.0.0",
    "tileUrl": "https://martin.example.com/layers/{layerId}/{z}/{x}/{y}.pbf",
    "minzoom": 0,
    "maxzoom": 14,
    "bounds": [-122.5, 37.7, -122.3, 37.8]
  },
  "links": {
    "layer": "/api/v1/maps/:mapId/layers/:layerId"
  }
}
```

### GET /api/v1/maps/:mapId/layers/:layerId/features

```json
{
  "data": [
    {
      "id": "uuid",
      "properties": { "name": "Dolores Park", "area_sqft": 54000 },
      "geometryType": "Polygon"
    }
  ],
  "meta": { "totalCount": 1247, "limit": 20, "nextCursor": "..." },
  "links": { "self": "...", "next": "...", "geojson": "..." }
}
```

Features list omits full geometry for performance. Use the GeoJSON endpoint for shapes.

### POST /api/v1/maps/:mapId/annotations

Request:

```json
{
  "anchor": { "type": "point", "coordinates": [-122.4, 37.7] },
  "content": { "type": "text", "body": "Notable tree density here" },
  "parentId": null
}
```

Response:

```json
{
  "data": {
    "id": "uuid",
    "mapId": "uuid",
    "authorId": "uuid",
    "authorName": "Jane",
    "anchor": { "type": "point", "coordinates": [-122.4, 37.7] },
    "content": { "type": "text", "body": "Notable tree density here" },
    "parentId": null,
    "templateId": null,
    "version": 1,
    "createdAt": "...",
    "updatedAt": "..."
  },
  "links": {
    "self": "/api/v1/maps/:mapId/annotations/:id",
    "map": "/api/v1/maps/:mapId"
  }
}
```

### GET /api/v1/maps/:mapId/annotations (list)

```json
{
  "data": [
    {
      "id": "uuid",
      "mapId": "uuid",
      "authorId": "uuid",
      "authorName": "Jane",
      "anchor": { "type": "point", "coordinates": [-122.4, 37.7] },
      "content": { "type": "text", "body": "Notable tree density here" },
      "parentId": null,
      "templateId": null,
      "version": 1,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "meta": { "totalCount": 42, "limit": 20, "nextCursor": "abc123" },
  "links": { "self": "...", "next": "...", "map": "/api/v1/maps/:mapId" }
}
```

Default sort: `createdAt` ascending. `?rootsOnly=true` filters to top-level annotations (no parentId).

### GET /api/v1/maps/:mapId/annotations/:id (single)

Same object shape as list items, wrapped in envelope:

```json
{
  "data": { "id": "uuid", "...same fields as above..." },
  "links": { "self": "...", "map": "/api/v1/maps/:mapId" }
}
```

### PATCH /api/v1/maps/:mapId/annotations/:id

Request (all fields optional — only send what changed):

```json
{
  "anchor": { "type": "region", "geometry": { "type": "Polygon", "coordinates": [[...]] } },
  "content": { "type": "text", "body": "Updated note" }
}
```

- Only `anchor` and `content` are patchable. `parentId`, `authorId`, `mapId` are immutable after creation.
- Returns the full updated annotation in the same shape as POST response.
- Increments `version`. Supports optimistic concurrency via `If-Match: <version>` header. If `If-Match` is present and the version does not match, returns `409 Conflict`. If `If-Match` is absent, the server applies the update unconditionally (last-write-wins).

### DELETE /api/v1/maps/:mapId/annotations/:id

Returns `204 No Content` with an empty body on success. Cascades to child annotations (same `parentId` behavior as the existing service).

### GET /api/v1/maps/:mapId/comments (list)

```json
{
  "data": [
    {
      "id": "uuid",
      "mapId": "uuid",
      "authorId": "uuid",
      "authorName": "Jane",
      "body": "Great analysis of the park boundaries",
      "resolved": false,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "meta": { "totalCount": 8, "limit": 20, "nextCursor": null },
  "links": { "self": "...", "map": "/api/v1/maps/:mapId" }
}
```

### POST /api/v1/maps/:mapId/comments

Request:

```json
{
  "body": "This layer needs attribution"
}
```

Response (201 Created):

```json
{
  "data": {
    "id": "uuid",
    "mapId": "uuid",
    "authorId": "uuid",
    "authorName": "Jane",
    "body": "This layer needs attribution",
    "resolved": false,
    "createdAt": "...",
    "updatedAt": "..."
  },
  "links": {
    "self": "/api/v1/maps/:mapId/comments/:id",
    "map": "/api/v1/maps/:mapId"
  }
}
```

### Error Shape

```json
{
  "error": {
    "code": "MAP_NOT_FOUND",
    "message": "Map with id '...' not found",
    "status": 404
  }
}
```

Consumers switch on `code`, not `status`. Codes are stable across versions.

### Error Codes

| Code | Status | When |
|---|---|---|
| `UNAUTHORIZED` | 401 | No valid API key or share token |
| `FORBIDDEN` | 403 | Valid auth but insufficient scope or access |
| `MAP_NOT_FOUND` | 404 | Map does not exist or not accessible |
| `LAYER_NOT_FOUND` | 404 | Layer does not exist on this map |
| `ANNOTATION_NOT_FOUND` | 404 | Annotation does not exist |
| `VALIDATION_ERROR` | 422 | Request body fails schema validation |
| `LIMIT_EXCEEDED` | 422 | Annotation per-map limit reached |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## 4. File Architecture

```
apps/web/src/
  routes/
    api/
      v1/
        middleware.ts              # resolveAuth(), envelope(), requireScope()
        errors.ts                  # error codes, toErrorResponse()
        maps/
          +server.ts              # GET /maps
          [mapId]/
            +server.ts            # GET /maps/:mapId
            layers/
              +server.ts          # GET /maps/:mapId/layers
              [layerId]/
                +server.ts        # GET layer detail
                geojson/
                  +server.ts      # GET GeoJSON
                features/
                  +server.ts      # GET paginated features
                tiles/
                  +server.ts      # GET tile info
            annotations/
              +server.ts          # GET list, POST create
              [id]/
                +server.ts        # GET, PATCH, DELETE
            comments/
              +server.ts          # GET list, POST create
        files/
          +server.ts              # POST upload
          [id]/
            +server.ts            # GET download
  lib/
    server/
      api/
        serializers.ts            # toMapResponse(), toLayerResponse(), etc.
        links.ts                  # buildLinks() for HATEOAS links
```

### Key Modules

**`middleware.ts`** — a utility module imported by route handlers, **not** a SvelteKit hook. Each `+server.ts` calls these functions explicitly. This avoids modifying `hooks.server.ts` or entangling with the tRPC hook chain. Exports:
- `resolveAuth(event)`: reads Bearer header or `?token` param, returns `{ userId: string | null, scope: 'read' | 'read-write', mapScope: string | null }`. For share tokens, returns a synthetic read-only context with `mapScope` locked to that single map.
- `envelope(data, meta?, links?)`: wraps response in standard shape.
- `requireScope(auth, 'read-write')`: throws `FORBIDDEN` if scope insufficient.
- `rateLimit(auth, event)`: checks and increments the rate counter, throws `RATE_LIMITED` if exceeded.

**`serializers.ts`** — transforms internal DB rows (snake_case) into API response shapes (camelCase, with computed fields). Single source of truth for external representation.

**`links.ts`** — `buildLinks(resource, id, parents?)` generates the `links` block. Centralised so URL structure changes propagate.

**`errors.ts`** — maps error codes to HTTP statuses. `toErrorResponse(code, message?)` returns a `Response` object.

### Auth Flow

**API key path:**
```
+server.ts handler
  -> resolveAuth(event)                         # returns { userId, scope, mapScope: null }
  -> requireScope(auth, 'read' | 'read-write')
  -> requireMapAccess(auth.userId, mapId, 'viewer' | 'commenter')
  -> call existing service / run query
  -> serialize with toXxxResponse()
  -> envelope(data, meta, links)
  -> return new Response(JSON.stringify(body), { headers })
```

**Share token path:**
```
+server.ts handler
  -> resolveAuth(event)                         # returns { userId: null, scope: 'read', mapScope: mapId }
  -> requireScope(auth, 'read')                 # always passes (scope is 'read')
  -> if (auth.mapScope) assert mapId === auth.mapScope, else 403
  -> call existing service / run query (no userId needed for reads)
  -> serialize with toXxxResponse()
  -> envelope(data, meta, links)
  -> return new Response(JSON.stringify(body), { headers })
```

### What Does NOT Change

- No new DB tables. The API reads existing tables (files use `import_jobs` with `source: 'api'`).
- No changes to tRPC. The internal API stays exactly as-is.
- No changes to `hooks.server.ts`. Auth resolution is self-contained in `middleware.ts` (a utility module, not a hook).

### What Changes Minimally

- **`annotationService`** gains optional `cursor` and `limit` parameters on `list()` to support paginated queries. The existing call signature (`{ userId, mapId, rootsOnly? }`) remains valid — cursor/limit default to "return all."
- **`apiKeys` table** in `schema.ts` gains a `scope` column (see section 5).
- **Settings UI** gains a scope dropdown when creating/editing API keys.

---

## 5. DB Changes

One column addition:

```sql
ALTER TABLE api_keys ADD COLUMN scope text NOT NULL DEFAULT 'read';
```

Drizzle schema update in `apps/web/src/lib/server/db/schema.ts`:

```ts
// Add to apiKeys pgTable definition:
scope: text('scope').notNull().default('read'),
```

Valid values: `read`, `read-write`. Existing API keys default to `read` (safe by default). The FLI settings UI gains a scope dropdown when creating/editing API keys.

**File storage:** `POST /api/v1/files` stores uploaded files on disk (same mechanism as import jobs) and tracks metadata in the existing `import_jobs` table with a new `source` value of `'api'`. No new DB tables are needed.

---

## 6. Locked Decisions

1. **Approach 2 (standalone REST alongside tRPC)** — routes call services directly. Rules out: tRPC adapter (approach 1), tRPC replacement (approach 3).
2. **Two-tier auth: API keys + share tokens** — no OAuth2, no app registration. Rules out: Supabase-compatible shim, OAuth2 flows.
3. **API key `scope` field: `read` | `read-write`** — controls write access. Rules out: fine-grained per-resource permissions.
4. **Write surface limited to annotations, comments, files** — no layer creation, feature mutation, or geoprocessing. Rules out: full CRUD for external consumers.
5. **GeoJSON endpoint returns bare `application/geo+json`** — no envelope. Rules out: envelope-wrapped GeoJSON.
6. **All other endpoints use `{ data, meta, links }` envelope** — consumers discover resources via `links`. Rules out: flat JSON, JSON:API.
7. **Cursor-based pagination** — rules out: offset/page-number pagination.
8. **URL versioning (`/api/v1/`)** — rules out: header versioning, content negotiation.
9. **`middleware.ts` is a utility module, not a SvelteKit hook** — route handlers import and call it explicitly. Does not modify `hooks.server.ts`. Rules out: shared hook chain between tRPC and REST, `sequence()` chaining.
10. **Features list omits geometry** — use GeoJSON endpoint for shapes. Rules out: inline geometry in paginated features.
