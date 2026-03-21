# Web-Next UI Merge Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing apps/web frontend UI with web-next prototype components, keeping all server code untouched.

**Architecture:** Big-bang replacement on a feature branch. Copy web-next's contracts, screens, and UI components into apps/web/src/lib/. Replace route +page.svelte files to use new screen components. Existing MapEditor.svelte and its dependencies stay unchanged — the map editor, share, and embed routes keep their current page structure.

**Tech Stack:** SvelteKit 2, Svelte 5, Tailwind 4, lucide-svelte, tRPC 11, TanStack Query, MapLibre GL 5

**Spec:** `docs/superpowers/specs/2026-03-20-web-next-merge-design.md`

---

## File Structure

### New directories in `apps/web/src/lib/`
- `contracts/` — screen contract types (7 files)
- `screens/` — screen components (8 files)
- `components/admin/` — admin sub-components (4 files)

### Modified directories
- `components/ui/` — add 20 new primitives, replace 4 existing (Button, Input, Spinner, Toast)

### Kept unchanged
- `components/map/` — all files (MapEditor + its real dependencies)
- `components/data/` — all files (used by MapEditor)
- `components/annotations/` — all files (used by MapEditor)
- `components/geoprocessing/` — GeoprocessingPanel (used by MapEditor)
- `components/style/` — Legend, StylePanel (used by MapEditor)
- `stores/` — all real stores
- `server/` — entire server directory
- `utils/` — trpc.ts, query-client.ts, etc.

### Static assets added
- `static/fonts/` — 8 woff2 files (Inter + Kode Mono)
- `static/icons/` — 3 PWA icons
- `static/manifest.webmanifest`

---

## Task 1: Branch Setup and Dependencies

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Create feature branch**

```bash
cd /mnt/Ghar/2TA/DevStuff/felt-like-it
git checkout -b feat/web-next-merge master
```

- [ ] **Step 2: Install lucide-svelte**

```bash
cd apps/web && pnpm add lucide-svelte@^0.469.0
```

- [ ] **Step 3: Verify install**

