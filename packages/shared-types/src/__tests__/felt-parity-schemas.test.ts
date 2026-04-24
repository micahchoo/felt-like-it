import { describe, it, expect } from 'vitest';
import {
  AnnotationStyleSchema,
  AnnotationGroupSchema,
  CreateAnnotationGroupSchema,
  UpdateAnnotationObjectSchema,
  CreateAnnotationObjectSchema,
} from '../index.js';

/**
 * Felt-parity contract skeleton (plan Wave 0, cycle 01).
 * Validates the four schema extensions every later wave consumes.
 */

describe('Felt-parity schema skeleton', () => {
  describe('AnnotationStyleSchema', () => {
    it('accepts a well-formed style payload', () => {
      const result = AnnotationStyleSchema.safeParse({
        strokeWidth: 3,
        strokeStyle: 'dashed',
        strokeColor: '#ff0000',
        strokeOpacity: 0.5,
        fillColor: '#00ff00',
        fillOpacity: 0.2,
        endcaps: 'both',
        textStyle: 'italic',
        textAlign: 'center',
        showLabel: true,
      });
      expect(result.success).toBe(true);
    });

    it('rejects strokeOpacity out of range', () => {
      const result = AnnotationStyleSchema.safeParse({ strokeOpacity: 1.5 });
      expect(result.success).toBe(false);
    });

    it('rejects malformed hex colour (strict contract)', () => {
      const result = AnnotationStyleSchema.safeParse({ strokeColor: 'red' });
      expect(result.success).toBe(false);
    });

    it('rejects unknown fields at the API boundary (strict)', () => {
      // Integrator persona retries on bad payload shape — must fail fast.
      const result = AnnotationStyleSchema.safeParse({
        strokeWidth: 2,
        // @ts-expect-error unknown key must be rejected by strict()
        unknownProp: 'evil',
      });
      expect(result.success).toBe(false);
    });

    it('accepts empty object (all fields optional for partial updates)', () => {
      expect(AnnotationStyleSchema.safeParse({}).success).toBe(true);
    });
  });

  describe('AnnotationGroupSchema', () => {
    it('round-trips a valid group', () => {
      const group = {
        id: '11111111-1111-4111-8111-111111111111',
        mapId: '22222222-2222-4222-8222-222222222222',
        parentGroupId: null,
        name: 'Field sites',
        ordinal: 0,
        visible: true,
      };
      const result = AnnotationGroupSchema.safeParse(group);
      expect(result.success).toBe(true);
    });

    it('rejects a name longer than 200 chars', () => {
      const result = AnnotationGroupSchema.safeParse({
        id: '11111111-1111-4111-8111-111111111111',
        mapId: '22222222-2222-4222-8222-222222222222',
        parentGroupId: null,
        name: 'x'.repeat(201),
        ordinal: 0,
        visible: true,
      });
      expect(result.success).toBe(false);
    });

    it('CreateAnnotationGroupSchema does not require id or ordinal', () => {
      const result = CreateAnnotationGroupSchema.safeParse({
        mapId: '22222222-2222-4222-8222-222222222222',
        parentGroupId: null,
        name: 'Candidates',
        visible: true,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('AnnotationObjectSchema extensions', () => {
    const mapId = '22222222-2222-4222-8222-222222222222';
    const validAnchor = { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } } as const;
    const validContent = { kind: 'single', body: { type: 'text', text: 'x' } } as const;

    it('Create accepts optional name, description, groupId, style', () => {
      const result = CreateAnnotationObjectSchema.safeParse({
        mapId,
        anchor: validAnchor,
        content: validContent,
        name: 'Alpha',
        description: 'Body',
        groupId: '33333333-3333-4333-8333-333333333333',
        style: { strokeWidth: 2 },
      });
      expect(result.success).toBe(true);
    });

    it('Create still accepts payload with none of the new fields (backward compat)', () => {
      const result = CreateAnnotationObjectSchema.safeParse({
        mapId,
        anchor: validAnchor,
        content: validContent,
      });
      expect(result.success).toBe(true);
    });

    it('Update rejects name longer than 200 chars', () => {
      const result = UpdateAnnotationObjectSchema.safeParse({
        id: '44444444-4444-4444-8444-444444444444',
        version: 1,
        name: 'x'.repeat(201),
      });
      expect(result.success).toBe(false);
    });

    it('Update accepts nulling out description explicitly', () => {
      const result = UpdateAnnotationObjectSchema.safeParse({
        id: '44444444-4444-4444-8444-444444444444',
        version: 1,
        description: null,
      });
      expect(result.success).toBe(true);
    });
  });
});
