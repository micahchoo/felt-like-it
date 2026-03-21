<script lang="ts">
	interface Props {
		color: string;
		size?: 'sm' | 'md';
		selected?: boolean;
		onclick?: (() => void) | undefined;
	}

	let {
		color,
		size = 'md',
		selected = false,
		onclick
	}: Props = $props();

	const sizeClasses: Record<string, string> = {
		sm: 'h-4 w-4',
		md: 'h-6 w-6'
	};
</script>

<button
	type="button"
	class="rounded transition-shadow inline-block
		{sizeClasses[size]}
		{selected ? 'ring-2 ring-primary ring-offset-1 ring-offset-surface' : ''}
		{onclick ? 'cursor-pointer' : ''}"
	style="background-color: {color}"
	aria-label={color}
	onclick={onclick}
	disabled={!onclick}
>
</button>