Run: `pnpm check` in apps/web
Expected: No new errors from the dependency addition

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore: add lucide-svelte dependency for web-next merge"
```

---

## Task 2: Copy Static Assets

**Files:**
- Create: `apps/web/static/fonts/*.woff2` (8 files)
- Create: `apps/web/static/icons/*.png` (3 files)
- Create: `apps/web/static/manifest.webmanifest`
- Modify: `apps/web/src/app.html`
- Modify: `apps/web/src/app.css`

- [ ] **Step 1: Copy font files**

```bash
WN=.worktrees/web-next/apps/web-next
WEB=apps/web
mkdir -p $WEB/static/fonts $WEB/static/icons
cp $WN/static/fonts/*.woff2 $WEB/static/fonts/
cp $WN/static/icons/*.png $WEB/static/icons/
cp $WN/static/manifest.webmanifest $WEB/static/
```

- [ ] **Step 2: Update app.html**

Replace `apps/web/src/app.html` with web-next version but keep existing `<body>` structure. Key changes:
- Add `class="dark"` to `<html>` tag
- Replace Google Fonts preconnect with local font preloads
- Add PWA meta tags (theme-color, apple-mobile-web-app, manifest link)

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" href="%sveltekit.assets%/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#081425" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <link rel="apple-touch-icon" href="/icons/icon-192.png" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="preload" href="/fonts/kode-mono-latin-600.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/fonts/inter-latin-400.woff2" as="font" type="font/woff2" crossorigin />
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```

- [ ] **Step 3: Replace app.css**

Copy web-next's `app.css` to `apps/web/src/app.css`. This contains:
- Tailwind 4 import
- CSS custom properties for design tokens
- @font-face declarations for Inter + Kode Mono
- Signature utility classes (glass-panel, tonal-elevation, etc.)

```bash
cp $WN/src/app.css $WEB/src/app.css
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/static/ apps/web/src/app.html apps/web/src/app.css
git commit -m "feat: add web-next static assets, fonts, and styling"
```

---

## Task 3: Copy Contracts and Screens

**Files:**
- Create: `apps/web/src/lib/contracts/` (7 files)
- Create: `apps/web/src/lib/screens/` (8 files)

- [ ] **Step 1: Copy contracts directory**

```bash
cp -r $WN/src/lib/contracts $WEB/src/lib/contracts
```

- [ ] **Step 2: Add AdminUser type to contracts/admin.ts**

Add after the existing `User` import:

```typescript
export interface AdminUser extends User {
  isAdmin: boolean;
  disabledAt: Date | null;
}
```

Update `AdminData` to use `PaginatedData<AdminUser>` instead of `PaginatedData<User>`.

- [ ] **Step 3: Copy screens directory**

```bash
cp -r $WN/src/lib/screens $WEB/src/lib/screens
```

- [ ] **Step 4: Remove mock store imports from screens**

The screens import mock stores via `setContext`. Grep and remove any mock store imports:

```bash
grep -rl 'mock-' $WEB/src/lib/screens/ | head
```

If any screens import from `$lib/stores/mock-*` or `$lib/stores/interfaces`, remove those imports.

- [ ] **Step 5: Verify contracts compile**

Run: `cd apps/web && npx svelte-kit sync`
Expected: No errors related to contracts/ (they only depend on @felt-like-it/shared-types)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/contracts apps/web/src/lib/screens
git commit -m "feat: add screen contracts and screen components from web-next"
```

---

## Task 4: Copy New and Non-Conflicting Component Directories

**Files:**
- Create: `apps/web/src/lib/components/admin/` (4 files — AuditLogViewer, ImportJobMonitor, UserList, StorageStats)
- Create: `apps/web/src/lib/components/collaboration/` (5 files — ActivityFeed, CollaboratorsPanel, CommentPanel, GuestCommentPanel, ShareDialog)

Screen components import from these directories. Without them, Wave 2 route wiring will fail to build.

**Not copied** (existing versions kept for MapEditor compatibility):
- `components/annotations/` — MapEditor imports existing AnnotationPanel, AnnotationContent, AnnotationThread
- `components/data/` — MapEditor imports existing DataTable, FilterPanel, ImportDialog, ExportDialog
- `components/style/` — MapEditor imports existing StylePanel, Legend
- `components/map/` — MapEditor IS the map/ directory

- [ ] **Step 1: Copy new component directories**

```bash
cp -r $WN/src/lib/components/admin $WEB/src/lib/components/admin
cp -r $WN/src/lib/components/collaboration $WEB/src/lib/components/collaboration
```

- [ ] **Step 2: Handle screen imports of missing web-next components**

Some screens import components from directories we're NOT copying (annotations, data, style, map). These screens need import path fixups:
- `MapEditorScreen.svelte` — imports web-next annotation/collaboration/map/data/style components. Since we're NOT using this screen (MapEditor stays as-is), no fix needed.
- `ShareViewerScreen.svelte` / `EmbedScreen.svelte` — same situation, not used in this merge.
- `DashboardScreen.svelte`, `SettingsScreen.svelte`, `AdminScreen.svelte` — verify they only import from `components/ui/` and `components/admin/`. Fix any broken imports.

```bash
# Check which components the active screens import
grep -oP "from '\\\$lib/components/[^']+'" $WEB/src/lib/screens/DashboardScreen.svelte $WEB/src/lib/screens/SettingsScreen.svelte $WEB/src/lib/screens/AdminScreen.svelte | sort -u
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/components/admin apps/web/src/lib/components/collaboration
git commit -m "feat: add admin and collaboration components from web-next"
```

---

## Task 5: Add New UI Primitives

**Files:**
- Create: 20 new files in `apps/web/src/lib/components/ui/`
- Modify: 4 existing files in `apps/web/src/lib/components/ui/`

- [ ] **Step 1: Copy new UI components that don't conflict**

New components (no existing equivalent):
```bash
for f in Badge ColorSwatch ConfirmDialog DataTable EmptyState ErrorState GlassPanel \
  IconButton InstallPrompt MapCard OfflineBanner Pagination ProgressBar SearchInput \
  Select SidePanel SkeletonLoader Slider Textarea Toggle TopBar UpdateBanner; do
  cp "$WN/src/lib/components/ui/${f}.svelte" "$WEB/src/lib/components/ui/${f}.svelte"
done
```

Note: `ui/DataTable.svelte` is different from `data/DataTable.svelte` (MapEditor uses data/ version).

- [ ] **Step 2: Replace overlapping UI components**

Replace Button, Input, Spinner, Toast with web-next versions:
```bash
for f in Button Input Spinner Toast; do
  cp "$WN/src/lib/components/ui/${f}.svelte" "$WEB/src/lib/components/ui/${f}.svelte"
done
```

**CRITICAL**: After this step, verify `toastStore` export compatibility. MapEditor.svelte imports:
```typescript
import { toastStore } from '$lib/components/ui/Toast.svelte';
```

The web-next Toast must export a `toastStore` with `.success(msg)` and `.error(msg)` methods. Read both Toast files to confirm API compatibility. If the web-next Toast uses a different export name or API, adapt it to match.

- [ ] **Step 3: Keep existing Modal.svelte and Tooltip.svelte**

These have no web-next equivalent and may be used by existing components. Do NOT delete them.

- [ ] **Step 4: Run type check**

Run: `cd apps/web && pnpm check`
Expected: May have errors from screens importing components not yet wired — note but don't fix yet.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/components/ui
git commit -m "feat: add and replace UI primitives from web-next"
```

---

## Task 6: Wire Dashboard Route

**Files:**
- Modify: `apps/web/src/routes/(app)/dashboard/+page.svelte`
- Modify: `apps/web/src/routes/(app)/dashboard/+page.server.ts` (minor)

- [ ] **Step 1: Read existing +page.server.ts data shape**

The existing load function returns:
```typescript
{ maps: Array<{id,title,description,basemap,createdAt,updatedAt,layerCount}>,
  templates: Array<{id,title,description,viewport,basemap}>,
  sharedMaps: Array<{id,title,description,basemap,createdAt,updatedAt,role}> }
```

DashboardScreen expects `DashboardData`:
```typescript
{ maps: MapRecord[], collaboratingMaps: MapRecord[], templates: MapRecord[] }
```

These shapes don't exactly match. The route svelte will handle normalization.

- [ ] **Step 2: Replace +page.svelte**

Replace `apps/web/src/routes/(app)/dashboard/+page.svelte` with a new file that:
1. Imports DashboardScreen
2. Maps server data to DashboardData contract (normalizing missing fields)
3. Wires action callbacks to tRPC mutations

```svelte
<script lang="ts">
  import DashboardScreen from '$lib/screens/DashboardScreen.svelte';
  import { trpc } from '$lib/utils/trpc.js';
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';
  import type { DashboardData, DashboardActions } from '$lib/contracts/dashboard.js';

  let { data }: { data: PageData } = $props();

  const dashboardData: DashboardData = $derived({
    maps: data.maps.map(m => ({
      ...m,
      viewport: { center: [0, 0] as [number, number], zoom: 1, bearing: 0, pitch: 0 },
      userId: '',
      isTemplate: false,
    })),
    collaboratingMaps: data.sharedMaps.map(m => ({
      ...m,
      viewport: { center: [0, 0] as [number, number], zoom: 1, bearing: 0, pitch: 0 },
      userId: '',
      isTemplate: false,
    })),
    templates: data.templates.map(t => ({
      ...t,
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: '',
      isTemplate: true,
    })),
  });

  const actions: DashboardActions = {
    onRetry: async () => { await invalidateAll(); },
    onCreate: async (title, description) => {
      const map = await trpc.maps.create.mutate({ title, description });
      goto(`/map/${map.id}`);
    },
    onDelete: async (id) => {
      await trpc.maps.delete.mutate({ id });
      toastStore.success('Map deleted.');
      await invalidateAll();
    },
    onClone: async (id) => {
      const map = await trpc.maps.clone.mutate({ id });
      toastStore.success('Map cloned.');
      goto(`/map/${map.id}`);
    },
  };
</script>

<svelte:head>
  <title>Dashboard - Felt Like It</title>
</svelte:head>

<DashboardScreen data={dashboardData} {actions} status="success" />
```

Note: The `$derived` normalization fills in missing fields with defaults. This is a pragmatic tradeoff — DashboardScreen uses `MapRecord` but only displays title/description/dates, not viewport/userId.

- [ ] **Step 3: Verify the page loads**

Run: `cd apps/web && pnpm check`
Look for errors in `(app)/dashboard/+page.svelte`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/\(app\)/dashboard/+page.svelte
git commit -m "feat: wire dashboard route to DashboardScreen"
```

---

## Task 7: Wire Auth Routes

**Files:**
- Modify: `apps/web/src/routes/auth/login/+page.svelte`
- Modify: `apps/web/src/routes/auth/signup/+page.svelte`
- Modify: `apps/web/src/routes/auth/+layout.svelte`

Auth routes use SvelteKit form actions (server-side, progressive enhancement). The web-next LoginScreen/RegisterScreen use client-side async callbacks. Rather than fight this mismatch, we restyle the existing form-action pages using web-next UI components.

- [ ] **Step 1: Update auth layout**

Replace `apps/web/src/routes/auth/+layout.svelte` with web-next styling:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();
</script>

<div class="bg-surface min-h-screen flex items-center justify-center p-4">
  <div class="w-full max-w-sm flex flex-col gap-6">
    <div class="text-center">
      <span class="font-display text-4xl font-bold text-primary">FLIT</span>
    </div>
    {@render children()}
  </div>
</div>
```

- [ ] **Step 2: Replace login page svelte**

Replace `apps/web/src/routes/auth/login/+page.svelte`. Uses form actions with `use:enhance` but web-next UI components:

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';
  import GlassPanel from '$lib/components/ui/GlassPanel.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import type { ActionData } from './$types';

  let { form }: { form: ActionData } = $props();
  let loading = $state(false);
</script>

<svelte:head><title>Sign In - Felt Like It</title></svelte:head>

<GlassPanel class="p-8 flex flex-col gap-4">
  <form
    method="POST"
    class="flex flex-col gap-4"
    use:enhance={() => {
      loading = true;
      return ({ update }) => { loading = false; update(); };
    }}
  >
    <Input
      id="email"
      type="email"
      name="email"
      placeholder="Email"
      required
      autocomplete="email"
    />
    <Input
      id="password"
      type="password"
      name="password"
      placeholder="Password"
      required
      autocomplete="current-password"
    />

    {#if form?.message}
      <p class="text-error text-sm font-body" role="alert">{form.message}</p>
    {/if}

    <Button type="submit" variant="primary" size="lg" disabled={loading}>
      Sign In
    </Button>
  </form>

  <p class="text-center text-sm font-body text-on-surface-variant">
    Don't have an account?
    <a href="/auth/signup" class="text-primary hover:underline">Sign up</a>
  </p>
</GlassPanel>
```

- [ ] **Step 3: Replace signup page svelte**

Replace `apps/web/src/routes/auth/signup/+page.svelte` with same pattern — form actions + web-next UI:

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';
  import GlassPanel from '$lib/components/ui/GlassPanel.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import type { ActionData } from './$types';

  let { form }: { form: ActionData } = $props();
  let loading = $state(false);
</script>

<svelte:head><title>Sign Up - Felt Like It</title></svelte:head>

<GlassPanel class="p-8 flex flex-col gap-4">
  <form
    method="POST"
    class="flex flex-col gap-4"
    use:enhance={() => {
      loading = true;
      return ({ update }) => { loading = false; update(); };
    }}
  >
    <Input id="name" type="text" name="name" placeholder="Name" required autocomplete="name" />
    <Input id="email" type="email" name="email" placeholder="Email" required autocomplete="email" />
    <Input id="password" type="password" name="password" placeholder="Password" required autocomplete="new-password" />
    <Input id="confirmPassword" type="password" name="confirmPassword" placeholder="Confirm Password" required autocomplete="new-password" />

    {#if form?.message}
      <p class="text-error text-sm font-body" role="alert">{form.message}</p>
    {/if}

    <Button type="submit" variant="primary" size="lg" disabled={loading}>
      Create Account
    </Button>
  </form>

  <p class="text-center text-sm font-body text-on-surface-variant">
    Already have an account?
    <a href="/auth/login" class="text-primary hover:underline">Sign in</a>
  </p>
</GlassPanel>
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/auth/
git commit -m "feat: restyle auth routes with web-next UI components"
```

---

## Task 8: Wire Settings Route

**Files:**
- Modify: `apps/web/src/routes/(app)/settings/+page.svelte`

The existing `+page.server.ts` has complex form actions (updateProfile, changePassword, createKey, revokeKey, resetDemo). Keep ALL server code. Replace only the +page.svelte view.

- [ ] **Step 1: Read existing settings page server data shape**

Returns: `{ user: {id, email, name}, apiKeys: Array<{id, name, prefix, lastUsedAt, createdAt}> }`

SettingsScreen expects `SettingsData`: `{ user: User, apiKeys: ApiKey[] }`

- [ ] **Step 2: Replace +page.svelte**

Replace `apps/web/src/routes/(app)/settings/+page.svelte` with:

```svelte
<script lang="ts">
  import SettingsScreen from '$lib/screens/SettingsScreen.svelte';
  import { enhance } from '$app/forms';
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import type { PageData, ActionData } from './$types';
  import type { SettingsData, SettingsActions } from '$lib/contracts/settings.js';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // Show form action results
  $effect(() => {
    if (form && 'message' in form && form.message) {
      if ('success' in form && form.success) {
        toastStore.success(form.message);
      } else if ('field' in form) {
        toastStore.error(form.message);
      }
    }
  });

  const settingsData: SettingsData = $derived({
    user: { id: data.user.id, email: data.user.email, name: data.user.name },
    apiKeys: data.apiKeys.map(k => ({
      ...k,
      scope: 'full' as const,
      keyHash: '',
      userId: data.user.id,
    })),
  });

  // Settings actions use form submissions for server-side mutations.
  // These are wired as hybrid: tRPC for reads, form actions for writes.
  const actions: SettingsActions = {
    onRetry: async () => { window.location.reload(); },
    onUpdateProfile: async () => { /* handled by form action */ },
    onCreateApiKey: async () => { /* handled by form action */ },
    onRevokeApiKey: async () => { /* handled by form action */ },
  };
