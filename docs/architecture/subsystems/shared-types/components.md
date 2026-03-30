# Shared Types — Component Analysis (L5)

> Subsystem: `packages/shared-types/`
> Risk: Medium — breaking changes break 3 processes simultaneously (web, worker, import-engine)

## Type Inventory

### Organization

**Grouped by schema module** — 11 Zod schema files under `src/schemas/`, one `types.ts` deriving
TypeScript types via `z.infer`, one `branded.ts` for nominal types, and a barrel `index.ts`.

```
src/
  index.ts              ← barrel re-export (all schemas + types + branded)
  types.ts              ← z.infer aliases for all core schemas
  branded.ts            ← FeatureUUID branded type + guards
  schemas/
    user.ts             ← UserSchema, CreateUserSchema, UpdateUserSchema, LoginSchema
    map.ts              ← MapSchema, CreateMapSchema, UpdateMapSchema, ViewportSchema
    layer.ts            ← LayerSchema, CreateLayerSchema, UpdateLayerSchema, LayerTypeSchema
    feature.ts          ← FeatureSchema, GeometrySchema, GeoJSONFeatureSchema, GeoJSONFeatureCollectionSchema
    style.ts            ← LayerStyleSchema, LegendEntrySchema, StyleConfigSchema, StyleLabelSchema
    share.ts            ← ShareSchema, CreateShareSchema, AccessLevelSchema
    job.ts              ← ImportJobSchema, ImportJobPayloadSchema, JobStatusSchema
    geoprocessing.ts    ← GeoprocessingOpSchema (10-op discriminated union) + per-op schemas
    annotation.ts       ← AnnotationContentSchema (6-variant discriminated union on `type`)
    annotation-object.ts← AnnotationObjectSchema, CreateAnnotationObjectSchema, UpdateAnnotationObjectSchema, AnchorSchema
    audit-log.ts        ← AuditLogEntrySchema
  __tests__/
    schemas.test.ts     ← comprehensive schema validation tests (~80 test cases)
    branded.test.ts     ← FeatureUUID guard/converter tests
    annotation-object.test.ts ← AnchorSchema + content schema tests
```

### Exported Zod Schemas (43 total)

| Module | Schemas | Pattern |
|--------|---------|---------|
| **user** | `UserSchema`, `CreateUserSchema`, `UpdateUserSchema`, `LoginSchema` | CRUD + auth |
| **map** | `MapSchema`, `CreateMapSchema`, `UpdateMapSchema`, `ViewportSchema` | CRUD + viewport |
| **layer** | `LayerSchema`, `CreateLayerSchema`, `UpdateLayerSchema`, `LayerTypeSchema` | CRUD + enum |
| **feature** | `FeatureSchema`, `GeometrySchema`, `GeoJSONFeatureSchema`, `GeoJSONFeatureCollectionSchema` | Record + GeoJSON |
| **style** | `LayerStyleSchema`, `LegendEntrySchema`, `StyleConfigSchema`, `StyleLabelSchema` | FSL-compatible |
| **share** | `ShareSchema`, `CreateShareSchema`, `AccessLevelSchema` | CRUD + enum |
| **job** | `ImportJobSchema`, `ImportJobPayloadSchema`, `JobStatusSchema` | Record + payload + enum |
| **geoprocessing** | `GeoprocessingOpSchema` + 10 per-op schemas (`GeoBufferOpSchema`, `GeoConvexHullOpSchema`, `GeoCentroidOpSchema`, `GeoDissolveOpSchema`, `GeoIntersectOpSchema`, `GeoUnionOpSchema`, `GeoClipOpSchema`, `GeoPointInPolygonOpSchema`, `GeoNearestNeighborOpSchema`, `GeoAggregateOpSchema`) | Discriminated union |
| **annotation** | `AnnotationContentSchema` (6 variants: text, emoji, gif, image, link, iiif) | Discriminated union |
| **annotation-object** | `AnnotationObjectSchema`, `CreateAnnotationObjectSchema`, `UpdateAnnotationObjectSchema`, `AnchorSchema` (5 variants: point, region, feature, viewport, measurement), `AnnotationObjectContentSchema` (single/slotted) | Nested discriminated unions |
| **audit-log** | `AuditLogEntrySchema` | Record |

