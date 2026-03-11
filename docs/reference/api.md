# API Reference

tRPC 11 Fetch adapter at `/api/trpc/[...trpc]`. All requests use JSON over HTTP POST (mutations) or GET (queries).

**Authentication:** Most procedures require a session cookie or `Authorization: Bearer flk_...` API key header. Public procedures are marked below.

## maps

| Procedure | Type | Input | Output | Auth |
|-----------|------|-------|--------|------|
| list | query | — | Map[] | protected |
| get | query | `{ id }` | Map | protected |
| create | mutation | `{ title, description? }` | Map | protected |
| update | mutation | `{ id, title?, description?, viewport?, basemap? }` | Map | protected |
| delete | mutation | `{ id }` | void | protected (owner) |
| clone | mutation | `{ id }` | Map | protected |
| listTemplates | query | — | Map[] | protected |
| createFromTemplate | mutation | `{ id }` | Map | protected |
| listCollaborating | query | — | Map[] | protected |

## layers

| Procedure | Type | Input | Output | Auth |
|-----------|------|-------|--------|------|
| list | query | `{ mapId }` | Layer[] | protected |
| create | mutation | `{ mapId, name, type }` | Layer | protected |
| update | mutation | `{ id, name?, style?, visible?, zIndex? }` | Layer | protected |
| delete | mutation | `{ id }` | void | protected |
| reorder | mutation | `{ mapId, layerIds }` | void | protected |

## features

| Procedure | Type | Input | Output | Auth |
|-----------|------|-------|--------|------|
| list | query | `{ layerId }` | FeatureCollection | protected |
| upsert | mutation | `{ layerId, features[] }` | `{ upsertedIds }` | protected |
| delete | mutation | `{ layerId, ids[] }` | void | protected |

## annotations

| Procedure | Type | Input | Output | Auth |
|-----------|------|-------|--------|------|
| list | query | `{ mapId, rootsOnly? }` | AnnotationObject[] | protected |
| get | query | `{ id }` | AnnotationObject | protected |
| getThread | query | `{ rootId }` | `{ root, replies }` | protected |
| create | mutation | `{ mapId, anchor, content, parentId? }` | AnnotationObject | protected |
| update | mutation | `{ id, content, version }` | AnnotationObject | protected (author) |
| delete | mutation | `{ id }` | void | protected (author) |
| fetchIiifNavPlace | query | `{ manifestUrl }` | GeoJSON \| null | protected |

## comments

| Procedure | Type | Input | Output | Auth |
|-----------|------|-------|--------|------|
| list | query | `{ mapId }` | Comment[] | protected |
| create | mutation | `{ mapId, body }` | Comment | protected |
| delete | mutation | `{ id }` | void | protected (author) |
| resolve | mutation | `{ id }` | Comment | protected |
| listForShare | query | `{ token }` | Comment[] | public |
| createForShare | mutation | `{ token, body, authorName }` | Comment | public |

## collaborators

| Procedure | Type | Input | Output | Auth |
|-----------|------|-------|--------|------|
| list | query | `{ mapId }` | Collaborator[] | protected |
| invite | mutation | `{ mapId, email, role }` | Collaborator | protected (owner) |
| remove | mutation | `{ mapId, userId }` | void | protected (owner) |
| updateRole | mutation | `{ mapId, userId, role }` | Collaborator | protected (owner) |

## shares

| Procedure | Type | Input | Output | Auth |
|-----------|------|-------|--------|------|
| create | mutation | `{ mapId }` | Share | protected |
| getForMap | query | `{ mapId }` | Share \| null | protected |
| delete | mutation | `{ id }` | void | protected |
| resolve | query | `{ token }` | `{ map, share }` | public |

## geoprocessing

| Procedure | Type | Input | Output | Auth |
|-----------|------|-------|--------|------|
| run | mutation | `{ mapId, op, outputLayerName }` | `{ layerId }` | protected |

Operations (`op`): `buffer`, `clip`, `intersect`, `union`, `dissolve`, `convex_hull`, `centroid`, `point_in_polygon`, `nearest_neighbor`, `aggregate`.

## events

| Procedure | Type | Input | Output | Auth |
|-----------|------|-------|--------|------|
| list | query | `{ mapId }` | Event[] | protected |
| log | mutation | `{ mapId, action, metadata? }` | Event | protected |

## apiKeys

| Procedure | Type | Input | Output | Auth |
|-----------|------|-------|--------|------|
| list | query | — | ApiKey[] | protected |
| create | mutation | `{ name }` | `{ key, ...ApiKey }` | protected |
| revoke | mutation | `{ id }` | void | protected |

Note: `create` returns the plaintext key exactly once. It is never stored or retrievable again.

## auditLog

| Procedure | Type | Input | Output | Auth |
|-----------|------|-------|--------|------|
| list | query | `{ mapId? }` | AuditEntry[] | protected (admin) |
| verify | query | `{ mapId? }` | `{ valid, brokenAt? }` | protected (admin) |