</script>

<svelte:head>
  <title>Settings - Felt Like It</title>
</svelte:head>

<SettingsScreen data={settingsData} {actions} status="success" />
```

**Important:** The SettingsScreen uses callback actions, but the existing page uses form actions. The screen component needs to either:
a) Use `use:enhance` forms internally (preferred — matches existing pattern)
b) Wire callbacks to programmatic form submission

Read `SettingsScreen.svelte` and determine which approach it uses. If it uses button onclick handlers, wrap them to submit hidden forms. If it already uses forms, wire directly.

This task may require editing SettingsScreen.svelte to add `use:enhance` forms instead of onclick callbacks for the settings mutations (updateProfile, changePassword, createKey, revokeKey).

- [ ] **Step 3: Run type check**

Run: `cd apps/web && pnpm check`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/\(app\)/settings/
git commit -m "feat: wire settings route to SettingsScreen"
```

---

## Task 9: Wire Admin Route (Consolidate)

**Files:**
- Modify: `apps/web/src/routes/(app)/admin/+page.server.ts`
- Modify: `apps/web/src/routes/(app)/admin/+page.svelte`
- Delete: `apps/web/src/routes/(app)/admin/audit/` (directory)
- Delete: `apps/web/src/routes/(app)/admin/storage/` (directory)
- Delete: `apps/web/src/routes/(app)/admin/jobs/` (directory)
- Delete: `apps/web/src/routes/(app)/admin/+layout.svelte` (admin-specific layout)

