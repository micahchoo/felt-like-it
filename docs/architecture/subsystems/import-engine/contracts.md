# Import Engine — Contracts (L6)

> Subsystem: `packages/import-engine/` (`@felt-like-it/import-engine` v0.1.0)

## Public API Surface

### Types

```typescript
/** Standard parsed feature — GeoJSON geometry + properties. */
interface ParsedFeature {
  geometry: Geometry;                    // from @felt-like-it/shared-types
  properties: Record<string, unknown>;
}

/** GeoPackage parsed feature — WKB binary + SRID. */
interface ParsedWkbFeature {
  wkbHex: string;    // hex-encoded WKB bytes, ready for ST_GeomFromWKB
  srid: number;      // spatial reference ID (typically 4326)
  properties: Record<string, unknown>;
}

/** Parsed CSV with headers preserved for coordinate detection. */
interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

/** Result of parsing a GeoPackage file. */
interface GeoPackageResult {
  features: ParsedWkbFeature[];
  layerType: 'point' | 'line' | 'polygon' | 'mixed';
  tableName: string;
}
```

### Exported Functions

| Function | Input | Output | Module |
|----------|-------|--------|--------|
| `parseGeoJSON(filePath)` | `string` (file path) | `Promise<ParsedFeature[]>` | geojson.ts |
| `parseCSV(filePath)` | `string` (file path) | `Promise<ParsedCsv>` | csv.ts |
| `csvRowsToFeatures(headers, rows)` | `string[], Record<string, string>[]` | `ParsedFeature[]` (sync) | csv.ts |
| `parseKML(filePath)` | `string` (file path) | `Promise<ParsedFeature[]>` | kml.ts |
| `parseGPX(filePath)` | `string` (file path) | `Promise<ParsedFeature[]>` | gpx.ts |
| `parseShapefile(filePath)` | `string` (file path) | `Promise<ParsedFeature[]>` | shapefile.ts |
| `parseGeoPackage(filePath)` | `string` (file path) | `Promise<GeoPackageResult>` | geopackage.ts |
| `parseGpkgBlob(blob)` | `Uint8Array` | `ParsedBlob \| null` | geopackage.ts |
| `gpkgGeomTypeToLayerType(name)` | `string` | `'point' \| 'line' \| 'polygon' \| 'mixed'` | geopackage.ts |
| `sanitizeFilename(name)` | `string` | `string` | sanitize.ts |

## Input Contracts

**All file-reading parsers accept a file path (`string`), not a Buffer.**
They call `readFile` or `createReadStream` internally. This is a deliberate design choice — the consumer provides a temp-file path from the upload pipeline.

| Parser | Reads As | Via |
|--------|----------|-----|
| `parseGeoJSON` | UTF-8 string | `readFile(filePath, 'utf-8')` |
| `parseCSV` | Streaming | `createReadStream(filePath)` via papaparse |
| `parseKML` | UTF-8 string | `readFile(filePath, 'utf-8')` |
| `parseGPX` | UTF-8 string | `readFile(filePath, 'utf-8')` |
| `parseShapefile` | Binary buffer | `readFile(filePath)` → ArrayBuffer |
| `parseGeoPackage` | Binary buffer | `readFile(filePath)` → Uint8Array |

**Exception:** `csvRowsToFeatures` is a pure in-memory converter (no file I/O). It accepts pre-parsed headers and rows from `parseCSV`. This two-stage design lets consumers insert geocoding between parse and convert.

**Exception:** `parseGpkgBlob` accepts a raw `Uint8Array` (a single geometry BLOB cell from SQLite). It is also used internally by `parseGeoPackage` but exported for direct testing.

## Error Contracts

**All parsers signal failure by throwing `Error`.** There is no Result/Either type.

### Error Taxonomy

