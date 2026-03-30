# Shared Types — Contract Analysis (L6)

> Cross-process contract layer for felt-like-it
> 3 consumers: web app, worker service, import-engine/geo-engine packages

## Consumer Map

### Who imports what

```
Consumer                          Types/Schemas Used
──────────────────────────────────────────────────────────────────
apps/web (SvelteKit)
  lib/contracts/map-editor.ts     MapRecord, Layer
  lib/contracts/dashboard.ts      MapRecord
  lib/contracts/share-viewer.ts   MapRecord, Layer
  lib/contracts/admin.ts          User, AuditLogEntry, ImportJob
  lib/stores/layers.svelte.ts     Layer, LayerStyle
  lib/stores/style.svelte.ts      LayerStyle
  lib/stores/map-editor-state.ts  GeoJSONFeature
  lib/stores/annotation-geo.ts    (annotation types)
  lib/screens/*Screen.svelte      Layer
  routes/(app)/map/[id]/          Layer
  routes/(app)/dashboard/         MapRecord
  routes/(app)/settings/          Geometry
  routes/(public)/share/          Layer
  routes/(public)/embed/          Layer
  server/annotations/service.ts   Anchor, AnnotationObject, AnnotationObjectContent
  server/annotations/changelog.ts AnnotationObject
  server/jobs/queues.ts           ImportJobPayload
  server/trpc/.../geoprocessing   GeoprocessingOpSchema (runtime .safeParse)
  routes/api/.../annotations      CreateAnnotationObjectSchema (runtime .safeParse)

services/worker
  src/index.ts                    ImportJobPayload (type only)

packages/import-engine
  src/types.ts, kml.ts, etc.      Geometry (type only)

packages/geo-engine
  src/auto-style.ts               LayerStyle, LayerType, LegendEntry
  src/detect.ts                   LayerType
```

## Boundary Analysis

### 1. Redis Boundary (web --> worker)

```
web/server/jobs/queues.ts                    services/worker/src/index.ts
─────────────────────────                    ────────────────────────────
Queue<ImportJobPayload>  ──── BullMQ/Redis ──── Worker<ImportJobPayload>
enqueueImportJob(payload)                    processImportJob(job)
```

**Contract type:** `ImportJobPayload` (5 fields: jobId, mapId, layerName, filePath, fileName)

**Runtime validation: NONE.** Both sides use `ImportJobPayload` as a TypeScript `type import` only.
BullMQ serializes to JSON via Redis; the worker trusts the shape. There is no `safeParse` or
`parse` call on the worker side — the payload is consumed directly from `job.data`.

**Risk:** If `ImportJobPayloadSchema` changes (e.g., a required field is added), the worker
will receive malformed data at runtime with no error until it tries to access the missing field.
BullMQ's retry mechanism (3 attempts, exponential backoff) will exhaust retries on the same bad shape.

### 2. REST API Boundary (server --> external clients)

Runtime Zod validation occurs at **one** API endpoint:

| Endpoint | Schema | Validation |
|----------|--------|------------|
| `POST /api/v1/maps/[mapId]/annotations` | `CreateAnnotationObjectSchema.safeParse()` | Full Zod validation, returns `VALIDATION_ERROR` on failure |

Other API endpoints (`/api/v1/maps`, `/api/v1/maps/[mapId]/layers/[layerId]/features`,
`/api/v1/maps/[mapId]/comments`) use manual `parsePaginationParams` for query params
but do **not** validate request bodies through shared-types Zod schemas.

### 3. tRPC Boundary (client --> server, same process)

| tRPC Route | Schema | Validation |
|------------|--------|------------|
| `geoprocessing.run` | `GeoprocessingOpSchema` | Zod validation via tRPC input (automatic) |

tRPC automatically validates inputs against Zod schemas, so `GeoprocessingOpSchema` gets
runtime validation on every call. This is the most robustly validated boundary.

### 4. Internal Package Boundary (shared-types --> geo-engine, import-engine)

Both packages use **type-only imports** (`import type { ... }`). No runtime validation.
These are compile-time contracts only — safe as long as the monorepo builds together.

## Breaking Change Impact Analysis

### Severity Tiers

```
CRITICAL (runtime failure across processes):
  ImportJobPayloadSchema  ──  web enqueues, worker consumes via Redis
                              No runtime validation on either side.
                              Adding/removing a required field = silent runtime failure.

HIGH (runtime failure within web process):
  GeoprocessingOpSchema   ──  tRPC validates but 10 op-type variants mean
                              wide surface area. Adding a new op type is safe
                              (old clients won't send it); changing an existing
                              op's fields breaks all pending requests.

  CreateAnnotationObjectSchema ── REST API validates; external clients will get
                              VALIDATION_ERROR if schema tightens.

  AnchorSchema            ──  Nested in AnnotationObjectSchema, stored as JSONB.
                              Changing anchor variants affects DB reads of
                              historical data (schema must remain backward-compatible).

MEDIUM (compile-time failure, caught by monorepo build):
  Layer, LayerStyle       ──  Used by 8+ web files (screens, stores, contracts).
                              Breaking change = many type errors, but caught at build.

  MapRecord               ──  Used by 3 contracts (dashboard, map-editor, share-viewer).

  Geometry                ──  Used by import-engine (4 files) and geo-engine (2 files).

  User, AuditLogEntry     ──  Used by admin contract only.

LOW (internal, single consumer):
  ViewportSchema, ShareSchema, LoginSchema, CreateUserSchema
```

### Change Propagation Paths

```
Schema Change                    Propagation
──────────────────────────────   ─────────────────────────────────────────
ImportJobPayloadSchema           web/queues.ts --> Redis --> worker/index.ts
  (add required field)           SILENT FAILURE: worker gets undefined field

LayerStyleSchema                 layer.ts (embeds it) --> web stores --> UI
  (remove field)                 BUILD FAILURE: ~8 files break at compile

GeometrySchema                   feature.ts --> import-engine --> worker
  (add geometry type)            SAFE: discriminated union, old parsers skip

GeoprocessingOpSchema            tRPC router --> web client
  (change op params)             RUNTIME REJECTION: tRPC returns input error

AnnotationContentSchema          annotation.ts --> annotation-object.ts --> DB JSONB
  (remove variant)               DATA CORRUPTION: historical rows won't parse
```

## Runtime Validation Summary

| Boundary | Direction | Schema | Validation | Gap? |
|----------|-----------|--------|------------|------|
| Redis (BullMQ) | web --> worker | `ImportJobPayload` | **None** (type-only) | **YES** |
| REST API POST | external --> web | `CreateAnnotationObjectSchema` | `.safeParse()` | No |
| REST API GET | web --> external | (raw SQL rows) | **None** | YES (no response schema) |
| tRPC input | client --> server | `GeoprocessingOpSchema` | Automatic Zod | No |
| tRPC output | server --> client | (untyped) | **None** | YES (no output schema) |
| Package imports | compile-time | `Geometry`, `LayerStyle`, etc. | TypeScript compiler | No |

### Recommended Hardening

1. **Redis boundary**: Add `ImportJobPayloadSchema.parse(job.data)` at worker entry point
   (`processImportJob`). Fail fast with a clear error instead of silent field-access failures.

2. **REST API responses**: Define response schemas and validate outbound payloads in development
   mode (strip in production for performance).

3. **tRPC outputs**: Add output schemas to tRPC routes — currently only inputs are validated.

4. **Historical data**: Annotation schemas stored as JSONB must remain backward-compatible.
   Consider versioning the content schema (annotation-object already has a `version` field
   for optimistic concurrency, but not for schema evolution).
