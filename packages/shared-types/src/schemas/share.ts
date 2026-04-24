import { z } from 'zod';

export const AccessLevelSchema = z.enum(['public', 'unlisted']);

export const ShareSchema = z.object({
  id: z.string().uuid(),
  mapId: z.string().uuid(),
  token: z.string().min(16),
  accessLevel: AccessLevelSchema,
  /** F13.3 — optional expiration timestamp; null = no expiration. */
  expiresAt: z.date().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreateShareSchema = z.object({
  mapId: z.string().uuid(),
  accessLevel: AccessLevelSchema.default('unlisted'),
  /**
   * F13.3 — opt-in expiration. ISO string at the API boundary; pass `null`
   * (or omit) for "no expiration." Server stores as TIMESTAMPTZ.
   */
  expiresAt: z.string().datetime().nullable().optional(),
});
