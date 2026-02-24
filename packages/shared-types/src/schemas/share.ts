import { z } from 'zod';

export const AccessLevelSchema = z.enum(['public', 'unlisted']);

export const ShareSchema = z.object({
  id: z.string().uuid(),
  mapId: z.string().uuid(),
  token: z.string().min(16),
  accessLevel: AccessLevelSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreateShareSchema = z.object({
  mapId: z.string().uuid(),
  accessLevel: AccessLevelSchema.default('unlisted'),
});
