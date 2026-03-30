# Collaboration Subsystem — Components (L5)

> Where collaboration UI lives after the `components/collaboration/` removal.

## Status

The `apps/web/src/lib/components/collaboration/` directory was **removed** — it contained dead stubs
(ActivityFeed 55 LOC, ShareDialog 55 LOC) that were never imported anywhere.
All live collaboration UI now lives in `components/map/` and `screens/`.

## Component Inventory

### ShareDialog

- **Path:** `apps/web/src/lib/components/map/ShareDialog.svelte`
- **Mounted by:** `MapEditor.svelte` (line ~729), always rendered, visibility controlled by `bind:open={dialogs.showShareDialog}`
- **Props:** `mapId`, `open` (bindable), `onclose`, `isOwner?`, `userId?`
- **Sections:**
  1. **Collaborators** — lists current collaborators (joined with user details), invite form (owner-only), role dropdown per collaborator, remove button
  2. **Public Access** — create/delete share link, copy share URL, copy embed `<iframe>` snippet
- **tRPC calls:** `shares.getForMap`, `shares.create`, `shares.delete`, `collaborators.list`, `collaborators.invite`, `collaborators.remove`, `collaborators.updateRole`
- **State management:** local `$state` for share record, collaborators array, loading/error/inviting flags. No external store.

### GuestCommentPanel

- **Path:** `apps/web/src/lib/components/map/GuestCommentPanel.svelte`
- **Mounted by:** `ShareViewerScreen.svelte` — toggled via `showComments` state on the share viewer page
- **Props:** `shareToken: string`
- **Sections:**
  1. **Comment list** — chronological, with relative timestamps, resolved comments dimmed
  2. **New comment form** — author name input + body textarea + Post button
- **tRPC calls:** `comments.listForShare`, `comments.createForShare` (both `publicProcedure` — no auth)
- **Guest trust model:** No authentication. Author name is free-text from the caller. `userId` stored as `null`.

### ShareViewerScreen

- **Path:** `apps/web/src/lib/screens/ShareViewerScreen.svelte`
- **Mounted by:** `routes/(public)/share/[token]/+page.svelte`
- **Contract:** `ShareViewerData` from `$lib/contracts/share-viewer.ts`
- **Renders:** `MapEditor` (readonly=true) + overlay buttons (Comments toggle, Embed copy) + `GuestCommentPanel` (conditional)
- **Flow:** Page server load resolves token -> returns map/layers/share -> screen renders readonly map with guest comment panel

### EmbedScreen

- **Path:** `apps/web/src/lib/screens/EmbedScreen.svelte`
- **Mounted by:** `routes/(public)/embed/[token]/+page.svelte`
- **Renders:** `MapEditor` with `embed=true` — no comment panel, no share overlay buttons
- **Headers:** Sets `Content-Security-Policy: frame-ancestors *` to allow iframe embedding anywhere

### Dialog Visibility Composable

- **Path:** `apps/web/src/lib/components/map/useDialogVisibility.svelte.ts`
- **Manages:** `showImportDialog`, `showExportDialog`, `showShareDialog` as reactive `$state` booleans
- **Used by:** `MapEditor.svelte` (line ~140: `const dialogs = useDialogVisibility()`)

## Activity Feed

- **No UI component exists.** The old `ActivityFeed` stub was removed.
- **Backend exists:** `eventsRouter` (tRPC) with `list` and `log` procedures, backed by the `map_events` DB table.
- **Schema:** `mapEvents` table — `id`, `mapId`, `userId`, `action` (dot-namespaced string like `layer.imported`), `metadata` (JSONB), `createdAt`.
- **Current usage:** Events are logged client-side after successful tRPC mutations in MapEditor. No UI reads them — they are write-only from the frontend perspective. The `events.list` endpoint exists and is functional but has no consumer.

## Component Dependency Graph

```
MapEditor.svelte
  +-- useDialogVisibility.svelte.ts  (showShareDialog state)
  +-- ShareDialog.svelte             (owner: manage link + collaborators)

routes/(public)/share/[token]/+page.svelte
  +-- ShareViewerScreen.svelte       (readonly map + guest features)
       +-- MapEditor (readonly=true)
       +-- GuestCommentPanel.svelte   (guest comments via share token)

routes/(public)/embed/[token]/+page.svelte
  +-- EmbedScreen.svelte             (minimal readonly map, no comments)
       +-- MapEditor (embed=true)
```