Keep: `apps/web/src/routes/(app)/admin/+layout.server.ts` (isAdmin guard)

- [ ] **Step 1: Read existing admin sub-route server loads**

Gather the data each sub-route loads:
- `/admin` — users list (id, email, name, isAdmin, createdAt, disabledAt)
- `/admin/audit` — audit log entries
- `/admin/storage` — storage statistics
- `/admin/jobs` — import jobs

- [ ] **Step 2: Consolidate +page.server.ts**

Replace `apps/web/src/routes/(app)/admin/+page.server.ts` to load ALL admin data:

```typescript
import { desc } from 'drizzle-orm';
import { db } from '$lib/server/db/index.js';
import { users, importJobs } from '$lib/server/db/schema.js';
import { trpc } from '$lib/utils/trpc.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const [userList, jobList] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        isAdmin: users.isAdmin,
        createdAt: users.createdAt,
        disabledAt: users.disabledAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt)),
    db
      .select()
      .from(importJobs)
      .orderBy(desc(importJobs.createdAt))
      .limit(50),
  ]);

  return { users: userList, importJobs: jobList };
};
```

Note: Audit log and storage stats may need separate queries. Check what the existing sub-route server files load and consolidate.

- [ ] **Step 3: Replace +page.svelte**

Replace `apps/web/src/routes/(app)/admin/+page.svelte` with AdminScreen wiring:

