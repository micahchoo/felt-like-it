# Collaboration Subsystem — Behavior (L8)

> End-to-end traces of the three primary collaboration flows.

## Flow 1: Create Share Link -> Guest Views Map

### Trigger
Map owner clicks "Share" button in MapEditor toolbar (line ~476).

### Trace

```
1. MapEditor.svelte: onclick -> dialogs.showShareDialog = true
2. ShareDialog.svelte: $effect fires on open
   a. loadShare() -> trpc.shares.getForMap.query({ mapId })
      - protectedProcedure -> requireMapOwnership(userId, mapId)
      - Returns existing share or null
   b. loadCollaborators() -> trpc.collaborators.list.query({ mapId })
      - protectedProcedure -> requireMapOwnership(userId, mapId)
3. Owner clicks "Enable" (no existing share)
   a. createShare() -> trpc.shares.create.mutate({ mapId, accessLevel: 'public' })
      - requireMapOwnership check
      - generateToken() -> randomBytes(16).toString('base64url')
      - INSERT into shares table
      - appendAuditLog({ action: 'share.create' })
      - Returns share record with token
   b. ShareDialog displays:
      - Share URL: {origin}/share/{token}
      - Embed URL: {origin}/embed/{token}
      - Embed iframe snippet
      - Copy buttons for each
4. Owner copies share URL, sends to guest
```

### Guest Access

```
5. Guest navigates to /share/{token}
6. routes/(public)/share/[token]/+page.server.ts:
   a. DB lookup: shares WHERE token = param
   b. If not found: return { error: 'not_found' }
   c. If found: lookup map by share.mapId, lookup layers
   d. Return { map, layers, share: { token, accessLevel } }
7. +page.svelte renders:
   a. Error case: "Link Not Found" static page
   b. Success: <ShareViewerScreen data={viewerData} actions={actions} status="success" />
8. ShareViewerScreen:
   a. onMount: mapStore.loadViewport(), mapStore.setBasemap()
   b. Renders MapEditor with readonly=true (no drawing tools, no import/export)
   c. Overlay buttons: Comments toggle, Embed copy
   d. GuestCommentPanel (conditional on showComments toggle)
```

### Key Properties
- No session cookie needed for the share route (in `(public)` layout group)
- MapEditor in readonly mode skips annotation queries (`enabled: !!userId`)
- Share tokens do not expire
- One share per map (upsert model)

## Flow 2: Guest Posts Comment

### Trigger
Guest clicks "Comments" overlay button on ShareViewerScreen.

### Trace

```
1. ShareViewerScreen: showComments = true -> GuestCommentPanel renders
2. GuestCommentPanel: $effect fires on mount
   a. loadComments() -> trpc.comments.listForShare.query({ shareToken })
      - publicProcedure (no auth)
      - Validates share token: SELECT mapId FROM shares WHERE token = shareToken
      - If invalid: throws TRPCError NOT_FOUND
      - If valid: SELECT * FROM comments WHERE mapId = share.mapId ORDER BY createdAt ASC
      - Returns flat array (no limit param -> backward-compatible mode)
3. Panel renders comment list (or "No comments yet")
4. Guest fills in author name + body, clicks "Post"
5. handleSubmit():
   a. Client-side validation: body.trim() and authorName.trim() must be non-empty
   b. trpc.comments.createForShare.mutate({ shareToken, authorName, body })
      - publicProcedure (no auth)
      - Zod validation: shareToken 1-255, authorName 1-100 trimmed, body 1-5000 trimmed
      - Validates share token (same pattern)
      - INSERT into comments: userId=null, authorName from input, body from input
      - Returns comment record
   c. On success: clear body, toast "Comment posted", reload comment list
   d. On error: set error state "Failed to post comment"
```

### Trust Boundary Analysis
- **No rate limiting** on guest comment creation (publicProcedure, no middleware)
- **No CAPTCHA or proof-of-work** before posting
- **Author name is unverified** — any string 1-100 chars
- **No edit/delete for guests** — once posted, only the map owner can toggle resolved
- **Guest comments are indistinguishable by token** — all guests sharing a link see all comments and can post as any name

