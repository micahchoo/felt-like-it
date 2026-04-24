<script lang="ts">
  /**
   * AnnotationGroups — collapsible folder headers for the annotation sidebar.
   *
   * Wave 2 Task 2.4 of the Felt-parity plan. Ships the minimum viable surface:
   * create, rename inline, delete, show/hide. Drag-drop reorder and
   * group-membership assignment are follow-ups (see seeds).
   */
  import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
  import { trpc } from '$lib/utils/trpc.js';
  import { queryKeys } from '$lib/utils/query-keys.js';
  import {
    createAnnotationGroupMutationOptions,
    updateAnnotationGroupMutationOptions,
    deleteAnnotationGroupMutationOptions,
  } from './AnnotationMutations.js';
  import type { AnnotationGroup } from '@felt-like-it/shared-types';

  interface Props {
    mapId: string;
    /** If set, only this group's row is rendered in a "currently filtered by" style.
     *  Null means no filter — all groups are shown flat. */
    selectedGroupId?: string | null;
    onselect?: (groupId: string | null) => void;
  }

  let { mapId, selectedGroupId = null, onselect }: Props = $props();

  const queryClient = useQueryClient();

  const groupsQuery = createQuery(() => ({
    queryKey: queryKeys.annotations.groups({ mapId }),
    queryFn: () => trpc.annotations.listGroups.query({ mapId }),
  }));

  const groups = $derived<AnnotationGroup[]>(groupsQuery.data ?? []);
  const loading = $derived(groupsQuery.isPending);
  const error = $derived(groupsQuery.error?.message ?? null);

  const createGroup = createMutation(() =>
    createAnnotationGroupMutationOptions({ queryClient, mapId }),
  );
  const updateGroup = createMutation(() =>
    updateAnnotationGroupMutationOptions({ queryClient, mapId }),
  );
  const deleteGroup = createMutation(() =>
    deleteAnnotationGroupMutationOptions({ queryClient, mapId }),
  );

  let newGroupName = $state('');
  let editingId = $state<string | null>(null);
  let editName = $state('');

  async function handleCreate(e: Event) {
    e.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    try {
      await createGroup.mutateAsync({ mapId, name });
      newGroupName = '';
    } catch {
      // toast surfaced in onError
    }
  }

  function startRename(g: AnnotationGroup) {
    editingId = g.id;
    editName = g.name;
  }

  async function commitRename() {
    const id = editingId;
    const name = editName.trim();
    if (!id || !name) {
      editingId = null;
      return;
    }
    try {
      await updateGroup.mutateAsync({ id, name });
    } finally {
      editingId = null;
      editName = '';
    }
  }

  async function handleToggleVisible(g: AnnotationGroup) {
    try {
      await updateGroup.mutateAsync({ id: g.id, visible: !g.visible });
    } catch {
      // toast surfaced in onError
    }
  }

  async function handleDelete(g: AnnotationGroup) {
    if (!window.confirm(`Delete group "${g.name}"? Annotations inside it will move to ungrouped.`)) {
      return;
    }
    try {
      await deleteGroup.mutateAsync({ id: g.id });
      if (selectedGroupId === g.id) onselect?.(null);
    } catch {
      // toast surfaced in onError
    }
  }

  const busy = $derived(
    createGroup.isPending || updateGroup.isPending || deleteGroup.isPending,
  );
</script>

<div class="flex flex-col gap-1 border-b border-white/10 p-2">
  <div class="flex items-center justify-between px-1">
    <span class="text-[10px] font-medium uppercase tracking-wide text-on-surface-variant">
      Groups
    </span>
    {#if selectedGroupId}
      <button
        type="button"
        class="text-[10px] text-primary hover:underline"
        onclick={() => onselect?.(null)}
      >
        Clear filter
      </button>
    {/if}
  </div>

  {#if loading}
    <p class="px-1 text-[11px] text-on-surface-variant/60">Loading…</p>
  {:else if error}
    <p class="px-1 text-[11px] text-red-400">{error}</p>
  {:else if groups.length === 0}
    <p class="px-1 text-[11px] italic text-on-surface-variant/60">
      No groups yet — create one below to start organising.
    </p>
  {:else}
    <ul class="flex flex-col gap-0.5">
      {#each groups as g (g.id)}
        <li
          class="group flex items-center gap-1 rounded px-1.5 py-1 text-xs {selectedGroupId ===
          g.id
            ? 'bg-primary/15 text-on-surface'
            : 'text-on-surface-variant hover:bg-surface-high/40'}"
        >
          <button
            type="button"
            class="flex-1 truncate text-left disabled:opacity-40"
            title="Filter list by this group"
            onclick={() => onselect?.(selectedGroupId === g.id ? null : g.id)}
            disabled={busy || editingId === g.id}
          >
            {#if editingId === g.id}
              <!-- Inline rename — autofocus is intentional: follows explicit user click. -->
              <!-- svelte-ignore a11y_autofocus -->
              <input
                type="text"
                bind:value={editName}
                onkeydown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void commitRename();
                  } else if (e.key === 'Escape') {
                    editingId = null;
                    editName = '';
                  }
                }}
                onblur={commitRename}
                autofocus
                class="w-full rounded border border-primary/40 bg-surface-high/60 px-1 py-0.5 text-xs text-on-surface focus:outline-none"
              />
            {:else}
              {g.visible ? '' : '○ '}{g.name}
            {/if}
          </button>
          <button
            type="button"
            title={g.visible ? 'Hide group on map' : 'Show group on map'}
            class="text-[11px] text-on-surface-variant hover:text-on-surface disabled:opacity-40"
            onclick={() => handleToggleVisible(g)}
            disabled={busy}
          >
            {g.visible ? '👁' : '⚊'}
          </button>
          <button
            type="button"
            title="Rename"
            class="text-[11px] text-on-surface-variant hover:text-on-surface disabled:opacity-40 opacity-0 group-hover:opacity-100"
            onclick={() => startRename(g)}
            disabled={busy}
          >
            ✎
          </button>
          <button
            type="button"
            title="Delete group"
            class="text-[11px] text-red-400 hover:text-red-300 disabled:opacity-40 opacity-0 group-hover:opacity-100"
            onclick={() => handleDelete(g)}
            disabled={busy}
          >
            ✕
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <form class="mt-1 flex gap-1" onsubmit={handleCreate}>
    <input
      type="text"
      bind:value={newGroupName}
      placeholder="New group name"
      class="flex-1 rounded border border-white/10 bg-surface-high/40 px-2 py-1 text-xs text-on-surface placeholder:text-on-surface-variant/50 focus:border-primary/50 focus:outline-none"
      disabled={busy}
    />
    <button
      type="submit"
      disabled={!newGroupName.trim() || busy}
      class="rounded bg-primary px-2 py-1 text-xs font-medium text-on-primary disabled:cursor-not-allowed disabled:opacity-40 hover:bg-primary/90"
    >
      Add
    </button>
  </form>
</div>
