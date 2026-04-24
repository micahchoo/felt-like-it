import type { QueryClient } from '@tanstack/svelte-query';
import type { MutationOptions } from '@tanstack/svelte-query';
import { trpc } from '$lib/utils/trpc.js';
import { queryKeys } from '$lib/utils/query-keys.js';
import type { AnnotationObject, Anchor, AnnotationContent as AC } from '@felt-like-it/shared-types';
import { toastStore } from '$lib/components/ui/Toast.svelte';

/**
 * Translate a tRPC / server error into a user-facing message. Inspects the
 * wrapped TRPC error code so the toast distinguishes a stale version edit from
 * a permission failure from a plain network glitch.
 */
function describeError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const e = err as { data?: { code?: string }; message?: string };
    const code = e.data?.code;
    if (code === 'CONFLICT') return 'Someone else edited this annotation — reload to see the latest version.';
    if (code === 'UNAUTHORIZED') return 'Sign in to continue.';
    if (code === 'FORBIDDEN') return 'You do not have permission to do that.';
    if (code === 'NOT_FOUND') return 'Annotation not found — it may have been deleted.';
    if (code === 'TOO_MANY_REQUESTS') return 'Too many requests — slow down and try again.';
    if (code === 'PAYLOAD_TOO_LARGE') return 'Annotation content is too large.';
  }
  return fallback;
}

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
  CreateAnnotationInput,
  { previous: AnnotationObject[] | undefined; optimisticId: string }
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
        mapId: deps.mapId,
        parentId: null,
        authorId: null,
        authorName: '',
        anchor: variables.anchor,
        content: variables.content,
        templateId: null,
        ordinal: 0,
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      deps.queryClient.setQueryData<AnnotationObject[]>(
        queryKeys.annotations.list({ mapId: deps.mapId }),
        (old) => [...(old ?? []), optimisticAnnotation]
      );
      return { previous, optimisticId };
    },
    onError: (err, _vars, onMutateResult) => {
      if (onMutateResult?.previous) {
        deps.queryClient.setQueryData(
          queryKeys.annotations.list({ mapId: deps.mapId }),
          onMutateResult.previous
        );
      }
      toastStore.error(describeError(err, 'Failed to create annotation.'));
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
): MutationOptions<
  Awaited<ReturnType<typeof trpc.annotations.delete.mutate>>,
  Error,
  { id: string; version: number },
  { previous: AnnotationObject[] | undefined }
> {
  return {
    mutationFn: (input: { id: string; version: number }) => trpc.annotations.delete.mutate(input),
    onMutate: async ({ id }: { id: string; version: number }) => {
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
      return { previous };
    },
    onError: (err, _vars, onMutateResult) => {
      if (onMutateResult?.previous) {
        deps.queryClient.setQueryData(
          queryKeys.annotations.list({ mapId: deps.mapId }),
          onMutateResult.previous
        );
      }
      toastStore.error(describeError(err, 'Failed to delete annotation.'));
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
  { id: string; version: number; content?: { kind: 'single'; body: AC }; anchor?: Anchor }
> {
  return {
    mutationFn: (input: {
      id: string;
      version: number;
      content?: { kind: 'single'; body: AC };
      anchor?: Anchor;
    }) => trpc.annotations.update.mutate(input),
    onSuccess: () => {
      deps.queryClient.invalidateQueries({
        queryKey: queryKeys.annotations.list({ mapId: deps.mapId }),
      });
    },
    onError: (err) => {
      toastStore.error(describeError(err, 'Failed to update annotation.'));
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
    onError: (err) => {
      toastStore.error(describeError(err, 'Failed to post reply.'));
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
): MutationOptions<
  Awaited<ReturnType<typeof trpc.comments.delete.mutate>>,
  Error,
  { id: string },
  { previous: CommentEntry[] | undefined }
> {
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
      return { previous };
    },
    onError: (_err, _vars, onMutateResult) => {
      if (onMutateResult?.previous) {
        deps.queryClient.setQueryData(
          queryKeys.comments.list({ mapId: deps.mapId }),
          onMutateResult.previous
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
): MutationOptions<
  Awaited<ReturnType<typeof trpc.comments.resolve.mutate>>,
  Error,
  { id: string },
  { previous: CommentEntry[] | undefined }
> {
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
      return { previous };
    },
    onError: (_err, _vars, onMutateResult) => {
      if (onMutateResult?.previous) {
        deps.queryClient.setQueryData(
          queryKeys.comments.list({ mapId: deps.mapId }),
          onMutateResult.previous
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
