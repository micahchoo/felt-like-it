import { z } from 'zod';

export const ViewportSchema = z.object({
  center: z.tuple([z.number(), z.number()]),
  zoom: z.number().min(0).max(24),
  bearing: z.number().optional().default(0),
  pitch: z.number().min(0).max(85).optional().default(0),
});

export const MapSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  viewport: ViewportSchema,
  basemap: z.string().default('osm'),
  layerCount: z.number().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreateMapSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

export const UpdateMapSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  viewport: ViewportSchema.optional(),
  basemap: z.string().optional(),
  version: z.number().int().positive().optional(),
});
