/**
 * Annotation groups (folders) schema.
 *
 * Ships per Felt-parity plan Wave 0 (strategy cycle 01). Groups are the
 * Sidebar List's primary organizing primitive (bible §3). `parentGroupId`
 * supports one level of nesting today; deeper nesting is an open question
 * tracked on task 2.1 of the plan.
 */

import { z } from 'zod';

export const AnnotationGroupSchema = z.object({
  id: z.string().uuid(),
  mapId: z.string().uuid(),
  parentGroupId: z.string().uuid().nullable(),
  name: z.string().min(1).max(200),
  /** Relative sort order within the parent scope. Assigned by the service. */
  ordinal: z.number().int(),
  visible: z.boolean(),
});

export type AnnotationGroup = z.infer<typeof AnnotationGroupSchema>;

/** POST /annotation-groups body. Service assigns id + appends ordinal. */
export const CreateAnnotationGroupSchema = AnnotationGroupSchema.omit({
  id: true,
  ordinal: true,
}).extend({
  ordinal: z.number().int().optional(),
});

export type CreateAnnotationGroup = z.infer<typeof CreateAnnotationGroupSchema>;

/** PATCH body — partial update. */
export const UpdateAnnotationGroupSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(200).optional(),
    parentGroupId: z.string().uuid().nullable().optional(),
    ordinal: z.number().int().optional(),
    visible: z.boolean().optional(),
  })
  .strict();

export type UpdateAnnotationGroup = z.infer<typeof UpdateAnnotationGroupSchema>;
