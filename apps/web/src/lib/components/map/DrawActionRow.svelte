<script lang="ts">
  interface Props {
    onannotate: () => void;
    onmeasure: () => void;
    ondismiss: () => void;
  }

  let { onannotate, onmeasure, ondismiss }: Props = $props();

  let visible = $state(true);
</script>

{#if visible}
  <div
    class="flex items-center gap-1 glass-panel border-surface-high rounded-lg px-2 py-1 shadow-lg"
    role="toolbar"
    aria-label="Feature actions"
  >
    <button
      type="button"
      class="text-xs px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white transition-colors"
      onclick={onannotate}
    >
      Annotate
    </button>
    <button
      type="button"
      class="text-xs px-2 py-1 rounded bg-surface-high hover:bg-surface-highest text-on-surface transition-colors"
      onclick={onmeasure}
    >
      Measure
    </button>
    <button
      type="button"
      class="text-xs px-2 py-1 rounded bg-surface-high hover:bg-surface-highest text-on-surface-variant transition-colors"
      onclick={() => { visible = false; ondismiss(); }}
      aria-label="Dismiss"
    >
      Done
    </button>
  </div>
{/if}