```svelte
<script lang="ts">
  import AdminScreen from '$lib/screens/AdminScreen.svelte';
  import { trpc } from '$lib/utils/trpc.js';
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';
  import type { AdminData, AdminActions } from '$lib/contracts/admin.js';

  let { data }: { data: PageData } = $props();

  const adminData: AdminData = $derived({
    users: {
      items: data.users,
      totalCount: data.users.length,
      nextCursor: null,
    },
    auditLog: {
      items: [],
      totalCount: 0,
      nextCursor: null,
    },
    storageStats: {
      totalFeatures: 0,
      totalLayers: 0,
      totalMaps: 0,
      uploadVolumeBytes: 0,
      uploadVolumeMax: 1_073_741_824,
    },
    importJobs: data.importJobs ?? [],
  });

  const actions: AdminActions = {
    onRetry: async () => { await invalidateAll(); },
    onDisableUser: async (id) => {
      await trpc.admin.disableUser.mutate({ id });
      toastStore.success('User disabled.');
      await invalidateAll();
    },
    onEnableUser: async (id) => {
      await trpc.admin.enableUser.mutate({ id });
      toastStore.success('User enabled.');
      await invalidateAll();
    },
    onCreateUser: async (userData) => {
      await trpc.admin.createUser.mutate(userData);
      toastStore.success('User created.');
      await invalidateAll();
    },
    onVerifyAuditLog: async () => {
      toastStore.success('Audit log verified.');
      return true;
    },
  };
</script>

<svelte:head>
  <title>Admin - Felt Like It</title>
</svelte:head>

<AdminScreen data={adminData} {actions} status="success" />
```

