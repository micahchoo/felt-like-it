// @vitest-environment node
/**
 * Tests for the AnnotationObject → DataTable row projection (Phase 3 Wave D-α).
 *
 * Covers:
 *  1. Geometry extraction per anchor type (point/path/region/measurement
 *     surface their geometry; feature/viewport degrade to a [0,0] Point).
 *  2. Properties projected: name, description, anchor_type, body.
 *  3. _id carries the annotation id for row-click handlers (and is hidden
 *     from DataTable's column derivation since it starts with _).
 *  4. Layer filtering: annotations matching the requested layerId pass
 *     through; mismatches and null layerId are excluded.
 */
import { describe, it, expect } from 'vitest';
import type { AnnotationObject } from '@felt-like-it/shared-types';
import {
  annotationToFeatureRow,
  annotationsToLayerFeatureRows,
} from '$lib/components/data/annotation-row-mapper.js';

const BASE: Omit<AnnotationObject, 'id' | 'anchor' | 'content' | 'layerId'> = {
  mapId: 'map-001',
  parentId: null,
  authorId: null,
  authorName: 'tester',
  templateId: null,
  name: null,
  description: null,
  groupId: null,
  style: null,
  ordinal: 0,
  version: 1,
  createdAt: new Date('2026-04-25T12:00:00Z'),
  updatedAt: new Date('2026-04-25T12:00:00Z'),
};

const POINT: AnnotationObject = {
  ...BASE,
  id: 'a-point',
  layerId: 'layer-A',
  anchor: { type: 'point', geometry: { type: 'Point', coordinates: [10, 20] } },
  content: { kind: 'single', body: { type: 'text', text: 'hello' } },
  name: 'Point One',
  description: 'pretty pin',
};

const PATH: AnnotationObject = {
  ...BASE,
  id: 'a-path',
  layerId: 'layer-A',
  anchor: { type: 'path', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
  content: { kind: 'single', body: { type: 'text', text: '' } },
};

const REGION: AnnotationObject = {
  ...BASE,
  id: 'a-region',
  layerId: 'layer-A',
  anchor: {
    type: 'region',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
  },
  content: { kind: 'single', body: { type: 'text', text: '' } },
};

const MEASUREMENT: AnnotationObject = {
  ...BASE,
  id: 'a-meas',
  layerId: 'layer-A',
  anchor: {
    type: 'measurement',
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
  },
  content: { kind: 'single', body: { type: 'text', text: '' } },
};

const VIEWPORT_ANNO: AnnotationObject = {
  ...BASE,
  id: 'a-vp',
  layerId: 'layer-A',
  anchor: { type: 'viewport' },
  content: { kind: 'single', body: { type: 'text', text: '' } },
};

const FOREIGN_LAYER: AnnotationObject = {
  ...BASE,
  id: 'a-foreign',
  layerId: 'layer-B',
  anchor: { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } },
  content: { kind: 'single', body: { type: 'text', text: '' } },
};

const NO_LAYER: AnnotationObject = {
  ...BASE,
  id: 'a-no-layer',
  layerId: null,
  anchor: { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } },
  content: { kind: 'single', body: { type: 'text', text: '' } },
};

describe('annotationToFeatureRow', () => {
  describe('geometry extraction', () => {
    it('point anchor yields the same Point geometry', () => {
      const row = annotationToFeatureRow(POINT);
      expect(row.geometry).toEqual({ type: 'Point', coordinates: [10, 20] });
    });

    it('path anchor yields the same LineString geometry', () => {
      const row = annotationToFeatureRow(PATH);
      expect(row.geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
    });

    it('region anchor yields the same Polygon geometry', () => {
      const row = annotationToFeatureRow(REGION);
      expect(row.geometry).toEqual({
        type: 'Polygon',
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      });
    });

    it('measurement anchor yields its embedded geometry', () => {
      const row = annotationToFeatureRow(MEASUREMENT);
      expect(row.geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
    });

    it('viewport anchor degrades to a Point at [0,0]', () => {
      const row = annotationToFeatureRow(VIEWPORT_ANNO);
      expect(row.geometry).toEqual({ type: 'Point', coordinates: [0, 0] });
    });
  });

  describe('properties projection', () => {
    it('surfaces name, description, anchor_type, body', () => {
      const row = annotationToFeatureRow(POINT);
      expect(row.properties).toMatchObject({
        name: 'Point One',
        description: 'pretty pin',
        anchor_type: 'point',
        body: 'hello',
      });
    });

    it('null name + description become empty strings (DataTable-friendly)', () => {
      const row = annotationToFeatureRow(PATH);
      expect(row.properties?.['name']).toBe('');
      expect(row.properties?.['description']).toBe('');
    });

    it('non-text body falls back to empty string', () => {
      // single-emoji body — not the text variant
      const emojiAnno: AnnotationObject = {
        ...PATH,
        id: 'a-emoji',
        content: { kind: 'single', body: { type: 'emoji', emoji: '🌍' } },
      };
      const row = annotationToFeatureRow(emojiAnno);
      expect(row.properties?.['body']).toBe('');
    });

    it('_id carries the annotation id and is underscore-prefixed (hidden from DataTable columns)', () => {
      const row = annotationToFeatureRow(POINT);
      expect(row.properties?.['_id']).toBe('a-point');
    });
  });

  it('row.id matches the annotation id (used for tanstack cache + row click identity)', () => {
    const row = annotationToFeatureRow(REGION);
    expect(row.id).toBe('a-region');
  });
});

describe('annotationsToLayerFeatureRows', () => {
  const ALL = [POINT, PATH, REGION, MEASUREMENT, FOREIGN_LAYER, NO_LAYER];

  it('returns rows whose layerId matches the requested layer', () => {
    const rows = annotationsToLayerFeatureRows(ALL, 'layer-A');
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('a-point');
    expect(ids).toContain('a-path');
    expect(ids).toContain('a-region');
    expect(ids).toContain('a-meas');
  });

  it('excludes annotations on a different layer', () => {
    const rows = annotationsToLayerFeatureRows(ALL, 'layer-A');
    expect(rows.find((r) => r.id === 'a-foreign')).toBeUndefined();
  });

  it('excludes annotations with null layerId (map-scoped, not layer-scoped)', () => {
    const rows = annotationsToLayerFeatureRows(ALL, 'layer-A');
    expect(rows.find((r) => r.id === 'a-no-layer')).toBeUndefined();
  });

  it('returns empty array when no annotations match', () => {
    const rows = annotationsToLayerFeatureRows(ALL, 'layer-NEVER');
    expect(rows).toEqual([]);
  });

  it('returns empty array on empty input', () => {
    expect(annotationsToLayerFeatureRows([], 'layer-A')).toEqual([]);
  });
});
