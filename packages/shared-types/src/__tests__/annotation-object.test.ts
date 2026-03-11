// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  AnchorSchema,
  AnnotationObjectContentSchema,
  CreateAnnotationObjectSchema,
} from '../schemas/annotation-object.js';

describe('AnchorSchema', () => {
  it('validates a point anchor', () => {
    const result = AnchorSchema.safeParse({
      type: 'point',
      geometry: { type: 'Point', coordinates: [-122.4, 37.8] },
    });
    expect(result.success).toBe(true);
  });

  it('validates a region anchor', () => {
    const ring = [[-122, 37], [-122, 38], [-121, 38], [-121, 37], [-122, 37]];
    const result = AnchorSchema.safeParse({
      type: 'region',
      geometry: { type: 'Polygon', coordinates: [ring] },
    });
    expect(result.success).toBe(true);
  });

  it('validates a feature anchor', () => {
    const result = AnchorSchema.safeParse({
      type: 'feature',
      featureId: 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa',
      layerId: 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb',
    });
    expect(result.success).toBe(true);
  });

  it('validates a viewport anchor without bounds', () => {
    const result = AnchorSchema.safeParse({ type: 'viewport' });
    expect(result.success).toBe(true);
  });

  it('validates a viewport anchor with bounds', () => {
    const result = AnchorSchema.safeParse({
      type: 'viewport',
      bounds: [-122.5, 37.7, -122.3, 37.9],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid anchor type', () => {
    const result = AnchorSchema.safeParse({ type: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('rejects point anchor with out-of-range coordinates', () => {
    const result = AnchorSchema.safeParse({
      type: 'point',
      geometry: { type: 'Point', coordinates: [999, 999] },
    });
    expect(result.success).toBe(false);
  });
});

describe('AnnotationObjectContentSchema', () => {
  it('validates single content', () => {
    const result = AnnotationObjectContentSchema.safeParse({
      kind: 'single',
      body: { type: 'text', text: 'hello' },
    });
    expect(result.success).toBe(true);
  });

  it('validates slotted content', () => {
    const result = AnnotationObjectContentSchema.safeParse({
      kind: 'slotted',
      slots: {
        notes: { type: 'text', text: 'field notes' },
        photo: null,
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects slotted content with invalid slot body', () => {
    const result = AnnotationObjectContentSchema.safeParse({
      kind: 'slotted',
      slots: {
        notes: { type: 'text' }, // missing required `text` field
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('CreateAnnotationObjectSchema', () => {
  it('validates a minimal create input', () => {
    const result = CreateAnnotationObjectSchema.safeParse({
      mapId: 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb',
      anchor: { type: 'point', geometry: { type: 'Point', coordinates: [-122.4, 37.8] } },
      content: { kind: 'single', body: { type: 'text', text: 'hello' } },
    });
    expect(result.success).toBe(true);
  });

  it('validates a reply create input', () => {
    const result = CreateAnnotationObjectSchema.safeParse({
      mapId: 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb',
      parentId: 'cccccccc-0000-0000-0000-cccccccccccc',
      anchor: { type: 'point', geometry: { type: 'Point', coordinates: [-122.4, 37.8] } },
      content: { kind: 'single', body: { type: 'text', text: 'reply' } },
    });
    expect(result.success).toBe(true);
  });
});
