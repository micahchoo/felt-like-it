declare module 'shpjs' {
  interface Feature {
    type: 'Feature';
    geometry: Record<string, unknown>;
    properties: Record<string, unknown> | null;
  }
  interface FeatureCollection {
    type: 'FeatureCollection';
    features: Feature[];
  }
  function shpjs(buffer: ArrayBuffer): Promise<FeatureCollection | FeatureCollection[]>;
  namespace shpjs {
    function parseShp(buffer: ArrayBuffer): Promise<Record<string, unknown>[]>;
  }
  export default shpjs;
}
