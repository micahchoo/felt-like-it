# Annotation + Collaboration — Behavior (Zoom Level 8)

> How the subsystem behaves at runtime. Traces seven flows end-to-end.
> Cross-ref: [components.md](./components.md) for static structure.

---

## 1. Create Annotation Flow

```
User clicks map / selects anchor type in AnnotationPanel form
  -> AnnotationPanel.handleCreate()                              :AnnotationPanel.svelte ~L370
    |-- If image: upload file first (presigned URL flow)
    |-- If measurement: use pendingMeasurementData (pre-filled from MeasurePanel)
    |-- Build content object via buildContent()
    |-- Build anchor:
    |   |-- viewport -> { type: 'viewport' }
    |   |-- region   -> { type: 'region', geometry: regionGeometry }  (from Terra Draw polygon)
    |   |-- feature  -> { type: 'feature', featureId, layerId, geometry }
    |   +-- point    -> { type: 'point', geometry: { type: 'Point', coordinates: [lng, lat] } }
    +-- createAnnotationMutation.mutateAsync({ mapId, anchor, content: { kind: 'single', body } })
         -> tRPC annotations.create                              :routers/annotations.ts
           -> annotationService.create()                         :annotations/service.ts:65
             |-- requireMapAccess(userId, mapId, 'commenter')    :geo/access.ts:39
             |-- COUNT check: MAX_ANNOTATIONS_PER_MAP = 10,000
             |-- If parentId: validate parent is root (depth=1 max), compute ordinal
             |-- INSERT INTO annotation_objects
             |-- Changelog: buildAddPatch -> insertChangelog      :annotations/changelog.ts
             +-- RETURN rowToObject(row)
  -> onSuccess: invalidateQueries(annotations.list)
  -> onannotationsaved('created') -> parent MapEditor refreshes pins
```

**Terra Draw integration:** Region anchors enter via `interactionModes` state machine. MapEditor transitions to `drawRegion` state (`interaction-modes.svelte.ts`), which activates Terra Draw polygon mode. On completion, the polygon geometry is passed back to AnnotationPanel via the `regionGeometry` prop. No direct Terra Draw dependency in the annotation subsystem itself.

**Cache invalidation:** Pessimistic. `onSuccess` calls `queryClient.invalidateQueries` on `queryKeys.annotations.list({ mapId })`. MapEditor shares the same query key for its `annotationPinsQuery`, so both the list and map pins refresh together.

**No optimistic UI.** All mutations await the server response before updating the cache.

---

## 2. Edit Annotation Flow

```
User selects annotation -> inline edit (content or anchor change)
  -> updateAnnotationMutation.mutateAsync({ id, content?, anchor?, version })
    -> tRPC annotations.update                                   :routers/annotations.ts
      -> annotationService.update()                              :annotations/service.ts ~L210
        |-- Fetch current row (SELECT ... WHERE id = ?)
        |-- Authorship check: current.author_id !== userId -> FORBIDDEN
        |-- requireMapAccess(userId, mapId, 'commenter')
        |-- Version check: current.version !== params.version -> CONFLICT
        |-- Build SET clauses (version+1, content?, anchor?)
        |-- UPDATE ... WHERE id AND version (compare-and-swap)
        |   +-- If 0 rows -> CONFLICT ("modified concurrently")
        |-- Changelog: buildModPatch(new, old) -> insertChangelog
        +-- RETURN updated object
  -> onSuccess: invalidateQueries(annotations.list)
```

**Concurrency model:** Optimistic concurrency via version column. Client must send the current `version` number. Server does a compare-and-swap UPDATE. If another user edited between the read and write, the version won't match and the server returns `CONFLICT`. The client must refetch and retry.

**Server-first, not optimistic UI.** The UI waits for the server to confirm the edit before updating the cache. No rollback logic exists.

---

## 3. Comment on Annotation Flow

