# Frontend Rewrite Design Spec

**Date:** 2026-03-19
**Status:** Approved
**Scope:** New frontend at `apps/web-next/` — static prototypes with hardcoded mock data, no backend wiring

---

## 1. Overview

A full UI rewrite for Felt Like It (FLI), built as a PWA. The new frontend lives at `apps/web-next/` in the existing monorepo. This phase produces pixel-perfect static components with hardcoded mock data, structured so that backend wiring later requires changing only route files.

The design system is "Cartologic Flux" — a nocturnal, high-density aesthetic using tonal elevation instead of borders, glassmorphism for floating panels, and amber accents.

---

## 2. Project Structure

```
apps/web-next/
├── src/
│   ├── lib/
│   │   ├── components/
│   │   │   ├── ui/              # Primitives: Button, Input, Badge, Toast, GlassPanel, etc.
│   │   │   ├── map/             # MapCanvas, DrawingToolbar, BasemapPicker, FeaturePopup, Legend
│   │   │   ├── data/            # DataTable, FilterPanel, ImportDialog, ExportDialog
│   │   │   ├── style/           # StylePanel, ChoroplethControls, LabelControls
│   │   │   ├── annotations/     # AnnotationPanel, AnnotationForm, AnnotationContent
│   │   │   ├── collaboration/   # CommentPanel, CollaboratorsPanel, ShareDialog, ActivityFeed
│   │   │   └── admin/           # UserList, AuditLogViewer, StorageStats, ImportJobMonitor
│   │   ├── screens/             # Full-page compositions (DashboardScreen, MapEditorScreen, etc.)
│   │   ├── contracts/           # Typed prop interfaces per screen (data + actions + status)
│   │   ├── mock/                # Mock data + mock action providers
│   │   ├── stores/              # Mock Svelte 5 rune stores matching real store interfaces
│   │   └── styles/              # Font files (if not in static/), any additional CSS
│   ├── routes/
│   │   ├── +layout.svelte       # App shell: TopBar, toast container, OfflineBanner, InstallPrompt
│   │   ├── +page.svelte         # -> DashboardScreen
│   │   ├── maps/[id]/+page.svelte  # -> MapEditorScreen
│   │   ├── share/[token]/+page.svelte  # -> ShareViewerScreen
│   │   ├── embed/[token]/+page.svelte  # -> EmbedScreen
│   │   ├── admin/+page.svelte   # -> AdminScreen
│   │   ├── settings/+page.svelte # -> SettingsScreen
│   │   ├── login/+page.svelte   # -> LoginScreen
│   │   └── register/+page.svelte # -> RegisterScreen
│   ├── app.css                  # Tailwind 4 entry: @import 'tailwindcss', @theme, signature classes
│   ├── app.html                 # manifest link, theme-color, apple meta tags, font preloads
│   └── service-worker.ts        # App-shell caching strategy
├── static/
│   ├── manifest.webmanifest
│   ├── fonts/                   # Self-hosted Kode Mono + Inter (latin subset)
│   └── icons/                   # PWA icons: 192, 512, 512-maskable
├── svelte.config.js
├── vite.config.ts
├── tsconfig.json
└── package.json
```

### Key architectural decisions

- **Thin routes:** Each route file is ~3 lines — imports a screen, passes mock data and no-op actions.
- **Screen compositions:** The `screens/` layer sits between routes and components, receiving all data as typed props.
- **Centralized mocks:** `mock/` holds all fake data, structured to match tRPC return shapes using types from `@felt-like-it/shared-types`.
- **No Storybook:** Components are browsed by navigating the running app.

---

## 3. Wiring-Ready Architecture

Every seam where mock meets real is a single file change at the route level.

### Data flow

```
Route (+page.svelte)
  |  <- owns data fetching (mock now, tRPC later)
  |  <- owns mutation callbacks (no-op now, tRPC mutations later)
  v
Screen (e.g. DashboardScreen.svelte)
  |  <- receives typed props: data + callbacks + status
  |  <- pure presentation + composition, zero data fetching
  v
Components (ui/, features/)
     <- receive typed props, emit events
     <- never import stores or call APIs directly
```

### Patterns

**a) Typed data contracts.** A `contracts/` directory defines the prop interface each screen expects, importing types from `shared-types`:

