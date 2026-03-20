# Frontend Rewrite Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/web-next/` — a static, PWA-ready frontend with hardcoded mock data, pixel-perfect to the Cartologic Flux design system.

**Architecture:** Thin routes pass mock data/actions to screen compositions, which compose UI primitives and feature components. Stores provided via Svelte context. No backend wiring — only route files change later.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Tailwind 4, Lucide icons, Kode Mono + Inter fonts, PWA (manifest + service worker)

**Spec:** `docs/superpowers/specs/2026-03-19-frontend-rewrite-design.md`

---

## File Structure

### Config files (Task 1)
- `apps/web-next/package.json`
- `apps/web-next/svelte.config.js`
- `apps/web-next/vite.config.ts`
- `apps/web-next/tsconfig.json`
- `apps/web-next/.env`

### Design tokens & PWA (Tasks 2-3)
- `apps/web-next/src/app.css`
- `apps/web-next/src/app.html`
- `apps/web-next/static/manifest.webmanifest`
- `apps/web-next/static/fonts/` (Kode Mono + Inter woff2)
- `apps/web-next/static/icons/` (PWA icons)
- `apps/web-next/src/service-worker.ts`

### Contracts & mock data (Task 4)
- `apps/web-next/src/lib/contracts/shared.ts`
- `apps/web-next/src/lib/contracts/dashboard.ts`
- `apps/web-next/src/lib/contracts/map-editor.ts`
- `apps/web-next/src/lib/contracts/auth.ts`
- `apps/web-next/src/lib/contracts/settings.ts`
- `apps/web-next/src/lib/contracts/admin.ts`
- `apps/web-next/src/lib/contracts/share-viewer.ts`
- `apps/web-next/src/lib/mock/data/maps.ts`
- `apps/web-next/src/lib/mock/data/layers.ts`
- `apps/web-next/src/lib/mock/data/features.ts`
- `apps/web-next/src/lib/mock/data/users.ts`
- `apps/web-next/src/lib/mock/data/annotations.ts`
- `apps/web-next/src/lib/mock/data/comments.ts`
- `apps/web-next/src/lib/mock/dashboard.ts`
- `apps/web-next/src/lib/mock/map-editor.ts`
- `apps/web-next/src/lib/mock/admin.ts`
- `apps/web-next/src/lib/mock/settings.ts`

### Store interfaces & mocks (Task 5)
- `apps/web-next/src/lib/stores/interfaces.ts`
- `apps/web-next/src/lib/stores/context-keys.ts`
- `apps/web-next/src/lib/stores/mock-map.svelte.ts`
- `apps/web-next/src/lib/stores/mock-selection.svelte.ts`
- `apps/web-next/src/lib/stores/mock-filter.svelte.ts`
- `apps/web-next/src/lib/stores/mock-drawing.svelte.ts`

### UI primitives (Tasks 6-9)
- `apps/web-next/src/lib/components/ui/Button.svelte`
- `apps/web-next/src/lib/components/ui/IconButton.svelte`
- `apps/web-next/src/lib/components/ui/Input.svelte`
- `apps/web-next/src/lib/components/ui/Select.svelte`
- `apps/web-next/src/lib/components/ui/Textarea.svelte`
- `apps/web-next/src/lib/components/ui/Badge.svelte`
- `apps/web-next/src/lib/components/ui/Toggle.svelte`
- `apps/web-next/src/lib/components/ui/Slider.svelte`
- `apps/web-next/src/lib/components/ui/Tooltip.svelte`
- `apps/web-next/src/lib/components/ui/GlassPanel.svelte`
- `apps/web-next/src/lib/components/ui/SidePanel.svelte`
- `apps/web-next/src/lib/components/ui/TopBar.svelte`
- `apps/web-next/src/lib/components/ui/EmptyState.svelte`
- `apps/web-next/src/lib/components/ui/ErrorState.svelte`
- `apps/web-next/src/lib/components/ui/SkeletonLoader.svelte`
- `apps/web-next/src/lib/components/ui/Toast.svelte` (includes toastStore)
- `apps/web-next/src/lib/components/ui/ProgressBar.svelte`
- `apps/web-next/src/lib/components/ui/Spinner.svelte`
- `apps/web-next/src/lib/components/ui/ConfirmDialog.svelte`
- `apps/web-next/src/lib/components/ui/DataTable.svelte`
- `apps/web-next/src/lib/components/ui/Pagination.svelte`
- `apps/web-next/src/lib/components/ui/SearchInput.svelte`
- `apps/web-next/src/lib/components/ui/ColorSwatch.svelte`

### App shell & routes (Task 10)
- `apps/web-next/src/lib/components/ui/OfflineBanner.svelte`
- `apps/web-next/src/lib/components/ui/InstallPrompt.svelte`
- `apps/web-next/src/lib/components/ui/UpdateBanner.svelte`
- `apps/web-next/src/routes/+layout.svelte`
- `apps/web-next/src/routes/+page.svelte`
- `apps/web-next/src/routes/maps/[id]/+page.svelte`
- `apps/web-next/src/routes/share/[token]/+page.svelte`
- `apps/web-next/src/routes/embed/[token]/+page.svelte`
- `apps/web-next/src/routes/admin/+page.svelte`
- `apps/web-next/src/routes/settings/+page.svelte`
- `apps/web-next/src/routes/login/+page.svelte`
- `apps/web-next/src/routes/register/+page.svelte`

### Map feature components (Task 11)
- `apps/web-next/src/lib/components/map/MapCanvas.svelte`
- `apps/web-next/src/lib/components/map/DrawingToolbar.svelte`
- `apps/web-next/src/lib/components/map/DrawActionRow.svelte`
- `apps/web-next/src/lib/components/map/BasemapPicker.svelte`
- `apps/web-next/src/lib/components/map/FeaturePopup.svelte`
- `apps/web-next/src/lib/components/map/Legend.svelte`
- `apps/web-next/src/lib/components/map/LayerPanel.svelte`
- `apps/web-next/src/lib/components/map/MeasurementPanel.svelte`

### Map Editor screen (Task 12)
- `apps/web-next/src/lib/screens/MapEditorScreen.svelte`

### Dashboard screen (Task 13)
- `apps/web-next/src/lib/components/ui/MapCard.svelte`
- `apps/web-next/src/lib/screens/DashboardScreen.svelte`

### Auth screens (Task 14)
- `apps/web-next/src/lib/screens/LoginScreen.svelte`
- `apps/web-next/src/lib/screens/RegisterScreen.svelte`

### Annotation components (Task 15)
- `apps/web-next/src/lib/components/annotations/AnnotationPanel.svelte`
- `apps/web-next/src/lib/components/annotations/AnnotationForm.svelte`
- `apps/web-next/src/lib/components/annotations/AnnotationContent.svelte`
- `apps/web-next/src/lib/components/annotations/AnnotationList.svelte`

### Collaboration components (Task 16)
- `apps/web-next/src/lib/components/collaboration/CommentPanel.svelte`
- `apps/web-next/src/lib/components/collaboration/GuestCommentPanel.svelte`
- `apps/web-next/src/lib/components/collaboration/CollaboratorsPanel.svelte`
- `apps/web-next/src/lib/components/collaboration/ShareDialog.svelte`
- `apps/web-next/src/lib/components/collaboration/ActivityFeed.svelte`

### Data components (Task 17)
- `apps/web-next/src/lib/components/data/FilterPanel.svelte`
- `apps/web-next/src/lib/components/data/ImportDialog.svelte`
- `apps/web-next/src/lib/components/data/ExportDialog.svelte`

