# Design: Merge web-next UI into apps/web

> Replace the existing frontend in `apps/web` with the `web-next` prototype's components, screens, and contracts. Server code stays untouched.

## Strategy

Big-bang replacement. Copy all web-next UI artifacts into `apps/web/src/lib/`, replace route files to use new screen components, delete old UI components, fix until it builds. No incremental migration or shadow routes.

## Directory Changes

### Add to `apps/web/src/lib/`

| Directory | Contents | Notes |
|-----------|----------|-------|
| `screens/` | 8 screen components | New directory |
| `contracts/` | Screen contract types (data/actions/status per screen) | New directory |
| `components/ui/` | 26 UI primitives (Button, GlassPanel, Toast, etc.) | Replaces existing |
| `components/annotations/` | AnnotationPanel, AnnotationForm, AnnotationList, AnnotationContent | Replaces existing |
| `components/data/` | ImportDialog, ExportDialog, FilterPanel | Replaces existing |
| `components/collaboration/` | Collaboration components | New |
| `components/style/` | Style components (panel, choropleth, labels) | New |
| `components/admin/` | AuditLogViewer, ImportJobMonitor, UserList, StorageStats | New |

### Keep from existing `apps/web/src/lib/`

| Path | Reason |
|------|--------|
| `components/map/MapEditor.svelte` | Reused inside MapEditorScreen — battle-tested MapLibre/Terra Draw/deck.gl integration |
| `components/map/MapCanvas.svelte` | Real MapLibre canvas, not web-next placeholder |
| `components/map/DrawingToolbar.svelte` | Real Terra Draw toolbar |
| `components/map/MeasurementPanel.svelte` | Real measurement panel |
| `stores/*.svelte.ts` | Real stores (map, selection, drawing, filters, style, layers, undo) |
| `server/` | Entire server directory — DB, tRPC, auth, services, import pipeline |
| `utils/trpc.ts` | Existing tRPC client (createTRPCClient + httpBatchLink + superjson) |
| `utils/query-client.ts` | TanStack Query singleton |
| `debug/` | Effect tracker and diagnostics |

### Delete

| Path | Reason |
|------|--------|
| Old UI components replaced by web-next | Superseded |
| `apps/web-next/` | Entire app deleted after merge |
| web-next `mock/` directory | Not copied — real data replaces mocks |
| web-next `stores/mock-*.svelte.ts` | Not copied — real stores used instead |
| web-next `stores/interfaces.ts` | Not copied — scaffolding for prototype |

## Route Wiring

Keep existing URL structure. The `(app)/` layout group provides auth gating via `+layout.server.ts`.

### Auth Routes

| Route | Screen | Wiring |
|-------|--------|--------|
| `auth/login/+page.svelte` | `LoginScreen` | Existing `+page.server.ts` form actions for login. Wire `actions.onLogin` to form submission. |
| `auth/signup/+page.svelte` | `RegisterScreen` | Existing `+page.server.ts` form actions for signup. Wire `actions.onRegister` to form submission. |
| `auth/logout/+page.server.ts` | N/A | Keep existing — server-only redirect. |

### App Routes

| Route | Screen | Data Source | Notes |
|-------|--------|-------------|-------|
| `(app)/dashboard/+page.svelte` | `DashboardScreen` | `+page.server.ts`: `maps.list` + `maps.listCollaborating` + `maps.listTemplates` via tRPC server caller | Map to `DashboardData` contract |
| `(app)/map/[id]/+page.svelte` | `MapEditorScreen` | Existing `+page.server.ts` (Drizzle queries for map + layers). Client-side tRPC for annotations, comments, events, collaborators. | MapEditorScreen wraps existing MapEditor.svelte |
| `(app)/settings/+page.svelte` | `SettingsScreen` | `+page.server.ts`: user from layout + `apiKeys.list` | Map to `SettingsData` contract |
| `(app)/admin/+page.svelte` | `AdminScreen` | `+page.server.ts`: `admin.*` + `auditLog.list` + storage stats | Consolidate existing multi-page admin into single screen |

### Public Routes

| Route | Screen | Data Source |
|-------|--------|-------------|
| `share/[token]/+page.server.ts` | `ShareViewerScreen` | `shares.resolve` — no auth required |
| `embed/[token]/+page.server.ts` | `EmbedScreen` | `shares.resolve` — no auth required |

## Map Editor Integration

`MapEditorScreen` (new component) provides the UI shell: sidebar panels, toolbar styling, annotation/collaboration chrome. It wraps the existing `MapEditor.svelte` component which provides:

- MapLibre GL map rendering with mixed-geometry sublayers
- Terra Draw integration for drawing tools
- deck.gl overlay for large datasets
- Interaction mode state machine (idle/drawRegion/pickFeature/measure)
- Real stores: `mapStore`, `drawingStore`, `selectionStore`, `filterStore`, `styleStore`

The screen passes data/actions props for non-map concerns (annotations, comments, collaboration). Map-specific state flows through existing stores via `setContext`.

## Key Adaptation Points

### AnnotationSummary Mapping

The contract defines a simplified `AnnotationSummary`:
```typescript
interface AnnotationSummary {
  id: string;
  authorName: string;
  content: { type: string; [key: string]: unknown };
  anchor: { type: string; coordinates?: [number, number] };
  createdAt: Date;
  version: number;
}
```