```typescript
// lib/contracts/dashboard.ts
import type { MapRecord, Layer } from '@felt-like-it/shared-types';

export interface DashboardData {
  maps: MapRecord[];
  collaboratingMaps: MapRecord[];
  templates: MapRecord[];
}

// Every screen action interface extends BaseActions
export interface BaseActions {
  onRetry: () => Promise<void>;
}

export interface DashboardActions extends BaseActions {
  onCreate: (title: string, description?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClone: (id: string) => Promise<void>;
}

export type DashboardStatus = 'loading' | 'success' | 'error' | 'empty';
```

**Required `shared-types` exports.** The mock layer depends on these types existing in `@felt-like-it/shared-types`. If any are missing, Phase 1 includes adding type stubs to the package:

- `Map` (id, title, description, viewport, basemap, userId, createdAt, updatedAt)
- `Layer` (id, mapId, name, type, style, visible, zIndex, sourceFileName)
- `Feature` (id, layerId, geometry, properties)
- `LayerStyle` (type, config, label, attributes, popup, filters)
- `Annotation` / `AnnotationContent` (discriminated union: text/emoji/GIF/image/link/IIIF)
- `Comment` (id, mapId, userId, authorName, body, resolved, createdAt)
- `User` (id, email, name, isAdmin, createdAt, disabledAt)
- `Collaborator` (id, mapId, userId, role, invitedBy)
- `Share` (id, mapId, token, accessLevel)
- `MapEvent` (id, mapId, userId, action, metadata, createdAt)
- `ImportJob` (id, mapId, layerId, status, progress, fileName, errorMessage)
- `AuditLogEntry` (id, userId, action, entityType, entityId, metadata, createdAt)
- `ApiKey` (id, userId, name, prefix, scope, createdAt, lastUsedAt)
- `GeoprocessingOpSchema` (discriminated union for all 7 ops + spatial joins + aggregation)

**b) Mock providers.** `mock/` exports functions matching these contracts:

```typescript
// mock/dashboard.ts
import type { DashboardData, DashboardActions } from '$lib/contracts/dashboard';
import { mockMaps, mockTemplates } from './data/maps';
import { toastStore } from '$lib/components/ui/Toast.svelte';

export const mockDashboardData: DashboardData = { ... };

export const mockDashboardActions: DashboardActions = {
  onCreate: async (title) => { toastStore.info(`Would create: ${title}`); },
  onDelete: async (id) => { toastStore.info(`Would delete: ${id}`); },
  onClone: async (id) => { toastStore.info(`Would clone: ${id}`); },
};
```

**c) Route file — the only file that changes during wiring:**

```svelte
<!-- Static phase -->
<script lang="ts">
  import DashboardScreen from '$lib/screens/DashboardScreen.svelte';
  import { mockDashboardData, mockDashboardActions } from '$lib/mock/dashboard';
</script>
<DashboardScreen data={mockDashboardData} actions={mockDashboardActions} status="success" />
```

**d) Store interfaces via Svelte context.** UI-state stores (map viewport, selection, drawing mode, filters) have interfaces defined separately from implementation. Mock stores implement these with simple `$state` runes.

Stores are provided via Svelte `setContext`/`getContext` at the screen level — components never import a store module directly. This keeps the swap point at the route/screen boundary:

```typescript
// lib/stores/interfaces.ts
export interface IMapStore { readonly center: [number, number]; ... }

// In a screen component:
import { setContext } from 'svelte';
import { mockMapStore } from '$lib/stores/mock-map.svelte';
setContext('mapStore', mockMapStore);

// In any child component:
import { getContext } from 'svelte';
import type { IMapStore } from '$lib/stores/interfaces';
const mapStore = getContext<IMapStore>('mapStore');
```

During wiring, the screen swaps `mockMapStore` for the real store. No child component changes.

**e) Status-driven rendering.** Every screen handles four states:

```svelte
{#if status === 'loading'}
  <SkeletonLoader layout="dashboard" />
{:else if status === 'error'}
  <ErrorState message="Failed to load maps" onRetry={actions.onRetry} />
{:else if status === 'empty'}
  <EmptyState icon={MapIcon} message="No maps yet" cta="Create your first map" onAction={actions.onCreate} />
{:else}
  <!-- actual content -->
{/if}
```

**f) Pagination shapes.** List components accept a contract matching the REST envelope:

```typescript
export interface PaginatedData<T> {
  items: T[];
  totalCount: number;
  nextCursor: string | null;
}
```

