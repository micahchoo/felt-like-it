# E2E Flow Audit: Flows 13-16 (Sharing, Embedding, Commenting, Collaboration)

Audited 2026-03-30 against:
- **svelte-maplibre** @ `/mnt/Ghar/2TA/DevStuff/Patterning/Maps/svelte-maplibre/`
- **Allmaps** @ `/mnt/Ghar/2TA/DevStuff/Patterning/Maps/allmaps/`

---

## Flow 13: Sharing

**Trigger:** Map owner opens ShareDialog, clicks "Enable" to create public share link, copies URL.
**Outcome:** Recipient opens `/share/[token]` and sees a read-only map viewer with the map title, embed button, and guest comment panel toggle.

### Current Implementation

- `apps/web/src/lib/components/map/ShareDialog.svelte:45-55` — Derives `shareUrl` and `embedUrl` from `window.location.origin` + share token. Generates iframe embed snippet with hardcoded 800x600 dimensions.
- `apps/web/src/lib/components/map/ShareDialog.svelte:76-116` — `loadShare()`, `createShare()`, `deleteShare()` call tRPC `shares.getForMap`, `shares.create`, `shares.delete`. Only `public` accessLevel is ever passed (line 93).
- `apps/web/src/lib/server/trpc/routers/shares.ts:11-13` — Token generation via `randomBytes(16).toString('base64url')` — 128 bits of entropy.
- `apps/web/src/lib/server/trpc/routers/shares.ts:15-70` — `create` mutation: upserts share record; if existing, updates `accessLevel` only, preserving the original token. Audit-logged.
- `apps/web/src/lib/server/trpc/routers/shares.ts:72-80` — `getForMap` query: requires map ownership. Returns share or null.
- `apps/web/src/lib/server/trpc/routers/shares.ts:99-121` — `resolve` public procedure: looks up token, fetches map + layers by `zIndex`. Returns full map object + layers array.
- `apps/web/src/routes/(public)/share/[token]/+page.server.ts` — Server load function uses the same token-to-map-to-layers resolution as shares.resolve (duplicated logic, not calling the tRPC procedure).
- `apps/web/src/routes/(public)/share/[token]/+page.svelte:1-42` — Thin route shell: delegates to `ShareViewerScreen`, passes `ShareViewerData` contract.
- `apps/web/src/lib/screens/ShareViewerScreen.svelte:1-35` — Mounts `MapEditor` in `readonly` mode, overlays embed-copy button and comment panel toggle. Loads viewport/basemap on mount.
- `apps/web/src/lib/contracts/share-viewer.ts:1-19` — `ShareViewerData` = `{ map: MapRecord, layers: Layer[], shareToken: string }`. Actions only provide `onRetry`.

### Reference Patterns

- **svelte-maplibre:** `src/lib/hash.ts` — URL hash encodes viewport state (`zoom/lat/lng/bearing/pitch`). FLI's share URLs carry no viewport info in the URL; instead, the server returns the saved viewport and `ShareViewerScreen.onMount` calls `mapStore.loadViewport()`. This means shared links always open at the owner's last-saved viewport, with no way for the sharer to link to a specific view.
- **Allmaps:** `apps/viewer/` is a standalone SvelteKit app (`ssr: false, prerender: true`) that loads maps via URL parameters through `paramStore`/`dataStore`. Its store architecture is highly decomposed: `sources.ts`, `maps.ts`, `active.ts`, `view.ts`, `opacity.ts`, `visible.ts`, `render-options.ts`, etc. Each concern is an independent writable store. FLI's share viewer reuses the full `MapEditor` component in readonly mode rather than having a dedicated lightweight viewer — this pulls in the undo store, drawing state, filter persistence, annotation queries, and other editor infrastructure that the viewer never needs.

### Findings

