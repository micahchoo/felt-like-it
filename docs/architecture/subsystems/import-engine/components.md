# Import Engine — Components (L5)

> Subsystem: `packages/import-engine/` (`@felt-like-it/import-engine` v0.1.0)
> Risk: Medium (new package, well tested, pure parsing)

## Source Inventory

| File | Lines | Role |
|------|-------|------|
| `src/index.ts` | 8 | Barrel re-export of all modules |
| `src/types.ts` | 23 | Shared type definitions: `ParsedFeature`, `ParsedWkbFeature`, `ParsedCsv` |
| `src/sanitize.ts` | 14 | `sanitizeFilename` — path-traversal prevention |
| `src/geojson.ts` | ~80 | GeoJSON parser (FeatureCollection, Feature, bare Geometry) |
| `src/csv.ts` | ~80 | CSV parser (papaparse streaming) + `csvRowsToFeatures` converter |
| `src/kml.ts` | ~223 | KML parser (fast-xml-parser, recursive Placemark collection) |
| `src/gpx.ts` | ~148 | GPX parser (waypoints, tracks, routes) |
| `src/shapefile.ts` | ~65 | Shapefile parser (.shp/.zip via shpjs) |
| `src/geopackage.ts` | ~265 | GeoPackage parser (sql.js WASM SQLite, GP binary header stripping) |
| `src/vendor.d.ts` | ~40 | TYPE_DEBT ambient declarations for sql.js and shpjs |

**Total production code: ~950 lines across 8 modules.**

## Test Inventory

| Test File | Covers | Adversarial Cases |
|-----------|--------|-------------------|
| `geojson.test.ts` | FeatureCollection, single Feature, bare Geometry, null geometries | Invalid JSON, invalid GeoJSON structure, empty FeatureCollection |
| `csv.test.ts` | Coordinate detection, row-to-feature conversion | No coordinate columns, no valid rows |
| `kml.test.ts` | Points, LineStrings, Polygons with holes, nested Folders, ExtendedData | Invalid KML (missing root), Placemarks without geometry |
| `gpx.test.ts` | Waypoints, tracks, routes, elevation, mixed types | Invalid GPX (missing root), empty coordinates |
| `shapefile.test.ts` | .zip and .shp parsing, null geometry filtering | Empty shapefile (no valid geometry), unsupported extension |
| `geopackage.test.ts` | GP binary header parsing, SRID extraction, geom-type mapping | Short blobs, missing magic, empty-geometry flag, malformed envelope, case-insensitive types |
| `sanitize.test.ts` | Safe filenames, directory stripping, unsafe chars | Path traversal (`../`, `C:\`), dot-only names, empty string |

**7 test files covering all 8 production modules (index.ts is a barrel, no tests needed).**

## Coverage Assessment

- Every parser has at least one adversarial case per CLAUDE.md requirements.
- GeoPackage has the deepest adversarial coverage (binary header edge cases).
- CSV tests cover the two-stage pipeline (parse then convert) independently.
- KML/GPX tests verify nested XML structures and recursive collection.
- No coverage gaps detected for the parsing concern; geocoding is explicitly out of scope.

## Stratigraphy

This is **clean extracted code**, not a copy-paste. Evidence from the git diff:

1. The web `apps/web/src/lib/server/import/` files were refactored to delete inline parser logic and import from `@felt-like-it/import-engine` instead.
2. The extracted parsers are **pure functions** — they read files and return typed data, with no database, API key, or progress-callback dependencies.
3. Design boundary is explicit: geocoding stays in the consumer (documented in `csvRowsToFeatures` JSDoc).
4. `vendor.d.ts` carries `TYPE_DEBT` markers for `sql.js` and `shpjs` — acknowledged, not hidden.

## Dependency Graph

```
@felt-like-it/import-engine
  workspace deps:
    @felt-like-it/shared-types  (Geometry type)
    @felt-like-it/geo-engine    (validateGeoJSON, detectCoordinateColumns, isValidLatitude/Longitude)
  external deps:
    papaparse       ^5.4.1   (CSV streaming)
    shpjs           ^6.1.0   (Shapefile decoding)
    fast-xml-parser ^4.5.0   (KML/GPX XML parsing)
    sql.js          ^1.12.0  (GeoPackage SQLite WASM)
  node built-ins:
    fs/promises (readFile)
    fs (createReadStream — CSV only)
    path (basename, extname)
```

## Component Interaction Map

```
                    +-----------------------+
                    |  @felt-like-it/       |
                    |  shared-types         |
                    |  (Geometry type)      |
                    +-----------+-----------+
                                |
                    +-----------v-----------+
                    |  @felt-like-it/       |
                    |  geo-engine           |
                    |  (validation, coord   |
                    |   detection)          |
                    +-----------+-----------+
                                |
          +---------------------v---------------------+
          |         import-engine                      |
          |                                            |
          |  types.ts ─── sanitize.ts                  |
          |                                            |
          |  geojson.ts  csv.ts  kml.ts  gpx.ts       |
          |  shapefile.ts  geopackage.ts               |
          +---------------------+---------------------+
                                |
              +-----------------+-----------------+
              |                                   |
   +----------v----------+             +----------v----------+
   |  apps/web            |             |  services/worker    |
   |  server/import/      |             |  src/index.ts       |
   |  (csv, geojson,      |             |  (all parsers +     |
   |   shapefile, xmlgeo, |             |   sanitize)         |
   |   geopackage,        |             +---------------------+
   |   sanitize re-export)|
   +-----------------------+
```
