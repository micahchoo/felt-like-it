// @vitest-environment node
import { describe, test, expect } from 'vitest';
import { queryKeys } from '$lib/utils/query-keys.js';

describe('queryKeys', () => {
  describe('annotations', () => {
    test('all returns base key', () => {
      expect(queryKeys.annotations.all).toEqual(['annotations']);
    });

    test('list includes mapId', () => {
      expect(queryKeys.annotations.list({ mapId: 'map-1' }))
        .toEqual(['annotations', 'list', { mapId: 'map-1' }]);
    });

    test('thread includes annotationId', () => {
      expect(queryKeys.annotations.thread({ annotationId: 'ann-1' }))
        .toEqual(['annotations', 'getThread', { annotationId: 'ann-1' }]);
    });

    test('invalidating all clears list and thread keys', () => {
      const allKey = queryKeys.annotations.all;
      const listKey = queryKeys.annotations.list({ mapId: 'map-1' });
      const threadKey = queryKeys.annotations.thread({ annotationId: 'ann-1' });
      expect(listKey[0]).toBe(allKey[0]);
      expect(threadKey[0]).toBe(allKey[0]);
    });
  });

  describe('comments', () => {
    test('list includes mapId', () => {
      expect(queryKeys.comments.list({ mapId: 'map-1' }))
        .toEqual(['comments', 'list', { mapId: 'map-1' }]);
    });
  });

  describe('features', () => {
    test('list includes layerId', () => {
      expect(queryKeys.features.list({ layerId: 'layer-1' }))
        .toEqual(['features', 'list', { layerId: 'layer-1' }]);
    });
  });

  describe('layers', () => {
    test('list includes mapId', () => {
      expect(queryKeys.layers.list({ mapId: 'map-1' }))
        .toEqual(['layers', 'list', { mapId: 'map-1' }]);
    });
  });

  test('different mapIds produce different keys', () => {
    const key1 = queryKeys.annotations.list({ mapId: 'map-1' });
    const key2 = queryKeys.annotations.list({ mapId: 'map-2' });
    expect(key1).not.toEqual(key2);
  });
});
