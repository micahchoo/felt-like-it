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
    onchange: (section: SectionId | null) => void;
  }

  let { sections, activeSection, onchange }: Props = $props();

  function toggle(id: SectionId) {
    onchange(activeSection === id ? null : id);
  }
</script>

<aside
  class="w-80 shrink-0 flex flex-col h-full bg-surface-container border-l border-surface-high"
  aria-label="Side panel"
>
  {#each sections as section (section.id)}
    <!-- Accordion header -->
    <button
      class="flex items-center gap-2 px-4 py-3 w-full text-left transition-colors shrink-0 font-display uppercase tracking-wide text-xs
             {activeSection === section.id
               ? 'bg-surface-high/50 border-l-2 border-primary'
               : 'hover:bg-surface-high/30 border-l-2 border-transparent'}"
      onclick={() => toggle(section.id)}
      aria-expanded={activeSection === section.id}
      aria-controls="sidepanel-{section.id}"
    >
      <!-- Chevron -->
      <svg
        class="h-3 w-3 text-on-surface-variant transition-transform duration-200 shrink-0
               {activeSection === section.id ? 'rotate-90' : ''}"
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z"/>
      </svg>

      <!-- Icon -->
      <svg class="h-4 w-4 text-on-surface-variant shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d={section.icon} />
      </svg>

      <!-- Label -->
      <span class="text-sm font-medium text-on-surface flex-1">{section.label}</span>

      <!-- Count badge -->
      {#if section.count !== undefined && section.count > 0}
        <span class="bg-surface-high text-xs rounded-full px-1.5 py-0.5 text-on-surface-variant tabular-nums">
          {section.count}
        </span>
      {/if}
    </button>

    <!-- Accordion content -->
    {#if activeSection === section.id}
      <div
        id="sidepanel-{section.id}"
        class="flex-1 min-h-0 overflow-y-auto"
      >
        {#if section.helpText}
          <div class="px-4 py-2 bg-surface-low/30 border-b border-surface-high/30 text-xs text-on-surface-variant leading-relaxed">
            {section.helpText}
          </div>
        {/if}
        {@render section.content()}
      </div>
    {/if}
  {/each}
</aside>
