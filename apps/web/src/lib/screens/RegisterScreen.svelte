<script lang="ts">
	import type { AuthActions, AuthStatus } from '$lib/contracts/auth.js';

	let { actions, status }: { actions: AuthActions; status: AuthStatus } = $props();

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let confirmTouched = $state(false);
	let errorMessage = $state('');

	const passwordMismatch = $derived(confirmTouched && confirmPassword.length > 0 && password !== confirmPassword);

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
	<div class="w-full max-w-sm bg-surface-container rounded-2xl border border-white/5 shadow-2xl p-8 flex flex-col gap-6">
		<div class="text-center flex flex-col gap-1">
			<span class="text-primary font-bold text-xl font-display">FLI</span>
			<h1 class="text-2xl font-bold text-on-surface font-display">Create an account</h1>
			<p class="text-sm text-on-surface-variant">Get started with FLI</p>
		</div>

		<div class="flex flex-col gap-4">
			<div class="flex flex-col gap-1.5">
				<label for="name" class="text-xs text-on-surface-variant uppercase tracking-wide">Name</label>
				<input
					id="name"
					type="text"
					placeholder="Your name"
					bind:value={name}
					class="bg-surface-container-low border border-white/5 rounded-lg px-3 py-2.5 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary w-full"
				/>
			</div>
			<div class="flex flex-col gap-1.5">
				<label for="email" class="text-xs text-on-surface-variant uppercase tracking-wide">Email</label>
				<input
					id="email"
					type="email"
					placeholder="you@example.com"
					bind:value={email}
					class="bg-surface-container-low border border-white/5 rounded-lg px-3 py-2.5 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary w-full"
				/>
			</div>
			<div class="flex flex-col gap-1.5">
				<label for="password" class="text-xs text-on-surface-variant uppercase tracking-wide">Password</label>
				<input
					id="password"
					type="password"
					placeholder="••••••••"
					bind:value={password}
					minlength="8"
					class="bg-surface-container-low border border-white/5 rounded-lg px-3 py-2.5 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary w-full"
				/>
				<p class="text-[10px] text-on-surface-variant/70">Must be at least 8 characters</p>
			</div>
			<div class="flex flex-col gap-1.5">
				<label for="confirm-password" class="text-xs text-on-surface-variant uppercase tracking-wide">Confirm Password</label>
				<input
					id="confirm-password"
					type="password"
					placeholder="••••••••"
					bind:value={confirmPassword}
					onblur={() => (confirmTouched = true)}
					class="bg-surface-container-low border rounded-lg px-3 py-2.5 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-2 w-full
						{passwordMismatch ? 'border-error focus:ring-error' : 'border-white/5 focus:ring-primary'}"
				/>
				{#if passwordMismatch}
					<p class="text-[10px] text-error" role="alert">Passwords must match</p>
				{/if}
			</div>
		</div>

		{#if status === 'error' || errorMessage}
			<p class="text-error text-xs" role="alert">
				{errorMessage || 'An error occurred. Please try again.'}
			</p>
		{/if}

		<button
			onclick={handleSubmit}
			disabled={status === 'loading'}
			class="w-full bg-primary text-on-primary font-bold rounded-xl py-3 text-sm active:scale-95 transition-transform shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
		>
			{status === 'loading' ? 'Creating account…' : 'Create Account'}
		</button>

		<p class="text-center text-sm text-on-surface-variant">
			Already have an account?
			<a href="/login" class="text-primary hover:text-primary/80">Sign in</a>
		</p>
	</div>
</div>
