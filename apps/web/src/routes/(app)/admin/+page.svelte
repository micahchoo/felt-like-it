<script lang="ts">
  import type { PageData } from './$types';
  import { invalidateAll } from '$app/navigation';
  import { trpc } from '$lib/utils/trpc.js';

  let { data }: { data: PageData } = $props();

  // Modal state
  let showCreateModal = $state(false);
  let showResetModal = $state(false);
  let resetUserId = $state('');
  let resetUserName = $state('');
  let toast = $state('');

  // Create form
  let createEmail = $state('');
  let createName = $state('');
  let createPassword = $state('');
  let createConfirm = $state('');
  let createIsAdmin = $state(false);
  let createError = $state('');

  // Reset form
  let resetPassword = $state('');
  let resetConfirm = $state('');
  let resetError = $state('');

  function showToast(msg: string) {
    toast = msg;
    setTimeout(() => (toast = ''), 3000);
  }

  async function handleCreate() {
    createError = '';
    if (createPassword !== createConfirm) {
      createError = 'Passwords do not match.';
      return;
    }
    if (createPassword.length < 8) {
      createError = 'Password must be at least 8 characters.';
      return;
    }
    try {
      await trpc.admin.createUser.mutate({
        email: createEmail,
        name: createName,
        password: createPassword,
        isAdmin: createIsAdmin,
      });
      showCreateModal = false;
      createEmail = createName = createPassword = createConfirm = '';
      createIsAdmin = false;
      showToast('User created.');
      await invalidateAll();
    } catch (e: unknown) {
      createError = e instanceof Error ? e.message : 'Failed to create user.';
    }
  }

  async function handleResetPassword() {
    resetError = '';
    if (resetPassword !== resetConfirm) {
      resetError = 'Passwords do not match.';
      return;
    }
    if (resetPassword.length < 8) {
      resetError = 'Password must be at least 8 characters.';
      return;
    }
    try {
      await trpc.admin.resetPassword.mutate({
        userId: resetUserId,
        newPassword: resetPassword,
      });
      showResetModal = false;
      resetPassword = resetConfirm = '';
      showToast('Password reset.');
    } catch (e: unknown) {
      resetError = e instanceof Error ? e.message : 'Failed to reset password.';
    }
  }

  async function handleToggleAdmin(userId: string, userName: string, currentlyAdmin: boolean) {
    const action = currentlyAdmin ? 'Remove admin from' : 'Promote to admin:';
    if (!window.confirm(`${action} ${userName}?`)) return;
    try {
      await trpc.admin.toggleAdmin.mutate({ userId });
      showToast(currentlyAdmin ? 'Admin removed.' : 'Promoted to admin.');
      await invalidateAll();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed.');
    }
  }

  async function handleToggleDisabled(userId: string, userName: string, currentlyDisabled: boolean) {
    if (!currentlyDisabled) {
      if (!window.confirm(`Disable ${userName}? They will be logged out immediately.`)) return;
    }
    try {
      await trpc.admin.toggleDisabled.mutate({ userId });
      showToast(currentlyDisabled ? 'User enabled.' : 'User disabled.');
      await invalidateAll();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed.');
    }
  }

  function openResetModal(userId: string, userName: string) {
    resetUserId = userId;
    resetUserName = userName;
    resetPassword = resetConfirm = resetError = '';
    showResetModal = true;
  }
</script>