**g) MapEditorScreen contract (hero screen).** The most complex contract, shown here as the reference pattern:

```typescript
// lib/contracts/map-editor.ts
import type { MapRecord, Layer, Feature, Comment } from '@felt-like-it/shared-types';
import type { Annotation, MapEvent } from '@felt-like-it/shared-types';
import type { PaginatedData } from './shared';

export interface MapEditorData {
  map: MapRecord;
  layers: Layer[];
  features: Record<string, Feature[]>;  // keyed by layerId
  annotations: Annotation[];
  comments: Comment[];
  events: MapEvent[];
  collaborators: { userId: string; email: string; role: string }[];
}

export interface MapEditorActions extends BaseActions {
  // Layer mutations
  onLayerCreate: (name: string) => Promise<void>;
  onLayerDelete: (id: string) => Promise<void>;
  onLayerReorder: (id: string, newIndex: number) => Promise<void>;
  onLayerToggle: (id: string, visible: boolean) => Promise<void>;
  onLayerUpdateStyle: (id: string, style: Record<string, unknown>) => Promise<void>;
  // Feature mutations
  onFeatureUpsert: (layerId: string, feature: Feature) => Promise<void>;
  onFeatureDelete: (layerId: string, featureId: string) => Promise<void>;
  // Annotation mutations
  onAnnotationCreate: (annotation: Partial<Annotation>) => Promise<void>;
  onAnnotationUpdate: (id: string, version: number, changes: Partial<Annotation>) => Promise<void>;
  onAnnotationDelete: (id: string) => Promise<void>;
  // Comment mutations
  onCommentCreate: (body: string) => Promise<void>;
  onCommentDelete: (id: string) => Promise<void>;
  onCommentResolve: (id: string) => Promise<void>;
  // Map mutations
  onMapUpdate: (changes: Partial<MapRecord>) => Promise<void>;
  onViewportSave: (viewport: { center: [number, number]; zoom: number; bearing: number; pitch: number }) => Promise<void>;
  // Geoprocessing
  onGeoprocessingRun: (op: Record<string, unknown>) => Promise<void>;
}

export type MapEditorStatus = 'loading' | 'success' | 'error' | 'empty';
```

**h) Action callbacks as props.** Mutation-triggering components accept `onDelete`, `onSave`, `onInvite` callback props. In static mode these toast "would do X". When wiring, the route passes real mutations.

### Wiring summary

| During wiring you change... | You never touch... |
|---|---|
| Route files (mock -> tRPC queries/mutations) | Screen components |
| Screen-level `setContext` calls (mock stores -> real stores) | Any child component (they use `getContext`) |
| `mock/` deletion | `contracts/` types |
| Service worker cache strategy | UI primitives or feature components |

---

## 4. Design System & Tokens

### Color tokens (dark default)

All defined as CSS custom properties on `:root`. A prepared but empty `.light` block exists for future light mode — only values change, no component changes.

```
Surface hierarchy (5-tier tonal elevation):
  --surface:                   #081425   (base canvas)
  --surface-container-lowest:  #040e1f   (recessed utility areas)
  --surface-container-low:     #0d1c2f   (background wells)
  --surface-container:         #152031   (floating panels)
  --surface-container-high:    #1f2a3c   (hover/active states)
  --surface-container-highest: #2a3548   (tooltips, popovers)

Primary (amber FLI accent):
  --primary:                   #ffc174
  --primary-container:         #f59e0b
  --on-primary-container:      #613b00
  --inverse-primary:           #855300

Tertiary (info blue):
  --tertiary:                  #8ed5ff
  --tertiary-fixed-dim:        #7bd0ff

Text:
  --on-surface:                #d8e3fb   (primary text)
  --on-surface-variant:        #d8c3ad   (de-emphasized text)

Error:
  --error:                     #ffb4ab

Shadows:
  always surface-container-lowest at low alpha, never pure black
```

### Typography

```
Kode Mono (headings, labels, data, coordinates):
  display:   2rem / 700 / tracking -0.02em
  headline:  1.25rem / 600
  label-lg:  0.875rem / 600 / tracking 0.05em / uppercase
  label-sm:  0.75rem / 500 / tracking 0.05em / uppercase
  data:      0.8125rem / 500   (attribute values, coordinates)

Inter (body text, descriptions):
  body-lg:   1rem / 400
  body-md:   0.875rem / 400
  body-sm:   0.75rem / 400    (high-density attribute data)
```

