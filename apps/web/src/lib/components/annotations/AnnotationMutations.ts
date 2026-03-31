import type { QueryClient } from '@tanstack/svelte-query';
import type { MutationOptions } from '@tanstack/svelte-query';
import { trpc } from '$lib/utils/trpc.js';
import { queryKeys } from '$lib/utils/query-keys.js';
import type { AnnotationObject, Anchor, AnnotationContent as AC } from '@felt-like-it/shared-types';
import { toastStore } from '$lib/components/ui/Toast.svelte';

interface MutationDeps {
  queryClient: QueryClient;
  mapId: string;
}

// ── Annotation mutation option factories ─────────────────────────────────────
// These return plain options objects — the component wraps with createMutation.
// This keeps them testable outside Svelte component context.

type CreateAnnotationInput = {
  mapId: string;
  anchor: Anchor;
  content: { kind: 'single'; body: AC };
};

export function createAnnotationMutationOptions(
  deps: MutationDeps
): MutationOptions<
  Awaited<ReturnType<typeof trpc.annotations.create.mutate>>,
  Error,
  CreateAnnotationInput
> {
  return {
    mutationFn: (input: CreateAnnotationInput) => trpc.annotations.create.mutate(input),
    onMutate: async (variables) => {
      await deps.queryClient.cancelQueries({
        queryKey: queryKeys.annotations.list({ mapId: deps.mapId }),
      });
      const previous = deps.queryClient.getQueryData<AnnotationObject[]>(
        queryKeys.annotations.list({ mapId: deps.mapId })
      );
      const optimisticId = `temp-${Date.now()}`;
      const optimisticAnnotation: AnnotationObject = {
        id: optimisticId,
        map_id: deps.mapId,
        anchor: variables.anchor,
        content: variables.content,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 0,
        resolved: false,
      } as AnnotationObject;
      deps.queryClient.setQueryData<AnnotationObject[]>(
        queryKeys.annotations.list({ mapId: deps.mapId }),
        (old) => [...(old ?? []), optimisticAnnotation]
      );
      return { previous, optimisticId };
    },
    onError: (_err, _vars, context: { previous?: AnnotationObject[] } | undefined) => {
      if (context?.previous) {
        deps.queryClient.setQueryData(
          queryKeys.annotations.list({ mapId: deps.mapId }),
          context.previous
        );
      }
      toastStore.error('Failed to create annotation.');
    },
    onSuccess: () => {
      deps.queryClient.invalidateQueries({
        queryKey: queryKeys.annotations.list({ mapId: deps.mapId }),
      });
    },
  };
}

export function deleteAnnotationMutationOptions(
  deps: MutationDeps
): MutationOptions<void, Error, { id: string }> {
  return {
    mutationFn: (input: { id: string }) => trpc.annotations.delete.mutate(input),
    onMutate: async ({ id }: { id: string }) => {
      await deps.queryClient.cancelQueries({
        queryKey: queryKeys.annotations.list({ mapId: deps.mapId }),
      });
      const previous = deps.queryClient.getQueryData<AnnotationObject[]>(
        queryKeys.annotations.list({ mapId: deps.mapId })
      );
      deps.queryClient.setQueryData<AnnotationObject[]>(
        queryKeys.annotations.list({ mapId: deps.mapId }),
        (old) => old?.filter((a) => a.id !== id) ?? []
      );
      return { previous } as { previous?: AnnotationObject[] };
    },
    onError: (
      _err: unknown,
      _vars: { id: string },
      context: { previous?: AnnotationObject[] } | undefined
    ) => {
      if (context?.previous) {
        deps.queryClient.setQueryData(
          queryKeys.annotations.list({ mapId: deps.mapId }),
          context.previous
        );
      }
    },
    onSettled: () => {
      deps.queryClient.invalidateQueries({
        queryKey: queryKeys.annotations.list({ mapId: deps.mapId }),
      });
      deps.queryClient.invalidateQueries({
        queryKey: ['annotations', 'getThread'],
      });
    },
  };
}

export function updateAnnotationMutationOptions(
  deps: MutationDeps
): MutationOptions<
  Awaited<ReturnType<typeof trpc.annotations.update.mutate>>,
  Error,
  { id: string; content?: { kind: 'single'; body: AC }; anchor?: Anchor; version?: number }
> {
  return {
    mutationFn: (input: {
      id: string;
      content?: { kind: 'single'; body: AC };
      anchor?: Anchor;
      version?: number;
    }) => trpc.annotations.update.mutate(input),
    onSuccess: () => {
      deps.queryClient.invalidateQueries({
        queryKey: queryKeys.annotations.list({ mapId: deps.mapId }),
      });
    },
  };
}