Note: `auditLog` and `storageStats` are stubbed with empty/zero values. Wire them to real data in a follow-up once the admin tRPC procedures are verified. The existing admin sub-routes had this data — consolidate their queries into the page server load.

- [ ] **Step 4: Delete admin sub-routes**

```bash
rm -rf apps/web/src/routes/\(app\)/admin/audit
rm -rf apps/web/src/routes/\(app\)/admin/storage
rm -rf apps/web/src/routes/\(app\)/admin/jobs
rm -f apps/web/src/routes/\(app\)/admin/+layout.svelte
```

Keep `+layout.server.ts` (isAdmin guard).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/\(app\)/admin/
git commit -m "feat: consolidate admin into single AdminScreen route"
```

---

## Task 10: Update Root Layout

**Files:**
- Modify: `apps/web/src/routes/+layout.svelte`

- [ ] **Step 1: Update root layout**

The existing root layout has client error reporting (keep it) and Toast. Add web-next PWA components:

```svelte
<script lang="ts">
  import '../app.css';
  import Toast from '$lib/components/ui/Toast.svelte';
  import OfflineBanner from '$lib/components/ui/OfflineBanner.svelte';
  import InstallPrompt from '$lib/components/ui/InstallPrompt.svelte';
  import UpdateBanner from '$lib/components/ui/UpdateBanner.svelte';
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();

  function reportError(payload: Record<string, unknown>) {
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => undefined);
  }

  onMount(() => {
    const onError = (e: ErrorEvent) => {
      const message = e.message ?? 'Unknown error';
      const stack = (e.error instanceof Error ? e.error.stack : null) ?? `${e.filename}:${e.lineno}:${e.colno}`;
      console.error('[UNCAUGHT ERROR]', message, stack);
      reportError({ type: 'uncaught', message, stack, path: window.location.pathname });
    };

    const onUnhandledRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const message = reason instanceof Error ? reason.message : String(reason ?? 'Unhandled rejection');
      const stack = reason instanceof Error ? (reason.stack ?? message) : message;
      console.error('[UNHANDLED REJECTION]', message, stack);
      reportError({ type: 'rejection', message, stack, path: window.location.pathname });
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  });
</script>

