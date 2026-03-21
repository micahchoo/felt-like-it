import type { z } from 'zod';
import type {
  UserSchema,
  CreateUserSchema,
  UpdateUserSchema,
  LoginSchema,
} from './schemas/user.js';
import type { MapSchema, CreateMapSchema, UpdateMapSchema, ViewportSchema } from './schemas/map.js';
import type {
  LayerSchema,
  CreateLayerSchema,
  UpdateLayerSchema,
  LayerTypeSchema,
} from './schemas/layer.js';
import type {
  FeatureSchema,
  GeometrySchema,
  GeoJSONFeatureSchema,
  GeoJSONFeatureCollectionSchema,
} from './schemas/feature.js';
import type { LayerStyleSchema, LegendEntrySchema } from './schemas/style.js';
import type { ShareSchema, CreateShareSchema, AccessLevelSchema } from './schemas/share.js';
import type {
  ImportJobSchema,
  JobStatusSchema,
  ImportJobPayloadSchema,
} from './schemas/job.js';
import type { AuditLogEntrySchema } from './schemas/audit-log.js';

export type User = z.infer<typeof UserSchema>;
export type CreateUser = z.infer<typeof CreateUserSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;

export type MapRecord = z.infer<typeof MapSchema>;
export type CreateMap = z.infer<typeof CreateMapSchema>;
export type UpdateMap = z.infer<typeof UpdateMapSchema>;
export type Viewport = z.infer<typeof ViewportSchema>;

export type Layer = z.infer<typeof LayerSchema>;
export type CreateLayer = z.infer<typeof CreateLayerSchema>;
export type UpdateLayer = z.infer<typeof UpdateLayerSchema>;
export type LayerType = z.infer<typeof LayerTypeSchema>;

export type Feature = z.infer<typeof FeatureSchema>;
export type Geometry = z.infer<typeof GeometrySchema>;
export type GeoJSONFeature = z.infer<typeof GeoJSONFeatureSchema>;
export type GeoJSONFeatureCollection = z.infer<typeof GeoJSONFeatureCollectionSchema>;

export type LayerStyle = z.infer<typeof LayerStyleSchema>;
export type LegendEntry = z.infer<typeof LegendEntrySchema>;

export type Share = z.infer<typeof ShareSchema>;
export type CreateShare = z.infer<typeof CreateShareSchema>;
export type AccessLevel = z.infer<typeof AccessLevelSchema>;

export type ImportJob = z.infer<typeof ImportJobSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type ImportJobPayload = z.infer<typeof ImportJobPayloadSchema>;

export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;
