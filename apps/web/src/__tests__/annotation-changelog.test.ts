// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildAddPatch, buildModPatch, buildDelPatch } from '../lib/server/annotations/changelog.js';
import type { AnnotationObject } from '@felt-like-it/shared-types';

const MOCK_OBJECT: AnnotationObject = {
  id: 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa',
  mapId: 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb',
  parentId: null,
  authorId: 'cccccccc-0000-0000-0000-cccccccccccc',
  authorName: 'Test User',
  anchor: { type: 'point', geometry: { type: 'Point', coordinates: [-122.4, 37.8] } },
  content: { kind: 'single', body: { type: 'text', text: 'hello' } },
  templateId: null,
  ordinal: 0,
  version: 1,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

describe('buildAddPatch', () => {
  it('creates add patch with full object snapshot and del inverse', () => {
    const { patch, inverse } = buildAddPatch(MOCK_OBJECT);
    expect(patch.op).toBe('add');
    expect(patch.object.id).toBe(MOCK_OBJECT.id);
    expect(inverse.op).toBe('del');
    expect(inverse.object_id).toBe(MOCK_OBJECT.id);
  });
});

describe('buildModPatch', () => {
  it('creates mod patch with changed attrs and old values as inverse', () => {
    const newContent = { kind: 'single' as const, body: { type: 'text' as const, text: 'updated' } };
    const oldContent = MOCK_OBJECT.content;
    const { patch, inverse } = buildModPatch({ content: newContent }, { content: oldContent });
    expect(patch.op).toBe('mod');
    expect(patch.attrs.content).toEqual(newContent);
    expect(inverse.op).toBe('mod');
    expect(inverse.attrs.content).toEqual(oldContent);
  });
});

describe('buildDelPatch', () => {
  it('creates del patch and add inverse with full snapshot', () => {
    const { patch, inverse } = buildDelPatch(MOCK_OBJECT);
    expect(patch.op).toBe('del');
    expect(patch.object_id).toBe(MOCK_OBJECT.id);
    expect(inverse.op).toBe('add');
    expect(inverse.object.id).toBe(MOCK_OBJECT.id);
  });
});
