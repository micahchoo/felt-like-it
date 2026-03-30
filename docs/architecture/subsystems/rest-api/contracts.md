# REST API v1 — Contracts (L6)

## Endpoint Catalog

All endpoints require authentication (API key or share token) unless noted. All responses use the standard envelope: `{ data, meta, links }`.

### Maps

| Method | Path | Auth | Scope | Response |
|--------|------|------|-------|----------|
| GET | `/api/v1/maps` | Required | read | Paginated list of `MapSummary` |
| GET | `/api/v1/maps/:mapId` | Required | read | Single `MapDetail` |

**GET /maps**: Share tokens return only their scoped map (no pagination). API keys return all accessible maps with cursor pagination.

**MapSummary**: `{ id, title, description, basemap, createdAt, updatedAt }`
**MapDetail**: MapSummary + `{ viewport }`

### Layers

| Method | Path | Auth | Scope | Response |
|--------|------|------|-------|----------|
| GET | `/api/v1/maps/:mapId/layers` | Required | read | Array of `LayerSummary` (no pagination) |
| GET | `/api/v1/maps/:mapId/layers/:layerId` | Required | read | Single `LayerDetail` |

**LayerSummary**: `{ id, mapId, name, type, featureCount, visible, zIndex }`
**LayerDetail**: LayerSummary + `{ style, sourceFileName }`

### Features

| Method | Path | Auth | Scope | Response |
|--------|------|------|-------|----------|
| GET | `/api/v1/maps/:mapId/layers/:layerId/features` | Required | read | Paginated list of `FeatureSummary` |

**FeatureSummary**: `{ id, geometryType, properties, createdAt }`

Pagination: cursor-based, default limit 20, max 100. Response meta includes `{ totalCount, limit, nextCursor }`.

### GeoJSON

| Method | Path | Auth | Scope | Response |
|--------|------|------|-------|----------|
| GET | `/api/v1/maps/:mapId/layers/:layerId/geojson` | Required | read | GeoJSON FeatureCollection |

**Query params**: `?bbox=xmin,ymin,xmax,ymax` (spatial filter), `?limit=N` (default 5000, max 50000).

**Response**: Standard GeoJSON FeatureCollection (not envelope-wrapped). Headers include:
- `X-Total-Features`: total feature count (with bbox filter if applied)
- `ETag`: content hash for conditional requests
- `Cache-Control: private, max-age=10`

**Conditional requests**: Supports `If-None-Match` header, returns 304 on cache hit with matching ETag.

### Tiles

| Method | Path | Auth | Scope | Response |
|--------|------|------|-------|----------|
| GET | `/api/v1/maps/:mapId/layers/:layerId/tiles` | Required | read | TileJSON 3.0.0 metadata |

**Response** (envelope-wrapped):
```json
{
  "data": {
    "tilejson": "3.0.0",
    "tileUrl": "{MARTIN_URL}/function_zxy_query/{z}/{x}/{y}?layer_id={layerId}",
    "minzoom": 0,
    "maxzoom": 14,
    "bounds": [xmin, ymin, xmax, ymax] | null
  }
}
```

Bounds computed from PostGIS `ST_Extent`. Does not serve tiles directly -- provides the Martin tile URL for the client to use.

### Annotations

| Method | Path | Auth | Scope | Response |
|--------|------|------|-------|----------|
| GET | `/api/v1/maps/:mapId/annotations` | Required | read | Paginated list of `Annotation` |
| POST | `/api/v1/maps/:mapId/annotations` | Required | read-write | Created `Annotation` (201) |
| GET | `/api/v1/maps/:mapId/annotations/:id` | Required | read | Single `Annotation` |
| PATCH | `/api/v1/maps/:mapId/annotations/:id` | Required | read-write | Updated `Annotation` |
| DELETE | `/api/v1/maps/:mapId/annotations/:id` | Required | read-write | 204 No Content |

**Annotation**: `{ id, mapId, authorId, authorName, anchor, content, parentId, templateId, version, createdAt, updatedAt }`

