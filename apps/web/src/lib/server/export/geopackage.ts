/**
 * GeoPackage export — OGC-conformant .gpkg using sql.js (WASM, no native deps).
 *
 * Builds an in-memory SQLite database with the required gpkg_* metadata tables
 * and a feature table containing GeoPackage Binary geometry blobs.
 */

import initSqlJs from 'sql.js';
import { Geometry } from 'wkx';
import type { ExportData } from './shared.js';

const WGS84_SRS = {
  srs_name: 'WGS 84',
  srs_id: 4326,
  organization: 'EPSG',
  organization_coordsys_id: 4326,
  definition: 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]',
};

/**
 * Wrap a WKB buffer in a GeoPackage Binary Header (GP magic, version, flags, srid, WKB).
 */
function gpkgBinaryHeader(wkb: Buffer, srid: number): Uint8Array {
  // GP header: 2 magic + 1 version + 1 flags + 4 srid = 8 bytes
  const header = Buffer.alloc(8);
  header[0] = 0x47; // 'G'
  header[1] = 0x50; // 'P'
  header[2] = 0x00; // version 0
  header[3] = 0x01; // flags: little-endian, no envelope, not empty
  header.writeInt32LE(srid, 4);
  return Buffer.concat([header, wkb]);
}

export async function exportAsGeoPackage(data: ExportData): Promise<Buffer> {
  const SQL = await initSqlJs();
  const sqlDb = new SQL.Database();

  // ── Required GeoPackage metadata tables ──────────────────────────────────
  sqlDb.run(`
    CREATE TABLE gpkg_spatial_ref_sys (
      srs_name TEXT NOT NULL,
      srs_id INTEGER NOT NULL PRIMARY KEY,
      organization TEXT NOT NULL,
      organization_coordsys_id INTEGER NOT NULL,
      definition TEXT NOT NULL,
      description TEXT
    )
  `);

  sqlDb.run(`
    INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, ?, ?, ?, NULL)
  `, [WGS84_SRS.srs_name, WGS84_SRS.srs_id, WGS84_SRS.organization, WGS84_SRS.organization_coordsys_id, WGS84_SRS.definition]);

  sqlDb.run(`
    CREATE TABLE gpkg_contents (
      table_name TEXT NOT NULL PRIMARY KEY,
      data_type TEXT NOT NULL,
      identifier TEXT,
      description TEXT DEFAULT '',
      last_change TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      min_x DOUBLE,
      min_y DOUBLE,
      max_x DOUBLE,
      max_y DOUBLE,
      srs_id INTEGER REFERENCES gpkg_spatial_ref_sys(srs_id)
    )
  `);

  sqlDb.run(`
    CREATE TABLE gpkg_geometry_columns (
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      geometry_type_name TEXT NOT NULL,
      srs_id INTEGER NOT NULL,
      z TINYINT NOT NULL,
      m TINYINT NOT NULL,
      CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name)
    )
  `);

  // ── Feature table ────────────────────────────────────────────────────────
  // Collect property keys from all features for column creation
  const propKeys = new Set<string>();
  for (const f of data.features) {
    for (const k of Object.keys(f.properties)) {
      propKeys.add(k);
    }
  }

  const colDefs = Array.from(propKeys).map((k) => `"${k.replace(/"/g, '""')}" TEXT`);

  sqlDb.run(`
    CREATE TABLE features (
      fid INTEGER PRIMARY KEY AUTOINCREMENT,
      geom BLOB
      ${colDefs.length > 0 ? ', ' + colDefs.join(', ') : ''}
    )
  `);

  // Compute geometry type for metadata
  const geomTypeMap: Record<string, string> = {
    Point: 'POINT', MultiPoint: 'MULTIPOINT',
    LineString: 'LINESTRING', MultiLineString: 'MULTILINESTRING',
    Polygon: 'POLYGON', MultiPolygon: 'MULTIPOLYGON',
  };
  const geomTypes = new Set(data.features.map((f) => String(f.geometry['type'] ?? 'GEOMETRY')));
  const gpkgGeomType = geomTypes.size === 1
    ? (geomTypeMap[Array.from(geomTypes)[0] ?? ''] ?? 'GEOMETRY')
    : 'GEOMETRY';

  // Register in metadata
  sqlDb.run(`INSERT INTO gpkg_contents VALUES ('features', 'features', ?, '', strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL, NULL, NULL, 4326)`,
    [data.layerName]);

  sqlDb.run(`INSERT INTO gpkg_geometry_columns VALUES ('features', 'geom', ?, 4326, 0, 0)`,
    [gpkgGeomType]);

  // ── Insert features ──────────────────────────────────────────────────────
  const propKeyList = Array.from(propKeys);
  const placeholders = propKeyList.map(() => '?').join(', ');
  const colNames = propKeyList.map((k) => `"${k.replace(/"/g, '""')}"`).join(', ');

  const insertSql = propKeyList.length > 0
    ? `INSERT INTO features (geom, ${colNames}) VALUES (?${', ' + placeholders})`
    : `INSERT INTO features (geom) VALUES (?)`;

  const stmt = sqlDb.prepare(insertSql);

  for (const f of data.features) {
    const geojsonStr = JSON.stringify(f.geometry);
    const geom = Geometry.parseGeoJSON(JSON.parse(geojsonStr));
    const wkb = geom.toWkb();
    const gpkgBlob = gpkgBinaryHeader(wkb, 4326);

    const propValues = propKeyList.map((k) => {
      const v = f.properties[k];
      return v === null || v === undefined ? null : String(v);
    });

    stmt.run([gpkgBlob, ...propValues]);
  }

  stmt.free();

  // ── Export ───────────────────────────────────────────────────────────────
  const binaryArray = sqlDb.export();
  sqlDb.close();

  return Buffer.from(binaryArray);
}