Comments are a **separate domain** from annotations. They share the same panel UI but use different tables, routers, and query keys.

### Authenticated path

```
User types in comment input (bottom of AnnotationPanel)
  -> handleCommentSubmit()                                       :AnnotationPanel.svelte
    -> tRPC comments.create({ mapId, body })                     :routers/comments.ts:30
      |-- requireMapAccess(userId, mapId, 'commenter')
      |-- INSERT INTO comments (mapId, userId, authorName: ctx.user.name, body)
      +-- RETURN comment
  -> invalidateQueries(comments.list)
```

### Guest path (share page)

```
Guest enters name + body in GuestCommentPanel                   :map/GuestCommentPanel.svelte
  -> handleSubmit()
    -> tRPC comments.createForShare({ shareToken, authorName, body })  :routers/comments.ts:137
      |-- Resolve shareToken -> mapId (public procedure, no auth)
      |-- INSERT INTO comments (mapId, userId: null, authorName, body)
      +-- RETURN comment
  -> loadComments() re-fetches via comments.listForShare
```

**Key differences:**

| Aspect | Authenticated | Guest |
|--------|--------------|-------|
| tRPC procedure | `protectedProcedure` | `publicProcedure` |
| Auth | Lucia session -> `ctx.user` | Share token validation |
| userId stored | `ctx.user.id` | `null` |
| authorName source | `ctx.user.name` (denormalized) | User-provided input field |
| Delete own | Yes (WHERE userId match) | No (userId is null) |
| Resolve toggle | Map owner only | Not available |

**Comment resolution:** Only the map owner can toggle `resolved` via `comments.resolve`, which checks `requireMapOwnership`. This is a moderation action, not available to collaborators.

---

## 4. Share Map Flow

```
Owner clicks Share button in MapEditor toolbar
  -> showShareDialog = true                                      :MapEditor.svelte:152
  -> ShareDialog opens (Modal)                                   :map/ShareDialog.svelte
    -> $effect: loadShare() -> tRPC shares.getForMap({ mapId })  (owner-only, returns existing share or null)
    -> $effect: loadCollaborators() -> tRPC collaborators.list   (owner-only)

Owner clicks "Create Share Link":
  -> handleCreate()
    -> tRPC shares.create({ mapId, accessLevel })                :routers/shares.ts:17
      |-- requireMapOwnership(userId, mapId)
      |-- Check existing: SELECT FROM shares WHERE mapId
      |   |-- EXISTS -> UPDATE accessLevel only (reuse token)
      |   +-- NOT EXISTS -> INSERT with generateToken()
      |       +-- generateToken(): randomBytes(16).toString('base64url')  :shares.ts:11
      |-- appendAuditLog('share.create' or 'share.update')
      +-- RETURN share record (includes token)

UI displays:
  |-- Share URL:  ${origin}/share/${token}
  |-- Embed URL:  ${origin}/embed/${token}
  +-- Embed HTML: <iframe src="${embedUrl}" ...>
  -> Copy buttons use navigator.clipboard.writeText()

Owner clicks "Revoke":
  -> handleDelete()
    -> tRPC shares.delete({ mapId })                             :routers/shares.ts:82
      |-- requireMapOwnership
      |-- appendAuditLog('share.delete')
      +-- DELETE FROM shares WHERE mapId
```

**Access levels:** `public` or `unlisted`. Both expose the same functionality. The distinction is semantic (discoverability intent) -- neither is enforced differently at the application layer. Comments are always available regardless of access level.

**Token design:** 16 random bytes, base64url-encoded. One share per map (upsert pattern). No expiry mechanism exists.

---

## 5. Guest Access Flow