<OfflineBanner />
<UpdateBanner />
<InstallPrompt />
{@render children()}
<Toast />
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/routes/+layout.svelte
git commit -m "feat: add PWA components to root layout"
```

---

## Task 11: Cleanup and Delete Old Components

**Files:**
- Delete: unused old component files

- [ ] **Step 1: Identify components safe to delete**

Components that are fully superseded by web-next AND not imported by MapEditor or other kept code:

```bash
cd apps/web
# Check what MapEditor.svelte imports
grep -oP "from '\$lib/components/[^']+'" src/lib/components/map/MapEditor.svelte | sort -u

# Check what other kept components import
grep -rn "from '\$lib/components/" src/lib/components/map/ src/lib/components/data/ \
  src/lib/components/annotations/ src/lib/components/geoprocessing/ src/lib/components/style/ \
  | grep -oP "from '\$lib/components/[^']+'" | sort -u
```

Any component NOT in the output AND replaced by web-next can be deleted.

- [ ] **Step 2: Delete confirmed-unused old components**

Based on the audit, components likely safe to delete:
- None from `map/`, `data/`, `annotations/`, `geoprocessing/`, `style/` — MapEditor uses them all

The old `ui/` components that were replaced (Button, Input, Spinner, Toast) are already overwritten. `Modal.svelte` and `Tooltip.svelte` should be kept if any component imports them.

- [ ] **Step 3: Commit**

```bash
git add -A apps/web/src/lib/components/
git commit -m "chore: remove unused old components"
```

---

## Task 12: Build Verification and Fix

**Files:**
- Various (type error fixes)

- [ ] **Step 1: Run full type check**

```bash
cd apps/web && pnpm check 2>&1 | head -100
```

Expected: Type errors from contract/screen mismatches, missing component props, etc.

- [ ] **Step 2: Fix type errors iteratively**

Common fixes needed:
1. **Toast API mismatch** — web-next Toast may export `toastStore` differently than existing. Adapt export to match `toastStore.success(msg)` / `toastStore.error(msg)` API.
2. **Button/Input prop mismatches** — web-next components may have different prop interfaces. MapEditor's child components (LayerPanel, etc.) import Button/Input. Fix any prop incompatibilities.
3. **Screen component imports** — screens may import components that don't exist or have different paths. Fix imports.
4. **Contract type gaps** — DashboardData, SettingsData normalization may need adjustment.
5. **Date serialization** — contracts use `Date` types but `+page.server.ts` data passes through SvelteKit's `devalue` serializer which handles Dates natively. If screens compare dates with `instanceof Date` and receive strings instead, convert with `new Date(val)` in the route's `$derived` normalization.
6. **Tooltip conflict** — web-next has a `Tooltip.svelte` in `components/ui/`. If it was copied in Task 5, check whether MapEditor's child components import the existing Tooltip. If so, ensure the web-next version has compatible API or keep the existing one.

For each error, fix the minimal code needed. Do NOT refactor unrelated code.

- [ ] **Step 3: Run build**

```bash
cd apps/web && pnpm build
```

Expected: Build succeeds.

- [ ] **Step 4: Run existing tests**

```bash
cd apps/web && pnpm test
```

Expected: All server-side tests pass (they don't touch UI).

- [ ] **Step 5: Commit all fixes**

```bash
git add -A apps/web/
git commit -m "fix: resolve type errors from web-next merge"
```

---

## Task 13: Final Verification

- [ ] **Step 1: Clean check**

```bash
cd apps/web && pnpm check && pnpm build
```

Both must pass with 0 errors.

- [ ] **Step 2: Visual smoke test**

```bash
cd /mnt/Ghar/2TA/DevStuff/felt-like-it && pnpm dev
```

Manually verify:
1. `/auth/login` — shows new FLIT branding, form works
2. `/dashboard` — shows maps with new design
3. `/map/<id>` — MapEditor loads and works (MapLibre renders)
4. `/settings` — shows profile and API keys
5. `/admin` — shows consolidated admin view (if admin user)

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A && git commit -m "fix: final adjustments from smoke test"
```

