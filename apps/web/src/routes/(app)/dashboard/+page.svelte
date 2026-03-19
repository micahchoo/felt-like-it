<script lang="ts">
  import { enhance } from '$app/forms';
  import { formatRelativeTime } from '$lib/utils/format.js';
  import { trpc } from '$lib/utils/trpc.js';
  import Button from '$lib/components/ui/Button.svelte';
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let showNewMapForm = $state(false);
  let showTemplates = $state(false);
  let newMapTitle = $state('');
  let creating = $state(false);
  let editingMapId = $state<string | null>(null);
  let editingTitle = $state('');

  function startRename(mapId: string, currentTitle: string): void {
    editingMapId = mapId;
    editingTitle = currentTitle;
  }

  async function saveRename(mapId: string): Promise<void> {
    if (editingMapId !== mapId) return;
    const newTitle = editingTitle.trim();
    if (!newTitle) {
      editingMapId = null;
      return;
    }
    try {
      await trpc.maps.update.mutate({ id: mapId, title: newTitle });
      const map = data.maps.find((m) => m.id === mapId);
      if (map) map.title = newTitle;
      toastStore.success('Map renamed.');
    } catch {
      toastStore.error('Failed to rename map.');
    } finally {
      editingMapId = null;
    }
  }

  $effect(() => {
    if (form && 'error' in form) {
      toastStore.error((form as { error: string }).error);
    }
  });
</script>

<svelte:head>
  <title>Dashboard — Felt Like It</title>
</svelte:head>

