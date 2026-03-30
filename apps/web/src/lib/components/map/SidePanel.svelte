<script lang="ts" module>
  export type SectionId = 'annotations' | 'analysis' | 'activity';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  interface SectionDef {
    id: SectionId;
    label: string;
    icon: string;
    count?: number;
    /** Short help text for newcomers — shown at the top of the expanded section. */
    helpText?: string;
    content: Snippet;
  }

  interface Props {
    sections: SectionDef[];
    activeSection: SectionId | null;
    collapsed?: boolean;
    onchange: (section: SectionId | null) => void;
    oncollapse?: () => void;
  }

  let { sections, activeSection, collapsed = false, onchange, oncollapse }: Props = $props();

  function toggle(id: SectionId) {
    onchange(activeSection === id ? null : id);
  }
</script>

<div
  class="{collapsed
    ? 'w-12'
    : 'w-80'} shrink-0 flex flex-col h-full glass-panel border-l border-white/5 transition-all duration-200"
  aria-label="Side panel"
>
  <!-- Header row with collapse toggle -->
  <div class="flex items-center justify-between px-2 py-1.5 border-b border-white/5">
    {#if !collapsed}
      <span class="text-xs font-display uppercase tracking-wide text-on-surface-variant">Panel</span
      >
    {/if}
    {#if oncollapse}
      <button
        class="p-1 rounded hover:bg-white/10 transition-colors"
        onclick={() => oncollapse()}
        title={collapsed ? 'Expand panel' : 'Collapse panel'}
        aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
      >
        <svg
          class="h-4 w-4 text-on-surface-variant {collapsed ? 'rotate-180' : ''}"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path
            d="M11.354 1.646a.5.5 0 0 1 0 .708L6.707 7l4.647 4.646a.5.5 0 0 1-.708.708l-5-5a.5.5 0 0 1 0-.708l5-5a.5.5 0 0 1 .708 0z"
          />
        </svg>
      </button>
    {/if}
  </div>

  {#if collapsed}
    <!-- Collapsed: show section icons only -->
    <div class="flex flex-col items-center gap-1 py-2">
      {#each sections as section (section.id)}
        <button
          class="p-2 rounded-lg transition-colors {activeSection === section.id
            ? 'bg-surface-high text-primary'
            : 'text-on-surface-variant hover:bg-surface-high'}"
          onclick={() => {
            oncollapse?.();
            toggle(section.id);
          }}
          title={section.label}
          aria-label={section.label}
        >
          <svg class="h-5 w-5" viewBox="0 0 16 16" fill="currentColor">
            <path d={section.icon} />
          </svg>
        </button>
      {/each}
    </div>
  {:else}
    <!-- Expanded: full section list with content -->
    {#each sections as section (section.id)}
      <div class="border-b border-white/5 last:border-b-0">
        <button
          class="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/5"
          class:text-primary={activeSection === section.id}
          onclick={() => toggle(section.id)}
          aria-expanded={activeSection === section.id}
          aria-controls="sidepanel-{section.id}"
        >
          <!-- Chevron -->
          <svg
            class="h-3 w-3 shrink-0 transition-transform {activeSection === section.id
              ? 'rotate-90'
              : ''} text-on-surface-variant"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path
              d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06z"
            />
          </svg>
          <!-- Icon -->
          <svg
            class="h-4 w-4 shrink-0 {activeSection === section.id
              ? 'text-primary'
              : 'text-on-surface-variant'}"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d={section.icon} />
          </svg>
          <!-- Label -->
          <span class="font-semibold flex-1 {activeSection === section.id ? 'text-on-surface' : ''}"
            >{section.label}</span
          >
          <!-- Count badge -->
          {#if section.count !== undefined && section.count > 0}
            <span
              class="text-[10px] px-1.5 py-0.5 rounded-full {activeSection === section.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-surface-high text-on-surface-variant'}"
            >
              {section.count}
            </span>
          {/if}
        </button>

        {#if activeSection === section.id}
          <div class="overflow-y-auto flex-1 min-h-0" id="sidepanel-{section.id}" role="region">
            {#if section.helpText}
              <div class="px-3 py-2 text-xs text-on-surface-variant/80 border-b border-white/5">
                {section.helpText}
              </div>
            {/if}
            {@render section.content()}
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>