### Style components (Task 18)
- `apps/web-next/src/lib/components/style/StylePanel.svelte`
- `apps/web-next/src/lib/components/style/ChoroplethControls.svelte`
- `apps/web-next/src/lib/components/style/LabelControls.svelte`

### Share/Embed screens (Task 19)
- `apps/web-next/src/lib/screens/ShareViewerScreen.svelte`
- `apps/web-next/src/lib/screens/EmbedScreen.svelte`

### Settings & Admin screens (Task 20)
- `apps/web-next/src/lib/screens/SettingsScreen.svelte`
- `apps/web-next/src/lib/screens/AdminScreen.svelte`
- `apps/web-next/src/lib/components/admin/UserList.svelte`
- `apps/web-next/src/lib/components/admin/AuditLogViewer.svelte`
- `apps/web-next/src/lib/components/admin/StorageStats.svelte`
- `apps/web-next/src/lib/components/admin/ImportJobMonitor.svelte`

---

## Interfaces & Types Reference

The `@felt-like-it/shared-types` package exports these types (used in contracts):

```typescript
// Types from packages/shared-types/src/types.ts
MapRecord          // Note: NOT "Map" — avoids JS Map collision
Layer, LayerType, LayerStyle, LegendEntry
Feature, Geometry, GeoJSONFeature, GeoJSONFeatureCollection
User, Share, AccessLevel
ImportJob, JobStatus

// Schemas from packages/shared-types/src/schemas/
AnnotationContentSchema  // discriminated union: text|emoji|gif|image|link|iiif
CreateAnnotationObjectSchema, AnnotationObjectSchema
GeoprocessingOpSchema    // discriminated union for all 7 ops
ViewportSchema           // { center, zoom, bearing, pitch }
```

Key gotcha: the map type is `MapRecord`, not `Map`.

---

## Task 1: Scaffold SvelteKit App

**Files:**
- Create: `apps/web-next/package.json`
- Create: `apps/web-next/svelte.config.js`
- Create: `apps/web-next/vite.config.ts`
- Create: `apps/web-next/tsconfig.json`
- Create: `apps/web-next/.env`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@felt-like-it/web-next",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json"
  },
  "devDependencies": {
    "@sveltejs/adapter-static": "^3.0.0",
    "@sveltejs/kit": "^2.15.1",
    "@sveltejs/vite-plugin-svelte": "^5.0.3",
    "@tailwindcss/vite": "^4.0.6",
    "svelte": "^5.17.3",
    "svelte-check": "^4.1.1",
    "tailwindcss": "^4.0.6",
    "typescript": "^5.7.3",
    "vite": "^6.0.0"
  },
  "dependencies": {
    "@felt-like-it/shared-types": "workspace:*",
    "lucide-svelte": "^0.469.0"
  }
}
```

- [ ] **Step 2: Create svelte.config.js**

```javascript
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ fallback: 'index.html' }),
    alias: { $lib: './src/lib' },
  },
};

export default config;
```

- [ ] **Step 3: Create vite.config.ts**

```typescript
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  build: { target: 'es2022' },
});
```

- [ ] **Step 4: Create tsconfig.json**

Copy from `apps/web/tsconfig.json` — same strict settings:
```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,
    "allowJs": true,
    "checkJs": true,
    "moduleResolution": "bundler",
    "module": "ESNext",
    "target": "ES2022"
  }
}
```

- [ ] **Step 5: Create .env**

```
PUBLIC_APP_NAME=Felt Like It
```

- [ ] **Step 6: Install dependencies**

```bash
cd apps/web-next && pnpm install
```

- [ ] **Step 7: Verify SvelteKit sync**

```bash
cd apps/web-next && pnpm check
```
Expected: should run svelte-kit sync (may warn about missing routes — that's fine)

- [ ] **Step 8: Commit**

```bash
git add apps/web-next/package.json apps/web-next/svelte.config.js apps/web-next/vite.config.ts apps/web-next/tsconfig.json apps/web-next/.env
git commit -m "feat(web-next): scaffold SvelteKit app in monorepo"
```

---

## Task 2: Design Tokens, Fonts & app.css

**Files:**
- Create: `apps/web-next/src/app.css`
- Create: `apps/web-next/src/app.html`
- Create: `apps/web-next/static/fonts/` (font files)

**Reference:** `UI-Design Library/stitch/cartologic_flux/DESIGN.md` for token values.

- [ ] **Step 1: Download and place self-hosted fonts**

Download Kode Mono (woff2, weights 400/500/600/700) and Inter (woff2, weights 400/500/600/700) from Google Fonts. Place in `apps/web-next/static/fonts/`:
```
static/fonts/kode-mono-latin-400.woff2
static/fonts/kode-mono-latin-500.woff2
static/fonts/kode-mono-latin-600.woff2
static/fonts/kode-mono-latin-700.woff2
static/fonts/inter-latin-400.woff2
static/fonts/inter-latin-500.woff2
static/fonts/inter-latin-600.woff2
static/fonts/inter-latin-700.woff2
```

- [ ] **Step 2: Create app.css with @font-face, @theme, and signature classes**

```css
/* === Font loading === */
@font-face {
  font-family: 'Kode Mono';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/kode-mono-latin-400.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
/* Repeat for 500, 600, 700 weights */
@font-face {
  font-family: 'Kode Mono';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('/fonts/kode-mono-latin-500.woff2') format('woff2');
}
@font-face {
  font-family: 'Kode Mono';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('/fonts/kode-mono-latin-600.woff2') format('woff2');
}
@font-face {
  font-family: 'Kode Mono';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('/fonts/kode-mono-latin-700.woff2') format('woff2');
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/inter-latin-400.woff2') format('woff2');
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('/fonts/inter-latin-500.woff2') format('woff2');
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('/fonts/inter-latin-600.woff2') format('woff2');
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('/fonts/inter-latin-700.woff2') format('woff2');
}

/* === Tailwind 4 === */
@import 'tailwindcss';

/* === Design system tokens === */
@theme {
  /* Surface hierarchy (5-tier tonal elevation) */
  --color-surface: #081425;
  --color-surface-lowest: #040e1f;
  --color-surface-low: #0d1c2f;
  --color-surface-container: #152031;
  --color-surface-high: #1f2a3c;
  --color-surface-highest: #2a3548;

  /* Primary (amber FLI accent) */
  --color-primary: #ffc174;
  --color-primary-container: #f59e0b;
  --color-on-primary-container: #613b00;
  --color-inverse-primary: #855300;

  /* Tertiary (info blue) */
  --color-tertiary: #8ed5ff;
  --color-tertiary-dim: #7bd0ff;

  /* Text */
  --color-on-surface: #d8e3fb;
  --color-on-surface-variant: #d8c3ad;

  /* Error */
  --color-error: #ffb4ab;

  /* Typography */
  --font-display: 'Kode Mono', monospace;
  --font-body: 'Inter', system-ui, sans-serif;

  /* Spacing (8-point hybrid) */
  --spacing-panel: 0.6rem;   /* component internal padding */
  --spacing-layout: 1.1rem;  /* layout gaps */

  /* Radii */
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
}

/* === Signature classes (~6 reusable patterns) === */
.glass-panel {
  @apply bg-surface-container/70 backdrop-blur-[12px];
}

.tonal-elevation {
  box-shadow: 0 12px 40px rgba(4, 14, 31, 0.4);
}

.signature-gradient {
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-container));
}

.surface-well {
  @apply bg-surface-low;
}

