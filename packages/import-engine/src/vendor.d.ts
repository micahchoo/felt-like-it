// TYPE_DEBT: sql.js does not ship declaration files; minimal typings for our usage.
declare module 'sql.js' {
  interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  interface Database {
    exec(sql: string): QueryExecResult[];
    close(): void;
  }

  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database;
  }

  export default function initSqlJs(config?: Record<string, unknown>): Promise<SqlJsStatic>;
}

// TYPE_DEBT: shpjs does not ship declaration files; minimal typings for our usage.
declare module 'shpjs' {
  interface ShpFeature {
    type: 'Feature';
    geometry: { type: string; coordinates: unknown } | null;
    properties: Record<string, unknown> | null;
  }

  interface ShpFeatureCollection {
    type: 'FeatureCollection';
    features: ShpFeature[];
  }

  function shpjs(
    buffer: ArrayBuffer
  ): Promise<ShpFeatureCollection | ShpFeatureCollection[]>;

  namespace shpjs {
    function parseShp(
      buffer: ArrayBuffer,
      prj?: string
    ): Promise<Array<{ type: string; coordinates: unknown }>>;
  }

  export default shpjs;
}
