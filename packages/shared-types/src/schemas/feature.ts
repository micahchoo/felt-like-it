import { z } from 'zod';

const CoordinateSchema = z.tuple([z.number(), z.number()]).or(
  z.tuple([z.number(), z.number(), z.number()])
);

const PointGeometrySchema = z.object({
  type: z.literal('Point'),
  coordinates: CoordinateSchema,
});

const LineStringGeometrySchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(CoordinateSchema).min(2),
});

const LinearRingSchema = z.array(CoordinateSchema).min(4);

const PolygonGeometrySchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(LinearRingSchema).min(1),
});

const MultiPointGeometrySchema = z.object({
  type: z.literal('MultiPoint'),
  coordinates: z.array(CoordinateSchema),
});

const MultiLineStringGeometrySchema = z.object({
  type: z.literal('MultiLineString'),
  coordinates: z.array(z.array(CoordinateSchema).min(2)),
});

const MultiPolygonGeometrySchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(LinearRingSchema).min(1)),
});

export const GeometrySchema = z.discriminatedUnion('type', [
  PointGeometrySchema,
  LineStringGeometrySchema,
  PolygonGeometrySchema,
  MultiPointGeometrySchema,
  MultiLineStringGeometrySchema,
  MultiPolygonGeometrySchema,
]);

export const FeatureSchema = z.object({
  id: z.string().uuid(),
  layerId: z.string().uuid(),
  geometry: GeometrySchema,
  properties: z.record(z.string(), z.unknown()),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const GeoJSONFeatureSchema = z.object({
  type: z.literal('Feature'),
  id: z.union([z.string(), z.number()]).optional(),
  geometry: GeometrySchema,
  properties: z.record(z.string(), z.unknown()).nullable(),
});

export const GeoJSONFeatureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(GeoJSONFeatureSchema),
});