```
Guest navigates to /share/[token]
  -> +page.server.ts                                             :routes/(public)/share/[token]/+page.server.ts
    |-- SELECT share WHERE token = ?
    |-- SELECT map WHERE id = share.mapId
    |-- SELECT layers WHERE mapId ORDER BY zIndex
    +-- Return { map: { id, title, viewport, basemap }, layers, share: { token, accessLevel } }
       (or { error: 'not_found' })

  -> +page.svelte                                                :routes/(public)/share/[token]/+page.svelte
    |-- Constructs ShareViewerData { map, layers, shareToken }
    +-- Renders <ShareViewerScreen>

  -> ShareViewerScreen.svelte                                    :screens/ShareViewerScreen.svelte
    |-- mapStore.loadViewport(data.map.viewport)
    |-- mapStore.setBasemap(data.map.basemap)
    |-- <MapEditor mapId readonly={true} initialLayers={layers} />
    |-- Comments toggle button (top-right)
    |-- Embed code copy button
    +-- {#if showComments} <GuestCommentPanel shareToken={token} />
```

**What is blocked for guests:**
- No annotation creation/editing (AnnotationPanel's `annotationsQuery` is disabled when `!userId`)
- No annotation viewing (query is skipped for unauthenticated users)
- No feature editing/drawing (MapEditor is `readonly`)
- No share/collaborator management
- No activity feed

**What is allowed for guests:**
- View map + layers (read-only MapEditor)
- Post comments via GuestCommentPanel (name + body, no auth required)
- View existing comments via `comments.listForShare` (public procedure)
- Copy embed code

### Embed variant

```
Guest navigates to /embed/[token]
  -> Same server load as share (with CSP: frame-ancestors *)     :routes/(public)/embed/[token]/+page.server.ts
  -> EmbedScreen.svelte                                          :screens/EmbedScreen.svelte
    |-- <MapEditor mapId embed={true} initialLayers={layers} />
    +-- No comment panel, no embed button, minimal chrome
```

Embeds set `shareToken: ''` in ShareViewerData, so guest commenting is structurally impossible even if GuestCommentPanel were added.

---

## 6. Collaborator Invite Flow

```
Owner opens ShareDialog -> Collaborator Management section
  -> loadCollaborators() on mount                                :map/ShareDialog.svelte

Owner enters email + selects role:
  -> handleInvite()
    -> tRPC collaborators.invite({ mapId, email, role })         :routers/collaborators.ts ~L40
      |-- requireMapOwnership(userId, mapId)
      |-- Lookup invitee by email: SELECT FROM users WHERE email
      |   +-- NOT FOUND -> TRPCError('NOT_FOUND', 'No account found with that email.')
      |-- Self-invite guard: invitee.id === userId -> BAD_REQUEST
      |-- Duplicate guard: SELECT FROM map_collaborators WHERE mapId AND userId -> CONFLICT
      |-- INSERT INTO map_collaborators (mapId, userId, role, invitedBy)
      |-- appendAuditLog('collaborator.invite')
      +-- RETURN collaborator record

  -> Reload collaborators list
  -> toastStore.success('Invitation sent.')
```

**No email notification.** Despite the toast message saying "Invitation sent", there is no email or notification system. The collaborator must know the map URL or find it in their account. The "invitation" is purely a database record that grants access.

**Role update:**
```
Owner changes role dropdown -> handleRoleChange(userId, newRole)
  -> tRPC collaborators.updateRole({ mapId, userId, role })      :routers/collaborators.ts
    |-- requireMapOwnership
    |-- UPDATE map_collaborators SET role WHERE mapId AND userId
    +-- appendAuditLog('collaborator.updateRole')
```

**Remove:**
```
Owner clicks X -> handleRemove(userId)
  -> window.confirm() -> tRPC collaborators.remove({ mapId, userId })
    |-- requireMapOwnership
    |-- DELETE FROM map_collaborators WHERE mapId AND userId
    +-- appendAuditLog('collaborator.remove')
```

**Role hierarchy:** viewer(0) < commenter(1) < editor(2). Enforced by `requireMapAccess` in `geo/access.ts:5`. Owner always passes. Non-collaborators get NOT_FOUND (hides map existence).

---

## 7. Dead Code Flows

### ActivityFeed stub (`collaboration/ActivityFeed.svelte` -- 55 LOC)

Props-only component that receives `events: MapEvent[]` and renders them in a `SidePanel`. Displays action badges (create/update/delete with color variants), userId, and timestamps. **No tRPC calls -- purely presentational.** Would need a parent to call `events.list` and pass data down.

Compare with the **active** `map/ActivityFeed.svelte` (~230 LOC):
- Self-contained: calls `trpc.events.list.query({ mapId })` directly
- Has filter categories: all | imports | draws | annotations | collaborators
- localStorage-persisted filter selection
- `refreshTrigger` prop for pull-to-refresh pattern
- Last-visit tracking for "new" badges
- `oncountchange` callback for badge counts on parent

### ShareDialog stub (`collaboration/ShareDialog.svelte` -- 55 LOC)

Props-only component receiving `shareUrl`, `embedCode`, `accessLevel`, `ongeneratetoken`, `onaccesschange`. Renders in a `GlassPanel` with clipboard copy. **No tRPC -- delegates all mutations to parent callbacks.**

Compare with the **active** `map/ShareDialog.svelte` (~195 LOC):
- Self-contained Modal with full tRPC integration
- Manages share lifecycle: create, load, delete
- Collaborator CRUD (list, invite by email, role change, remove)
- Generates share URL, embed URL, and iframe snippet
- Uses `isOwner` prop to gate collaborator management section

### CommentPanel stub (`collaboration/CommentPanel.svelte` -- ~85 LOC)

Props-only component receiving `comments[]`, `oncreate`, `ondelete`, `onresolve`. Renders in a `SidePanel` with resolve toggle (owner-gated) and delete buttons. **No tRPC -- purely presentational.** This is superseded by:
- Authenticated comments: inline in AnnotationPanel
- Guest comments: GuestCommentPanel (self-contained tRPC)

### CollaboratorsPanel stub (`collaboration/CollaboratorsPanel.svelte`)

Props-only component receiving `collaborators[]`, `oninvite`, `onremove`. Role badge rendering. **No tRPC.** This functionality is now embedded in the active ShareDialog.

### Other dead paths

- **GuestCommentPanel in `collaboration/`** -- exists alongside the active `map/GuestCommentPanel.svelte`. The `collaboration/` version appears to be a near-identical copy. Only `map/` version is imported by ShareViewerScreen.
- **v1 `annotations` table** -- `schema.ts:224`. PostGIS Point-only anchor, no threading, no versioning, no templates. Table still exists in the schema definition and database but has **no active write paths**. No router references it. No migration to drop it exists.

---

## Cross-Cutting Observations

1. **All mutations are pessimistic.** No optimistic UI anywhere in the annotation-collab subsystem. Every mutation awaits server confirmation, then invalidates the relevant TanStack Query cache key.

2. **No real-time.** No WebSocket/SSE. ActivityFeed uses poll-on-trigger via `refreshTrigger` prop. Comments require manual refresh (guest) or query invalidation (authenticated).

3. **Changelog is write-only.** `annotation_changelog` table records add/mod/del patches with inverse operations, but there is no UI or API to replay/undo them. The inverse patches suggest an intended undo feature that was never built.

4. **Feature deletion orphan recovery.** When features are deleted, `flagOrphanedAnnotations` sets `anchor.featureDeleted = true` via JSONB update. AnnotationContent shows a "Feature deleted" banner with a "Convert to point" rescue button. `convertAnchorToPoint` replaces the anchor entirely.

5. **Author name denormalization.** Both annotations and comments store `authorName` at insert time, copied from the user record. This survives user deletion (userId is set null via FK cascade, but authorName persists). No mechanism to update if the user changes their name.

---

*Generated from source analysis. See [components.md](./components.md) for static structure.*
