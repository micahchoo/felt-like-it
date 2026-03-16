<script lang="ts">
  import type { Snippet } from 'svelte';
  import { QueryClientProvider } from '@tanstack/svelte-query';
  import { queryClient } from '$lib/utils/query-client.js';

  interface Props {
    children: Snippet;
    data: { user: { id: string; email: string; name: string; isAdmin: boolean } };
  }

  let { children }: Props = $props();
</script>

<QueryClientProvider client={queryClient}>
  {@render children()}
</QueryClientProvider>
