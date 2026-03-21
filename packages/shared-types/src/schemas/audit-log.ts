import { z } from 'zod';

export const AuditLogEntrySchema = z.object({
  id: z.string(),
  userId: z.string().uuid().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  mapId: z.string().uuid().nullable(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.date(),
});