POST requires `{ anchor: { lngLat, zoom? }, content: [...] }`. PATCH supports partial updates and uses optimistic concurrency via `version` field (returns 409 on conflict).

### Comments

| Method | Path | Auth | Scope | Response |
|--------|------|------|-------|----------|
| GET | `/api/v1/maps/:mapId/comments` | Required | read | Paginated list of `Comment` |
| POST | `/api/v1/maps/:mapId/comments` | Required | read-write | Created `Comment` (201) |
| GET | `/api/v1/maps/:mapId/comments/:id` | Required | read | Single `Comment` |

**Comment**: `{ id, mapId, authorId, authorName, body, resolved, createdAt, updatedAt }`

POST requires `{ body: string }`. Comments are read-only after creation (no PATCH/DELETE exposed).

### Files

| Method | Path | Auth | Scope | Response |
|--------|------|------|-------|----------|
| POST | `/api/v1/files` | Required | read-write | `{ id, fileName, fileSize, url }` (201) |
| GET | `/api/v1/files/:id` | Required | read | Raw file binary |

POST accepts `multipart/form-data` with a `file` field. Max size: 50MB. Files are stored as `{uuid}.{ext}` under `$UPLOAD_DIR` (default `./uploads/api`).

GET returns binary with appropriate MIME type and `Cache-Control: public, max-age=31536000, immutable`.

---

## GeoJSON Cache Contract

| Property | Value |
|----------|-------|
| **What's cached** | Serialized GeoJSON FeatureCollection body (string) + ETag |
| **Cache key** | `${layerId}:${bbox \|\| 'all'}:${limit}` |
| **TTL** | 30 seconds (hard expiry, no stale-while-revalidate) |
| **Max entries** | 200 |
| **Eviction** | FIFO (first inserted evicted first) -- not LRU |
| **Invalidation** | TTL-only. No explicit invalidation on write/mutation. Cache is process-local. |
| **ETag generation** | `md5(body).hex().slice(0, 16)` |
| **Scope** | Per-process `Map<>`. Not shared across server instances. |

---

## API Key Scope Flags

API keys carry a `scope` field with two possible values:

| Scope | Permissions |
|-------|-------------|
| `read` | All GET endpoints |
| `read-write` | All GET + POST/PATCH/DELETE endpoints |

**Schema**: `api_keys` table has `scope TEXT NOT NULL DEFAULT 'read'`. Migration 0014 backfilled pre-existing keys to `read-write`.

**Key format**: `flk_<64 hex chars>`. Only the SHA-256 hash is stored. The `prefix` column stores the first 12 chars for UI display.

**Share tokens**: Always `read` scope, scoped to a single `mapId` via the `mapScope` field. Cannot write.

---

## Pagination Contract

**Type**: Cursor-based (keyset pagination on `(created_at, id)`)

| Parameter | Default | Range | Notes |
|-----------|---------|-------|-------|
| `?cursor` | (none) | opaque base64url string | Encodes `ISO-timestamp\|uuid` |
| `?limit` | 20 | 1-100 | Clamped to range |

**Response meta** (in envelope):
```json
{
  "meta": {
    "totalCount": 42,
    "limit": 20,
    "nextCursor": "MjAyNi0wMS0wMVQwMDo..."
  }
}
```

**Endpoints using pagination**: maps (list), features, annotations (list), comments (list).

**Endpoints NOT paginated**: layers (returns all layers for a map), map detail, GeoJSON (uses its own `?limit` with default 5000).

---

## Standard Envelope

All JSON responses (except GeoJSON and file downloads) use:

```json
{
  "data": { ... } | [ ... ],
  "meta": { "totalCount"?: number, "limit"?: number, "nextCursor"?: string },
  "links": { "self": "/api/v1/...", "next"?: "/api/v1/...?cursor=...", ... }
}
```

**Error responses** use a different shape:
```json
{
  "error": {
    "code": "MAP_NOT_FOUND",
    "message": "MAP_NOT_FOUND",
    "status": 404
  }
}
```
