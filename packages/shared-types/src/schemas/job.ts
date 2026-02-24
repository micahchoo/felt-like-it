import { z } from 'zod';

export const JobStatusSchema = z.enum(['pending', 'processing', 'done', 'failed']);

export const ImportJobSchema = z.object({
  id: z.string().uuid(),
  mapId: z.string().uuid(),
  layerId: z.string().uuid().nullable(),
  status: JobStatusSchema,
  fileName: z.string(),
  fileSize: z.number().int().nonnegative(),
  errorMessage: z.string().nullable(),
  progress: z.number().int().min(0).max(100),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const ImportJobPayloadSchema = z.object({
  jobId: z.string().uuid(),
  mapId: z.string().uuid(),
  layerName: z.string(),
  filePath: z.string(),
  fileName: z.string(),
});
