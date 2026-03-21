<script lang="ts">
	import type { Component, SvelteComponent } from 'svelte';

	// TYPE_DEBT: lucide-svelte@0.469 exports SvelteComponentTyped (Svelte 4 class API), incompatible with Svelte 5 Component<T>
	type IconType = Component<Record<string, any>> | (new (...args: any[]) => SvelteComponent); // eslint-disable-line @typescript-eslint/no-explicit-any

	interface Props {
		icon: IconType;
		label: string;
		variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
		size?: 'sm' | 'md' | 'lg';
		active?: boolean;
		disabled?: boolean;
		onclick?: (() => void) | undefined;
	}

	let {
		icon: Icon,
		label,
		variant = 'ghost',
		size = 'md',
		active = false,
		disabled = false,
		onclick
	}: Props = $props();

	const variantClasses: Record<string, string> = {
		primary: 'signature-gradient text-on-primary-container',
		secondary: 'bg-surface-container text-on-surface',
		ghost: 'bg-transparent text-on-surface hover:bg-surface-high',
		danger: 'bg-error/20 text-error'
	};

	const sizeBoxClasses: Record<string, string> = {
		sm: 'h-8 w-8',
		md: 'h-10 w-10',
		lg: 'h-12 w-12'
	};

	const iconSizes: Record<string, number> = {
		sm: 16,
		md: 20,
		lg: 24
	};
</script>

<button
	type="button"
	class="inline-flex items-center justify-center rounded-md transition-colors
		focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface
		{active ? 'signature-gradient text-on-primary-container' : variantClasses[variant]}
		{sizeBoxClasses[size]}
		{disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}"
	{disabled}
	aria-label={label}
	aria-pressed={active}
	{onclick}
>
	<Icon size={iconSizes[size]} />
</button>
