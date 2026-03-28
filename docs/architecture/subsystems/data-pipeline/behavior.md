# Data Pipeline Cluster — Behavior

## Critical Flow Traces

### CSV with Address Columns → Geocoding → Features

```
Upload → Worker dequeues → processCSV()
  → PapaParse streams CSV, extract headers
  → detectCoordinateColumns(headers) → null (no lat/lng)
  → detectAddressColumn(headers) → finds address column
  → geocodeBatch(addresses, progressCb) at 1100ms/request via Nominatim
  → Per row: if geocode succeeds → Point geometry; if fails → row silently dropped
  → If ALL fail → throw Error → job status='failed'
  → createLayerAndInsertFeatures() → 500-row batches → status='done'
```

**Gap:** Partial geocoding silently drops failed rows. No warning count stored.

### GeoPackage → Async Job → Completion

```
Upload → Worker → processGeoPackage()
  → sql.js loads entire .gpkg into memory as Uint8Array
  → SELECT first feature table from gpkg_contents (only first table!)
  → isValidTableName() regex validates table name
  → SELECT geometry column from gpkg_geometry_columns
  → SELECT * FROM table → parseGpkgBlob() strips GP header → WKB hex
  → Batch INSERT: ST_GeomFromWKB + ST_Transform for non-4326 SRIDs
  → Client polls /api/job → progress 10→90→100 → status='done'
```

**Gap:** Multi-layer .gpkg files silently discard all layers after the first.

### Geoprocessing Buffer → PostGIS → New Layer

```
tRPC geoprocessing.run → GeoprocessingOpSchema.parse(input)
  → getOpLayerIds(op) → verify ownership for each source layer
  → Caller INSERTs output layer row
  → runGeoprocessing(op, newLayerId)
  → Single INSERT...SELECT with ST_Buffer(geometry::geography, distance)::geometry
  → No transaction wrapping
```

### Export as GeoJSON / Shapefile

```
GET /api/export/[layerId]?format=geojson
  → getExportData() → getLayerFeatures() via ST_AsGeoJSON::json
  → toFeatureCollection() → JSON.stringify(fc, null, 2)
  → Content-Disposition: attachment

format=shp:
  → Block mixed-geometry layers (HTTP 400)
  → truncateProperties() enforces DBF limits (key ≤10, value ≤254 — silent)
  → shp-write zip() → application/zip
```

## Worker Module (669 LOC)

Key functions:
- `processImportJob` — top-level dispatcher by file extension
- `processGeoJSON` — JSON.parse → validateGeoJSON → insertFeaturesBatch
- `processCSV` — PapaParse → lat/lng path or address → geocodeBatch
- `processShapefile` — shpjs → insertFeaturesBatch
- `processXmlGeo` — @xmldom/xmldom → @tmcw/togeojson → insertFeaturesBatch
- `processGeoPackage` — sql.js → WKB parse → ST_GeomFromWKB
- `insertFeaturesBatch` — 500-row batches, sequential, progress callback
- `updateJobStatus` — raw SQL UPDATE on import_jobs

**See also:** [components](components.md) | [subsystems](../subsystems.md)
