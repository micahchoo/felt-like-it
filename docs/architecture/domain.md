# Domain

Felt Like It is a self-hosted collaborative GIS platform for data-sovereign organizations (government, NGOs, defense, utilities) that need collaborative spatial data editing without cloud lock-in or proprietary licensing.

## Bounded Contexts

### Identity & Access
- Users, sessions (Lucia auth), API keys (`flk_` prefix, SHA-256 hashed)
- Roles: owner, editor, commenter, viewer per map; `is_admin` for platform admin
- Audit log with tamper-evident hash chain (BIGSERIAL, prev_hash → chain_hash)

### Map Workspace
- Maps as top-level workspaces with viewport state, basemap, archive/template flags
- Layers as typed geometry containers (point/line/polygon/mixed), z-ordering, visibility
- Features as individual geometries (PostGIS `geometry(Geometry, 4326)` + JSONB properties)
- Drawing tools via Terra Draw; undo/redo stack
- **MapEditorState**: single class consolidating interaction modes, selection, and drawing state (replaces former separate `drawing.svelte.ts`, `selection.svelte.ts`, `interaction-modes.svelte.ts` stores and the `useInteractionBridge` adapter). State machine with typed interaction states: `idle | featureSelected | drawRegion | pickFeature | pendingMeasurement`
- TanStack Query cache as single source of truth for server state (optimistic concurrency via version column)

### Data Import & Export
- BullMQ job pipeline: GeoJSON, CSV, Shapefile, KML, GPX, GeoPackage → PostGIS
- **Import Engine** (`@felt-like-it/import-engine`): shared parser package extracted to `packages/import-engine/`. Pure parsing logic (no DB access) producing `ParsedFeature` (GeoJSON geometry + properties) or `ParsedWkbFeature` (WKB hex + SRID for GeoPackage). Web app importers and the BullMQ worker are now thin wrappers calling import-engine parsers.
- Filename sanitization (`sanitizeFilename`) shared between web and worker via import-engine
- CSV geocoding via Nominatim (address column detection)
- Export: GeoJSON, GeoPackage, Shapefile, PDF, PNG screenshot

### Style & Visualization
- FSL-compatible style schema: simple, categorical, numeric/choropleth, heatmap
- Auto-styling engine in `packages/geo-engine` based on detected data type
- MapLibre rendering; Martin vector tile server for layers > 10K features

### Spatial Analysis (Geoprocessing)
- 7 PostGIS operations: Buffer, Convex Hull, Centroid, Dissolve, Union, Intersect, Clip
- Spatial joins: point-in-polygon, nearest neighbor
- Aggregation: count/sum/avg point-to-polygon
- Measurement: distance, area, perimeter (Turf.js, ephemeral — not persisted)

### Annotation
- Pins/regions anchored geographically (WGS84 Point/Polygon/viewport/feature)
- Content types: text, emoji, GIF, image, link, IIIF NavPlace
- Threading via parentId; versioned for optimistic concurrency
- v2 "annotation objects" (Penpot-inspired flat object store) partially built

### Collaboration & Sharing
- Map collaborators with role enforcement on all tRPC procedures
- Comment threads (owner + collaborator + guest via share token)
- Activity feed (`map_events`)
- Share tokens (public/unlisted) and embeddable iframe (`/embed/[token]`)

## Ubiquitous Language

| Term | Meaning |
|------|---------|
| Map | Top-level workspace containing layers, annotations, and collaborators |
| Layer | Typed geometry container (point/line/polygon/mixed) within a map |
| Feature | Single GIS geometry + properties JSON blob stored in PostGIS |
| Import Job | Async BullMQ task parsing an uploaded file into features |
| Import Engine | Shared parser package (`@felt-like-it/import-engine`) — pure parsing, no DB. Produces `ParsedFeature` or `ParsedWkbFeature` |
| ParsedFeature | Standard import output: `{ geometry: Geometry, properties: Record<string, unknown> }` |
| MapEditorState | Consolidated client-side state machine managing interaction modes, feature selection, and drawing lifecycle |
| Style (FSL) | Felt Style Language descriptor: visualization type + paint rules |
| Geoprocessing | Server-side PostGIS spatial operation producing a new output layer |
| Annotation | Geographically anchored media object (text, image, IIIF, etc.) |
| Share / Token | Public or unlisted link granting read-only map access |
| Collaborator | User invited to a map with viewer/commenter/editor role |
| Template | Map cloned config-only (no features) as reusable starting point |
| Martin | Vector tile server; activated for layers > 10K features |
| Anchor | Geographic or logical attachment point of an annotation |
| Audit Log | Tamper-evident hash chain recording tracked mutations |
| API Key | Bearer token (`flk_` prefix) for REST API v1 access |

## User Personas

1. **Map Author** — Creates maps, imports datasets, draws features, applies styles, runs geoprocessing. Primary power user.
2. **Collaborator** — Invited to a map. Editors draw/modify; commenters annotate; viewers read-only.
3. **Public/Guest Viewer** — Accesses maps via share token (no account). Can comment if token allows.
4. **Platform Admin** — `is_admin = true`. User management, storage stats, import monitoring via `/admin`.
5. **API Consumer** — REST API v1 + API key for programmatic access. Target: Research-Narratives integration.

## Data Model

```
users ──< sessions
users ──< api_keys
users ──< maps ──< layers ──< features (geometry + properties JSONB)
                │
                ├──< shares (token, access_level: public|unlisted)
                ├──< map_collaborators (role: viewer|commenter|editor)
                ├──< comments (userId nullable, author_name denorm)
                ├──< map_events (action, metadata JSONB)
                ├──< annotations (anchor_point, content JSONB)
                ├──< annotation_objects (v2: flat object store)
                └──< import_jobs (status, file_name, progress)

audit_log (global hash chain: entity_type + entity_id)
```

All PKs are UUIDs (self-hosted portability). Geometry columns use SRID 4326 (WGS84).

### Package Boundaries

```
packages/shared-types     — Zod schemas + branded types (Feature, Layer, Map, Style, etc.)
packages/geo-engine       — Auto-styling, coordinate detection, spatial helpers
packages/import-engine    — Format parsers (GeoJSON, CSV, Shapefile, KML, GPX, GeoPackage)
                            Returns ParsedFeature[] / ParsedWkbFeature[] — no DB dependency
```

Client-side editor state lives in `MapEditorState` (single Svelte 5 runes class), not spread across multiple stores. Server state cached via TanStack Query as single source of truth.

**See also:** [ecosystem](ecosystem.md) | [subsystems](subsystems.md)
