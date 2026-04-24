import { readFile } from 'fs/promises';
import type { ParsedWkbFeature } from './types.js';

// ─── GeoPackage Binary Header constants (OGC 12-128r18 §2.1.3) ────────────────
// Header layout: magic[2] + version[1] + flags[1] + srs_id[4] = 8 bytes,
// followed by an optional envelope block, then standard WKB.
const GPKG_MAGIC_0 = 0x47; // 'G'
const GPKG_MAGIC_1 = 0x50; // 'P'

// Byte count of the optional envelope block, indexed by envelope indicator (0-4).
// Indicators 5-7 are reserved per the spec; we treat them as 0 bytes.
const ENVELOPE_BYTE_SIZES: ReadonlyArray<number> = [0, 32, 48, 48, 64];

// ─── Internal types ────────────────────────────────────────────────────────────

/** Result of stripping the GeoPackage Binary Header from a geometry BLOB. */
interface ParsedBlob {
  /** Standard WKB bytes, ready to pass to PostGIS. */
  wkbBytes: Uint8Array;
  /**
   * SRS_ID extracted from the GP header. May be 0 if unset — callers should
   * fall back to the value in gpkg_geometry_columns when this is 0.
   */
  srid: number;
}

/**
 * A single cell value in a sql.js query result row.
 * sql.js returns BLOBs as Uint8Array, TEXT as string, INTEGER/REAL as number.
 */
type SqlValue = number | string | Uint8Array | null;

// ─── Exported pure helpers (tested directly) ──────────────────────────────────

/**
 * Strip the GeoPackage Binary Header from a geometry BLOB and return the
 * embedded WKB payload with its SRID.
 *
 * Returns null for:
 * - Blobs shorter than the 8-byte minimum header
 * - Missing GP magic bytes (0x47, 0x50)
 * - Empty-geometry flag set (flags byte bit 4)
 * - WKB offset beyond end of blob (malformed envelope indicator)
 *
 * Callers should silently skip null rows rather than failing the whole import.
 */
export function parseGpkgBlob(blob: Uint8Array): ParsedBlob | null {
  if (blob.length < 8) return null;
  if (blob[0] !== GPKG_MAGIC_0 || blob[1] !== GPKG_MAGIC_1) return null;

  const flags = blob[3] ?? 0;
  // Bit 4 = empty geometry flag; no WKB follows
  if (((flags >> 4) & 0x1) === 1) return null;

  const littleEndian = (flags & 0x1) === 1;
  const envelopeIndicator = (flags >> 1) & 0x7;
  const envelopeSize: number =
    envelopeIndicator <= 4
      ? (ENVELOPE_BYTE_SIZES[envelopeIndicator] ?? 0)
      : 0;

  const dataView = new DataView(
    blob.buffer,
    blob.byteOffset,
    blob.byteLength
  );
  const srid = dataView.getInt32(4, littleEndian);

  const wkbOffset = 8 + envelopeSize;
  if (blob.length <= wkbOffset) return null;

  return { wkbBytes: blob.slice(wkbOffset), srid };
}

/**
 * Map a GeoPackage geometry type name to our internal layer type.
 * Strips trailing Z / M / ZM dimension suffixes before matching
 * (e.g. "POINTZ" -> "POINT", "LINESTRINGZM" -> "LINESTRING").
 *
 * Geometry type names per OGC 12-128r18 Table 5:
 * POINT, LINESTRING, POLYGON, MULTIPOINT, MULTILINESTRING, MULTIPOLYGON,
 * GEOMETRYCOLLECTION, and curve subtypes; plus *Z, *M, *ZM variants.
 */
export function gpkgGeomTypeToLayerType(
  geomTypeName: string
): 'point' | 'line' | 'polygon' | 'mixed' {
  const n = geomTypeName.toUpperCase().replace(/(?:ZM|[ZM])$/, '');
  if (n === 'POINT' || n === 'MULTIPOINT') return 'point';
  if (
    n === 'LINESTRING' ||
    n === 'MULTILINESTRING' ||
    n === 'CIRCULARSTRING' ||
    n === 'COMPOUNDCURVE' ||
    n === 'MULTICURVE'
  )
    return 'line';
  if (
    n === 'POLYGON' ||
    n === 'MULTIPOLYGON' ||
    n === 'CURVEPOLYGON' ||
    n === 'MULTISURFACE'
  )
    return 'polygon';
  return 'mixed';
}

/**
 * Reject table names that could introduce SQL injection via dynamic SQL
 * when reading feature data from user-supplied GeoPackage files.
 * Valid: starts with letter or _, followed by letters/digits/underscores/hyphens.
 */
function isValidTableName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name);
}

/** Result of parsing a GeoPackage file. */
export interface GeoPackageResult {
  features: ParsedWkbFeature[];
  layerType: 'point' | 'line' | 'polygon' | 'mixed';
  tableName: string;
}

