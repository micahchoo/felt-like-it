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
  class="w-80 shrink-0 flex flex-col h-full glass-panel border-l border-white/5"
  aria-label="Side panel"
>
  {#each sections as section (section.id)}
    <!-- Accordion header -->
    <button
      class="flex items-center gap-2.5 px-4 py-3 w-full text-left transition-all duration-200 shrink-0 font-display uppercase tracking-widest text-[10px]
             {activeSection === section.id
               ? 'bg-amber-500/10 shadow-[inset_3px_0_0_0_#f59e0b] text-amber-400'
               : 'hover:bg-amber-500/5 hover:text-amber-400 text-on-surface-variant border-l-2 border-transparent'}"
      onclick={() => toggle(section.id)}
      aria-expanded={activeSection === section.id}
      aria-controls="sidepanel-{section.id}"
    >
      <!-- Chevron -->
      <svg
        class="h-3 w-3 transition-transform duration-200 shrink-0
               {activeSection === section.id ? 'rotate-90 text-amber-500' : 'text-on-surface-variant'}"
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z"/>
      </svg>

      <!-- Icon -->
      <svg class="h-4 w-4 shrink-0 {activeSection === section.id ? 'text-amber-500' : 'text-on-surface-variant'}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d={section.icon} />
      </svg>

      <!-- Label -->
      <span class="font-semibold flex-1 {activeSection === section.id ? 'text-on-surface' : ''}">{section.label}</span>

      <!-- Count badge -->
      {#if section.count !== undefined && section.count > 0}
        <span class="text-[9px] rounded-full px-1.5 py-0.5 tabular-nums font-bold
                     {activeSection === section.id
                       ? 'bg-amber-500/20 text-amber-400'
                       : 'bg-surface-high text-on-surface-variant'}">
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
          <div class="px-4 py-2 bg-surface-lowest/30 border-b border-white/5 text-[10px] text-on-surface-variant leading-relaxed tracking-wide">
            {section.helpText}
          </div>
        {/if}
        {@render section.content()}
      </div>
    {/if}
  {/each}
</aside>