<!-- Toast -->
{#if toast}
  <div class="fixed top-4 right-4 z-50 px-4 py-2 rounded bg-emerald-600 text-white text-sm shadow-lg">
    {toast}
  </div>
{/if}

<div class="flex items-center justify-between mb-6">
  <h1 class="text-2xl font-bold">Users</h1>
  <button
    class="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
    onclick={() => (showCreateModal = true)}
  >
    Create User
  </button>
</div>

<!-- Users Table -->
<div class="overflow-x-auto">
  <table class="w-full text-sm text-left">
    <thead class="text-xs text-slate-400 uppercase border-b border-white/10">
      <tr>
        <th class="px-4 py-3">Name</th>
        <th class="px-4 py-3">Email</th>
        <th class="px-4 py-3">Role</th>
        <th class="px-4 py-3">Status</th>
        <th class="px-4 py-3">Created</th>
        <th class="px-4 py-3">Actions</th>
      </tr>
    </thead>
    <tbody>
      {#each data.users as user (user.id)}
        <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
          <td class="px-4 py-3 font-medium text-white">{user.name}</td>
          <td class="px-4 py-3 text-slate-300">{user.email}</td>
          <td class="px-4 py-3">
            {#if user.isAdmin}
              <span class="px-2 py-0.5 rounded text-xs font-medium bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30">Admin</span>
            {:else}
              <span class="text-slate-500">User</span>
            {/if}
          </td>
          <td class="px-4 py-3">
            {#if user.disabledAt}
              <span class="px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-300 ring-1 ring-red-500/30">Disabled</span>
            {:else}
              <span class="px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30">Active</span>
            {/if}
          </td>
          <td class="px-4 py-3 text-slate-400">{new Date(user.createdAt).toLocaleDateString()}</td>
          <td class="px-4 py-3 flex gap-2">
            <button
              class="px-2 py-1 rounded text-xs bg-white/5 hover:bg-white/10 text-slate-300 transition-colors"
              onclick={() => handleToggleAdmin(user.id, user.name, user.isAdmin)}
              title={user.isAdmin ? 'Remove admin' : 'Make admin'}
            >
              {user.isAdmin ? 'Demote' : 'Promote'}
            </button>
            <button
              class="px-2 py-1 rounded text-xs bg-white/5 hover:bg-white/10 text-slate-300 transition-colors"
              onclick={() => openResetModal(user.id, user.name)}
            >
              Reset PW
            </button>
            <button
              class="px-2 py-1 rounded text-xs transition-colors {user.disabledAt
                ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300'
                : 'bg-red-500/10 hover:bg-red-500/20 text-red-300'}"
              onclick={() => handleToggleDisabled(user.id, user.name, !!user.disabledAt)}
            >
              {user.disabledAt ? 'Enable' : 'Disable'}
            </button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

{#if data.users.length === 0}
  <p class="text-slate-400 text-center py-10">No users found.</p>
{/if}

<!-- Create User Modal -->
{#if showCreateModal}
  <div class="fixed inset-0 z-40 bg-black/50 flex items-center justify-center" onclick={() => (showCreateModal = false)}>
    <div class="bg-slate-800 rounded-lg p-6 w-full max-w-md shadow-xl" onclick={(e) => e.stopPropagation()}>
      <h2 class="text-lg font-semibold mb-4">Create User</h2>
      {#if createError}
        <p class="text-red-400 text-sm mb-3">{createError}</p>
      {/if}
      <form onsubmit={(e) => { e.preventDefault(); handleCreate(); }} class="space-y-3">
        <div>
          <label class="block text-xs text-slate-400 mb-1" for="create-email">Email</label>
          <input id="create-email" type="email" required bind:value={createEmail}
            class="w-full px-3 py-2 rounded bg-slate-700 border border-white/10 text-white text-sm" />
        </div>
        <div>
          <label class="block text-xs text-slate-400 mb-1" for="create-name">Name</label>
          <input id="create-name" type="text" required bind:value={createName}
            class="w-full px-3 py-2 rounded bg-slate-700 border border-white/10 text-white text-sm" />
        </div>
        <div>
          <label class="block text-xs text-slate-400 mb-1" for="create-pw">Password</label>
          <input id="create-pw" type="password" required minlength="8" bind:value={createPassword}
            class="w-full px-3 py-2 rounded bg-slate-700 border border-white/10 text-white text-sm" />
        </div>
        <div>
          <label class="block text-xs text-slate-400 mb-1" for="create-confirm">Confirm Password</label>
          <input id="create-confirm" type="password" required minlength="8" bind:value={createConfirm}
            class="w-full px-3 py-2 rounded bg-slate-700 border border-white/10 text-white text-sm" />
        </div>
        <label class="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" bind:checked={createIsAdmin} class="rounded" />
          Admin
        </label>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick={() => (showCreateModal = false)}
            class="px-4 py-2 rounded text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
          <button type="submit"
            class="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors">Create</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- Reset Password Modal -->
{#if showResetModal}
  <div class="fixed inset-0 z-40 bg-black/50 flex items-center justify-center" onclick={() => (showResetModal = false)}>
    <div class="bg-slate-800 rounded-lg p-6 w-full max-w-md shadow-xl" onclick={(e) => e.stopPropagation()}>
      <h2 class="text-lg font-semibold mb-1">Reset Password</h2>
      <p class="text-sm text-slate-400 mb-4">For: {resetUserName}</p>
      {#if resetError}
        <p class="text-red-400 text-sm mb-3">{resetError}</p>
      {/if}
      <form onsubmit={(e) => { e.preventDefault(); handleResetPassword(); }} class="space-y-3">
        <div>
          <label class="block text-xs text-slate-400 mb-1" for="reset-pw">New Password</label>
          <input id="reset-pw" type="password" required minlength="8" bind:value={resetPassword}
            class="w-full px-3 py-2 rounded bg-slate-700 border border-white/10 text-white text-sm" />
        </div>
        <div>
          <label class="block text-xs text-slate-400 mb-1" for="reset-confirm">Confirm Password</label>
          <input id="reset-confirm" type="password" required minlength="8" bind:value={resetConfirm}
            class="w-full px-3 py-2 rounded bg-slate-700 border border-white/10 text-white text-sm" />
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick={() => (showResetModal = false)}
            class="px-4 py-2 rounded text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
          <button type="submit"
            class="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors">Reset</button>
        </div>
      </form>
    </div>
  </div>
{/if}
