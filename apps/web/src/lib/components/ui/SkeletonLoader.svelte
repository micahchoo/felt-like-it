<script lang="ts">
	interface Props {
		layout?: 'dashboard' | 'editor' | 'table' | 'panel';
	}

	let { layout = 'dashboard' }: Props = $props();
</script>

{#if layout === 'dashboard'}
	<div class="grid grid-cols-3 gap-4 p-4">
		{#each { length: 6 } as _}
			<div class="bg-surface-high rounded animate-pulse h-32"></div>
		{/each}
	</div>
{:else if layout === 'editor'}
	<div class="flex gap-4 p-4 h-full">
		<div class="bg-surface-high rounded animate-pulse w-64 shrink-0"></div>
		<div class="bg-surface-high rounded animate-pulse flex-1"></div>
		<div class="bg-surface-high rounded animate-pulse w-64 shrink-0"></div>
	</div>
{:else if layout === 'table'}
	<div class="flex flex-col gap-2 p-4">
		<div class="bg-surface-high rounded animate-pulse h-10"></div>
		{#each { length: 5 } as _}
			<div class="bg-surface-high rounded animate-pulse h-8"></div>
		{/each}
	</div>
{:else if layout === 'panel'}
	<div class="flex flex-col gap-3 p-4">
		<div class="bg-surface-high rounded animate-pulse h-8 w-2/3"></div>
		{#each { length: 4 } as _}
			<div class="bg-surface-high rounded animate-pulse h-12"></div>
		{/each}
	</div>
{/if}