| Category | Parser(s) | Error Message Pattern | When |
|----------|-----------|----------------------|------|
| **Invalid format** | geojson | `"Invalid JSON in file"` | JSON parse fails |
| | geojson | `"Invalid GeoJSON: ..."` | validateGeoJSON fails (first 3 errors) |
| | geojson | `"Unrecognized GeoJSON structure"` | Not FC, Feature, or bare Geometry |
| | kml | `"Invalid KML: missing <kml> root element"` | XML lacks `<kml>` tag |
| | gpx | `"Invalid GPX: missing <gpx> root element"` | XML lacks `<gpx>` tag |
| | shapefile | `"Unsupported Shapefile extension: .foo"` | Not `.shp` or `.zip` |
| | geopackage | `"Invalid GeoPackage table name: ..."` | SQL-injection-unsafe table name |
| | geopackage | `"...has no entry in gpkg_geometry_columns"` | Malformed GeoPackage metadata |
| **Empty data** | geojson | `"GeoJSON contains no features"` | All features filtered (null geometry) |
| | csv | `"Could not detect latitude/longitude columns..."` | No lat/lng header match |
| | csv | `"No valid coordinate rows found..."` | All rows have invalid coords |
| | shapefile | `"Shapefile contains no features with valid geometry"` | Empty after null-geom filter |
| | geopackage | `"GeoPackage contains no feature tables"` | No `features` data_type in gpkg_contents |
| | geopackage | `"...table is empty"` | Feature table has zero rows |
| | geopackage | `"...contains no features with valid geometry"` | All blobs failed parsing |

### Silent-Skip Behavior

KML, GPX, and GeoPackage parsers **silently skip** individual malformed features rather than failing the entire import:
- KML/GPX: Placemarks without supported geometry are skipped (no error).
- GeoPackage: `parseGpkgBlob` returns `null` for malformed blobs; caller skips.
- CSV: Rows with invalid lat/lng are silently skipped; error thrown only if zero rows survive.
- Shapefile/GeoJSON: Null geometries filtered out; error only if none remain.

**KML and GPX return empty arrays (no throw) when all Placemarks lack geometry.** This is the only case where a parser returns successfully with zero features. All other parsers throw on empty.

## Sanitization Contract

`sanitizeFilename(name: string): string`

| Input | Output | Mechanism |
|-------|--------|-----------|
| `"data.geojson"` | `"data.geojson"` | Pass-through (safe) |
| `"/etc/passwd"` | `"passwd"` | `basename()` strips directories |
| `"../../secret.txt"` | `"secret.txt"` | Backslash normalization + `basename()` |
| `"C:\\Users\\file.csv"` | `"file.csv"` | `\` replaced with `/` before `basename()` |
| `"hello world!.csv"` | `"hello_world_.csv"` | `[^a-zA-Z0-9._-]` replaced with `_` |
| `".."` | `"__"` | Pure-dot names: dots replaced with `_` |
| `""` | `"upload"` | Empty fallback |

**Security invariant:** Output never contains `/`, `\`, or `..` sequences. Safe for use in file paths.

## Knot Analysis (Dependencies)

### What import-engine depends on

| Dependency | Kind | What it provides |
|-----------|------|-----------------|
| `@felt-like-it/shared-types` | workspace | `Geometry` type (GeoJSON geometry union) |
| `@felt-like-it/geo-engine` | workspace | `validateGeoJSON`, `detectCoordinateColumns`, `isValidLatitude`, `isValidLongitude` |
| `papaparse` | npm | CSV streaming parser |
| `shpjs` | npm | Shapefile (.shp/.zip) decoder |
| `fast-xml-parser` | npm | XML parser for KML and GPX |
| `sql.js` | npm | Pure WASM SQLite engine for GeoPackage |
| Node `fs`, `path` | built-in | File I/O, path manipulation |

### What depends on import-engine

| Consumer | Imports Used |
|----------|-------------|
| `apps/web/src/lib/server/import/geojson.ts` | `parseGeoJSON` |
| `apps/web/src/lib/server/import/csv.ts` | `parseCSV`, `csvRowsToFeatures`, `ParsedFeature` |
| `apps/web/src/lib/server/import/shapefile.ts` | `parseShapefile` |
| `apps/web/src/lib/server/import/xmlgeo.ts` | `parseKML`, `parseGPX` |
| `apps/web/src/lib/server/import/geopackage.ts` | `parseGeoPackage`, `parseGpkgBlob`, `gpkgGeomTypeToLayerType` |
| `apps/web/src/lib/server/import/sanitize.ts` | `sanitizeFilename` (re-export) |
| `services/worker/src/index.ts` | All parsers + sanitize (full API surface) |

### Coupling Assessment

- **Low coupling inward:** Only depends on two workspace packages for types and validation. External deps are all leaf-level parsing libraries.
- **Clean seam outward:** Consumers import pure functions, pass file paths, receive typed data. No shared state, no callbacks, no side effects beyond file reads.
- **No circular deps:** import-engine sits below web and worker in the dependency graph; shared-types and geo-engine sit below import-engine.
- **TYPE_DEBT:** `sql.js` and `shpjs` lack declaration files; ambient `vendor.d.ts` provides minimal typings scoped to actual usage.
