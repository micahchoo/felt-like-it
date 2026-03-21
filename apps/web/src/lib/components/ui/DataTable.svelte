<script lang="ts">
	import ChevronUp from 'lucide-svelte/icons/chevron-up';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import Search from 'lucide-svelte/icons/search';
	import X from 'lucide-svelte/icons/x';

	interface Column {
		key: string;
		label: string;
		sortable?: boolean;
	}

	interface Props {
		columns: Column[];
		rows: Record<string, unknown>[];
		onrowclick?: (row: Record<string, unknown>) => void;
		searchable?: boolean;
	}

	let {
		columns,
		rows,
		onrowclick,
		searchable = false
	}: Props = $props();

	let sortKey: string | null = $state(null);
	let sortDirection: 'asc' | 'desc' = $state('asc');
	let searchQuery = $state('');

	function toggleSort(key: string) {
		if (sortKey === key) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortKey = key;
			sortDirection = 'asc';
		}
	}

	const filteredRows = $derived.by(() => {
		let result = rows;
		if (searchable && searchQuery.trim()) {
			const q = searchQuery.trim().toLowerCase();
			result = result.filter((row) =>
				Object.values(row).some(
					(val) => typeof val === 'string' && val.toLowerCase().includes(q)
				)
			);
		}
		if (sortKey) {
			const key = sortKey;
			const dir = sortDirection === 'asc' ? 1 : -1;
			result = [...result].sort((a, b) => {
				const av = a[key];
				const bv = b[key];
				if (av == null && bv == null) return 0;
				if (av == null) return 1;
				if (bv == null) return -1;
				if (typeof av === 'string' && typeof bv === 'string') {
					return av.localeCompare(bv) * dir;
				}
				return (Number(av) - Number(bv)) * dir;
			});
		}
		return result;
	});

	function cellValue(val: unknown): string {
		if (val == null) return '';
		return String(val);
	}
</script>

<div class="flex flex-col gap-2">
	{#if searchable}
		<div class="relative">
			<Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search..."
				class="font-body bg-surface-low text-on-surface rounded-md pl-9 pr-8 py-2 text-sm w-full
					border-b-2 border-transparent transition-colors
					placeholder:text-on-surface-variant/50
					focus:border-primary focus:outline-none"
			/>
			{#if searchQuery}
				<button
					type="button"
					class="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface cursor-pointer"
					onclick={() => (searchQuery = '')}
					aria-label="Clear search"
				>
					<X size={14} />
				</button>
			{/if}
		</div>
	{/if}

	<div class="scrollbar-thin overflow-auto">
		<table class="w-full">
			<thead>
				<tr class="bg-surface-low">
					{#each columns as col}
						<th
							class="font-display text-xs uppercase tracking-wide text-on-surface-variant px-3 py-2 text-left
								{col.sortable ? 'cursor-pointer select-none' : ''}"
							onclick={col.sortable ? () => toggleSort(col.key) : undefined}
						>
							<span class="inline-flex items-center gap-1">
								{col.label}
								{#if col.sortable && sortKey === col.key}
									{#if sortDirection === 'asc'}
										<ChevronUp size={14} />
									{:else}
										<ChevronDown size={14} />
									{/if}
								{/if}
							</span>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each filteredRows as row}
					<tr
						class="font-body text-sm text-on-surface hover:bg-surface-high/50 transition-colors
							{onrowclick ? 'cursor-pointer' : ''}"
						onclick={onrowclick ? () => onrowclick(row) : undefined}
					>
						{#each columns as col}
							<td class="px-3 py-2">{cellValue(row[col.key])}</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
