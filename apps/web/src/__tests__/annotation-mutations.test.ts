import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/svelte-query';

// Mock trpc — must be at module scope for vitest hoisting
vi.mock('$lib/utils/trpc.js', () => ({
  trpc: {
    annotations: {
      create: { mutate: vi.fn().mockResolvedValue({ id: 'test-id' }) },
      delete: { mutate: vi.fn().mockResolvedValue(undefined) },
      update: { mutate: vi.fn().mockResolvedValue({ id: 'test-id' }) },
      convertToPoint: { mutate: vi.fn().mockResolvedValue(undefined) },
    },
    comments: {
      create: { mutate: vi.fn().mockResolvedValue({ id: 'comment-id' }) },
      delete: { mutate: vi.fn().mockResolvedValue(undefined) },
      resolve: { mutate: vi.fn().mockResolvedValue(undefined) },
    },
  },
}));

vi.mock('$lib/utils/query-keys.js', () => ({
  queryKeys: {
    annotations: {
      list: (opts: { mapId: string }) => ['annotations', 'list', opts],
      thread: (opts: { annotationId: string }) => ['annotations', 'thread', opts],
    },
    comments: { list: (opts: { mapId: string }) => ['comments', 'list', opts] },
  },
}));

vi.mock('$lib/components/ui/Toast.svelte', () => ({
  toastStore: { error: vi.fn() },
}));

describe('AnnotationMutations', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
  });

  it('exports all mutation option factory functions', async () => {
    const {
      createAnnotationMutationOptions,
      deleteAnnotationMutationOptions,
      updateAnnotationMutationOptions,
      replyAnnotationMutationOptions,
      convertToPointMutationOptions,
      createCommentMutationOptions,
      deleteCommentMutationOptions,
      resolveCommentMutationOptions,
    } = await import('$lib/components/annotations/AnnotationMutations.js');

    expect(typeof createAnnotationMutationOptions).toBe('function');
    expect(typeof deleteAnnotationMutationOptions).toBe('function');
    expect(typeof updateAnnotationMutationOptions).toBe('function');
    expect(typeof replyAnnotationMutationOptions).toBe('function');
    expect(typeof convertToPointMutationOptions).toBe('function');
    expect(typeof createCommentMutationOptions).toBe('function');
    expect(typeof deleteCommentMutationOptions).toBe('function');
    expect(typeof resolveCommentMutationOptions).toBe('function');
  });

  it('createAnnotation options call trpc.annotations.create', async () => {
    const { createAnnotationMutationOptions } =
      await import('$lib/components/annotations/AnnotationMutations.js');
    const options = createAnnotationMutationOptions({ queryClient, mapId: 'map-1' });
    await options.mutationFn!({
      mapId: 'map-1',
      anchor: { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } },
      content: { kind: 'single', body: { type: 'text', text: 'test' } },
    });
    const { trpc } = await import('$lib/utils/trpc.js');
    expect(trpc.annotations.create.mutate).toHaveBeenCalled();
  });

  it('deleteAnnotation options call trpc.annotations.delete', async () => {
    const { deleteAnnotationMutationOptions } =
      await import('$lib/components/annotations/AnnotationMutations.js');
    const options = deleteAnnotationMutationOptions({ queryClient, mapId: 'map-1' });
    await options.mutationFn!({ id: 'ann-1' });
    const { trpc } = await import('$lib/utils/trpc.js');
    expect(trpc.annotations.delete.mutate).toHaveBeenCalled();
  });

  it('createComment options call trpc.comments.create', async () => {
    const { createCommentMutationOptions } =
      await import('$lib/components/annotations/AnnotationMutations.js');
    const options = createCommentMutationOptions({ queryClient, mapId: 'map-1' });
    await options.mutationFn!({ mapId: 'map-1', body: 'hello' });
    const { trpc } = await import('$lib/utils/trpc.js');
    expect(trpc.comments.create.mutate).toHaveBeenCalled();
  });

  it('deleteComment options call trpc.comments.delete', async () => {
    const { deleteCommentMutationOptions } =
      await import('$lib/components/annotations/AnnotationMutations.js');
    const options = deleteCommentMutationOptions({ queryClient, mapId: 'map-1' });
    await options.mutationFn!({ id: 'comment-1' });
    const { trpc } = await import('$lib/utils/trpc.js');
    expect(trpc.comments.delete.mutate).toHaveBeenCalled();
  });

  it('createAnnotation optimistic insert adds temp item to cache', async () => {
    const { createAnnotationMutationOptions } =
      await import('$lib/components/annotations/AnnotationMutations.js');

    // Seed the cache with one existing annotation
    queryClient.setQueryData(
      ['annotations', 'list', { mapId: 'map-1' }],
      [{ id: 'existing-1', map_id: 'map-1' }]
    );

    const options = createAnnotationMutationOptions({ queryClient, mapId: 'map-1' });

    // Call onMutate directly to test the optimistic update
    const context = await options.onMutate!({
      mapId: 'map-1',
      anchor: { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } },
      content: { kind: 'single', body: { type: 'text', text: 'test' } },
    });

    const cache = queryClient.getQueryData(['annotations', 'list', { mapId: 'map-1' }]) as Array<{
      id: string;
    }>;
    // Should have the existing item + the optimistic temp item
    expect(cache.length).toBe(2);
    expect(cache[1].id).toMatch(/^temp-\d+$/);
    // Context should contain previous state and optimisticId
    expect(context).toHaveProperty('previous');
    expect(context).toHaveProperty('optimisticId');
  });

  it('deleteAnnotation onMutate removes item from cache', async () => {
    const { deleteAnnotationMutationOptions } =
      await import('$lib/components/annotations/AnnotationMutations.js');

    queryClient.setQueryData(
      ['annotations', 'list', { mapId: 'map-1' }],
      [
        { id: 'ann-1', map_id: 'map-1' },
        { id: 'ann-2', map_id: 'map-1' },
      ]
    );

    const options = deleteAnnotationMutationOptions({ queryClient, mapId: 'map-1' });
    await options.onMutate!({ id: 'ann-1' });

    const cache = queryClient.getQueryData(['annotations', 'list', { mapId: 'map-1' }]) as Array<{
      id: string;
    }>;
    expect(cache.length).toBe(1);
    expect(cache[0].id).toBe('ann-2');
  });

  it('createAnnotation onError restores previous cache', async () => {
    const { createAnnotationMutationOptions } =
      await import('$lib/components/annotations/AnnotationMutations.js');

    const previousData = [{ id: 'existing-1', map_id: 'map-1' }];
    queryClient.setQueryData(['annotations', 'list', { mapId: 'map-1' }], previousData);

    const options = createAnnotationMutationOptions({ queryClient, mapId: 'map-1' });

    // Simulate onMutate adding optimistic item
    const context = await options.onMutate!({
      mapId: 'map-1',
      anchor: { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } },
      content: { kind: 'single', body: { type: 'text', text: 'test' } },
    });

    // Verify optimistic item was added
    let cache = queryClient.getQueryData(['annotations', 'list', { mapId: 'map-1' }]) as Array<{
      id: string;
    }>;
    expect(cache.length).toBe(2);

    // Simulate error — onError should restore previous
    options.onError!(new Error('fail'), {} as any, context as any);
    cache = queryClient.getQueryData(['annotations', 'list', { mapId: 'map-1' }]) as Array<{
      id: string;
    }>;
    expect(cache.length).toBe(1);
    expect(cache[0].id).toBe('existing-1');
  });
});