.map-pattern {
  background-color: var(--color-surface);
  background-image: radial-gradient(var(--color-surface-high) 1px, transparent 1px);
  background-size: 24px 24px;
}

.status-glow {
  animation: glow 2s ease-in-out infinite alternate;
}
@keyframes glow {
  from { box-shadow: 0 0 4px rgba(255, 193, 116, 0.2); }
  to { box-shadow: 0 0 12px rgba(255, 193, 116, 0.5); }
}

/* === Global base styles === */
html {
  @apply bg-surface text-on-surface;
  font-family: var(--font-body);
}

/* Custom scrollbar for dark panels */
.scrollbar-thin::-webkit-scrollbar {
  width: 4px;
}
.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}
.scrollbar-thin::-webkit-scrollbar-thumb {
  background-color: rgb(42, 53, 72, 0.5);
  border-radius: 2px;
}

/* Respect reduced motion */
@media (prefers-reduced-motion: reduce) {
  .status-glow { animation: none; }
  * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}

/* Light mode placeholder — values will be added later */
/* .light { } */
```

- [ ] **Step 3: Create app.html**

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

- [ ] **Step 4: Verify app builds**

```bash
cd apps/web-next && pnpm build
```
Expected: build completes (may warn about missing routes)

- [ ] **Step 5: Commit**

```bash
git add apps/web-next/src/app.css apps/web-next/src/app.html apps/web-next/static/fonts/
git commit -m "feat(web-next): add design tokens, self-hosted fonts, app shell HTML"
```

---

## Task 3: PWA Manifest, Icons & Service Worker

**Files:**
- Create: `apps/web-next/static/manifest.webmanifest`
- Create: `apps/web-next/static/icons/` (3 icons)
- Create: `apps/web-next/src/service-worker.ts`

- [ ] **Step 1: Create manifest.webmanifest**

```json
{
  "name": "Felt Like It",
  "short_name": "FLIT",
  "description": "Collaborative web GIS platform",
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#081425",
  "background_color": "#081425",
  "orientation": "any",
  "categories": ["productivity", "utilities"],
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 2: Generate PWA icons**

Create placeholder PNG icons at `apps/web-next/static/icons/`:
- `icon-192.png` (192x192) — amber (#ffc174) rounded square with "FLIT" text
- `icon-512.png` (512x512) — same design
- `icon-512-maskable.png` (512x512) — same with extra safe-zone padding

For the prototype phase, simple solid-color placeholders are fine. Use any PNG generation tool.

- [ ] **Step 3: Create service-worker.ts**

SvelteKit provides `$service-worker` module with `build`, `files`, `version`.

```typescript
/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const CACHE_NAME = `flit-${version}`;

// App shell assets to cache
const ASSETS = [...build, ...files];

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
});

self.addEventListener('fetch', (event: FetchEvent) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Skip API routes and external requests
  if (url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      // Network-first for navigation, cache-first for assets
      if (event.request.mode === 'navigate') {
        return fetch(event.request).catch(() =>
          caches.match('/').then((r) => r ?? new Response('Offline', { status: 503 }))
        );
      }

      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
```

- [ ] **Step 4: Commit**

```bash
git add apps/web-next/static/manifest.webmanifest apps/web-next/static/icons/ apps/web-next/src/service-worker.ts
git commit -m "feat(web-next): add PWA manifest, icons, and service worker"
```

---

## Task 3.5: Add Missing Types to shared-types

**Files:**
- Modify: `packages/shared-types/src/schemas/comment.ts` (create if missing)
- Modify: `packages/shared-types/src/schemas/collaborator.ts` (create if missing)
- Modify: `packages/shared-types/src/schemas/event.ts` (create if missing)
- Modify: `packages/shared-types/src/schemas/audit-log.ts` (create if missing)
- Modify: `packages/shared-types/src/schemas/api-key.ts` (create if missing)
- Modify: `packages/shared-types/src/types.ts`
- Modify: `packages/shared-types/src/index.ts`

The contracts layer needs these types which are not yet exported from `@felt-like-it/shared-types`. The DB schema defines these tables but no Zod schemas exist for them yet.

- [ ] **Step 1: Check which schemas already exist**

```bash
ls packages/shared-types/src/schemas/
grep -r "Comment\|Collaborator\|MapEvent\|AuditLog\|ApiKey" packages/shared-types/src/schemas/ packages/shared-types/src/types.ts
```

- [ ] **Step 2: Create missing Zod schemas**

For each missing type, create a schema file following existing patterns (see `schemas/user.ts`, `schemas/share.ts`):

- `CommentSchema`: id (uuid), mapId (uuid), userId (uuid nullable), authorName (string), body (string), resolved (boolean), createdAt (date), updatedAt (date)
- `CollaboratorSchema`: id (uuid), mapId (uuid), userId (uuid), role ('viewer'|'commenter'|'editor'), invitedBy (uuid nullable)
- `MapEventSchema`: id (uuid), mapId (uuid), userId (uuid nullable), action (string), metadata (record), createdAt (date)
- `AuditLogEntrySchema`: id (string), userId (uuid nullable), action (string), entityType (string), entityId (string), mapId (uuid nullable), metadata (record), createdAt (date)
- `ApiKeySchema`: id (uuid), userId (uuid), name (string), prefix (string), scope (string), createdAt (date), lastUsedAt (date nullable)

- [ ] **Step 3: Add type exports to types.ts and index.ts**

Add `export type Comment = z.infer<typeof CommentSchema>` etc. to `types.ts`. Add `export * from './schemas/comment.js'` etc. to `index.ts`.

- [ ] **Step 4: Verify shared-types builds**

```bash
cd packages/shared-types && pnpm build
```
Expected: builds without errors

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/
git commit -m "feat(shared-types): add Comment, Collaborator, MapEvent, AuditLogEntry, ApiKey schemas"
```

---

## Task 4: Contracts & Mock Data

**Files:**
- Create: all files under `apps/web-next/src/lib/contracts/`
- Create: all files under `apps/web-next/src/lib/mock/`

<interfaces>
From @felt-like-it/shared-types:
- MapRecord: { id: string, title: string, description: string | null, viewport: object, basemap: string, userId: string, createdAt: Date, updatedAt: Date }
- Layer: { id: string, mapId: string, name: string, type: 'point'|'line'|'polygon'|'mixed', style: object, visible: boolean, zIndex: number, sourceFileName: string | null }
- Feature: { id: string, layerId: string, geometry: object, properties: Record<string, unknown> }
- User: { id: string, email: string, name: string, createdAt: Date, updatedAt: Date }
- Share: { id: string, mapId: string, token: string, accessLevel: 'public'|'unlisted', createdAt: Date, updatedAt: Date }
- ImportJob: { id: string, mapId: string, layerId: string | null, status: string, progress: number, fileName: string, errorMessage: string | null }
- LayerStyle: { type: 'simple'|'categorical'|'numeric'|'graduated'|'heatmap', config?: object, label?: object, ... }
- AnnotationContentSchema: discriminated union on type: text|emoji|gif|image|link|iiif
</interfaces>

- [ ] **Step 1: Create `contracts/shared.ts`**

```typescript
export interface BaseActions {
  onRetry: () => Promise<void>;
}

export interface PaginatedData<T> {
  items: T[];
  totalCount: number;
  nextCursor: string | null;
}
```

- [ ] **Step 2: Create `contracts/dashboard.ts`**

```typescript
import type { MapRecord } from '@felt-like-it/shared-types';
import type { BaseActions } from './shared.js';

export interface DashboardData {
  maps: MapRecord[];
  collaboratingMaps: MapRecord[];
  templates: MapRecord[];
}

export interface DashboardActions extends BaseActions {
  onCreate: (title: string, description?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClone: (id: string) => Promise<void>;
}

export type DashboardStatus = 'loading' | 'success' | 'error' | 'empty';
```

- [ ] **Step 3: Create `contracts/map-editor.ts`**

Define `MapEditorData`, `MapEditorActions`, `MapEditorStatus` as specified in the design spec Section 3g. Use `MapRecord` (not `Map`). Import `Layer`, `Feature` from shared-types. Define all mutation callbacks: layer CRUD, feature upsert/delete, annotation CRUD, comment CRUD, map update, viewport save, geoprocessing run.

- [ ] **Step 4: Create remaining contracts**

- `contracts/auth.ts` — `LoginActions { onLogin, onRegister }`, form data types
- `contracts/settings.ts` — `SettingsData { apiKeys, user }`, `SettingsActions { onCreateKey, onRevokeKey, onUpdateProfile }`
- `contracts/admin.ts` — `AdminData { users, auditLog, storageStats, importJobs }`, admin actions
- `contracts/share-viewer.ts` — `ShareViewerData { map, layers, features, comments }`, `ShareViewerActions { onComment }`

- [ ] **Step 5: Create mock data files**

Create `mock/data/maps.ts`, `mock/data/layers.ts`, `mock/data/features.ts`, `mock/data/users.ts`, `mock/data/annotations.ts`, `mock/data/comments.ts`. Each exports typed arrays matching `shared-types` shapes. Use realistic GIS data (e.g. mock San Francisco parks, building layers with proper GeoJSON geometries).

- [ ] **Step 6: Create mock providers**

Create `mock/dashboard.ts`, `mock/map-editor.ts`, `mock/admin.ts`, `mock/settings.ts`. Each imports from `mock/data/*` and `contracts/*`, exports `mock*Data` and `mock*Actions` (actions use toastStore to show "Would do X" messages).

- [ ] **Step 7: Verify TypeScript**

```bash
cd apps/web-next && pnpm check
```
Expected: no type errors in contracts or mock data

- [ ] **Step 8: Commit**

```bash
git add apps/web-next/src/lib/contracts/ apps/web-next/src/lib/mock/
git commit -m "feat(web-next): add typed contracts and mock data layer"
```

---

## Task 5: Store Interfaces & Mock Stores

**Files:**
- Create: all files under `apps/web-next/src/lib/stores/`

<interfaces>
InteractionMode = 'default' | 'draw-point' | 'draw-line' | 'draw-polygon' | 'select' | 'pan'
BasemapId = 'osm' | 'positron' | 'dark-matter'
FilterOperator = 'eq' | 'ne' | 'lt' | 'gt' | 'cn' | 'in' | 'ni'
UIFilter = { field: string, operator: FilterOperator, value: string }
</interfaces>

- [ ] **Step 1: Create `stores/interfaces.ts`**

Define `IMapStore`, `ISelectionStore`, `IFilterStore`, `IDrawingStore` interfaces matching the real store APIs from `apps/web/src/lib/stores/`. Export all type aliases (`InteractionMode`, `BasemapId`, `BasemapOption`, `FilterOperator`, `UIFilter`).

- [ ] **Step 2: Create `stores/context-keys.ts`**

```typescript
export const MAP_STORE_KEY = Symbol('mapStore');
export const SELECTION_STORE_KEY = Symbol('selectionStore');
export const FILTER_STORE_KEY = Symbol('filterStore');
export const DRAWING_STORE_KEY = Symbol('drawingStore');
```

- [ ] **Step 3: Create mock store implementations**

Create `mock-map.svelte.ts`, `mock-selection.svelte.ts`, `mock-filter.svelte.ts`, `mock-drawing.svelte.ts`. Each uses `$state` runes and implements the corresponding interface. Mock map store starts with center `[-122.4194, 37.7749]` (San Francisco), zoom 12.

**Important:** Read the public API of each existing store file in `apps/web/src/lib/stores/` (`map.svelte.ts`, `selection.svelte.ts`, `filters.svelte.ts`, `drawing.svelte.ts`) to extract the interface shapes accurately. The context keys in `context-keys.ts` use `Symbol()` — components must use `getContext(MAP_STORE_KEY)` not string keys. This supersedes the spec's string-key example.

- [ ] **Step 4: Commit**

```bash
git add apps/web-next/src/lib/stores/
git commit -m "feat(web-next): add store interfaces and mock implementations"
```

---

## Task 6: UI Primitives — Core Interactive

**Files:**
- Create: `Button.svelte`, `IconButton.svelte`, `Input.svelte`, `Select.svelte`, `Textarea.svelte`, `Badge.svelte`, `Toggle.svelte`, `Slider.svelte`

All in `apps/web-next/src/lib/components/ui/`.

**Design rules:**
- Use Tailwind 4 utilities + design tokens from `app.css`
- No 1px borders for visual separation (No-Line rule)
- Inputs: `surface-low` bg, 2px bottom `primary` border on focus
- Buttons: primary variant uses `.signature-gradient`, ghost is transparent
- All: `aria-*` attributes, keyboard focus ring with `primary` color, `prefers-reduced-motion` respect
- Use Svelte 5 `$props()` syntax for all component props

- [ ] **Step 1: Create Button.svelte**

Props: `variant: 'primary' | 'secondary' | 'ghost' | 'danger'` (default 'secondary'), `size: 'sm' | 'md' | 'lg'` (default 'md'), `disabled: boolean`, `loading: boolean`, `onclick: () => void`. Uses `{@render children()}` for slot content. Primary variant uses `signature-gradient`. Loading state shows Spinner + disables click. Kode Mono `label-sm` text.

- [ ] **Step 2: Create IconButton.svelte**

Props: `icon: Component` (Lucide icon), `label: string` (aria-label), `variant`, `size`, `onclick`. Renders icon only, tooltip-ready. Uses `<svelte:component this={icon} />` pattern.

- [ ] **Step 3: Create Input.svelte**

Props: `type: string`, `value: string`, `placeholder: string`, `error: string | undefined`, `disabled: boolean`. No full border — `surface-low` bg with 2px bottom accent in `primary` on focus. Error state shows `error` color border + message text. Inter `body-md` font.

- [ ] **Step 4: Create Select.svelte**

Props: `options: { value: string, label: string }[]`, `value: string`, `placeholder: string`, `onchange: (value: string) => void`. Same bottom-accent pattern as Input. Custom dropdown arrow icon from Lucide (`ChevronDown`).

- [ ] **Step 5: Create Textarea, Badge, Toggle, Slider**

- `Textarea`: same pattern as Input, with `rows` prop
- `Badge`: `rounded-full`, Kode Mono `label-sm` uppercase, variant colors (default/primary/info/error)
- `Toggle`: amber `primary` when checked, `surface-high` when off, smooth transition
- `Slider`: range input styled with `primary` fill, `surface-low` track, value label in Kode Mono

- [ ] **Step 6: Verify all components render**

Create a temporary test route or add to layout to visually verify each component in all states.

- [ ] **Step 7: Commit**

```bash
git add apps/web-next/src/lib/components/ui/Button.svelte apps/web-next/src/lib/components/ui/IconButton.svelte apps/web-next/src/lib/components/ui/Input.svelte apps/web-next/src/lib/components/ui/Select.svelte apps/web-next/src/lib/components/ui/Textarea.svelte apps/web-next/src/lib/components/ui/Badge.svelte apps/web-next/src/lib/components/ui/Toggle.svelte apps/web-next/src/lib/components/ui/Slider.svelte
git commit -m "feat(web-next): add core interactive UI primitives"
```

---

## Task 7: UI Primitives — Layout

**Files:**
- Create: `GlassPanel.svelte`, `SidePanel.svelte`, `TopBar.svelte`, `Tooltip.svelte`

All in `apps/web-next/src/lib/components/ui/`.

- [ ] **Step 1: Create GlassPanel.svelte**

Props: `class: string` (pass-through for additional classes). Applies `.glass-panel` + `.tonal-elevation`. Uses `{@render children()}` slot. This is the workhorse container for all floating panels.

- [ ] **Step 2: Create SidePanel.svelte**

Props: `title: string`, `side: 'left' | 'right'` (default 'left'), `open: boolean`, `onclose: () => void`. A GlassPanel anchored to the viewport edge with slide-in/out transition. Fixed position, full height below TopBar. Close button (Lucide `X` icon). Kode Mono `headline` for title.

- [ ] **Step 3: Create TopBar.svelte**

Fixed top bar, glass panel style, 64px height (`h-16`). Uses `{@render children()}` for content. Contains logo area (left) and actions area (right) via named slots or just children layout.

- [ ] **Step 4: Create Tooltip.svelte**

Props: `text: string`, `position: 'top' | 'bottom' | 'left' | 'right'` (default 'top'). `surface-highest` bg, Kode Mono `label-sm`. Shows on hover/focus of wrapped children. Uses CSS positioning, not a portal.

- [ ] **Step 5: Commit**

```bash
git add apps/web-next/src/lib/components/ui/GlassPanel.svelte apps/web-next/src/lib/components/ui/SidePanel.svelte apps/web-next/src/lib/components/ui/TopBar.svelte apps/web-next/src/lib/components/ui/Tooltip.svelte
git commit -m "feat(web-next): add layout UI primitives (GlassPanel, SidePanel, TopBar, Tooltip)"
```

---

## Task 8: UI Primitives — Feedback & State

**Files:**
- Create: `Toast.svelte`, `ProgressBar.svelte`, `Spinner.svelte`, `ConfirmDialog.svelte`, `EmptyState.svelte`, `ErrorState.svelte`, `SkeletonLoader.svelte`

All in `apps/web-next/src/lib/components/ui/`.

- [ ] **Step 1: Create Toast.svelte + toastStore**

Export a `toastStore` (Svelte 5 rune-based: `$state` array of `{ id, variant, message, duration }`). Methods: `success()`, `error()`, `info()`, `warning()`, `dismiss()`. Toast component renders the stack — glass block, auto-dismiss after duration (default 4s), manual dismiss on click.

- [ ] **Step 2: Create ProgressBar.svelte**

Props: `value: number` (0-100), `label: string | undefined`, `variant: 'primary' | 'info'`. Amber fill on `surface-low` track. Label in Kode Mono `label-sm`.

- [ ] **Step 3: Create Spinner.svelte**

Props: `size: 'sm' | 'md' | 'lg'`. Amber rotating ring animation. Sizes: 16/24/32px.

- [ ] **Step 4: Create ConfirmDialog.svelte**

Props: `open: boolean`, `title: string`, `message: string`, `confirmLabel: string`, `variant: 'primary' | 'danger'`, `onConfirm: () => void`, `onCancel: () => void`. Modal overlay (dark backdrop) with centered GlassPanel. Trap focus inside dialog. Escape key cancels.

- [ ] **Step 5: Create EmptyState, ErrorState, SkeletonLoader**

- `EmptyState`: Props `icon: Component`, `message`, `description?`, `cta?`, `onAction?`. Centered layout, Kode Mono heading, Inter description.
- `ErrorState`: Props `message`, `onRetry?`. Error icon (Lucide `AlertTriangle`), message, retry button.
- `SkeletonLoader`: Props `layout: 'dashboard' | 'editor' | 'table' | 'panel'`. Predefined skeleton shapes with pulse animation. Uses `surface-high` for skeleton blocks.

- [ ] **Step 6: Commit**

```bash
git add apps/web-next/src/lib/components/ui/Toast.svelte apps/web-next/src/lib/components/ui/ProgressBar.svelte apps/web-next/src/lib/components/ui/Spinner.svelte apps/web-next/src/lib/components/ui/ConfirmDialog.svelte apps/web-next/src/lib/components/ui/EmptyState.svelte apps/web-next/src/lib/components/ui/ErrorState.svelte apps/web-next/src/lib/components/ui/SkeletonLoader.svelte
git commit -m "feat(web-next): add feedback and state UI primitives"
```

---

## Task 9: UI Primitives — Data Display

**Files:**
- Create: `DataTable.svelte`, `Pagination.svelte`, `SearchInput.svelte`, `ColorSwatch.svelte`

All in `apps/web-next/src/lib/components/ui/`.

- [ ] **Step 1: Create DataTable.svelte**

Props: `columns: { key: string, label: string, sortable?: boolean }[]`, `rows: Record<string, unknown>[]`, `onRowClick?: (row) => void`, `searchable?: boolean`. Kode Mono `label-sm` for column headers, Inter `body-sm` for data cells. Sortable columns show chevron icon. Row hover uses `surface-high`. Click handler for row selection. `scrollbar-thin` class on overflow container.

- [ ] **Step 2: Create Pagination.svelte**

Props matching `PaginatedData<T>` contract: `totalCount: number`, `hasNext: boolean`, `hasPrev: boolean`, `onNext: () => void`, `onPrev: () => void`. Shows "X of Y" count in Kode Mono `data` font. Ghost buttons for prev/next with Lucide `ChevronLeft`/`ChevronRight`.

- [ ] **Step 3: Create SearchInput.svelte**

Props: `value: string`, `placeholder: string`, `onchange: (value: string) => void`. Input with Lucide `Search` icon prefix. Debounced (300ms) via `$effect` with timeout.

- [ ] **Step 4: Create ColorSwatch.svelte**

Props: `color: string`, `size: 'sm' | 'md'` (16/24px), `onclick?: () => void`, `selected?: boolean`. Rounded square showing the color. Selected state has `primary` ring. For style editor color pickers.

- [ ] **Step 5: Commit**

```bash
git add apps/web-next/src/lib/components/ui/DataTable.svelte apps/web-next/src/lib/components/ui/Pagination.svelte apps/web-next/src/lib/components/ui/SearchInput.svelte apps/web-next/src/lib/components/ui/ColorSwatch.svelte
git commit -m "feat(web-next): add data display UI primitives"
```

---

## Task 10: App Shell, PWA Components & Routes

**Files:**
- Create: `OfflineBanner.svelte`, `InstallPrompt.svelte`, `UpdateBanner.svelte`
- Create: `+layout.svelte` and all route `+page.svelte` stubs

- [ ] **Step 1: Create OfflineBanner.svelte**

Listens for `online`/`offline` events via `$effect`. Shows a tertiary blue glass bar at top when offline: "You're offline — some features may be unavailable". Auto-dismisses when back online. Slide-down transition.

- [ ] **Step 2: Create InstallPrompt.svelte**

Captures `beforeinstallprompt` event. Shows dismissable GlassPanel banner with amber primary CTA "Install FLIT" and tertiary "Not now". Stores dismissal in `localStorage`. Hidden when already installed (`matchMedia('(display-mode: standalone)')`).

- [ ] **Step 3: Create UpdateBanner.svelte**

Detects when a new service worker is waiting via `navigator.serviceWorker.getRegistration()`. Shows "New version available — refresh" banner. Calls `registration.waiting.postMessage({ type: 'SKIP_WAITING' })` on click, then reloads.

- [ ] **Step 4: Create +layout.svelte**

```svelte
<script lang="ts">
  import '../app.css';
  import TopBar from '$lib/components/ui/TopBar.svelte';
  import Toast from '$lib/components/ui/Toast.svelte';
  import OfflineBanner from '$lib/components/ui/OfflineBanner.svelte';
  import InstallPrompt from '$lib/components/ui/InstallPrompt.svelte';
  import UpdateBanner from '$lib/components/ui/UpdateBanner.svelte';

  let { children } = $props();
</script>

<OfflineBanner />
<UpdateBanner />
<InstallPrompt />
<Toast />
{@render children()}
```

- [ ] **Step 5: Create all route stubs**

Each route is a thin file importing a screen and passing mock data. For now, screens don't exist yet, so create placeholder `<p>` tags:

- `routes/+page.svelte` → "Dashboard — coming in Task 13"
- `routes/maps/[id]/+page.svelte` → "Map Editor — coming in Task 12"
- `routes/share/[token]/+page.svelte` → "Share Viewer — coming in Task 19"
- `routes/embed/[token]/+page.svelte` → "Embed — coming in Task 19"
- `routes/admin/+page.svelte` → "Admin — coming in Task 20"
- `routes/settings/+page.svelte` → "Settings — coming in Task 20"
- `routes/login/+page.svelte` → "Login — coming in Task 14"
- `routes/register/+page.svelte` → "Register — coming in Task 14"

- [ ] **Step 6: Verify dev server runs**

```bash
cd apps/web-next && pnpm dev
```
Expected: app runs at localhost, shows layout with TopBar + route placeholders. PWA manifest loads. Service worker registers.

- [ ] **Step 7: Commit**

```bash
git add apps/web-next/src/lib/components/ui/OfflineBanner.svelte apps/web-next/src/lib/components/ui/InstallPrompt.svelte apps/web-next/src/lib/components/ui/UpdateBanner.svelte apps/web-next/src/routes/
git commit -m "feat(web-next): add app shell, PWA components, and route stubs"
```

---

## Task 11: Map Feature Components

**Files:**
- Create: all files under `apps/web-next/src/lib/components/map/`

**Reference:** `UI-Design Library/stitch/desktop_map_editor_orchestrator/code.html` and `UI-Design Library/stitch/map_editor/code.html` for visual design. Match the Cartologic Flux aesthetic.

- [ ] **Step 1: Create MapCanvas.svelte**

Placeholder `div` with `map-pattern` bg (dot grid). Fills available space. Accepts `interactionMode` prop to change cursor style: `default` → default, `draw-*` → crosshair, `select` → pointer, `pan` → grab. No actual MapLibre — just the visual placeholder.

- [ ] **Step 2: Create DrawingToolbar.svelte**

Vertical toolbar with IconButtons: Point (`MapPin`), Line (`Route`), Polygon (`Pentagon`), Select (`MousePointer2`), Pan (`Hand`). Active mode uses `signature-gradient` bg. Accepts `activeMode: InteractionMode` and `onModeChange: (mode) => void` props. Positioned absolutely top-left of map area. Also includes undo/redo buttons (`Undo2`, `Redo2`) at bottom of toolbar.

- [ ] **Step 3: Create DrawActionRow.svelte**

Confirm bar that slides in below the toolbar when `visible: true`. Shows "Confirm" and "Cancel" buttons + a ProgressBar countdown. Props: `visible`, `onConfirm`, `onCancel`, `duration` (default 5000ms). Pauses countdown on mouseenter, resumes on mouseleave. Auto-cancels when countdown reaches 0.

- [ ] **Step 4: Create BasemapPicker.svelte**

Popover triggered by an IconButton (`Layers`). Shows 3 basemap options as small thumbnail cards (OSM, Positron, Dark Matter). Active basemap has `primary` ring. Props: `activeBasemap: BasemapId`, `onSelect: (id: BasemapId) => void`. Positioned bottom-right.

- [ ] **Step 5: Create FeaturePopup.svelte**

GlassPanel positioned near a mock click point. Shows property key-values in Kode Mono `data` font. Props: `properties: Record<string, unknown>`, `position: { x: number, y: number }`, `onClose: () => void`. Close button top-right. Keys in `on-surface-variant`, values in `on-surface`.

- [ ] **Step 6: Create Legend.svelte**

GlassPanel showing style-driven legend. Props: `entries: LegendEntry[]`, `title: string`. Renders color swatches + labels. Handles simple (single color), categorical (swatch per category), numeric (gradient bar with breakpoints). Positioned bottom-left.

- [ ] **Step 7: Create LayerPanel.svelte**

SidePanel (left side) containing:
- Header "Layers" with "Add Layer" button (Lucide `Plus`)
- Layer list: each row shows visibility toggle (Lucide `Eye`/`EyeOff`), layer name, feature count badge, action menu (style, data, delete)
- Drag handle icon for reorder (Lucide `GripVertical`) — visual only in static phase
- Props: `layers: Layer[]`, `actions: { onToggle, onDelete, onEditStyle, onOpenData }`, `onAddLayer: () => void`
- Expandable row shows style type badge and color preview

- [ ] **Step 8: Create MeasurementPanel.svelte**

Floating GlassPanel overlay. Props: `measurement: { type: 'distance' | 'area' | 'perimeter', value: number, unit: string }`, `onUnitChange`, `onClose`. Unit picker (Select), result in large Kode Mono `headline` font. Positioned center-bottom.

- [ ] **Step 9: Commit**

```bash
git add apps/web-next/src/lib/components/map/
git commit -m "feat(web-next): add map feature components"
```

---

## Task 12: Map Editor Screen

**Files:**
- Create: `apps/web-next/src/lib/screens/MapEditorScreen.svelte`
- Modify: `apps/web-next/src/routes/maps/[id]/+page.svelte`

**Reference:** `UI-Design Library/stitch/desktop_map_editor_orchestrator/code.html` for layout.

- [ ] **Step 1: Create MapEditorScreen.svelte**

The most complex screen. Accepts `MapEditorData`, `MapEditorActions`, `MapEditorStatus` props. Sets up store contexts via `setContext` (map store, selection store, filter store, drawing store).

Layout:
- TopBar at top (with map title, share button, export button)
- LayerPanel on left
- MapCanvas fills remaining space
- DrawingToolbar floating top-left over map
- BasemapPicker floating bottom-right over map
- Legend floating bottom-left over map
- Unified right SidePanel with tabs: Annotations, Comments, Geoprocessing, Measure, Activity
- DataTable collapsible at bottom (below map, above status bar)

Status-driven rendering: loading → SkeletonLoader('editor'), error → ErrorState, empty → EmptyState, success → full editor.

- [ ] **Step 2: Wire route to screen**

Update `routes/maps/[id]/+page.svelte`:

```svelte
<script lang="ts">
  import MapEditorScreen from '$lib/screens/MapEditorScreen.svelte';
  import { mockMapEditorData, mockMapEditorActions } from '$lib/mock/map-editor';
</script>

<MapEditorScreen data={mockMapEditorData} actions={mockMapEditorActions} status="success" />
```

- [ ] **Step 3: Verify layout visually**

```bash
cd apps/web-next && pnpm dev
```
Navigate to `/maps/test-id`. Expected: full editor layout with panels, toolbar, mock data.

- [ ] **Step 4: Commit**

```bash
git add apps/web-next/src/lib/screens/MapEditorScreen.svelte apps/web-next/src/routes/maps/
git commit -m "feat(web-next): add MapEditorScreen with full panel composition"
```

---

## Task 13: Dashboard Screen

**Files:**
- Create: `apps/web-next/src/lib/components/ui/MapCard.svelte`
- Create: `apps/web-next/src/lib/screens/DashboardScreen.svelte`
- Modify: `apps/web-next/src/routes/+page.svelte`

**Reference:** `UI-Design Library/stitch/fli_dashboard/code.html` for layout.

- [ ] **Step 1: Create MapCard.svelte**

Props: `map: MapRecord`, `onOpen`, `onClone`, `onDelete`. GlassPanel card with:
- Map thumbnail area (map-pattern placeholder)
- Title in Kode Mono `headline`
- Description in Inter `body-sm`, truncated
- Metadata: created date (Kode Mono `data`), layer count badge
- Action menu (three-dot button → clone, delete)
- Hover: subtle tonal-elevation increase

- [ ] **Step 2: Create DashboardScreen.svelte**

Props: `DashboardData`, `DashboardActions`, `DashboardStatus`. Layout:
- TopBar with "FLIT" logo (left), user menu (right, with logout action callback)
- "My Maps" section: responsive grid of MapCards (2-4 columns)
- "Shared with Me" section: same grid, different data source
- Templates section: smaller cards, "Use Template" CTA
- "Create Map" floating action button (bottom-right, signature-gradient)
- Status-driven: loading/error/empty/success

- [ ] **Step 3: Wire route**

Update `routes/+page.svelte` to import `DashboardScreen` + mock data.

- [ ] **Step 4: Verify**

Navigate to `/`. Expected: dashboard with mock map cards, sections, FAB.

- [ ] **Step 5: Commit**

```bash
git add apps/web-next/src/lib/components/ui/MapCard.svelte apps/web-next/src/lib/screens/DashboardScreen.svelte apps/web-next/src/routes/+page.svelte
git commit -m "feat(web-next): add DashboardScreen with MapCard grid"
```

---

## Task 14: Auth Screens

**Files:**
- Create: `apps/web-next/src/lib/screens/LoginScreen.svelte`
- Create: `apps/web-next/src/lib/screens/RegisterScreen.svelte`
- Modify: `apps/web-next/src/routes/login/+page.svelte`
- Modify: `apps/web-next/src/routes/register/+page.svelte`

- [ ] **Step 1: Create LoginScreen.svelte**

Centered GlassPanel on surface bg. "FLIT" logo at top in Kode Mono `display`. Email Input, Password Input, primary Button "Sign In". Link to `/register`. Error state for invalid credentials (mock).

- [ ] **Step 2: Create RegisterScreen.svelte**

Same layout. Name, Email, Password, Confirm Password inputs. Primary Button "Create Account". Link to `/login`.

- [ ] **Step 3: Wire routes**

- [ ] **Step 4: Commit**

```bash
git add apps/web-next/src/lib/screens/LoginScreen.svelte apps/web-next/src/lib/screens/RegisterScreen.svelte apps/web-next/src/routes/login/ apps/web-next/src/routes/register/
git commit -m "feat(web-next): add auth screens (Login, Register)"
```

---

## Task 15: Annotation Components

**Files:**
- Create: all files under `apps/web-next/src/lib/components/annotations/`

**Reference:** `UI-Design Library/stitch/annotation_crud_felt_inspired/code.html` and `UI-Design Library/stitch/advanced_annotation_workflow/code.html`.

- [ ] **Step 1: Create AnnotationContent.svelte**

Renders annotation by content type. Props: `content: AnnotationContent` (discriminated union). Switch on `content.type`: text → body text, emoji → large emoji, gif → embedded GIF, image → thumbnail, link → link card, iiif → manifest preview.

- [ ] **Step 2: Create AnnotationList.svelte**

Scrollable list of annotations. Each item: amber pin icon (Lucide `MapPin`), author name (Kode Mono `label-sm`), timestamp, AnnotationContent preview. Props: `annotations: Annotation[]`, `onSelect: (id) => void`.

- [ ] **Step 3: Create AnnotationForm.svelte**

Content type switcher (7 tabs/badges for text/emoji/gif/image/link/iiif/measurement). Form fields change per type. Submit button with 8-condition disabled logic (show hint text explaining why disabled). Props: `onSubmit`, `onCancel`, `editingAnnotation?`.

- [ ] **Step 4: Create AnnotationPanel.svelte**

SidePanel wrapping AnnotationList + AnnotationForm. Toggle between list and form views. Props: `annotations`, `actions: { onCreate, onUpdate, onDelete }`.

- [ ] **Step 5: Commit**

```bash
git add apps/web-next/src/lib/components/annotations/
git commit -m "feat(web-next): add annotation components (panel, form, list, content)"
```

---

## Task 16: Collaboration Components

**Files:**
- Create: all files under `apps/web-next/src/lib/components/collaboration/`

**Reference:** `UI-Design Library/stitch/desktop_collaboration_permissions/code.html`.

- [ ] **Step 1: Create CommentPanel.svelte**

SidePanel with threaded comment list. Each comment: author name, timestamp, body text, resolve button (only if `isOwner` prop is true). New comment form at bottom (Textarea + Button).

- [ ] **Step 2: Create GuestCommentPanel.svelte**

Floating mini-panel for share view. Author name Input + comment Textarea + submit Button. Toggle button to show/hide.

- [ ] **Step 3: Create CollaboratorsPanel.svelte**

Invite form (email Input + role Select [viewer/commenter/editor] + Button). List of current collaborators with role Badge and remove button.

- [ ] **Step 4: Create ShareDialog.svelte**

ConfirmDialog showing: share link (read-only Input with copy button), access level Toggle (public/unlisted), embed snippet textarea (read-only, with copy). Generate token button.

- [ ] **Step 5: Create ActivityFeed.svelte**

SidePanel with chronological event list. Each event: action icon, description, user name, timestamp. Uses Badge for action type.

- [ ] **Step 6: Commit**

```bash
git add apps/web-next/src/lib/components/collaboration/
git commit -m "feat(web-next): add collaboration components (comments, collaborators, share, activity)"
```

---

## Task 17: Data Components

**Files:**
- Create: all files under `apps/web-next/src/lib/components/data/`

**Reference:** `UI-Design Library/stitch/desktop_data_table_filter_panel/code.html`, `UI-Design Library/stitch/desktop_import_audit_terminal/code.html`, `UI-Design Library/stitch/desktop_export_output_controls/code.html`.

- [ ] **Step 1: Create FilterPanel.svelte**

Per-layer filter builder. Add filter button → row with field Select, operator Select (from `FILTER_OPERATOR_LABELS`), value Input. Active filters shown as removable Badges. Props: `fields: string[]`, `filters: UIFilter[]`, `onChange`.

- [ ] **Step 2: Create ImportDialog.svelte**

ConfirmDialog with drag-drop zone (dashed border area), file type badges, ProgressBar for active import, terminal-style log area (`surface-lowest` bg, Kode Mono `data` font, scrollable). Props: `onUpload: (file) => void`, `jobStatus?`.

- [ ] **Step 3: Create ExportDialog.svelte**

ConfirmDialog with format cards: GeoJSON, GeoPackage, Shapefile, PDF, PNG. Each card is a GlassPanel with format icon, name, description. Selected card has `primary` border. Per-format options (e.g. PDF: include screenshot toggle). Props: `onExport: (format, options) => void`.

- [ ] **Step 4: Commit**

```bash
git add apps/web-next/src/lib/components/data/
git commit -m "feat(web-next): add data components (filter, import, export)"
```

---

## Task 18: Style Components

**Files:**
- Create: all files under `apps/web-next/src/lib/components/style/`

**Reference:** `UI-Design Library/stitch/heatmap_vector_tile_config/code.html`.

- [ ] **Step 1: Create StylePanel.svelte**

SidePanel containing: style type Select (simple/categorical/numeric/heatmap), attribute selectors (Select per type), color/opacity/size Sliders, ColorSwatch grid for palette. Props: `style: LayerStyle`, `attributes: string[]`, `onChange`.

- [ ] **Step 2: Create ChoroplethControls.svelte**

Embedded in StylePanel when type is 'numeric'. ColorBrewer ramp picker (grid of ColorSwatch rows, 9 ramps), class count Slider (2-9), classification method Select (equal_interval/quantile).

- [ ] **Step 3: Create LabelControls.svelte**

Toggle for visibility, zoom range Sliders (min/max), font size Slider, color/halo ColorSwatches. Kode Mono preview of label text.

- [ ] **Step 4: Commit**

```bash
git add apps/web-next/src/lib/components/style/
git commit -m "feat(web-next): add style components (panel, choropleth, labels)"
```

---

## Task 19: Share & Embed Screens

**Files:**
- Create: `apps/web-next/src/lib/screens/ShareViewerScreen.svelte`
- Create: `apps/web-next/src/lib/screens/EmbedScreen.svelte`
- Modify: `apps/web-next/src/routes/share/[token]/+page.svelte`
- Modify: `apps/web-next/src/routes/embed/[token]/+page.svelte`

- [ ] **Step 1: Create ShareViewerScreen.svelte**

Read-only map view. MapCanvas + Legend. GuestCommentPanel (floating toggle). No toolbar, no layer mutations. "Embed" copy button. Props: `ShareViewerData`, `ShareViewerActions`.

- [ ] **Step 2: Create EmbedScreen.svelte**

Minimal: MapCanvas + Legend only. No TopBar, no panels, no chrome. Fills viewport.

- [ ] **Step 3: Wire routes with mock data**

- [ ] **Step 4: Commit**

```bash
git add apps/web-next/src/lib/screens/ShareViewerScreen.svelte apps/web-next/src/lib/screens/EmbedScreen.svelte apps/web-next/src/routes/share/ apps/web-next/src/routes/embed/
git commit -m "feat(web-next): add ShareViewer and Embed screens"
```

---

## Task 20: Settings & Admin Screens

**Files:**
- Create: `apps/web-next/src/lib/screens/SettingsScreen.svelte`
- Create: `apps/web-next/src/lib/screens/AdminScreen.svelte`
- Create: all files under `apps/web-next/src/lib/components/admin/`
- Modify: `apps/web-next/src/routes/settings/+page.svelte`
- Modify: `apps/web-next/src/routes/admin/+page.svelte`

**Reference:** `UI-Design Library/stitch/audit_log_admin_view/code.html`.

- [ ] **Step 1: Create admin components**

- `UserList.svelte`: DataTable of users with SearchInput, admin Badge, disable/enable actions
- `AuditLogViewer.svelte`: DataTable showing hash chain entries, verification Badge (green check/red X)
- `StorageStats.svelte`: GlassPanel cards showing upload volume ProgressBar, feature counts in Kode Mono `display`
- `ImportJobMonitor.svelte`: DataTable of jobs with status Badge and ProgressBar

- [ ] **Step 2: Create SettingsScreen.svelte**

TopBar + two sections:
- Account: name/email form with save Button
- API Keys: DataTable of keys (name, prefix `flk_...`, created, last used), create Button, revoke action

- [ ] **Step 3: Create AdminScreen.svelte**

TopBar + tabbed layout: Users, Audit Log, Storage, Import Jobs. Each tab renders its admin component.

- [ ] **Step 4: Wire routes with mock data**

- [ ] **Step 5: Commit**

```bash
git add apps/web-next/src/lib/components/admin/ apps/web-next/src/lib/screens/SettingsScreen.svelte apps/web-next/src/lib/screens/AdminScreen.svelte apps/web-next/src/routes/settings/ apps/web-next/src/routes/admin/
git commit -m "feat(web-next): add Settings and Admin screens with admin components"
```

---

## Task 21: Final Verification & Cleanup

**Files:**
- Modify: various route stubs to wire remaining screens

- [ ] **Step 1: Wire all remaining route stubs to real screens**

Replace all placeholder `<p>` tags with actual screen imports + mock data.

- [ ] **Step 2: Navigation links**

Ensure TopBar has working navigation links between all routes (dashboard, settings, admin). Login/Register have cross-links. Map cards link to `/maps/[id]`.

- [ ] **Step 3: Full visual walkthrough**

```bash
cd apps/web-next && pnpm dev
```

Navigate every route and verify:
- Dashboard: map cards render, empty state works (set status='empty'), loading skeleton works
- Map Editor: all panels visible, toolbar, legend, data table
- Auth: login/register forms styled correctly
- Share/Embed: read-only views
- Settings/Admin: all admin components render
- PWA: manifest loads, service worker registers, install prompt appears in supported browsers

- [ ] **Step 4: Run svelte-check**

```bash
cd apps/web-next && pnpm check
```
Expected: 0 errors

- [ ] **Step 5: Run build**

```bash
cd apps/web-next && pnpm build
```
Expected: build succeeds

- [ ] **Step 6: Commit**

```bash
git add -A apps/web-next/
git commit -m "feat(web-next): wire all routes and final verification"
```

---

## Execution Waves

**Wave 0: Scaffold & Foundation (Tasks 1-3, 3.5)**
Tasks 1, 2, 3 — sequential (each depends on prior)
Task 3.5 — parallel with Tasks 2-3 (modifies shared-types, independent of web-next scaffold)

**Wave 1: Contracts & Stores (Tasks 4-5)**
Task 4 — depends on Task 3.5 (needs Comment, Collaborator, etc. types)
Task 5 — parallel with Task 4 (needs only shared-types base types)

**Wave 2: UI Primitives (Tasks 6-9)**
Tasks 6, 7, 8, 9 — parallel (all create independent components, depend only on app.css tokens)

**Wave 3: App Shell & Routes (Task 10)**
Task 10 — sequential (depends on UI primitives from Wave 2)

**Wave 4: Hero Screen (Tasks 11-12)**
Task 11, then Task 12 — sequential (12 composes components from 11)

**Wave 5: Remaining Screens & Components (Tasks 13-20)**
Tasks 13, 14, 15, 16, 17, 18 — parallel (all independent feature areas, depend only on UI primitives)
Task 19 — depends on Task 15 (annotations) + Task 16 (collaboration)
Task 20 — depends on UI primitives only

**Wave 6: Final Verification (Task 21)**
Task 21 — sequential (depends on everything)

```
Wave 0: [1] → [2] → [3], [3.5] (parallel with 2-3)
Wave 1: [3.5] → [4], [5] (4 depends on 3.5; 5 parallel)
Wave 2: [6, 7, 8, 9] (parallel)
Wave 3: [10]
Wave 4: [11] → [12]
Wave 5: [13, 14, 15, 16, 17, 18, 20] (parallel) → [19]
Wave 6: [21]
```