### Exported TypeScript Types (19 via z.infer)

`User`, `CreateUser`, `UpdateUser`, `LoginInput`, `MapRecord`, `CreateMap`, `UpdateMap`,
`Viewport`, `Layer`, `CreateLayer`, `UpdateLayer`, `LayerType`, `Feature`, `Geometry`,
`GeoJSONFeature`, `GeoJSONFeatureCollection`, `LayerStyle`, `LegendEntry`, `Share`,
`CreateShare`, `AccessLevel`, `ImportJob`, `JobStatus`, `ImportJobPayload`, `AuditLogEntry`

Plus from annotation-object: `Anchor`, `AnnotationObjectContent`, `AnnotationObject`

### Branded Type

`FeatureUUID` — nominal branded string validated against UUID regex.
Exported with `toFeatureUUID()` (converter, returns null on invalid) and `isFeatureUUID()` (type guard).

## Stratigraphy

**No legacy patterns detected.** All types follow a consistent modern pattern:

1. Zod schemas defined in domain-specific files under `schemas/`
2. TypeScript types derived via `z.infer<typeof Schema>` in `types.ts`
3. Discriminated unions used for polymorphic types (geometry, annotations, geoprocessing ops)
4. Single branded type (`FeatureUUID`) is the only non-Zod pattern

The style schema is the most complex (~170 lines), modeling the Felt Style Language (FSL)
with nested config, label, attributes, popup, and filter blocks. It uses `z.record` with
`z.unknown()` for paint/layout properties — deferring validation to MapLibre at runtime.

## Test Coverage

### schemas.test.ts (~80 test cases across 12 describe blocks)

| Describe Block | Coverage |
|---------------|----------|
| Top-level rejection | null/undefined for UserSchema, CreateMapSchema |
| UserSchema | Valid parse, invalid email |
| CreateUserSchema | Password length validation |
| LoginSchema | Empty password rejection |
| ViewportSchema | Defaults, zoom bounds |
| MapSchema | Full valid parse |
| CreateMapSchema | Minimal parse, empty title rejection |
| GeometrySchema | Point, LineString, Polygon, unknown type |
| GeoJSONFeatureSchema | Valid Feature, null properties |
| GeoJSONFeatureCollectionSchema | Empty collection |
| LayerStyleSchema | ~35 tests: type defaults, config fields, categories, steps, attributes, popup, filters, highlight, heatmap, classification |
| JobStatusSchema | All valid statuses, invalid rejection |
| GeoprocessingOpSchema | Discriminated union: buffer/convex_hull/dissolve/intersect/clip/point_in_polygon/nearest_neighbor/aggregate |

### branded.test.ts
Tests `toFeatureUUID` (valid UUID, invalid string, number, null, undefined) and `isFeatureUUID` (type guard).

### annotation-object.test.ts
Tests `AnchorSchema` (point, region, feature, viewport, measurement, invalid types, out-of-range coords)
and `AnnotationObjectContentSchema` / `CreateAnnotationObjectSchema`.

### Coverage Gaps

- `ShareSchema`, `CreateShareSchema`, `AccessLevelSchema` — no dedicated tests (only via integration)
- `LayerSchema`, `CreateLayerSchema`, `UpdateLayerSchema` — no dedicated tests
- `AnnotationContentSchema` (the 6-variant union) — not directly tested in isolation
- `AuditLogEntrySchema` — no dedicated tests
- `ImportJobSchema`, `ImportJobPayloadSchema` — no dedicated tests (only JobStatusSchema tested)
