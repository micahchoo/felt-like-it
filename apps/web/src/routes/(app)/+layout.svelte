<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
    data: { user: { id: string; email: string; name: string } };
  }

  let { children }: Props = $props();
</script>

{@render children()}