Self-hosted in `static/fonts/`. Latin + latin-ext subsets. Preloaded in `app.html` for primary weights. `font-display: swap`.

### Signature CSS classes (~6 via `@apply`)

```css
.glass-panel        /* rgba(21,32,49,0.7) + backdrop-blur-[12px] */
.tonal-elevation    /* box-shadow: 0 12px 40px rgba(4,14,31,0.4) */
.signature-gradient /* linear-gradient(135deg, var(--primary), var(--primary-container)) */
.surface-well       /* surface-container-low background for recessed areas */
.map-pattern        /* dot grid background for empty map canvas states */
.status-glow        /* subtle animated glow for active/drawing states */
```

### Design rules

- **No-Line rule:** No 1px borders for section separation. Boundaries via tonal shifts only. Borders allowed only for input focus states (2px bottom-accent in `--primary`).
- **Corners:** `rounded-lg` (0.5rem) default. `rounded-xl` (0.75rem) for cards/dialogs. `rounded-full` for badges/pills.
- **Icons:** Lucide via `lucide-svelte`. Sizes: `icon-sm` (16px), `icon-md` (20px), `icon-lg` (24px).
- **Spacing:** 8-point hybrid scale. `spacing.3` (0.6rem) for component internal padding, `spacing.5` (1.1rem) for layout gaps.

---

## 5. UI Primitives (`ui/`)

### Core (~22 components)

| Component | Key props | Notes |
|---|---|---|
| `Button` | `variant: 'primary' \| 'secondary' \| 'ghost' \| 'danger'`, `size`, `disabled`, `loading`, `onclick` | Primary uses `signature-gradient`. Loading shows spinner + disables. |
| `IconButton` | `icon: Component`, `label: string` (aria-label), `variant`, `size` | For toolbar actions. |
| `Input` | `type`, `value`, `placeholder`, `error`, `disabled` | `surface-container-low` bg, 2px bottom `--primary` on focus. |
| `Select` | `options`, `value`, `placeholder`, `onchange` | Same bottom-accent pattern. |
| `Textarea` | `value`, `placeholder`, `rows`, `error` | Same pattern. |
| `Badge` | `variant: 'default' \| 'primary' \| 'info' \| 'error'`, `label` | `rounded-full`, `label-sm` uppercase. |
| `Toggle` | `checked`, `onchange`, `label` | Amber primary when on. |
| `Slider` | `min`, `max`, `value`, `step`, `label`, `onchange` | For opacity, radius, intensity. |
| `Tooltip` | `text`, `position` | `surface-container-highest` bg. Wraps children. |
| `GlassPanel` | `class` (pass-through) | `.glass-panel` + `.tonal-elevation`. Workhorse container. |
| `SidePanel` | `title`, `side: 'left' \| 'right'`, `open`, `onclose` | Glass panel anchored to edge. Slide transition. |
| `TopBar` | slot children | Fixed top, glass panel. |
| `EmptyState` | `icon`, `message`, `description?`, `cta?`, `onAction?` | Centered, Kode Mono heading, Inter description. |
| `ErrorState` | `message`, `onRetry?` | Error icon + message + retry button. |
| `SkeletonLoader` | `layout: 'dashboard' \| 'editor' \| 'table' \| 'panel'` | Predefined shapes. Pulse animation. |
| `Toast` | `variant`, `message`, `duration?` | Glass block, auto-dismiss. Managed by `toastStore`. |
| `ProgressBar` | `value: 0-100`, `label?` | Amber fill on `surface-container-low` track. |
| `Spinner` | `size` | Amber rotating indicator. |
| `ConfirmDialog` | `title`, `message`, `confirmLabel`, `variant`, `onConfirm`, `onCancel` | Modal overlay, glass panel. |
| `DataTable` | `columns`, `rows`, `onRowClick?`, `sortable?`, `searchable?` | `body-sm` Inter data, `label-sm` Kode Mono headers. |
| `Pagination` | `totalCount`, `cursor`, `onNext`, `onPrev` | Matches `PaginatedData<T>`. |
| `SearchInput` | `value`, `placeholder`, `onchange` | Input with search icon. Debounced. |
| `ColorSwatch` | `color`, `size?`, `onclick?` | For style editor. |

### Accessibility baseline

