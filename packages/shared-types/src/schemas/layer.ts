import { z } from 'zod';
import { LayerStyleSchema } from './style.js';

export const LayerTypeSchema = z.enum(['point', 'line', 'polygon', 'mixed']);

export const LayerSchema = z.object({
  id: z.string().uuid(),
  mapId: z.string().uuid(),
  name: z.string().min(1).max(200),
  type: LayerTypeSchema,
  style: LayerStyleSchema,
  visible: z.boolean().default(true),
  zIndex: z.number().int().min(0),
  sourceFileName: z.string().nullable(),
  featureCount: z.number().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreateLayerSchema = z.object({
  mapId: z.string().uuid(),
  name: z.string().min(1).max(200),
  type: LayerTypeSchema.optional().default('mixed'),
});

export const UpdateLayerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  style: LayerStyleSchema.optional(),
  visible: z.boolean().optional(),
  zIndex: z.number().int().min(0).optional(),
  version: z.number().int().positive().optional(),
});