## Flow 3: Owner Manages Collaborators

### Trigger
Map owner opens ShareDialog (same as Flow 1).

### Invite Trace

```
1. ShareDialog: collaborators section loads on open
   a. loadCollaborators() -> trpc.collaborators.list.query({ mapId })
      - protectedProcedure -> requireMapOwnership
      - INNER JOIN map_collaborators with users -> returns { id, mapId, userId, role, invitedBy, createdAt, email, name }
2. Owner fills email + selects role (viewer/commenter/editor) + clicks "Invite"
3. handleInvite():
   a. trpc.collaborators.invite.mutate({ mapId, email, role })
      - requireMapOwnership
      - Lookup user by email -> NOT_FOUND if unregistered
      - Self-invite check -> BAD_REQUEST
      - Duplicate check -> CONFLICT
      - INSERT into map_collaborators
      - appendAuditLog({ action: 'collaborator.invite' })
   b. On success: clear email, reload collaborators, toast "Collaborator added"
```

### Role Change Trace

```
4. Owner selects new role in dropdown next to collaborator name
5. handleRoleChange(collabUserId, newRole):
   a. trpc.collaborators.updateRole.mutate({ mapId, userId, role })
      - requireMapOwnership
      - UPDATE map_collaborators SET role = newRole
      - appendAuditLog({ action: 'collaborator.updateRole' })
   b. Optimistic local update: collaborators array mapped to new role
   c. Toast "Role updated"
```

### Remove Trace

```
6. Owner clicks remove (x) on collaborator
7. handleRemove(collabUserId):
   a. window.confirm() guard with collaborator name
   b. trpc.collaborators.remove.mutate({ mapId, userId })
      - requireMapOwnership
      - DELETE FROM map_collaborators WHERE mapId AND userId
   c. Optimistic local filter: remove from collaborators array
   d. Toast "Collaborator removed"
```

### Permission Enforcement for Collaborators

Once invited, collaborators access maps through the authenticated path (not share links):

```
Collaborator navigates to /maps/{mapId}:
  -> MapEditor loads
  -> All tRPC calls use requireMapAccess(userId, mapId, minRole)
  -> Role hierarchy: viewer(0) < commenter(1) < editor(2)
  -> Owner always bypasses role checks
  -> Insufficient role: FORBIDDEN
  -> No collaborator record: NOT_FOUND (hides map existence)
```

| Role      | Can view map | Can comment | Can edit features | Can manage sharing |
|-----------|-------------|-------------|-------------------|--------------------|
| viewer    | Yes         | No          | No                | No                 |
| commenter | Yes         | Yes         | No                | No                 |
| editor    | Yes         | Yes         | Yes               | No                 |
| owner     | Yes         | Yes         | Yes               | Yes                |

## Embed Flow (Variant of Flow 1)

```
Guest navigates to /embed/{token}:
  1. +page.server.ts: same token resolution as share route
     - Additionally sets: Content-Security-Policy: frame-ancestors *
  2. +page.svelte: renders EmbedScreen (not ShareViewerScreen)
  3. EmbedScreen: MapEditor with embed=true
     - No comment panel
     - No share overlay buttons
     - Minimal chrome for iframe embedding
  4. shareToken passed as empty string '' (comments not available)
```

## Sequence Diagram: Share + Guest Comment

```
Owner                    Server                  Guest
  |                        |                       |
  |-- shares.create ------>|                       |
  |<-- { token } ---------|                       |
  |                        |                       |
  |  (sends URL to guest)  |                       |
  |                        |                       |
  |                        |<-- GET /share/{token} |
  |                        |--- { map, layers } -->|
  |                        |                       |
  |                        |<-- listForShare -------|
  |                        |--- comments[] -------->|
  |                        |                       |
  |                        |<-- createForShare -----|
  |                        |    { name, body }      |
  |                        |--- comment record ---->|
  |                        |                       |
```