Every primitive gets: proper `role`/`aria-*`, keyboard navigation, focus visible with `--primary` ring, screen reader labels, `prefers-reduced-motion` respect.

---

## 6. Feature Components

### Map (`map/`)

| Component | Notes |
|---|---|
| `MapCanvas` | Placeholder div with `map-pattern` bg. Accepts `interactionMode` for cursor. |
| `DrawingToolbar` | Point/Line/Polygon/Select/Pan buttons. Active = `signature-gradient`. |
| `DrawActionRow` | Countdown confirm bar with pause-on-hover. |
| `BasemapPicker` | 3 basemap thumbnails in popover. |
| `FeaturePopup` | GlassPanel near click point. Property key-values in `data` font. |
| `Legend` | Style-driven. Handles simple/categorical/numeric/heatmap. |
| `MeasurementPanel` | Floating overlay. Unit picker, Kode Mono results. |

### Data (`data/`)

| Component | Notes |
|---|---|
| `FilterPanel` | Per-layer filter builder. Operator picker + value. Active filters as badges. |
| `ImportDialog` | Drag-drop, format detection, job progress, terminal-style log. |
| `ExportDialog` | Format cards (GeoJSON/GeoPackage/Shapefile/PDF/PNG). Per-format options. |

### Style (`style/`)

| Component | Notes |
|---|---|
| `StylePanel` | Style type picker, attribute selectors, color/opacity/size controls. |
| `ChoroplethControls` | 9 ColorBrewer ramps, class count, method dropdown. |
| `LabelControls` | Visibility, zoom range, font size, color, halo. |

### Annotations (`annotations/`)

| Component | Notes |
|---|---|
| `AnnotationPanel` | SidePanel, auto-open on pick/region. |
| `AnnotationForm` | Content type switcher (text/emoji/GIF/image/link/IIIF). 8-condition disabled + hint. |
| `AnnotationContent` | Renders by type. Image thumbnail, IIIF NavPlace preview. |
| `AnnotationList` | Scrollable, author + timestamp, amber pin icon. |

### Collaboration (`collaboration/`)

| Component | Notes |
|---|---|
| `CommentPanel` | Threaded comments. Owner-only resolve via prop. |
| `GuestCommentPanel` | Author name + comment. Floating toggle on share view. |
| `CollaboratorsPanel` | Invite by email, role picker, role badges. |
| `ShareDialog` | Token gen, access level, embed snippet copy. |
| `ActivityFeed` | Chronological event list. |

### Admin (`admin/`)

| Component | Notes |
|---|---|
| `UserList` | Paginated table, admin badge, disable/enable. |
| `AuditLogViewer` | Hash chain display, verification badge. |
| `StorageStats` | Upload volume, feature counts. |
| `ImportJobMonitor` | Job list with status + progress. |

---

## 7. Screens

| Screen | Route | Composes |
|---|---|---|
| `LoginScreen` | `/login` | Input, Button, GlassPanel |
| `RegisterScreen` | `/register` | Input, Button, GlassPanel |
| `DashboardScreen` | `/` | TopBar, map cards grid, EmptyState |
| `MapEditorScreen` | `/maps/[id]` | TopBar, MapCanvas, DrawingToolbar, LayerPanel, unified right SidePanel, DataTable, BasemapPicker, Legend |
| `ShareViewerScreen` | `/share/[token]` | MapCanvas, Legend, GuestCommentPanel |
| `EmbedScreen` | `/embed/[token]` | MapCanvas, Legend only |
| `SettingsScreen` | `/settings` | TopBar, API key list, account form |
| `AdminScreen` | `/admin` | TopBar, UserList, AuditLogViewer, StorageStats, ImportJobMonitor |

### LayerPanel

SidePanel containing:
- Layer list: drag-to-reorder, visibility toggle, z-index display
- Per-layer expandable row: style summary, feature count badge, actions (edit style, data table, delete)
- "Add layer" button (opens ImportDialog)
- Accepts `actions` callback prop (onToggle, onReorder, onDelete, onEditStyle)

---

## 8. PWA

### Manifest

```
name:             Felt Like It
short_name:       FLIT
description:      Collaborative web GIS platform
start_url:        /
display:          standalone
theme_color:      #081425
background_color: #081425
orientation:      any
categories:       ["productivity", "utilities"]
icons:            192 (any), 512 (any), 512 (maskable)
```