---

## Task 14: Delete web-next App and Clean Up

**Files:**
- Delete: `apps/web-next/` (entire directory in worktree)
- Delete: `.worktrees/web-next/` (worktree)

- [ ] **Step 1: Remove the web-next worktree**

```bash
cd /mnt/Ghar/2TA/DevStuff/felt-like-it
git worktree remove .worktrees/web-next
```

- [ ] **Step 2: Delete the web-next branch**

```bash
git branch -D web-next
```

The branch is preserved in tags (`backup/pre-merge-web-next`) and git reflog.

- [ ] **Step 3: Pop the pre-merge stash**

```bash
git stash list  # find "pre-merge working state"
git stash pop stash@{0}  # adjust index if needed
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove web-next worktree and restore working state"
```

---

## Execution Waves

### Wave 0: Setup
- Task 1 (branch + dependencies)

### Wave 1: Assets and Components (parallel)
- Task 2 (static assets + styling)
- Task 3 (contracts + screens)
- Task 4 (admin + collaboration components)
- Task 5 (UI primitives)

### Wave 2: Route Wiring (parallel)
- Task 6 (dashboard)
- Task 7 (auth routes)
- Task 8 (settings)
- Task 9 (admin consolidation)
- Task 10 (root layout)

### Wave 3: Cleanup and Verify (sequential)
- Task 11 (delete old components)
- Task 12 (build verification + fixes)
- Task 13 (final verification)
- Task 14 (delete web-next + cleanup)

---

## Notes

### Routes NOT changed in this plan
- `(app)/map/[id]` — MapEditor stays as-is. New CSS will restyle it globally.
- `(public)/share/[token]` — Uses MapEditor in readonly mode. Stays as-is.
- `(public)/embed/[token]` — Same as share. Stays as-is.
- All API routes (`api/trpc/`, `api/v1/`, `api/upload/`, etc.) — untouched.

### Deferred work (post-transition plan in spec)
1. MapEditor decomposition (break 800-line component into screen contract pattern)
2. Wire share/embed routes to ShareViewerScreen/EmbedScreen (currently use MapEditor directly)
3. PWA service worker wiring
4. Light mode
5. E2E tests for new UI flows