/**
 * Parse a GeoPackage (.gpkg) file and extract features as WKB hex.
 *
 * GeoPackage (OGC 12-128r18) is a SQLite container. Feature tables store
 * geometry as GeoPackage Binary BLOBs (GP header + standard WKB). This
 * parser strips the GP header and returns WKB hex for each feature, letting
 * the consumer pass it to PostGIS via ST_GeomFromWKB.
 *
 * Uses sql.js (pure WASM SQLite, no native deps) so parsing works on
 * Alpine Docker without any build toolchain.
 */
export async function parseGeoPackage(
  filePath: string
): Promise<GeoPackageResult> {
  // TYPE_DEBT: sql.js v1 ships no .d.ts — use any for the dynamic import default.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sqlJsMod = (await import('sql.js' as any)) as { default: any };
  const buf = await readFile(filePath);
  const initSqlJs = sqlJsMod.default;

  const SQL = await initSqlJs();
  const sqlDb = new SQL.Database(new Uint8Array(buf));

  try {
    // ── Step 1: Discover feature tables ─────────────────────────────────────
    const contentsResult = sqlDb.exec(
      "SELECT table_name, srs_id FROM gpkg_contents WHERE data_type = 'features' ORDER BY table_name"
    );

    const contentsData = contentsResult[0];
    const firstContentRow = contentsData?.values[0];

    if (!contentsData || !firstContentRow) {
      throw new Error('GeoPackage contains no feature tables');
    }

    const tableNameIdx = contentsData.columns.indexOf('table_name');
    const srsIdIdx = contentsData.columns.indexOf('srs_id');
    const tableName =
      tableNameIdx !== -1
        ? String((firstContentRow as SqlValue[])[tableNameIdx] ?? '')
        : '';

    if (!tableName || !isValidTableName(tableName)) {
      throw new Error(
        `Invalid GeoPackage table name: "${tableName}". ` +
          'Table names must start with a letter or underscore and contain only ' +
          'letters, digits, underscores, or hyphens.'
      );
    }

    const tableSrid =
      srsIdIdx !== -1
        ? Number((firstContentRow as SqlValue[])[srsIdIdx] ?? 4326)
        : 4326;

    // ── Step 2: Geometry column metadata ────────────────────────────────────
    const geomColResult = sqlDb.exec(
      `SELECT column_name, geometry_type_name, srs_id ` +
        `FROM gpkg_geometry_columns WHERE table_name = '${tableName}'`
    );

    const geomData = geomColResult[0];
    const geomRow = geomData?.values[0];

    if (!geomData || !geomRow) {
      throw new Error(
        `GeoPackage table "${tableName}" has no entry in gpkg_geometry_columns`
      );
    }

    const geomCols = geomData.columns;
    const geomRowValues = geomRow as SqlValue[];
    const geomColName = String(
      geomRowValues[geomCols.indexOf('column_name')] ?? 'geom'
    );
    const geomTypeName = String(
      geomRowValues[geomCols.indexOf('geometry_type_name')] ?? 'GEOMETRY'
    );
    const geomSrid = Number(
      geomRowValues[geomCols.indexOf('srs_id')] ?? tableSrid
    );
    // Prefer the srs_id from gpkg_geometry_columns; fall back to gpkg_contents
    const effectiveSrid = geomSrid > 0 ? geomSrid : tableSrid;

    const layerType = gpkgGeomTypeToLayerType(geomTypeName);

    // ── Step 3: Read feature rows ───────────────────────────────────────────
    const featureResult = sqlDb.exec(`SELECT * FROM "${tableName}"`);
    const featureData = featureResult[0];
    if (!featureData) {
      throw new Error(`GeoPackage table "${tableName}" is empty`);
    }

    const featureCols = featureData.columns;
    const featureRows = featureData.values;
    const geomColIndex = featureCols.indexOf(geomColName);

    if (geomColIndex === -1) {
      throw new Error(
        `Geometry column "${geomColName}" not found in table "${tableName}"`
      );
    }

    const features: ParsedWkbFeature[] = [];

    for (const rawRow of featureRows) {
      const row = rawRow as SqlValue[];
      const rawBlob = row[geomColIndex];
      if (!(rawBlob instanceof Uint8Array)) continue;

      const parsed = parseGpkgBlob(rawBlob);
      if (parsed === null) continue;

      const properties: Record<string, unknown> = {};
      for (let i = 0; i < featureCols.length; i++) {
        if (i === geomColIndex) continue;
        const col = featureCols[i];
        if (!col || col === 'fid' || col === 'ogc_fid') continue;
        const val = row[i];
        properties[col] =
          val instanceof Uint8Array ? null : (val ?? null);
      }

      const srid = parsed.srid > 0 ? parsed.srid : effectiveSrid;
      // Pure JS hex encoding — avoids relying on Buffer global
      const wkbHex = Array.from(parsed.wkbBytes, (b) =>
        (b as number).toString(16).padStart(2, '0')
      ).join('');

      features.push({ wkbHex, srid, properties });
    }

    if (features.length === 0) {
      throw new Error(
        `GeoPackage table "${tableName}" contains no features with valid geometry`
      );
    }

    return { features, layerType, tableName };
  } finally {
    sqlDb.close();
  }
}