### Service worker

| Asset type | Strategy |
|---|---|
| App shell (HTML, JS, CSS) | Cache-first, versioned by build hash |
| Fonts | Cache-first, long-lived |
| PWA icons | Cache-first |
| Navigation requests | Network-first, fall back to cached shell |
| `/api/*`, map tiles, uploads | Not cached (no backend yet) |

Versioned cache name. Old cache cleanup on activate. `UpdateBanner` component prompts on new service worker.

### `app.html`

```html
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#081425" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<link rel="apple-touch-icon" href="/icons/icon-192.png" />
```

### Install prompt

`InstallPrompt` component: captures `beforeinstallprompt`, shows dismissable amber CTA banner, remembers dismissal in `localStorage`, hidden when already installed.

### Offline indicator

`OfflineBanner` component: listens for `online`/`offline`, shows tertiary blue glass bar, auto-dismisses on reconnect.

---

## 9. Build Order

### Phase 1: Foundation
Scaffold, `app.css` tokens, self-host fonts, `app.html`, manifest, service worker, `+layout.svelte` app shell, install `lucide-svelte`.

### Phase 2: Primitives
All ~22 `ui/` components with full visual states + a11y. Priority: Button -> IconButton -> GlassPanel -> Input -> Select -> Badge -> Toast -> SidePanel -> TopBar -> EmptyState -> ErrorState -> SkeletonLoader -> remaining.

### Phase 3: Hero screen (Map Editor)
Contracts, mock data, MapCanvas placeholder, DrawingToolbar, LayerPanel, MapEditorScreen composition, unified right SidePanel.

### Phase 4: Dashboard
Contracts, mock data, map card component, DashboardScreen, empty state.

### Phase 5: Supporting screens
Login, Register, ShareViewer, Embed, Settings, Admin.

### Phase 6: Remaining feature components
StylePanel, ChoroplethControls, LabelControls, ImportDialog, ExportDialog, FilterPanel, MeasurementPanel, FeaturePopup, BasemapPicker, Legend.

---

## 10. Locked Decisions

| Decision | Rules out |
|---|---|
| `apps/web-next/` in monorepo | Separate repo; overwriting `apps/web/` |
| Thin routes -> screen compositions -> primitives (Approach C) | Component library without routing; screens that fetch data |
| Wiring via route-only changes | Components importing tRPC directly; stores calling APIs |
| Dark mode only, CSS custom properties for future light mode | Building both themes now; hard-coded color values in components |
| Kode Mono (headings/labels/data) + Inter (body) | Inter everywhere; any other typeface pairing |
| Lucide icons via `lucide-svelte` | Material Symbols Outlined; Heroicons |
| Tailwind 4 utility-first + ~6 `@apply` signature classes | Full `@apply` component classes; CSS modules |
| No-Line rule (tonal elevation, no 1px borders) | Traditional bordered UI sections |
| PWA short_name "FLIT" | Any other short name |
| No Storybook | Storybook-driven development |
| Types from `@felt-like-it/shared-types` for all mock data | Custom mock types; simplified mock shapes |
| Status-driven rendering (loading/error/empty/success) on all screens | Happy-path-only prototypes |
| `contracts/` directory for screen prop interfaces | Inline prop type definitions; untyped props |
| Action callbacks as props (not direct API calls) | Components calling tRPC mutations |
| Auth routes at `/login`, `/register` (not `/auth/*`) | Existing app's `/auth/login`, `/auth/signup` paths; redirect logic must update during wiring |
| Logout is a TopBar action callback, not a route | Dedicated `/logout` route |
| Stores provided via Svelte `setContext`/`getContext` | Components importing store modules directly |
| Pagination uses `PaginatedData<T>` envelope shape (matches both tRPC and REST) | Custom pagination types per component |

## 11. Referenced Documents

| Document | Path |
|---|---|
| Cartologic Flux Design System | `UI-Design Library/stitch/cartologic_flux/DESIGN.md` |
| Design Audit Compliance | `UI-Design Library/fli_design_audit_compliance_document.html` |
| Architecture | `docs/ARCHITECTURE.md` |
| Roadmap | `docs/ROADMAP.md` |
| Shared types package | `packages/shared-types/src/index.ts` |
| Current web app | `apps/web/` |
| UI Design Library prototypes | `UI-Design Library/stitch/` (23 directories) |
