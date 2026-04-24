/**
 * Annotation visual-style schema.
 *
 * Ships per Felt-parity plan Wave 0 (strategy cycle 01). All fields optional so
 * partial updates from `UpdateAnnotationObject` or a style-tab PATCH flow
 * through without re-validating absent fields. `.strict()` rejects unknown
 * keys at the API boundary — Integrator-persona retries need fast, specific
 * rejection rather than silent field drops.
 *
 * Felt surface mapped here: bible §4 (Styling & grouping → Felt Help Center).
 */

import { z } from 'zod';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const AnnotationStyleSchema = z
  .object({
    /** Line / polygon outline thickness in CSS px. */
    strokeWidth: z.number().min(0).max(40).optional(),
    /** Outline pattern. `dashed` / `dotted` render via MapLibre dash arrays. */
    strokeStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
    strokeColor: z.string().regex(HEX_COLOR).optional(),
    strokeOpacity: z.number().min(0).max(1).optional(),
    fillColor: z.string().regex(HEX_COLOR).optional(),
    fillOpacity: z.number().min(0).max(1).optional(),
    /** Only applies to route/line anchors. */
    endcaps: z.enum(['none', 'start', 'end', 'both']).optional(),
    /** Only applies to text / note / pin-label content. */
    textStyle: z.enum(['regular', 'italic', 'light', 'caps']).optional(),
    textAlign: z.enum(['left', 'center', 'right']).optional(),
    /** Pins only. Toggles the built-in name-label render. */
    showLabel: z.boolean().optional(),
  })
  .strict();

export type AnnotationStyle = z.infer<typeof AnnotationStyleSchema>;
