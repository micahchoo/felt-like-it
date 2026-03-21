<script lang="ts">
	import IconButton from './IconButton.svelte';
	import ChevronLeft from 'lucide-svelte/icons/chevron-left';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';

	interface Props {
		totalCount: number;
		hasNext?: boolean;
		hasPrev?: boolean;
		onnext?: (() => void) | undefined;
		onprev?: (() => void) | undefined;
		currentPage?: number;
	}

	let {
		totalCount,
		hasNext = false,
		hasPrev = false,
		onnext,
		onprev,
		currentPage = 1
	}: Props = $props();
</script>

<div class="flex justify-between items-center">
	<span class="font-display text-xs text-on-surface-variant">
		Showing {totalCount} of {totalCount}
	</span>

	<div class="flex items-center gap-1">
		<IconButton
			icon={ChevronLeft}
			label="Previous page"
			variant="ghost"
			size="sm"
			disabled={!hasPrev}
			onclick={onprev}
		/>
		<span class="font-display text-xs text-on-surface-variant px-2">
			{currentPage}
		</span>
		<IconButton
			icon={ChevronRight}
			label="Next page"
			variant="ghost"
			size="sm"
			disabled={!hasNext}
			onclick={onnext}
		/>
	</div>
</div>
