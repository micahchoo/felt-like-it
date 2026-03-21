<script lang="ts">
	interface Props {
		checked?: boolean;
		onchange?: ((checked: boolean) => void) | undefined;
		label?: string | undefined;
		disabled?: boolean;
	}

	let {
		checked = $bindable(false),
		onchange,
		label = undefined,
		disabled = false
	}: Props = $props();

	function toggle() {
		if (disabled) return;
		checked = !checked;
		onchange?.(checked);
	}
</script>

<div class="inline-flex items-center gap-2">
	<button
		type="button"
		role="switch"
		aria-checked={checked}
		aria-label={label ?? undefined}
		{disabled}
		onclick={toggle}
		class="relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors
			focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface
			{checked ? 'bg-primary-container' : 'bg-surface-high'}
			{disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}"
	>
		<span
			class="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm
				transform transition-transform duration-200 ease-in-out mt-0.5
				{checked ? 'translate-x-5.5' : 'translate-x-0.5'}"
			aria-hidden="true"
		></span>
	</button>
	{#if label}
		<span class="font-body text-sm text-on-surface">{label}</span>
	{/if}
</div>
