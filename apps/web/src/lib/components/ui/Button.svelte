<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg' | 'icon';
    loading?: boolean;
    children: Snippet;
  }

  let {
    variant = 'secondary',
    size = 'md',
    loading = false,
    class: className = '',
    disabled,
    children,
    ...rest
  }: Props = $props();

  const base =
    'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none';

  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-600',
    secondary:
      'bg-slate-700 text-slate-100 hover:bg-slate-600 focus-visible:ring-slate-500',
    ghost:
      'text-slate-300 hover:bg-slate-700 hover:text-slate-100 focus-visible:ring-slate-500',
    danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600',
  };

  const sizes = {
    sm: 'h-7 px-2.5 text-xs gap-1.5',
    md: 'h-9 px-3.5 text-sm gap-2',
    lg: 'h-11 px-5 text-base gap-2',
    icon: 'h-9 w-9 p-0',
  };
</script>

<button
  class="{base} {variants[variant]} {sizes[size]} {className}"
  disabled={disabled || loading}
  aria-busy={loading}
  {...rest}
>
  {#if loading}
    <svg
      class="animate-spin -ml-0.5 h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
      <path
        class="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  {/if}
  {@render children()}
</button>
