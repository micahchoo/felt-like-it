<script lang="ts">
	import type { AuthActions, AuthStatus } from '$lib/contracts/auth.js';

	let { actions, status }: { actions: AuthActions; status: AuthStatus } = $props();

	let email = $state('');
	let password = $state('');
	let errorMessage = $state('');

	async function handleSubmit() {
		errorMessage = '';
		try {
			await actions.onLogin({ email, password });
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : 'Sign in failed. Please try again.';
		}
	}
</script>

<div class="bg-surface min-h-screen flex items-center justify-center p-4">
	<div class="w-full max-w-sm bg-surface-container rounded-2xl border border-white/5 shadow-2xl p-8 flex flex-col gap-6">
		<div class="text-center flex flex-col gap-1">
			<span class="text-primary font-bold text-xl font-display">FLI</span>
			<h1 class="text-2xl font-bold text-on-surface font-display">Welcome back</h1>
			<p class="text-sm text-on-surface-variant">Sign in to your account</p>
		</div>

		<div class="flex flex-col gap-4">
			<div class="flex flex-col gap-1.5">
				<label for="email" class="text-xs text-on-surface-variant uppercase tracking-wide">Email</label>
				<input
					id="email"
					type="email"
					placeholder="you@example.com"
					bind:value={email}
					class="bg-surface-low border border-white/5 rounded-lg px-3 py-2.5 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary w-full"
				/>
			</div>
			<div class="flex flex-col gap-1.5">
				<label for="password" class="text-xs text-on-surface-variant uppercase tracking-wide">Password</label>
				<input
					id="password"
					type="password"
					placeholder="••••••••"
					bind:value={password}
					class="bg-surface-low border border-white/5 rounded-lg px-3 py-2.5 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary w-full"
				/>
			</div>
		</div>

		{#if status === 'error' || errorMessage}
			<p class="text-error text-xs" role="alert">
				{#if errorMessage.includes('admin@feltlikei.it')}
					This account has been disabled. Contact support at <a href="mailto:admin@feltlikei.it" class="underline">admin@feltlikei.it</a> for assistance.
				{:else}
					{errorMessage || 'An error occurred. Please try again.'}
				{/if}
			</p>
		{/if}

		<button
			onclick={handleSubmit}
			disabled={status === 'loading'}
			class="w-full bg-primary text-on-primary font-bold rounded-xl py-3 text-sm active:scale-95 transition-transform shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
		>
			{status === 'loading' ? 'Signing in…' : 'Sign In'}
		</button>

		<p class="text-center text-sm text-on-surface-variant">
			Don't have an account?
			<a href="/register" class="text-primary hover:text-primary/80">Sign up</a>
		</p>
	</div>
</div>
