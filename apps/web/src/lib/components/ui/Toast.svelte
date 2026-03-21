<script lang="ts" module>
	export interface ToastItem {
		id: string;
		variant: 'success' | 'error' | 'info' | 'warning';
		message: string;
		duration: number;
	}

	function createToastStore() {
		let items = $state<ToastItem[]>([]);

		function add(variant: ToastItem['variant'], message: string, duration = 4000) {
			const id = crypto.randomUUID();
			items = [...items, { id, variant, message, duration }];
		}

		function dismiss(id: string) {
			items = items.filter((t) => t.id !== id);
		}

		return {
			get items() {
				return items;
			},
			success: (message: string) => add('success', message),
			error: (message: string) => add('error', message),
			info: (message: string) => add('info', message),
			warning: (message: string) => add('warning', message),
			dismiss
		};
	}

	export const toastStore = createToastStore();
</script>

<script lang="ts">
	const variantBorder: Record<ToastItem['variant'], string> = {
		success: 'border-l-4 border-primary',
		error: 'border-l-4 border-error',
		info: 'border-l-4 border-tertiary',
		warning: 'border-l-4 border-primary-container'
	};

	const variantText: Record<ToastItem['variant'], string> = {
		success: 'text-primary',
		error: 'text-error',
		info: 'text-tertiary',
		warning: 'text-primary-container'
	};

	$effect(() => {
		const timers: ReturnType<typeof setTimeout>[] = [];
		for (const toast of toastStore.items) {
			const timer = setTimeout(() => toastStore.dismiss(toast.id), toast.duration);
			timers.push(timer);
		}
		return () => timers.forEach(clearTimeout);
	});
</script>

{#if toastStore.items.length > 0}
	<div class="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
		{#each toastStore.items as toast (toast.id)}
			<button
				class="glass-panel tonal-elevation max-w-sm rounded-lg px-4 py-3 font-body text-sm text-on-surface
					pointer-events-auto cursor-pointer toast-enter
					{variantBorder[toast.variant]}"
				onclick={() => toastStore.dismiss(toast.id)}
				aria-label="Dismiss notification"
			>
				<span class={variantText[toast.variant]}>{toast.message}</span>
			</button>
		{/each}
	</div>
{/if}

<style>
	@media (prefers-reduced-motion: no-preference) {
		.toast-enter {
			animation: slide-in 200ms ease-out;
		}
	}
	@keyframes slide-in {
		from {
			opacity: 0;
			transform: translateX(1rem);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}
</style>