<div class="min-h-screen bg-slate-900 text-white">
  <!-- Nav -->
  <nav class="border-b border-white/10 px-6 py-3 flex items-center gap-4">
    <span class="font-bold text-white text-lg">🗺 Felt Like It</span>
    <span class="flex-1"></span>
    {#if data.user.isAdmin}
      <a href="/admin" class="text-sm text-slate-400 hover:text-white transition-colors">Admin</a>
    {/if}
    <span class="text-sm text-slate-400">{data.user.email}</span>
    <form method="POST" action="/auth/logout" use:enhance>
      <button type="submit" class="text-sm text-slate-400 hover:text-white transition-colors">
        Sign out
      </button>
    </form>
  </nav>

  <main class="max-w-5xl mx-auto px-6 py-10">
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="text-2xl font-bold text-white">Your Maps</h1>
        <p class="text-sm text-slate-400 mt-1">{data.maps.length} map{data.maps.length !== 1 ? 's' : ''}</p>
      </div>

      {#if !showNewMapForm}
        <div class="flex gap-2">
          {#if data.templates.length > 0}
            <Button variant="secondary" onclick={() => (showTemplates = !showTemplates)}>
              {showTemplates ? 'Hide templates' : 'Start from template'}
            </Button>
          {/if}
          <Button variant="primary" onclick={() => (showNewMapForm = true)}>
            + New Map
          </Button>
        </div>
      {:else}
        <form
          method="POST"
          action="?/createMap"
          class="flex gap-2"
          use:enhance={() => {
            creating = true;
            return ({ update }) => {
              creating = false;
              showNewMapForm = false;
              newMapTitle = '';
              update();
            };
          }}
        >
          <!-- svelte-ignore a11y_autofocus -->
          <input
            type="text"
            name="title"
            bind:value={newMapTitle}
            placeholder="Map title…"
            autofocus
            class="rounded-lg bg-slate-700 border border-slate-600 px-3 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <Button type="submit" variant="primary" loading={creating}>Create</Button>
          <Button
            variant="ghost"
            onclick={() => { showNewMapForm = false; newMapTitle = ''; }}
          >Cancel</Button>
        </form>
      {/if}
    </div>

    <!-- Template picker -->
    {#if showTemplates && data.templates.length > 0}
      <div class="mb-8 p-4 bg-slate-800/60 rounded-xl ring-1 ring-white/10">
        <h2 class="text-sm font-semibold text-slate-300 mb-3">Start from a template</h2>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {#each data.templates as template (template.id)}
            <form method="POST" action="?/useTemplate" use:enhance>
              <input type="hidden" name="templateId" value={template.id} />
              <button
                type="submit"
                class="w-full text-left p-3 bg-slate-700 hover:bg-slate-600 rounded-lg ring-1 ring-white/10 hover:ring-blue-500/50 transition-all group"
              >
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-base">🗺</span>
                  <span class="text-sm font-medium text-white group-hover:text-blue-300 transition-colors">
                    {template.title}
                  </span>
                </div>
                {#if template.description}
                  <p class="text-xs text-slate-400 leading-snug">{template.description}</p>
                {/if}
              </button>
            </form>
          {/each}
        </div>
      </div>
    {/if}

    {#if data.maps.length === 0}
      <div class="text-center py-20">
        <div class="text-5xl mb-4">🗺</div>
        <h2 class="text-xl font-semibold text-white mb-2">No maps yet</h2>
        <p class="text-slate-400 mb-6">
          Create your first map to visualize, annotate, and share geographic data with your team.
        </p>
        <Button variant="primary" onclick={() => (showNewMapForm = true)}>
          Create your first map
        </Button>
      </div>
    {:else}
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {#each data.maps as map (map.id)}
          <div class="group bg-slate-800 rounded-xl ring-1 ring-white/10 overflow-hidden hover:ring-blue-500/50 transition-all">
            <!-- Map thumbnail placeholder -->
            <a href="/map/{map.id}" class="block h-36 bg-slate-700 flex items-center justify-center">
              <span class="text-4xl opacity-30">🗺</span>
            </a>

            <div class="p-4">
              <div class="flex items-start justify-between gap-2">
                {#if editingMapId === map.id}
                  <!-- svelte-ignore a11y_autofocus -->
                  <input
                    type="text"
                    bind:value={editingTitle}
                    autofocus
                    onblur={() => saveRename(map.id)}
                    onkeydown={(e) => {
                      if (e.key === 'Enter') saveRename(map.id);
                      if (e.key === 'Escape') { editingMapId = null; }
                    }}
                    class="flex-1 min-w-0 rounded bg-slate-700 border border-blue-500 px-1 py-0.5 text-sm font-semibold text-white focus:outline-none"
                  />
                {:else}
                  <a
                    href="/map/{map.id}"
                    class="flex-1 text-sm font-semibold text-white hover:text-blue-400 transition-colors truncate"
                    title="Double-click to rename"
                  >
                    {map.title}
                  </a>
                {/if}

                <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <!-- Rename -->
                  <button
                    type="button"
                    onclick={() => startRename(map.id, map.title)}
                    class="text-slate-500 hover:text-blue-400 transition-colors text-xs"
                    aria-label="Rename map"
                    title="Rename map"
                  >&#x270E;</button>
                  <!-- Clone -->
                  <form method="POST" action="?/cloneMap" use:enhance>
                    <input type="hidden" name="mapId" value={map.id} />
                    <button
                      type="submit"
                      class="text-slate-500 hover:text-blue-400 transition-colors text-xs"
                      aria-label="Duplicate map"
                      title="Duplicate map"
                    >⎘</button>
                  </form>
                  <!-- Delete -->
                  <form method="POST" action="?/deleteMap" use:enhance>
                    <input type="hidden" name="mapId" value={map.id} />
                    <button
                      type="submit"
                      class="text-slate-500 hover:text-red-400 transition-colors text-xs"
                      aria-label="Delete map"
                      onclick={(e) => {
                        if (!confirm(`Delete "${map.title}"?`)) e.preventDefault();
                      }}
                    >✕</button>
                  </form>
                </div>
              </div>

              <div class="flex items-center gap-3 mt-2 text-xs text-slate-400">
                <span>{map.layerCount} layer{map.layerCount !== 1 ? 's' : ''}</span>
                <span>·</span>
                <span>{formatRelativeTime(new Date(map.updatedAt))}</span>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Shared with me -->
    {#if data.sharedMaps.length > 0}
      <div class="mt-12">
        <h2 class="text-lg font-semibold text-white mb-4">Shared with me</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {#each data.sharedMaps as map (map.id)}
            <div class="bg-slate-800 rounded-xl ring-1 ring-white/10 overflow-hidden hover:ring-blue-500/50 transition-all">
              <a href="/map/{map.id}" class="block h-36 bg-slate-700 flex items-center justify-center">
                <span class="text-4xl opacity-30">🗺</span>
              </a>
              <div class="p-4">
                <div class="flex items-start justify-between gap-2">
                  <a
                    href="/map/{map.id}"
                    class="flex-1 text-sm font-semibold text-white hover:text-blue-400 transition-colors truncate"
                  >
                    {map.title}
                  </a>
                  <span class="shrink-0 text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 ring-1 ring-white/10 capitalize">
                    {map.role}
                  </span>
                </div>
                <div class="mt-2 text-xs text-slate-400">
                  {formatRelativeTime(new Date(map.updatedAt))}
                </div>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </main>
</div>
