<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends HTMLInputAttributes {
    label?: string;
    error?: string | undefined;
    hint?: string | undefined;
  }

  let {
    label,
    error,
    hint,
    class: className = '',
    id,
    ...rest
  }: Props = $props();

  const generatedId = `input-${Math.random().toString(36).slice(2)}`;
  const inputId = $derived(id ?? generatedId);
</script>

<div class="flex flex-col gap-1">
  {#if label}
    <label for={inputId} class="text-sm font-medium text-slate-300">
      {label}
      {#if rest.required}<span class="text-red-400 ml-0.5" aria-hidden="true">*</span>{/if}
    </label>
  {/if}

  <input
    id={inputId}
    class="w-full rounded-lg bg-slate-700 border border-slate-600 px-3 py-2 text-sm text-white placeholder-slate-400
           focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
           disabled:opacity-50 disabled:cursor-not-allowed
           aria-invalid:border-red-500 aria-invalid:focus:ring-red-500
           {className}"
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
    {...rest}
  />

  {#if error}
    <p id="{inputId}-error" class="text-xs text-red-400" role="alert">{error}</p>
  {:else if hint}
    <p id="{inputId}-hint" class="text-xs text-slate-400">{hint}</p>
  {/if}
</div>
