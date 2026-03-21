<script lang="ts">
	interface Props {
		value?: string;
		placeholder?: string;
		rows?: number;
		error?: string | undefined;
		disabled?: boolean;
		id?: string | undefined;
	}

	let {
		value = $bindable(''),
		placeholder = '',
		rows = 3,
		error = undefined,
		disabled = false,
		id = undefined
	}: Props = $props();
</script>

<div class="flex flex-col gap-1">
	<textarea
		bind:value
		{placeholder}
		{rows}
		{disabled}
		{id}
		class="font-body bg-surface-low text-on-surface rounded-md px-3 py-2 text-sm resize-y
			border-b-2 border-transparent transition-colors
			placeholder:text-on-surface-variant/50
			focus:border-b-2 focus:border-primary focus:outline-none
			focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface
			{error ? 'border-error' : ''}
			{disabled ? 'opacity-50 cursor-not-allowed' : ''}"
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={error && id ? `${id}-error` : undefined}
	></textarea>
	{#if error}
		<p
			class="text-error text-xs font-body"
			id={id ? `${id}-error` : undefined}
			role="alert"
		>
			{error}
		</p>
	{/if}
</div>