| Category | Finding | Recommendation |
|----------|---------|----------------|
| gap | Share URL carries no viewport state; recipient always sees owner's saved viewport, cannot deeplink to a specific view. | Add optional `#zoom/lat/lng` hash to share URLs (pattern from svelte-maplibre's `hash.ts`). |
| debt | `+page.server.ts` duplicates the token-to-map-to-layers query that already exists in `shares.resolve` tRPC procedure. Two code paths that must stay in sync. | Refactor server load to call `shares.resolve` internally or extract shared helper. |
| gap | Only `accessLevel: 'public'` is ever created (line 93). The `accessLevel` field on the shares table and the `CreateShareSchema` support other values but the UI offers no choice. | Either remove the unused access-level abstraction or expose "link with password" / "unlisted" options. |
| debt | ShareViewerScreen reuses the full MapEditor (undo store, drawing state, filter persistence, style store, annotation geo store) in readonly mode. Heavy for a read-only viewer. | Consider a lightweight `ReadOnlyMapCanvas` (like Allmaps viewer's decomposed store approach) that only loads map + layers + basemap. |
| missing | No share link expiration or revocation tracking. `deleteShare` removes the row but there's no soft-delete, expiry timestamp, or access log for the share link. | Add `expiresAt` column, optional TTL on share creation, and share-access event logging. |
| gap | No loading state indicator while `+page.server.ts` resolves the token. If the map has many layers, the user sees nothing until SSR completes. | Add skeleton/loading state or streaming with SvelteKit's `defer`. |

---

## Flow 14: Embedding

**Trigger:** Owner copies iframe snippet from ShareDialog (or ShareViewerScreen's embed button), pastes in external page.
**Outcome:** Iframe renders bare map canvas — no toolbar, no side panels, no basemap picker.

### Current Implementation

- `apps/web/src/lib/components/map/ShareDialog.svelte:51-54` — Generates `<iframe src="${embedUrl}" width="800" height="600" frameborder="0" allowfullscreen></iframe>`. Hardcoded dimensions, no responsive option.
- `apps/web/src/lib/screens/ShareViewerScreen.svelte:27-34` — `copyEmbedCode()` generates different snippet: `width="100%" height="500"` with a `title` attribute. Two different embed snippets exist in the codebase.
- `apps/web/src/routes/(public)/embed/[token]/+page.server.ts:1-43` — Resolves token, fetches map (id, title, viewport, basemap) + layers. Sets `Content-Security-Policy: "frame-ancestors *"` header to allow embedding anywhere.
- `apps/web/src/routes/(public)/embed/[token]/+page.svelte:1-30` — Passes `embed={true}` to MapEditor. Displays error state if token invalid.
- `apps/web/src/lib/components/map/MapEditor.svelte:62-68` — `embed` prop documented: "renders only the map canvas and legend — no toolbar, no layer panel, no basemap picker, no side panels. Implies readonly."
- `apps/web/src/lib/components/map/MapEditor.svelte:86-87` — `effectiveReadonly = readonly || embed`.
- `apps/web/src/lib/components/map/MapEditor.svelte:368-369` — `{#if !embed}` hides top toolbar.
- `apps/web/src/lib/components/map/MapEditor.svelte:556-557` — `{#if !embed}` hides map overlay controls.
- `apps/web/src/lib/components/map/MapEditor.svelte:701-702` — `{#if !designMode && !embed}` hides SidePanel.

### Reference Patterns

- **svelte-maplibre:** `cooperative_gestures/+page.svelte` — Uses `cooperativeGestures` prop on `<MapLibre>` to prevent scroll-hijacking when embedded. Configurable locale strings for the gesture overlay ("Use Ctrl + scroll to zoom"). FLI's embed has no cooperative gesture handling — an embedded map will capture scroll events and prevent page scrolling.
- **Allmaps:** Viewer is `ssr: false, prerender: true` — designed as a static client-side app that can be loaded in an iframe. Its minimal layout (`+layout.svelte` is just CSS imports + `<slot />`) keeps the embed footprint small. FLI's embed loads the full MapEditor component tree even though most of it is `{#if !embed}` hidden — the JS bundle includes all the dead code.

### Findings

| Category | Finding | Recommendation |
|----------|---------|----------------|
| gap | No cooperative gestures — embedded map captures scroll events, making it hard to scroll past the iframe on mobile. | Add MapLibre's `cooperativeGestures` option when `embed={true}` (pattern from svelte-maplibre). |
| debt | Two different embed snippets: ShareDialog uses `width="800" height="600"`, ShareViewerScreen uses `width="100%" height="500"`. Inconsistent. | Consolidate to a single `generateEmbedSnippet()` utility with responsive defaults. |
| debt | Embed loads full MapEditor JS bundle including toolbar, side panels, annotation panel, drawing tools, undo store — all gated behind `{#if !embed}` but still shipped to the browser. | Consider code-splitting or a dedicated `EmbedMapCanvas` component that only imports MapCanvas + Legend. |
| gap | `frame-ancestors *` CSP is maximally permissive. No way for map owner to restrict which domains can embed their map. | Add optional allowed-origins list to share settings; generate domain-scoped CSP. |
| missing | No embed analytics — owner has no visibility into how many times their embed is loaded or from which domains. | Add a lightweight server-side embed-view counter (per token, with referer). |
| gap | No `sandbox` attribute in the generated iframe snippet. Best practice for third-party embeds. | Add `sandbox="allow-scripts allow-same-origin"` to the generated snippet. |

---

## Flow 15: Commenting

**Trigger:** Authenticated user or guest writes comment on a map. Comments appear in panel. Owner can resolve.
**Outcome:** Comment persists in DB, appears in chronological list, owner can toggle resolved state.

### Current Implementation

- **Authenticated comments** (via MapEditor's AnnotationPanel):
  - `apps/web/src/lib/server/trpc/routers/comments.ts:25-62` — `list` (protectedProcedure): returns comments for a map, requires `viewer` access. Supports cursor-based pagination when `limit` is provided, otherwise flat array (backward-compatible).
  - `apps/web/src/lib/server/trpc/routers/comments.ts:69-94` — `create` (protectedProcedure): requires `commenter` access. Denormalizes `authorName` from session.
  - `apps/web/src/lib/server/trpc/routers/comments.ts:96-110` — `delete` (protectedProcedure): only comment author can delete (WHERE matches `userId`). Returns NOT_FOUND for non-authors — does not distinguish "not your comment" from "doesn't exist".
  - `apps/web/src/lib/server/trpc/routers/comments.ts:115-140` — `resolve` (protectedProcedure): toggles `resolved` boolean. Only map owner can resolve (enforced by `requireMapOwnership`).

- **Guest comments** (via share page):
  - `apps/web/src/lib/components/map/GuestCommentPanel.svelte:2-62` — Self-contained panel. Calls `trpc.comments.listForShare` and `trpc.comments.createForShare`. Requires `authorName` + `body` inputs.
  - `apps/web/src/lib/server/trpc/routers/comments.ts:9-10` — Rate limiter: 10 guest comments per share token per minute.
  - `apps/web/src/lib/server/trpc/routers/comments.ts:148-200` — `listForShare` (publicProcedure): validates share token, returns comments for the shared map. Same pagination pattern as `list`.
  - `apps/web/src/lib/server/trpc/routers/comments.ts:200+` — `createForShare` (publicProcedure): validates share token, rate-limits by token, inserts with `userId: null` and guest `authorName`.

- **Integration**:
  - `apps/web/src/lib/components/map/MapEditor.svelte:163` — Tracks `commentCount` state.
  - `apps/web/src/lib/components/map/MapEditor.svelte:640` — AnnotationPanel `oncountchange` updates annotation + comment counts for SidePanel badge.
  - `apps/web/src/lib/screens/ShareViewerScreen.svelte:19,68-80` — Toggle button for `showComments`, renders `GuestCommentPanel` in a side drawer when active.

### Reference Patterns

- **Allmaps:** `apps/editor/src/lib/shared/ui-events.ts` — Uses a typed `EventTarget` subclass with custom event types (`CLICKED_ITEM`, `ZOOM_TO_EXTENT`, `FIT_BBOX`, `SET_CENTER`) for decoupled communication between editor components. This is more architecturally clean than FLI's direct tRPC calls from UI components. `maps-events.ts` defines operation-level events (`InsertMap`, `RemoveMap`, `ReplaceGcps`, etc.) that flow through ShareDB. There is no commenting system in Allmaps — it's a georeferencing tool, not a collaboration platform.
- **Allmaps:** No commenting or feedback mechanism found in the editor or viewer. The `ShareDB` integration is purely for real-time map georeferencing edits, not user-generated text content.

### Findings

| Category | Finding | Recommendation |
|----------|---------|----------------|
| gap | Guest comments have no spam protection beyond rate limiting (10/min/token). No CAPTCHA, no honeypot, no content filtering. | Add honeypot field + basic content-length check; consider turnstile CAPTCHA for public-facing forms. |
| gap | Guest `authorName` is free-text with no verification. Anyone can impersonate any name. No indication to readers that guest comments are unverified. | Display a "Guest" badge on guest comments (userId === null) to distinguish from authenticated users. |
| debt | `delete` returns NOT_FOUND for non-authors, conflating "not your comment" with "doesn't exist." This makes client-side error handling ambiguous. | Return FORBIDDEN when the comment exists but isn't owned by the caller. |
| missing | No real-time comment updates. Both authenticated and guest comment panels require manual refresh or re-fetch to see new comments from other users. | Add tRPC subscription or polling interval for live comment updates (Allmaps uses EventTarget pattern for decoupled reactivity). |
| gap | Guest comments on shared maps cannot be resolved or deleted by anyone via the GuestCommentPanel UI — owner must open the map in the editor to moderate. | Add owner moderation controls to the share viewer, or notify the owner of new guest comments. |
| debt | Comments use two completely separate code paths: `list`/`create` (authenticated, protectedProcedure) vs `listForShare`/`createForShare` (guest, publicProcedure). The pagination logic is duplicated across both. | Extract shared pagination helper; consider unifying into a single procedure with optional auth context. |
| gap | No comment editing. Once posted, a comment's body cannot be changed — only deleted or resolved. | Add `update` mutation gated to comment author within a time window. |

---

## Flow 16: Collaboration

**Trigger:** Owner invites user by email with role from ShareDialog's collaborator section.
**Outcome:** Collaborator sees map in dashboard "Shared with Me" tab, opens it with appropriate role permissions.

### Current Implementation

- **Invitation**:
  - `apps/web/src/lib/components/map/ShareDialog.svelte:57-65` — Collaborator state: list, loading, error, invite email/role. Roles: `viewer`, `commenter`, `editor`.
  - `apps/web/src/lib/components/map/ShareDialog.svelte:144-160` — `handleInvite()`: calls `trpc.collaborators.invite` with mapId, email, role.
  - `apps/web/src/lib/server/trpc/routers/collaborators.ts:45-107` — `invite` mutation: requires map ownership, looks up user by email, checks not self-invite, checks not duplicate, inserts `mapCollaborators` row, audit-logged.
  - `apps/web/src/lib/server/trpc/routers/collaborators.ts:61-63` — If email not registered, throws NOT_FOUND ("No account found with that email.") — cannot invite unregistered users.

- **Role management**:
  - `apps/web/src/lib/server/trpc/routers/collaborators.ts:109-135` — `remove`: owner-only, deletes collaborator row.
  - `apps/web/src/lib/server/trpc/routers/collaborators.ts:140-177` — `updateRole`: owner-only, updates role. Audit-logged.
  - `apps/web/src/lib/server/geo/access.ts:1-82` — `requireMapAccess(userId, mapId, minRole)`: owner always passes; collaborator checked against `ROLE_LEVEL = { viewer: 0, commenter: 1, editor: 2 }`. Non-collaborators get NOT_FOUND (map existence hidden).

- **Dashboard**:
  - `apps/web/src/routes/(app)/dashboard/+page.server.ts:72-88` — Queries `mapCollaborators` joined with `maps` for user's shared maps. Returns `sharedMaps` with `role` field.
  - `apps/web/src/lib/contracts/dashboard.ts:6` — `DashboardData.collaboratingMaps: MapRecord[]` — but the server returns `role` and the contract uses `MapRecord` which may not include it.
  - `apps/web/src/lib/screens/DashboardScreen.svelte` (shared tab) — Renders "Shared with Me" section with grid cards showing a generic "Shared" badge. Only a "View" button (Eye icon) is shown — no indication of the user's actual role.
  - `apps/web/src/lib/components/map/MapEditor.svelte:69-72` — `isOwner` and `userRole` props. `userRole` is "shown as a badge for non-owners to clarify permissions."

- **BUG**: `apps/web/src/lib/screens/DashboardScreen.svelte:26-34` — `handleCreate` calls itself recursively: `async function handleCreate(title) { ... await handleCreate(title); ... }`. This is an infinite recursion bug (guarded only by the `creatingMap` flag which prevents re-entry, but the first call will recurse once before the flag is checked on the second call's `await`). It should call `actions.onCreate(title)`.

### Reference Patterns

- **Allmaps:** `apps/editor/src/lib/shared/organizations.ts` — Organizations are hardcoded configuration objects (title, baseUrls, allowCallback) — not a dynamic user-invitation system. Organizations define which IIIF servers the editor trusts for callbacks. This is a fundamentally different model: Allmaps uses institutional trust boundaries while FLI uses per-map user invitations.
- **Allmaps:** `sharedb.d.ts` (600+ lines) — Full ShareDB typings for real-time OT-based collaborative editing. Supports `Connection`, `Doc`, `Query`, middleware hooks, and projections. This is real-time co-editing infrastructure — multiple users simultaneously editing the same document with operational transforms. FLI's collaboration model is role-based access control without real-time presence or co-editing.
- **Allmaps:** `apps/editor/src/lib/shared/router.ts` — Simple view-based routing (`goto` with `replaceState: false, keepFocus: true`). Navigation state is URL-driven, not stored in a global store.

### Findings

| Category | Finding | Recommendation |
|----------|---------|----------------|
| **debt/bug** | `DashboardScreen.handleCreate` (line 26-34) recursively calls itself instead of `actions.onCreate(title)`. This causes infinite recursion on first map creation attempt from the dashboard. | Fix: replace `await handleCreate(title)` with `await actions.onCreate(title)`. |
| gap | Cannot invite unregistered users. `collaborators.invite` throws NOT_FOUND if email not in `users` table. No invitation-by-link or email-invitation flow for new users. | Add pending invitation table + email notification; resolve on signup. |
| gap | Dashboard "Shared with Me" shows generic "Shared" badge for all collaborators. The `role` field is returned by the server but the `DashboardData.collaboratingMaps` contract types it as `MapRecord[]` which likely drops the role info. User cannot see their role until they open the map. | Extend `MapRecord` or create `CollaboratingMapRecord` with `role`; display role badge (viewer/commenter/editor) on shared map cards. |
| missing | No email notification when invited as collaborator. User must discover shared maps by visiting the dashboard. | Add email notification on `collaborator.invite` (audit log exists but no notification). |
| missing | No real-time collaboration. Allmaps uses ShareDB for OT-based co-editing. FLI has role-based access but no presence indicators, no conflict resolution, no live cursors. | For v1, add presence indicators (who's viewing). Full OT co-editing is a major architecture change. |
| gap | No "accept/decline" flow for invitations. Collaborator is immediately added; they cannot opt out. | Add invitation state (`pending`/`accepted`/`declined`) to `mapCollaborators`. |
| debt | `requireMapAccess` casts `collab.role as CollabRole` with a `TYPE_DEBT` comment (line 71-73). The Drizzle enum inference issue means an invalid role value in DB would silently grant level -1 (denied), which is safe but should be an explicit error. | Fix Drizzle schema typing or add runtime validation with explicit error for unknown roles. |
| gap | Collaborator cannot leave a shared map voluntarily — only the owner can remove them. | Add `collaborators.leave` mutation (self-removal). |
| debt | Server returns `sharedMaps` but the `+page.svelte` maps it to `collaboratingMaps` field in `DashboardData`. The field name mismatch requires tracing through the page component to understand the data flow. | Align naming: use `collaboratingMaps` consistently or `sharedMaps` consistently. |

---

## Cross-Flow Summary

### Critical Bugs
1. **DashboardScreen.handleCreate infinite recursion** (Flow 16) — prevents map creation from dashboard.

### Top Architecture Gaps (compared to references)
1. **No URL-encoded viewport state in share/embed links** — svelte-maplibre's hash pattern is the standard approach.
2. **No cooperative gestures for embeds** — svelte-maplibre demonstrates the pattern; essential for iframe usability.
3. **Full MapEditor loaded for read-only/embed views** — Allmaps viewer's decomposed store architecture shows how to build a minimal viewer.
4. **No real-time features** — Allmaps uses ShareDB for live co-editing; FLI has no presence, live cursors, or real-time comment updates.
5. **No invite flow for unregistered users** — collaboration requires pre-existing accounts.

### Debt Hotspots
1. **Duplicated token resolution** — share server load vs tRPC `shares.resolve`.
2. **Duplicated comment pagination** — `list` vs `listForShare`.
3. **Two different embed snippets** — ShareDialog vs ShareViewerScreen.
4. **TYPE_DEBT in access.ts** — Drizzle role enum inference.
