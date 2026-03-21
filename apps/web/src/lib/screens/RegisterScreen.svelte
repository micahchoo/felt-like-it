<script lang="ts">
	import type { AuthActions, AuthStatus } from '$lib/contracts/auth.js';
	import GlassPanel from '$lib/components/ui/GlassPanel.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Button from '$lib/components/ui/Button.svelte';

	let { actions, status }: { actions: AuthActions; status: AuthStatus } = $props();

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let errorMessage = $state('');

	async function handleSubmit() {
		errorMessage = '';
		if (password !== confirmPassword) {
			errorMessage = 'Passwords do not match.';
			return;
		}
		try {
			await actions.onRegister({ name, email, password, confirmPassword });
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : 'Registration failed. Please try again.';
		}
	}
</script>

<div class="bg-surface min-h-screen flex items-center justify-center p-4">
	<GlassPanel class="w-full max-w-sm p-8 flex flex-col gap-6">
		<div class="text-center">
			<span class="font-display text-4xl font-bold text-primary">FLIT</span>
		</div>

		<div class="flex flex-col gap-4">
			<Input
				id="name"
				type="text"
				placeholder="Name"
				bind:value={name}
			/>
			<Input
				id="email"
				type="email"
				placeholder="Email"
				bind:value={email}
			/>
			<Input
				id="password"
				type="password"
				placeholder="Password"
				bind:value={password}
			/>
			<Input
				id="confirm-password"
				type="password"
				placeholder="Confirm Password"
				bind:value={confirmPassword}
			/>
		</div>

		{#if status === 'error' || errorMessage}
			<p class="text-error text-sm font-body" role="alert">
				{errorMessage || 'An error occurred. Please try again.'}
			</p>
		{/if}

		<Button variant="primary" size="lg" onclick={handleSubmit} disabled={status === 'loading'}>
			Create Account
		</Button>

		<p class="text-center text-sm font-body text-on-surface-variant">
			Already have an account?
			<a href="/login" class="text-primary hover:underline">Sign in</a>
		</p>
	</GlassPanel>
</div>
