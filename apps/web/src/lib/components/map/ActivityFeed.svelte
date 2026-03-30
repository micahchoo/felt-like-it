<script lang="ts">
  import { trpc } from '$lib/utils/trpc.js';

  interface Props {
    mapId: string;
    embedded?: boolean;
    /** Increment to trigger a data re-fetch. */
    refreshTrigger?: number;
    oncountchange?: (count: number) => void;
  }

  /** Shape returned by events.list — mirrors MapEventRow without a server import. */
  interface EventEntry {
    id: string;
    mapId: string;
    userId: string | null;
    action: string;
    metadata: unknown;
    createdAt: Date;
  }

  type FilterCategory = 'all' | 'imports' | 'draws' | 'annotations' | 'collaborators';

  const FILTER_LABELS: Record<FilterCategory, string> = {
    all: 'All',
    imports: 'Imports',
    draws: 'Draws',
    annotations: 'Annotations',
    collaborators: 'Collaborators',
  };

  /** Action prefixes that belong to each filter category. */
  const FILTER_PREFIXES: Record<FilterCategory, string[]> = {
    all: [],
    imports: ['layer.imported', 'geoprocessing.completed'],
    draws: ['feature.drawn', 'layer.deleted', 'viewport.saved'],
    annotations: ['annotation.created', 'annotation.deleted'],
    collaborators: ['map.created', 'collaborator.'],
  };

  let { mapId, embedded, refreshTrigger, oncountchange }: Props = $props();

  let events = $state<EventEntry[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let selectedFilter = $state<FilterCategory>('all');
  let lastVisit = $state<Date | null>(null);
  let filterRestored = $state(false);

  // Restore saved filter on mount (runs once; flag prevents save-effect loop)
  $effect(() => {
    try {
      const saved = localStorage.getItem(`felt-activity-filter-${mapId}`);
      if (saved) selectedFilter = saved as FilterCategory;
    } catch {
      // localStorage unavailable
    }
    filterRestored = true;
  });

  // Persist filter whenever it changes, but only after restore has run
  $effect(() => {
    if (!filterRestored) return;
    try {
      localStorage.setItem(`felt-activity-filter-${mapId}`, selectedFilter);
    } catch {
      // ignore
    }
  });

  $effect(() => {
    void refreshTrigger; // reactive dependency — increment triggers re-fetch
    loading = true;
    error = null;
    trpc.events.list
      .query({ mapId })
      .then((rows) => {
        events = rows as EventEntry[];
        loading = false;
        oncountchange?.(rows.length);
      })
      .catch(() => {
        error = 'Could not load activity.';
        loading = false;
      });
  });

  $effect(() => {
    try {
      const stored = localStorage.getItem(`felt-lastvisit-${mapId}`);
      if (stored) lastVisit = new Date(stored);
    } catch {
      // localStorage unavailable (e.g. private browsing with storage blocked)
    }
    return () => {
      try {
        localStorage.setItem(`felt-lastvisit-${mapId}`, new Date().toISOString());
      } catch {
        // ignore
      }
    };
  });

  const filteredEvents = $derived(
    selectedFilter === 'all'
      ? events
      : events.filter((e) =>
          FILTER_PREFIXES[selectedFilter].some((prefix) => e.action.startsWith(prefix))
        )
  );

  function isNew(event: EventEntry): boolean {
    if (!lastVisit) return false;
    return event.createdAt > lastVisit;
  }

  /** Icon SVG path data keyed by exact action string or action prefix. */
  const ACTION_ICONS: Record<string, string> = {
    'layer.imported': 'M.5 9.9a.5.5 0 01.5.5v2.5a1 1 0 001 1h12a1 1 0 001-1v-2.5a.5.5 0 011 0v2.5a2 2 0 01-2 2H2a2 2 0 01-2-2v-2.5a.5.5 0 01.5-.5zM7.646 1.146a.5.5 0 01.708 0l3 3a.5.5 0 01-.708.708L8.5 2.707V11.5a.5.5 0 01-1 0V2.707L5.354 4.854a.5.5 0 11-.708-.708l3-3z',
    'layer.deleted':  'M5.5 5.5A.5.5 0 016 6v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm2.5 0a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm3 .5a.5.5 0 00-1 0v6a.5.5 0 001 0V6zM14.5 3a1 1 0 01-1 1H13v9a2 2 0 01-2 2H5a2 2 0 01-2-2V4h-.5a1 1 0 010-2h3.5l1-1h3l1 1H14.5a1 1 0 011 1zM4.118 4L4 4.059V13a1 1 0 001 1h6a1 1 0 001-1V4.059L11.882 4H4.118z',
    'feature.drawn':  'M12.854.146a.5.5 0 00-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 000-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 016 13.5V13h-.5a.5.5 0 01-.5-.5V12h-.5a.5.5 0 01-.5-.5V11h-.5a.5.5 0 01-.5-.5V10h-.5a.499.499 0 01-.175-.032l-.179.178a.5.5 0 00-.11.168l-2 5a.5.5 0 00.65.65l5-2a.5.5 0 00.168-.11l.178-.178z',
    'viewport.saved': 'M13.854 3.646a.5.5 0 010 .708l-7 7a.5.5 0 01-.708 0l-3.5-3.5a.5.5 0 11.708-.708L6.5 10.293l6.646-6.647a.5.5 0 01.708 0z',
    'map.created':    'M8 1a.5.5 0 01.5.5v5H14a.5.5 0 010 1H8.5v5a.5.5 0 01-1 0v-5H2a.5.5 0 010-1h5.5v-5A.5.5 0 018 1z',
    'geoprocessing.completed': 'M8 0a8 8 0 108 8A8 8 0 008 0zm3.5 7.5h-3v-3a.5.5 0 00-1 0v3h-3a.5.5 0 000 1h3v3a.5.5 0 001 0v-3h3a.5.5 0 000-1z',
    'annotation.created': 'M14 1a1 1 0 011 1v8a1 1 0 01-1 1h-2.5a1 1 0 00-.8.4l-1.9 2.533a.25.25 0 01-.4-.033L7.9 11.4a1 1 0 00-.8-.4H2a1 1 0 01-1-1V2a1 1 0 011-1h12z',
    'annotation.deleted': 'M14 1a1 1 0 011 1v8a1 1 0 01-1 1h-2.5a1 1 0 00-.8.4l-1.9 2.533a.25.25 0 01-.4-.033L7.9 11.4a1 1 0 00-.8-.4H2a1 1 0 01-1-1V2a1 1 0 011-1h12z',
  };

  const DEFAULT_ICON_PATH = 'M8 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z';

  function iconFor(action: string): string {
    for (const [prefix, path] of Object.entries(ACTION_ICONS)) {
      if (action.startsWith(prefix)) return path;
    }
    return DEFAULT_ICON_PATH;
  }

  function labelFor(action: string, metadata: unknown): string {
    const m = metadata as Record<string, unknown> | null;
    switch (action) {
      case 'layer.imported':
        return m?.['name'] ? `Imported layer "${String(m['name'])}"` : 'Imported a layer';
      case 'layer.deleted':
        return m?.['name'] ? `Deleted layer "${String(m['name'])}"` : 'Deleted a layer';
      case 'feature.drawn':
        return m?.['count'] ? `Drew ${String(m['count'])} feature(s)` : 'Drew a feature';
      case 'viewport.saved':
        return 'Saved the view';
      case 'map.created':
        return 'Created this map';
      case 'geoprocessing.completed': {
        const op = m?.['operation'] ? String(m['operation']) : 'operation';
        const out = m?.['outputLayerName'] ? ` → "${String(m['outputLayerName'])}"` : '';
        return `Ran ${op}${out}`;
      }
      case 'annotation.created':
        return 'Added an annotation';
      case 'annotation.deleted':
        return 'Removed an annotation';
      default:
        return action;
    }
  }

  function relativeTime(date: Date): string {
    const sec = Math.floor((Date.now() - date.getTime()) / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
  }
</script>

<div class="flex flex-col h-full {embedded !== true ? 'bg-surface-container border-l border-white/5' : ''}">
  {#if embedded !== true}
  <div class="px-3 py-2 border-b border-white/5 shrink-0 flex items-center justify-between gap-2">
    <span class="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Activity</span>
    <select
      bind:value={selectedFilter}
      class="text-xs bg-surface-low text-on-surface border border-white/5 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
      aria-label="Filter activity by type"
    >
      {#each Object.entries(FILTER_LABELS) as [value, label] (value)}
        <option value={value}>{label}</option>
      {/each}
    </select>
  </div>
  {/if}

  <div class="flex-1 overflow-y-auto">
    {#if loading}
      <div class="flex items-center justify-center h-16 text-on-surface-variant/70 text-xs">Loading…</div>
    {:else if error}
      <div class="px-3 py-2 text-red-400 text-xs">{error}</div>
    {:else if filteredEvents.length === 0}
      <div class="flex flex-col items-center justify-center py-12 px-4 text-center">
        <svg class="h-6 w-6 text-on-surface-variant/70 mb-2" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M0 2a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H2a2 2 0 01-2-2V2zm14.5 5.5h-13v1h13v-1zM2 4.5h12v1H2v-1zm0 4h8v1H2v-1z"/>
        </svg>
        <p class="text-sm text-on-surface-variant">
          {selectedFilter === 'all'
            ? 'Map activity will appear here as you and collaborators make changes.'
            : `No ${FILTER_LABELS[selectedFilter].toLowerCase()} activity yet.`}
        </p>
      </div>
    {:else}
      <ul class="divide-y divide-white/5">
        {#each filteredEvents as event (event.id)}
          <li class="flex items-start gap-2 px-3 py-2 {isNew(event) ? 'bg-tertiary/10' : ''}">
            <div class="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-surface-low flex items-center justify-center relative">
              <svg class="w-3 h-3 text-on-surface" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d={iconFor(event.action)} />
              </svg>
              {#if isNew(event)}
                <span
                  class="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary rounded-full"
                  aria-label="New since last visit"
                ></span>
              {/if}
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-xs text-on-surface leading-snug">{labelFor(event.action, event.metadata)}</p>
              <p class="text-xs text-on-surface-variant/70 mt-0.5">{relativeTime(event.createdAt)}</p>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
