<script lang="ts">
	interface Props {
		size?: 'sm' | 'md' | 'lg';
	}

	let { size = 'md' }: Props = $props();

	const sizeClass: Record<string, string> = {
		sm: 'h-4 w-4',
		md: 'h-6 w-6',
		lg: 'h-8 w-8'
	};
</script>

<div
	class="border-2 border-primary border-t-transparent rounded-full animate-spin {sizeClass[size]}"
	role="status"
>
	<span class="sr-only">Loading</span>
</div>