The tRPC `annotations.list` returns full W3C Annotation Objects. The route's `+page.server.ts` (or a shared mapper function) projects these into summaries:
- `authorName` from `body.creator.name`
- `content` from `body` (simplified)
- `anchor` from `target` (simplified)

### User.isAdmin / disabledAt

`shared-types` `User` type does not include `isAdmin` or `disabledAt`. The admin route passes the full user object from `locals.user` (which includes these fields from the DB query in `hooks.server.ts`). AdminScreen already has a workaround for this.

### Date Serialization

- tRPC client uses superjson (handles Dates transparently)
- `+page.server.ts` loads using Drizzle return Date objects — SvelteKit serializes these through `devalue`
- No special handling needed in either case

### MapRecord.layerCount

tRPC `maps.list` returns `layerCount` (computed field not in `MapRecord` type). Options:
1. Extend `MapRecord` in shared-types (preferred — it's useful data)
2. Pass as a separate map in the route's data return

## Styling

Web-next's `app.css` replaces existing `app.css`:
- Tailwind 4 with `@import 'tailwindcss'`
- CSS custom properties for theming (dark mode only, light mode ready)
- Kode Mono (headings/labels) + Inter (body), self-hosted woff2
- 6 signature classes: `glass-panel`, `tonal-elevation`, `signature-gradient`, `surface-well`, `map-pattern`, `status-glow`
- No-Line rule: tonal elevation only, no 1px borders
- Lucide icons via `lucide-svelte/icons/<name>`

Font files from `apps/web-next/static/fonts/` must be copied to `apps/web/static/fonts/`.

## Auth Flow

Unchanged. The existing auth stack is preserved:
1. `hooks.server.ts` — Lucia session validation + API key Bearer auth -> `locals.user`
2. `(app)/+layout.server.ts` — redirects unauthenticated users to `/auth/login?redirect=...`
3. `+layout.server.ts` returns `user` object to all `(app)` routes
4. New screens consume user data from SvelteKit's `$page.data` or layout data

## Admin Consolidation

The existing app splits admin across 4 routes: `/admin`, `/admin/audit`, `/admin/storage`, `/admin/jobs`. Web-next's `AdminScreen` consolidates these into a single tabbed screen. During migration:
- Single `(app)/admin/+page.svelte` uses `AdminScreen`
- `+page.server.ts` fetches all admin data (users, audit log, storage stats, import jobs)
- Delete sub-routes (`audit/`, `storage/`, `jobs/`)

## Post-Transition Plan

### Immediate (same session or next)
1. **Dead code cleanup** — grep for orphaned imports and unused old components. Delete them.
2. **Build verification** — `pnpm check` and `pnpm build` must pass with zero errors.
3. **Delete web-next** — remove `apps/web-next/`, clean up worktree and branch.
4. **Pop stash** — the main repo has a stash ("stash before web-next worktree") to pop after cleanup.

### Near-term (next few sessions)
5. **MapEditor decomposition** — the 800-line MapEditor wrapped inside MapEditorScreen is a tech debt seam. Break it into smaller components that conform to the screen contract pattern.
6. **Store interface alignment** — real stores don't implement web-next's `interfaces.ts`. Either adapt stores to a shared interface or accept the current module-singleton pattern.
7. **PWA wiring** — web-next has PWA components (InstallPrompt, UpdateBanner, OfflineBanner). Wire to real service worker or remove if not needed yet.

### Later
8. **Light mode** — CSS custom properties are ready. Add light theme values and a toggle.
9. **E2E tests** — add Playwright tests for new UI flows. Existing unit tests cover server code and should pass unchanged.
10. **Performance audit** — verify no regressions from new component tree (bundle size, render performance).

## Locked Decisions

| Decision | Rules out |
|----------|-----------|
| Big-bang replacement | Incremental migration, shadow routes, feature flags |
| Keep existing URL structure with `(app)/` layout group | Flat URL structure from web-next prototype |
| Reuse existing MapEditor.svelte inside new screen | Rewriting MapLibre/Terra Draw integration |
| Direct merge into `src/lib/` (no namespacing) | Coexistence of old and new components |
| Delete `apps/web-next/` after merge | Keeping prototype as reference (git history suffices) |
| Consolidate admin sub-routes into single AdminScreen | Keeping multi-page admin layout |

## Referenced Documents

| Document | Path |
|----------|------|
| Frontend rewrite plan (21 tasks) | `docs/superpowers/plans/2026-03-19-frontend-rewrite.md` |
| Frontend rewrite design spec | `docs/superpowers/specs/2026-03-19-frontend-rewrite-design.md` |
| Session handoff | `HANDOFF.md` |
| Screen contract types | `.worktrees/web-next/apps/web-next/src/lib/contracts/*.ts` |
| Store interfaces (prototype) | `.worktrees/web-next/apps/web-next/src/lib/stores/interfaces.ts` |
| Real stores | `apps/web/src/lib/stores/*.svelte.ts` |
| tRPC router root | `apps/web/src/lib/server/trpc/router.ts` |
| tRPC client | `apps/web/src/lib/utils/trpc.ts` |
| Auth hooks | `apps/web/src/hooks.server.ts` |
| Auth layout guard | `apps/web/src/routes/(app)/+layout.server.ts` |
