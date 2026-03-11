import { describe, it, expect } from 'vitest';
import {
  UserSchema,
  CreateUserSchema,
  LoginSchema,
  MapSchema,
  CreateMapSchema,
  ViewportSchema,
  LayerStyleSchema,
  GeoJSONFeatureSchema,
  GeoJSONFeatureCollectionSchema,
  GeometrySchema,
  ShareSchema,
  JobStatusSchema,
  GeoprocessingOpSchema,
  GeoAggregateOpSchema,
  AnnotationContentSchema,
  AnnotationAnchorSchema,
  CreateAnnotationSchema,
  UpdateAnnotationSchema,
} from '../index.js';

describe('rejects invalid top-level inputs', () => {
  it('UserSchema rejects null', () => {
    expect(() => UserSchema.parse(null)).toThrow();
  });

  it('UserSchema rejects undefined', () => {
    expect(() => UserSchema.parse(undefined)).toThrow();
  });

  it('CreateMapSchema rejects null', () => {
    expect(() => CreateMapSchema.parse(null)).toThrow();
  });
});

describe('UserSchema', () => {
  it('parses valid user', () => {
    const result = UserSchema.parse({
      id: '00000000-0000-0000-0000-000000000001',
      email: 'test@example.com',
      name: 'Test User',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.email).toBe('test@example.com');
    expect(result.id).toBe('00000000-0000-0000-0000-000000000001');
    expect(result.name).toBe('Test User');
  });

  it('rejects invalid email', () => {
    expect(() =>
      UserSchema.parse({
        id: '00000000-0000-0000-0000-000000000001',
        email: 'not-an-email',
        name: 'Test',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ).toThrow();
  });
});

describe('CreateUserSchema', () => {
  it('rejects password shorter than 8 characters', () => {
    expect(() =>
      CreateUserSchema.parse({ email: 'a@b.com', name: 'Test', password: 'short' })
    ).toThrow();
  });

  it('parses valid signup input', () => {
    const result = CreateUserSchema.parse({
      email: 'a@b.com',
      name: 'Test User',
      password: 'securepassword',
    });
    expect(result.email).toBe('a@b.com');
    expect(result.password).toBe('securepassword');
    expect(result.name).toBe('Test User');
  });
});

describe('LoginSchema', () => {
  it('rejects empty password', () => {
    expect(() => LoginSchema.parse({ email: 'a@b.com', password: '' })).toThrow();
  });
});

describe('ViewportSchema', () => {
  it('applies defaults for bearing and pitch', () => {
    const result = ViewportSchema.parse({ center: [0, 0], zoom: 10 });
    // defaults: north-up, top-down
    expect(result.bearing).toBe(0);
    expect(result.pitch).toBe(0);
  });

  it('rejects invalid zoom', () => {
    expect(() => ViewportSchema.parse({ center: [0, 0], zoom: 30 })).toThrow();
  });
});

describe('MapSchema', () => {
  it('parses valid map', () => {
    const map = MapSchema.parse({
      id: '00000000-0000-0000-0000-000000000001',
      userId: '00000000-0000-0000-0000-000000000002',
      title: 'My Map',
      description: null,
      viewport: { center: [-122.4, 37.8], zoom: 12 },
      basemap: 'osm',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(map.title).toBe('My Map');
    expect(map.id).toBe('00000000-0000-0000-0000-000000000001');
    expect(map.userId).toBe('00000000-0000-0000-0000-000000000002');
  });
});

describe('CreateMapSchema', () => {
  it('parses minimal input', () => {
    const parsed = CreateMapSchema.safeParse({ title: 'New Map' });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.title).toBe('New Map');
  });

  it('rejects empty title', () => {
    expect(() => CreateMapSchema.parse({ title: '' })).toThrow();
  });
});

describe('GeometrySchema', () => {
  it('parses Point geometry', () => {
    const result = GeometrySchema.parse({ type: 'Point', coordinates: [-122.4, 37.8] });
    expect(result.type).toBe('Point');
  });

  it('parses LineString geometry', () => {
    const result = GeometrySchema.parse({
      type: 'LineString',
      coordinates: [
        [-122.4, 37.8],
        [-122.5, 37.9],
      ],
    });
    expect(result.type).toBe('LineString');
  });

  it('parses Polygon geometry', () => {
    const result = GeometrySchema.parse({
      type: 'Polygon',
      coordinates: [
        [
          [-122.4, 37.8],
          [-122.5, 37.8],
          [-122.5, 37.9],
          [-122.4, 37.9],
          [-122.4, 37.8],
        ],
      ],
    });
    expect(result.type).toBe('Polygon');
  });

  it('rejects unknown geometry type', () => {
    expect(() =>
      GeometrySchema.parse({ type: 'InvalidType', coordinates: [] })
    ).toThrow();
  });
});

describe('GeoJSONFeatureSchema', () => {
  it('parses a valid Feature', () => {
    const result = GeoJSONFeatureSchema.parse({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { name: 'test' },
    });
    expect(result.type).toBe('Feature');
    expect(result.geometry).toBeDefined();
    expect(result.properties).toEqual({ name: 'test' });
  });

  it('allows null properties', () => {
    const result = GeoJSONFeatureSchema.parse({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: null,
    });
    expect(result.properties).toBeNull();
  });
});

describe('GeoJSONFeatureCollectionSchema', () => {
  it('parses an empty FeatureCollection', () => {
    const result = GeoJSONFeatureCollectionSchema.parse({
      type: 'FeatureCollection',
      features: [],
    });
    expect(result.features).toHaveLength(0);
  });
});

describe('LayerStyleSchema', () => {
  it('applies simple default type', () => {
    const result = LayerStyleSchema.parse({ paint: { 'circle-color': '#ff0000' } });
    expect(result.type).toBe('simple');
  });

  it('parses numeric type', () => {
    const result = LayerStyleSchema.parse({ type: 'numeric', paint: {} });
    expect(result.type).toBe('numeric');
  });

  it('parses config.labelAttribute', () => {
    const result = LayerStyleSchema.parse({
      paint: {},
      config: { labelAttribute: 'name' },
    });
    expect(result.config?.labelAttribute).toBe('name');
  });

  it('parses label block', () => {
    const result = LayerStyleSchema.parse({
      paint: {},
      label: { visible: true, minZoom: 8, color: '#000', haloColor: '#fff', fontSize: 14 },
    });
    expect(result.label?.minZoom).toBe(8);
    expect(result.label?.fontSize).toBe(14);
  });

  it('rejects invalid minZoom > 22', () => {
    expect(() =>
      LayerStyleSchema.parse({ paint: {}, label: { minZoom: 25 } })
    ).toThrow();
  });

  it('parses config.categories as string array', () => {
    const result = LayerStyleSchema.parse({
      paint: {},
      type: 'categorical',
      config: { categoricalAttribute: 'status', categories: ['open', 'closed'] },
    });
    expect(result.config?.categories).toEqual(['open', 'closed']);
  });

  it('parses config.steps as [number, string][] tuples', () => {
    const result = LayerStyleSchema.parse({
      paint: {},
      type: 'numeric',
      config: {
        numericAttribute: 'pop',
        steps: [
          [0, '#eff3ff'],
          [1000, '#bdd7e7'],
          [5000, '#6baed6'],
        ],
      },
    });
    expect(result.config?.steps).toHaveLength(3);
    expect(result.config?.steps?.[0]).toEqual([0, '#eff3ff']);
  });

  it('rejects config.steps with non-number threshold', () => {
    expect(() =>
      LayerStyleSchema.parse({
        paint: {},
        config: { steps: [['not-a-number', '#ff0000']] },
      })
    ).toThrow();
  });

  it('parses config.showOther as boolean', () => {
    const result = LayerStyleSchema.parse({
      paint: {},
      config: { showOther: false },
    });
    expect(result.config?.showOther).toBe(false);
  });

  it('parses isClickable field', () => {
    const result = LayerStyleSchema.parse({ paint: {}, isClickable: false });
    expect(result.isClickable).toBe(false);
  });

  it('isClickable defaults to undefined (not false)', () => {
    const result = LayerStyleSchema.parse({ paint: {} });
    expect(result.isClickable).toBeUndefined();
  });

  it('parses attributes block with displayName and format', () => {
    const result = LayerStyleSchema.parse({
      paint: {},
      attributes: {
        population: {
          displayName: 'Population',
          format: { mantissa: 0, thousandSeparated: true },
        },
        name: { displayName: 'Park Name' },
      },
    });
    expect(result.attributes?.['population']?.displayName).toBe('Population');
    expect(result.attributes?.['population']?.format?.mantissa).toBe(0);
    expect(result.attributes?.['population']?.format?.thousandSeparated).toBe(true);
    expect(result.attributes?.['name']?.displayName).toBe('Park Name');
  });

  it('rejects attributes.format.mantissa > 10', () => {
    expect(() =>
      LayerStyleSchema.parse({
        paint: {},
        attributes: { value: { format: { mantissa: 15 } } },
      })
    ).toThrow();
  });

  it('rejects attributes.format.mantissa < 0', () => {
    expect(() =>
      LayerStyleSchema.parse({
        paint: {},
        attributes: { value: { format: { mantissa: -1 } } },
      })
    ).toThrow();
  });

  it('parses popup block with titleAttribute and keyAttributes', () => {
    const result = LayerStyleSchema.parse({
      paint: {},
      popup: {
        titleAttribute: 'name',
        keyAttributes: ['name', 'population', 'area'],
      },
    });
    expect(result.popup?.titleAttribute).toBe('name');
    expect(result.popup?.keyAttributes).toEqual(['name', 'population', 'area']);
  });

  it('parses popup block with only titleAttribute', () => {
    const result = LayerStyleSchema.parse({
      paint: {},
      popup: { titleAttribute: 'label' },
    });
    expect(result.popup?.titleAttribute).toBe('label');
    expect(result.popup?.keyAttributes).toBeUndefined();
  });

  it('parses popup block with empty keyAttributes', () => {
    const result = LayerStyleSchema.parse({
      paint: {},
      popup: { keyAttributes: [] },
    });
    expect(result.popup?.keyAttributes).toEqual([]);
  });

  it('parses filters as unknown array (FSL filter expressions)', () => {
    const result = LayerStyleSchema.parse({
      paint: {},
      filters: [
        ['status', 'eq', 'active'],
        ['population', 'gt', 1000],
      ],
    });
    expect(result.filters).toHaveLength(2);
    expect(result.filters?.[0]).toEqual(['status', 'eq', 'active']);
  });

  it('parses empty filters array', () => {
    const result = LayerStyleSchema.parse({ paint: {}, filters: [] });
    expect(result.filters).toEqual([]);
  });

  it('filters default to undefined when not provided', () => {
    const result = LayerStyleSchema.parse({ paint: {} });
    expect(result.filters).toBeUndefined();
  });

  it('parses highlightColor as a CSS color string', () => {
    const result = LayerStyleSchema.parse({ paint: {}, highlightColor: '#ff6b35' });
    expect(result.highlightColor).toBe('#ff6b35');
  });

  it('highlightColor defaults to undefined when not provided', () => {
    const result = LayerStyleSchema.parse({ paint: {} });
    expect(result.highlightColor).toBeUndefined();
  });

  it('parses isSandwiched as boolean', () => {
    const result = LayerStyleSchema.parse({ paint: {}, isSandwiched: true });
    expect(result.isSandwiched).toBe(true);
  });

  it('isSandwiched defaults to undefined when not provided', () => {
    const result = LayerStyleSchema.parse({ paint: {} });
    expect(result.isSandwiched).toBeUndefined();
  });

  it('parses config.classificationMethod equal_interval', () => {
    const result = LayerStyleSchema.parse({
      paint: {},
      type: 'numeric',
      config: { numericAttribute: 'pop', classificationMethod: 'equal_interval' },
    });
    expect(result.config?.classificationMethod).toBe('equal_interval');
  });

  it('parses config.classificationMethod quantile', () => {
    const result = LayerStyleSchema.parse({
      paint: {},
      type: 'numeric',
      config: { numericAttribute: 'income', classificationMethod: 'quantile', nClasses: 7 },
    });
    expect(result.config?.classificationMethod).toBe('quantile');
    expect(result.config?.nClasses).toBe(7);
  });

  it('rejects config.classificationMethod with unknown value', () => {
    expect(() =>
      LayerStyleSchema.parse({
        paint: {},
        config: { classificationMethod: 'jenks' },
      })
    ).toThrow();
  });

  it('rejects config.nClasses below 2', () => {
    expect(() =>
      LayerStyleSchema.parse({
        paint: {},
        config: { nClasses: 1 },
      })
    ).toThrow();
  });

  it('rejects config.nClasses above 9', () => {
    expect(() =>
      LayerStyleSchema.parse({
        paint: {},
        config: { nClasses: 10 },
      })
    ).toThrow();
  });

  it('classificationMethod and nClasses default to undefined', () => {
    const result = LayerStyleSchema.parse({ paint: {} });
    expect(result.config?.classificationMethod).toBeUndefined();
    expect(result.config?.nClasses).toBeUndefined();
  });

  it('parses type heatmap', () => {
    const result = LayerStyleSchema.parse({ paint: {}, type: 'heatmap' });
    expect(result.type).toBe('heatmap');
  });

  it('rejects unknown type value', () => {
    expect(() =>
      LayerStyleSchema.parse({ paint: {}, type: 'pointcloud' })
    ).toThrow();
  });

  it('parses heatmap config fields', () => {
    const result = LayerStyleSchema.parse({
      paint: {},
      type: 'heatmap',
      config: { heatmapRadius: 40, heatmapIntensity: 2.5, heatmapWeightAttribute: 'count' },
    });
    expect(result.config?.heatmapRadius).toBe(40);
    expect(result.config?.heatmapIntensity).toBe(2.5);
    expect(result.config?.heatmapWeightAttribute).toBe('count');
  });

  it('rejects heatmapRadius below 1', () => {
    expect(() =>
      LayerStyleSchema.parse({ paint: {}, config: { heatmapRadius: 0 } })
    ).toThrow();
  });

  it('rejects heatmapRadius above 200', () => {
    expect(() =>
      LayerStyleSchema.parse({ paint: {}, config: { heatmapRadius: 201 } })
    ).toThrow();
  });

  it('rejects heatmapIntensity below 0.1', () => {
    expect(() =>
      LayerStyleSchema.parse({ paint: {}, config: { heatmapIntensity: 0.05 } })
    ).toThrow();
  });

  it('rejects heatmapIntensity above 5', () => {
    expect(() =>
      LayerStyleSchema.parse({ paint: {}, config: { heatmapIntensity: 5.1 } })
    ).toThrow();
  });

  it('heatmap config fields default to undefined', () => {
    const result = LayerStyleSchema.parse({ paint: {} });
    expect(result.config?.heatmapRadius).toBeUndefined();
    expect(result.config?.heatmapIntensity).toBeUndefined();
    expect(result.config?.heatmapWeightAttribute).toBeUndefined();
  });
});

describe('JobStatusSchema', () => {
  it('parses all valid statuses', () => {
    for (const status of JobStatusSchema.options) {
      expect(JobStatusSchema.parse(status)).toBe(status);
    }
  });

  it('rejects invalid status', () => {
    expect(() => JobStatusSchema.parse('cancelled')).toThrow();
  });
});

describe('GeoprocessingOpSchema — discriminated union', () => {
  const validLayerId = '00000000-0000-0000-0000-000000000001';
  const validLayerIdB = '00000000-0000-0000-0000-000000000002';

  it('parses buffer op with distanceKm', () => {
    const op = GeoprocessingOpSchema.parse({ type: 'buffer', layerId: validLayerId, distanceKm: 5 });
    expect(op.type).toBe('buffer');
    if (op.type === 'buffer') expect(op.distanceKm).toBe(5);
  });

  it('rejects buffer op with non-positive distanceKm', () => {
    expect(() => GeoprocessingOpSchema.parse({ type: 'buffer', layerId: validLayerId, distanceKm: 0 })).toThrow();
    expect(() => GeoprocessingOpSchema.parse({ type: 'buffer', layerId: validLayerId, distanceKm: -1 })).toThrow();
  });

  it('rejects buffer op with distanceKm > 1000', () => {
    expect(() => GeoprocessingOpSchema.parse({ type: 'buffer', layerId: validLayerId, distanceKm: 1001 })).toThrow();
  });

  it('parses convex_hull op', () => {
    const op = GeoprocessingOpSchema.parse({ type: 'convex_hull', layerId: validLayerId });
    expect(op.type).toBe('convex_hull');
  });

  it('parses dissolve op with optional field', () => {
    const withField = GeoprocessingOpSchema.parse({ type: 'dissolve', layerId: validLayerId, field: 'category' });
    const noField   = GeoprocessingOpSchema.parse({ type: 'dissolve', layerId: validLayerId });
    expect(withField.type).toBe('dissolve');
    expect(noField.type).toBe('dissolve');
  });

  it('parses intersect op with two layer IDs', () => {
    const op = GeoprocessingOpSchema.parse({ type: 'intersect', layerIdA: validLayerId, layerIdB: validLayerIdB });
    expect(op.type).toBe('intersect');
  });

  it('parses clip op with two layer IDs', () => {
    const op = GeoprocessingOpSchema.parse({ type: 'clip', layerIdA: validLayerId, layerIdB: validLayerIdB });
    expect(op.type).toBe('clip');
  });

  it('rejects unknown op type', () => {
    expect(() => GeoprocessingOpSchema.parse({ type: 'shrink', layerId: validLayerId })).toThrow();
  });

  it('rejects non-UUID layerId', () => {
    expect(() => GeoprocessingOpSchema.parse({ type: 'union', layerId: 'not-a-uuid' })).toThrow();
  });

  it('parses point_in_polygon op with two UUIDs', () => {
    const op = GeoprocessingOpSchema.parse({
      type: 'point_in_polygon',
      layerIdPoints: validLayerId,
      layerIdPolygons: validLayerIdB,
    });
    expect(op.type).toBe('point_in_polygon');
    if (op.type === 'point_in_polygon') {
      expect(op.layerIdPoints).toBe(validLayerId);
      expect(op.layerIdPolygons).toBe(validLayerIdB);
    }
  });

  it('rejects point_in_polygon with non-UUID layerIdPoints', () => {
    expect(() =>
      GeoprocessingOpSchema.parse({
        type: 'point_in_polygon',
        layerIdPoints: 'bad-id',
        layerIdPolygons: validLayerIdB,
      })
    ).toThrow();
  });

  it('parses nearest_neighbor op with two UUIDs', () => {
    const op = GeoprocessingOpSchema.parse({
      type: 'nearest_neighbor',
      layerIdA: validLayerId,
      layerIdB: validLayerIdB,
    });
    expect(op.type).toBe('nearest_neighbor');
  });

  it('parses aggregate count op (no field required)', () => {
    const op = GeoprocessingOpSchema.parse({
      type: 'aggregate',
      layerIdPolygons: validLayerId,
      layerIdPoints: validLayerIdB,
      aggregation: 'count',
    });
    expect(op.type).toBe('aggregate');
    if (op.type === 'aggregate') expect(op.aggregation).toBe('count');
  });

  it('parses aggregate sum op with field', () => {
    const op = GeoprocessingOpSchema.parse({
      type: 'aggregate',
      layerIdPolygons: validLayerId,
      layerIdPoints: validLayerIdB,
      aggregation: 'sum',
      field: 'population',
      outputField: 'total_pop',
    });
    if (op.type === 'aggregate') {
      expect(op.aggregation).toBe('sum');
      expect(op.field).toBe('population');
      expect(op.outputField).toBe('total_pop');
    }
  });

  // field-required invariant is enforced on GeoAggregateOpSchema (refined),
  // not on GeoprocessingOpSchema (which uses the base schema for discriminated union compat)
  it('rejects aggregate sum op without field (GeoAggregateOpSchema)', () => {
    expect(() =>
      GeoAggregateOpSchema.parse({
        type: 'aggregate',
        layerIdPolygons: validLayerId,
        layerIdPoints: validLayerIdB,
        aggregation: 'sum',
      })
    ).toThrow();
  });

  it('rejects aggregate avg op without field (GeoAggregateOpSchema)', () => {
    expect(() =>
      GeoAggregateOpSchema.parse({
        type: 'aggregate',
        layerIdPolygons: validLayerId,
        layerIdPoints: validLayerIdB,
        aggregation: 'avg',
      })
    ).toThrow();
  });

  it('parses aggregate avg op with field and no outputField', () => {
    const op = GeoprocessingOpSchema.parse({
      type: 'aggregate',
      layerIdPolygons: validLayerId,
      layerIdPoints: validLayerIdB,
      aggregation: 'avg',
      field: 'income',
    });
    if (op.type === 'aggregate') {
      expect(op.outputField).toBeUndefined();
    }
  });

  it('rejects unknown aggregation type', () => {
    expect(() =>
      GeoprocessingOpSchema.parse({
        type: 'aggregate',
        layerIdPolygons: validLayerId,
        layerIdPoints: validLayerIdB,
        aggregation: 'median',
        field: 'value',
      })
    ).toThrow();
  });
});

describe('ShareSchema', () => {
  it('parses valid share', () => {
    const share = ShareSchema.parse({
      id: '00000000-0000-0000-0000-000000000001',
      mapId: '00000000-0000-0000-0000-000000000002',
      token: 'abcdefghijklmnop',
      accessLevel: 'unlisted',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(share.accessLevel).toBe('unlisted');
    expect(share.mapId).toBe('00000000-0000-0000-0000-000000000002');
    expect(share.token).toBe('abcdefghijklmnop');
  });
});

// ─── AnnotationContentSchema ─────────────────────────────────────────────────

describe('AnnotationContentSchema — text', () => {
  it('parses a valid text annotation', () => {
    const result = AnnotationContentSchema.parse({ type: 'text', text: 'Hello world' });
    expect(result.type).toBe('text');
    if (result.type === 'text') {
      expect(result.text).toBe('Hello world');
    }
  });

  it('rejects empty text (min 1)', () => {
    expect(() => AnnotationContentSchema.parse({ type: 'text', text: '' })).toThrow();
  });

  it('rejects text longer than 5 000 characters', () => {
    expect(() =>
      AnnotationContentSchema.parse({ type: 'text', text: 'x'.repeat(5001) })
    ).toThrow();
  });
});

describe('AnnotationContentSchema — emoji', () => {
  it('parses emoji with optional label', () => {
    const result = AnnotationContentSchema.parse({ type: 'emoji', emoji: '🌊', label: 'Ocean' });
    expect(result.type).toBe('emoji');
    if (result.type === 'emoji') {
      expect(result.emoji).toBe('🌊');
      expect(result.label).toBe('Ocean');
      expect(typeof result.emoji).toBe('string');
    }
  });

  it('parses emoji without label', () => {
    const result = AnnotationContentSchema.parse({ type: 'emoji', emoji: '🏔️' });
    expect(result.type).toBe('emoji');
  });

  it('rejects empty emoji string', () => {
    expect(() => AnnotationContentSchema.parse({ type: 'emoji', emoji: '' })).toThrow();
  });
});

describe('AnnotationContentSchema — gif', () => {
  it('parses a valid GIF with altText', () => {
    const result = AnnotationContentSchema.parse({
      type: 'gif',
      url: 'https://media.tenor.com/example.gif',
      altText: 'A dancing cat',
    });
    expect(result.type).toBe('gif');
  });

  it('rejects a non-URL gif url', () => {
    expect(() =>
      AnnotationContentSchema.parse({ type: 'gif', url: 'not-a-url' })
    ).toThrow();
  });
});

describe('AnnotationContentSchema — link', () => {
  it('parses a full link card', () => {
    const result = AnnotationContentSchema.parse({
      type: 'link',
      url: 'https://example.com',
      title: 'Example',
      description: 'A test site',
    });
    expect(result.type).toBe('link');
  });

  it('parses a link card with URL only', () => {
    const result = AnnotationContentSchema.parse({ type: 'link', url: 'https://example.com' });
    expect(result.type).toBe('link');
  });
});

describe('AnnotationContentSchema — iiif', () => {
  it('parses a IIIF content object without navPlace', () => {
    const result = AnnotationContentSchema.parse({
      type: 'iiif',
      manifestUrl: 'https://example.org/iiif/manifest.json',
      label: 'Test Manuscript',
    });
    expect(result.type).toBe('iiif');
    if (result.type === 'iiif') {
      expect(result.navPlace).toBeUndefined();
    }
  });

  it('parses a IIIF content object with a navPlace FeatureCollection', () => {
    const result = AnnotationContentSchema.parse({
      type: 'iiif',
      manifestUrl: 'https://example.org/iiif/manifest.json',
      navPlace: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [-122.4, 37.8] }, properties: {} },
        ],
      },
    });
    if (result.type === 'iiif') {
      expect(result.navPlace?.features).toHaveLength(1);
    }
  });

  it('rejects invalid manifestUrl', () => {
    expect(() =>
      AnnotationContentSchema.parse({ type: 'iiif', manifestUrl: 'not-a-url' })
    ).toThrow();
  });
});

// ─── AnnotationAnchorSchema ───────────────────────────────────────────────────

describe('AnnotationAnchorSchema', () => {
  it('parses a valid WGS84 Point', () => {
    const input = { type: 'Point' as const, coordinates: [-122.4, 37.8] as [number, number] };
    const result = AnnotationAnchorSchema.parse(input);
    expect(result.coordinates).toEqual(input.coordinates);
    expect(result.type).toBe('Point');
    expect(result.coordinates[0]).toBe(-122.4);
    expect(result.coordinates[1]).toBe(37.8);
  });

  it('rejects longitude > 180', () => {
    expect(() =>
      AnnotationAnchorSchema.parse({ type: 'Point', coordinates: [181, 0] })
    ).toThrow();
  });

  it('rejects latitude > 90', () => {
    expect(() =>
      AnnotationAnchorSchema.parse({ type: 'Point', coordinates: [0, 91] })
    ).toThrow();
  });

  it('rejects longitude < -180', () => {
    expect(() =>
      AnnotationAnchorSchema.parse({ type: 'Point', coordinates: [-181, 0] })
    ).toThrow();
  });
});

// ─── CreateAnnotationSchema / UpdateAnnotationSchema ─────────────────────────

describe('CreateAnnotationSchema', () => {
  it('parses a valid create input', () => {
    const result = CreateAnnotationSchema.parse({
      mapId: '00000000-0000-0000-0000-000000000001',
      anchor: { type: 'Point', coordinates: [0, 0] },
      content: { type: 'text', text: 'Hello' },
    });
    expect(result.content.type).toBe('text');
  });

  it('rejects invalid anchor coordinates', () => {
    expect(() =>
      CreateAnnotationSchema.parse({
        mapId: '00000000-0000-0000-0000-000000000001',
        anchor: { type: 'Point', coordinates: [200, 0] },
        content: { type: 'text', text: 'Hello' },
      })
    ).toThrow();
  });
});

describe('UpdateAnnotationSchema', () => {
  it('accepts any valid content variant', () => {
    const result = UpdateAnnotationSchema.parse({
      id: '00000000-0000-0000-0000-000000000001',
      content: { type: 'emoji', emoji: '🔥' },
    });
    expect(result.content.type).toBe('emoji');
  });
});

// ─── AnnotationContentSchema — measurement ────────────────────────────────────

describe('AnnotationContentSchema — measurement', () => {
  it('validates a distance measurement', () => {
    const result = AnnotationContentSchema.parse({
      type: 'measurement',
      measurementType: 'distance',
      value: 1240,
      unit: 'km',
      displayValue: '1.24 km',
    });
    expect(result.type).toBe('measurement');
    if (result.type === 'measurement') {
      expect(result.measurementType).toBe('distance');
      expect(result.value).toBe(1240);
      expect(result.unit).toBe('km');
      expect(result.displayValue).toBe('1.24 km');
      expect(result.label).toBeUndefined();
    }
  });

  it('validates a measurement with optional label', () => {
    const result = AnnotationContentSchema.parse({
      type: 'measurement',
      measurementType: 'area',
      value: 5000000,
      unit: 'ha',
      displayValue: '500 ha',
      label: 'Central Park estimate',
    });
    expect(result.type).toBe('measurement');
    if (result.type === 'measurement') {
      expect(result.measurementType).toBe('area');
      expect(result.label).toBe('Central Park estimate');
    }
  });

  it('rejects measurement with invalid measurementType', () => {
    expect(() =>
      AnnotationContentSchema.parse({
        type: 'measurement',
        measurementType: 'volume',
        value: 100,
        unit: 'm3',
        displayValue: '100 m3',
      })
    ).toThrow();
  });

  it('rejects measurement missing required fields', () => {
    expect(() =>
      AnnotationContentSchema.parse({
        type: 'measurement',
        measurementType: 'distance',
        // missing value, unit, displayValue
      })
    ).toThrow();
  });

  it('rejects measurement with empty unit string', () => {
    expect(() =>
      AnnotationContentSchema.parse({
        type: 'measurement',
        measurementType: 'distance',
        value: 100,
        unit: '',
        displayValue: '100 m',
      })
    ).toThrow();
  });
});