export function replyAnnotationMutationOptions(
  deps: MutationDeps
): MutationOptions<
  Awaited<ReturnType<typeof trpc.annotations.create.mutate>>,
  Error,
  { mapId: string; parentId: string; anchor: Anchor; content: { kind: 'single'; body: AC } }
> {
  return {
    mutationFn: (input: {
      mapId: string;
      parentId: string;
      anchor: Anchor;
      content: { kind: 'single'; body: AC };
    }) => trpc.annotations.create.mutate(input),
    onSuccess: (_data, variables) => {
      deps.queryClient.invalidateQueries({
        queryKey: queryKeys.annotations.list({ mapId: deps.mapId }),
      });
      deps.queryClient.invalidateQueries({
        queryKey: queryKeys.annotations.thread({ annotationId: variables.parentId }),
      });
    },
  };
}

export function convertToPointMutationOptions(
  deps: MutationDeps
): MutationOptions<
  void,
  Error,
  { mapId: string; annotationId: string; coordinates: [number, number] }
> {
  return {
    mutationFn: (input: { mapId: string; annotationId: string; coordinates: [number, number] }) =>
      trpc.annotations.convertToPoint.mutate(input),
    onSuccess: () => {
      deps.queryClient.invalidateQueries({
        queryKey: queryKeys.annotations.list({ mapId: deps.mapId }),
      });
    },
    onError: () => {
      toastStore.error('Failed to convert annotation to point.');
    },
  };
}

// ── Comment mutation option factories ────────────────────────────────────────

export interface CommentEntry {
  id: string;
  mapId: string;
  userId: string | null;
  authorName: string;
  body: string;
  resolved: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function createCommentMutationOptions(
  deps: MutationDeps
): MutationOptions<
  Awaited<ReturnType<typeof trpc.comments.create.mutate>>,
  Error,
  { mapId: string; body: string }
> {
  return {
    mutationFn: (input: { mapId: string; body: string }) => trpc.comments.create.mutate(input),
    onSuccess: () => {
      deps.queryClient.invalidateQueries({
        queryKey: queryKeys.comments.list({ mapId: deps.mapId }),
      });
    },
  };
}

export function deleteCommentMutationOptions(
  deps: MutationDeps
): MutationOptions<void, Error, { id: string }> {
  return {
    mutationFn: (input: { id: string }) => trpc.comments.delete.mutate(input),
    onMutate: async ({ id }: { id: string }) => {
      await deps.queryClient.cancelQueries({
        queryKey: queryKeys.comments.list({ mapId: deps.mapId }),
      });
      const previous = deps.queryClient.getQueryData<CommentEntry[]>(
        queryKeys.comments.list({ mapId: deps.mapId })
      );
      deps.queryClient.setQueryData<CommentEntry[]>(
        queryKeys.comments.list({ mapId: deps.mapId }),
        (old) => old?.filter((c) => c.id !== id) ?? []
      );
      return { previous } as { previous?: CommentEntry[] };
    },
    onError: (
      _err: unknown,
      _vars: { id: string },
      context: { previous?: CommentEntry[] } | undefined
    ) => {
      if (context?.previous) {
        deps.queryClient.setQueryData(
          queryKeys.comments.list({ mapId: deps.mapId }),
          context.previous
        );
      }
    },
    onSettled: () => {
      deps.queryClient.invalidateQueries({
        queryKey: queryKeys.comments.list({ mapId: deps.mapId }),
      });
    },
  };
}

export function resolveCommentMutationOptions(
  deps: MutationDeps
): MutationOptions<void, Error, { id: string }> {
  return {
    mutationFn: (input: { id: string }) => trpc.comments.resolve.mutate(input),
    onMutate: async ({ id }: { id: string }) => {
      await deps.queryClient.cancelQueries({
        queryKey: queryKeys.comments.list({ mapId: deps.mapId }),
      });
      const previous = deps.queryClient.getQueryData<CommentEntry[]>(
        queryKeys.comments.list({ mapId: deps.mapId })
      );
      deps.queryClient.setQueryData<CommentEntry[]>(
        queryKeys.comments.list({ mapId: deps.mapId }),
        (old) => old?.map((c) => (c.id === id ? { ...c, resolved: !c.resolved } : c)) ?? []
      );
      return { previous } as { previous?: CommentEntry[] };
    },
    onError: (
      _err: unknown,
      _vars: { id: string },
      context: { previous?: CommentEntry[] } | undefined
    ) => {
      if (context?.previous) {
        deps.queryClient.setQueryData(
          queryKeys.comments.list({ mapId: deps.mapId }),
          context.previous
        );
      }
    },
    onSettled: () => {
      deps.queryClient.invalidateQueries({
        queryKey: queryKeys.comments.list({ mapId: deps.mapId }),
      });
    },
  };
}
