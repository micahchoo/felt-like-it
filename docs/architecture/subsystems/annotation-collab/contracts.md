# Annotation + Collaboration — Contracts (Zoom Level 6)

> Interface boundaries between subsystems. What crosses each seam, what shapes it takes, what guarantees hold.
> Cross-ref: [components.md](./components.md) for static structure, [behavior.md](./behavior.md) for runtime flows.

---

## 1. Annotation <-> Map Editor Boundary

### How the map editor knows about annotations

MapEditor imports AnnotationPanel and shares a TanStack Query cache key:

```
MapEditor.svelte:88-91
  const annotationPinsQuery = createQuery(() => ({
    queryKey: queryKeys.annotations.list({ mapId }),
    queryFn: () => trpc.annotations.list.query({ mapId }),
  }));
```

Both MapEditor and AnnotationPanel read from the same `queryKeys.annotations.list({ mapId })` key. When AnnotationPanel mutates (create/delete), it invalidates this key, and MapEditor's derived GeoJSON re-derives automatically.

### How annotations render on the map

`annotation-geo.svelte.ts` provides pure derivation functions that transform `AnnotationObject[]` into GeoJSON FeatureCollections:

| Function | Input filter | Output geometry | Used for |
|----------|-------------|----------------|----------|
| `deriveAnnotationPins()` | `anchor.type === 'point'` + root only | Point | Map pin markers |
| `deriveAnnotationRegions()` | `anchor.type === 'region'` + root only | Polygon | Region overlays |
| `deriveAnnotatedFeaturesIndex()` | `anchor.type === 'feature'` | Map<featureId, {layerId, count}> | Feature badge counts |
| `deriveMeasurementData()` | `anchor.type === 'measurement'` | Varies (line/polygon) | Measurement overlays |

Factory: `createAnnotationGeoStore(getRows)` returns a reactive object with `.pins`, `.regions`, `.index`, `.measurements` getters.

### Event flow: annotation panel <-> map canvas

The boundary is **props + callbacks**, not events:

```
MapEditor -> AnnotationPanel (props):
  mapId: string
  userId?: string                        -- gates edit/delete buttons
  regionGeometry?: Polygon               -- result of Terra Draw region draw
  pickedFeature?: { featureId, layerId } -- result of feature pick mode
  pendingMeasurement?: { content, anchor } -- from MeasurePanel
  scrollToFeatureId?: string             -- scroll-to on feature click
  embedded?: boolean                     -- hides UI elements in embed mode

AnnotationPanel -> MapEditor (callbacks):
  onannotationsaved: ('created'|'deleted') => void  -- triggers pin refresh
  onrequestregion: () => void            -- enter drawRegion interaction mode
  onrequestfeaturepick: () => void       -- enter pickFeature interaction mode
  oncountchange: (annotations, comments) => void  -- badge count updates
```

The `interactionModes` store (`interaction-modes.svelte.ts`) mediates state transitions:
- `idle` -> `drawRegion`: AnnotationPanel calls `onrequestregion`, MapEditor calls `transitionTo({ type: 'drawRegion' })`
- `idle` -> `pickFeature`: AnnotationPanel calls `onrequestfeaturepick`, MapEditor calls `transitionTo({ type: 'pickFeature' })`
- On completion: MapEditor sets `regionGeometry` or `pickedFeature` prop, transitions back to `idle`

**Threading replies** do not cross the boundary. AnnotationThread fetches its own data via `trpc.annotations.getThread`.

---

## 2. Comment <-> tRPC Boundary

### Authenticated routes (`commentsRouter`)

| Route | Procedure | Input | Output | Access |
|-------|-----------|-------|--------|--------|
| `comments.list` | `protectedProcedure` | `{ mapId: uuid }` | `Comment[]` (chronological ASC) | viewer+ |
| `comments.create` | `protectedProcedure` | `{ mapId: uuid, body: string[1..5000] }` | `Comment` | commenter+ |
| `comments.delete` | `protectedProcedure` | `{ id: uuid }` | `{ deleted: true }` | Author only (WHERE userId match) |
| `comments.resolve` | `protectedProcedure` | `{ id: uuid }` | `Comment` (toggled) | Map owner only |

### Guest routes (public)

| Route | Procedure | Input | Output | Access |
|-------|-----------|-------|--------|--------|
| `comments.listForShare` | `publicProcedure` | `{ shareToken: string[1..255] }` | `Comment[]` (chronological ASC) | Token validation only |
| `comments.createForShare` | `publicProcedure` | `{ shareToken: string[1..255], authorName: string[1..100], body: string[1..5000] }` | `Comment` | Token validation only |

### Comment shape

```typescript
// From comments table (schema.ts)
interface Comment {
  id: string;          // uuid
  mapId: string;       // uuid FK -> maps
  userId: string|null; // uuid FK -> users (null for guest comments)
  authorName: string;  // denormalized at insert time
  body: string;        // free-form text
  resolved: boolean;   // owner-toggleable moderation flag
  createdAt: Date;
  updatedAt: Date;
}
```

**No pagination.** All comments are returned in a single query. No cursor, no limit. This is a scaling concern for maps with many comments.

**No threading.** Comments are flat. The v1 schema had a `parentId` column on comments but it was removed. Current comments have no parent/child relationship.

---

## 3. Share <-> Auth Boundary

### Separate auth paths (not integrated with Lucia)

Share tokens are a **parallel auth path**, not integrated with the Lucia session system:

```
Authenticated path:                    Guest/Share path:
  Lucia session cookie                   Share token in URL path
  -> ctx.user (id, name, email)          -> publicProcedure (no ctx.user)
  -> protectedProcedure                  -> Token validated per-call via DB lookup
  -> requireMapAccess(userId, mapId)     -> SELECT FROM shares WHERE token = ?
```

**Key design decisions:**
- Share tokens are **not** stored in cookies or sessions -- they exist only in the URL
- Each guest tRPC call re-validates the token against the DB (no caching)
- Guest identity is ephemeral: `authorName` is user-provided per-comment, not persisted in a session
- A revoked share (DELETE) immediately blocks all guest access on next API call

### Share token lifecycle

```typescript
// shares table (schema.ts)
interface Share {
  id: string;           // uuid
  mapId: string;        // uuid FK -> maps (unique-ish: one share per map)
  token: string;        // randomBytes(16).toString('base64url'), unique index
  accessLevel: string;  // 'public' | 'unlisted' (semantic only, no behavioral difference)
  createdAt: Date;
  updatedAt: Date;
}
```

**No expiry.** Tokens are valid until explicitly revoked. No TTL, no auto-expire.

**One share per map.** The create endpoint upserts: if a share exists, it updates the access level but keeps the same token.

---

## 4. Collaborator <-> Access Control Boundary

### requireMapAccess contract

```typescript
// geo/access.ts:39
async function requireMapAccess(
  userId: string,
  mapId: string,
  minRole: 'viewer' | 'commenter' | 'editor' | 'owner'
): Promise<void>
```

**Resolution order:**
1. Map exists? No -> NOT_FOUND
2. User is map owner? Yes -> always granted (regardless of minRole)
3. minRole === 'owner'? Yes -> NOT_FOUND (hides existence from non-owners)
4. User has collaborator record? No -> NOT_FOUND (hides existence)
5. Collaborator role >= minRole? No -> FORBIDDEN ("requires X access or higher")
6. Yes -> granted

**Role level mapping:** `{ viewer: 0, commenter: 1, editor: 2 }`

### Where access checks happen

| Layer | Function | Used by |
|-------|----------|---------|
| Page load | `requireMapAccess` in `+page.server.ts` | Map editor page |
| tRPC mutations | `requireMapAccess(userId, mapId, 'commenter')` | annotations.create, comments.create |
| tRPC reads | `requireMapAccess(userId, mapId, 'viewer')` | annotations.list, comments.list |
| Owner-only | `requireMapOwnership(userId, mapId)` | shares.*, collaborators.*, comments.resolve |
| Component | `userId` prop comparison | Delete/edit buttons (client-side cosmetic gating) |

### Collaborator table contract

```typescript
// map_collaborators table (schema.ts)
interface MapCollaborator {
  id: string;
  mapId: string;       // FK -> maps (CASCADE)
  userId: string;      // FK -> users (CASCADE)
  role: string;        // 'viewer' | 'commenter' | 'editor'
  invitedBy: string|null; // FK -> users (SET NULL)
  createdAt: Date;
}
// Unique constraint: (mapId, userId) -- one role per user per map
```

**No 'owner' role in the table.** Ownership is determined by `maps.userId`, not by a collaborator record. The owner is never in the `map_collaborators` table.

---

## 5. v1 -> v2 Migration Boundary

### v1 schema (`annotations` table -- schema.ts:224)

```typescript
{
  id: uuid,
  mapId: uuid,           // FK -> maps
  userId: uuid | null,   // FK -> users (SET NULL)
  authorName: text,
  anchorPoint: geometry(Point, 4326),  // PostGIS Point ONLY
  content: jsonb,        // AnnotationContent (text|emoji|gif|image|link|iiif)
  createdAt: timestamp,
  updatedAt: timestamp,
}
// Indexes: (mapId, createdAt) composite, anchor_point GIST spatial
```

### v2 schema (`annotation_objects` table)

```typescript
{
  id: uuid,
  mapId: uuid,
  parentId: uuid | null, // self-FK for threading (max depth 1)
  authorId: uuid | null,
  authorName: text,
  anchor: jsonb,         // { type: 'point'|'region'|'feature'|'viewport'|'measurement', ... }
  content: jsonb,        // { kind: 'single'|'slotted', body/slots }
  templateId: uuid | null,
  ordinal: integer,      // reply ordering within a thread
  version: integer,      // optimistic concurrency
  createdAt: timestamp,
  updatedAt: timestamp,
}
```

### Migration status: **Abandoned, not migrated**

- v1 table still exists in `schema.ts` (exported as `annotations`)
- v1 table still exists in the database (with indexes)
- **No active code reads or writes v1.** All routers use `annotationService` which queries `annotation_objects`
- **No migration script exists** to move v1 data to v2 or drop the v1 table
- v1 data (if any exists) is **inaccessible** through the application
- The v1 content schema (`AnnotationContent`) is a subset of v2's `AnnotationObjectContent` -- the `kind: 'single'` wrapper was added in v2

**Risk:** Schema confusion. Both tables exist, both are exported from `schema.ts`, but only `annotation_objects` is live. A developer could accidentally import the wrong table.

---

## 6. Guest <-> Feature Boundary

### Enforcement layers

Guest access restrictions are enforced at **three levels**, with varying completeness:

#### Route level (server-side, strongest)

```
/(public)/share/[token]/+page.server.ts  -- no auth check, loads via token
/(public)/embed/[token]/+page.server.ts  -- no auth check, loads via token + CSP header
```

Share/embed routes are in the `(public)` route group. They bypass Lucia auth entirely. Data is loaded server-side via direct DB queries (not tRPC), so no session is needed.

#### API level (tRPC procedure types)

| Available to guests | Procedure type | Router |
|--------------------|---------------|--------|
| `comments.listForShare` | `publicProcedure` | comments |
| `comments.createForShare` | `publicProcedure` | comments |
| `shares.resolve` | `publicProcedure` | shares |
| Everything else | `protectedProcedure` | -- blocked by middleware |

Guests can only call `publicProcedure` endpoints. All annotation CRUD, collaborator management, events, and map mutations are `protectedProcedure` and will reject unauthenticated calls.

#### Component level (client-side, cosmetic)

```
ShareViewerScreen:
  <MapEditor readonly={true} />            -- disables editing UI
  <GuestCommentPanel shareToken={token} /> -- guest comment form

EmbedScreen:
  <MapEditor embed={true} />               -- minimal chrome, no panels

AnnotationPanel:
  annotationsQuery enabled: !!userId       -- skips query for guests
  Comment form: only rendered if userId    -- hidden for guests
```

### Feature matrix

| Feature | Owner | Editor | Commenter | Viewer | Guest (share) | Guest (embed) |
|---------|-------|--------|-----------|--------|--------------|---------------|
| View map + layers | Y | Y | Y | Y | Y | Y |
| Create annotation | Y | Y | Y | - | - | - |
| Edit own annotation | Y | Y | Y | - | - | - |
| Delete own annotation | Y | Y | Y | - | - | - |
| View annotations | Y | Y | Y | Y | - | - |
| Post comment (auth) | Y | Y | Y | - | - | - |
| Post comment (guest) | - | - | - | - | Y | - |
| View comments | Y | Y | Y | Y | Y | - |
| Resolve comment | Y | - | - | - | - | - |
| Create share link | Y | - | - | - | - | - |
| Invite collaborator | Y | - | - | - | - | - |
| Manage roles | Y | - | - | - | - | - |
| View activity feed | Y | - | - | - | - | - |
| Edit features/layers | Y | Y | - | - | - | - |

**Gap:** Viewers can see annotations but cannot comment. Guests (share) can comment but cannot see annotations. This asymmetry is a product decision, not a bug -- annotations require authentication for the query, while guest comments use a separate public endpoint.

---

## Proposed Seeds

```json
[
  {
    "title": "Drop v1 annotations table and schema export",
    "type": "task",
    "priority": "low",
    "labels": ["cleanup", "schema"],
    "description": "The v1 'annotations' table (schema.ts:224) has no active read or write paths. All code uses annotation_objects (v2). Create a migration to drop the table and remove the export from schema.ts. Risk: schema confusion if a developer imports the wrong table."
  },
  {
    "title": "Delete dead collaboration/ component stubs",
    "type": "task",
    "priority": "low",
    "labels": ["cleanup", "dead-code"],
    "description": "Five files in apps/web/src/lib/components/collaboration/ are dead stubs never imported by MapEditor: ActivityFeed.svelte (55 LOC), ShareDialog.svelte (55 LOC), CommentPanel.svelte (~85 LOC), CollaboratorsPanel.svelte, GuestCommentPanel.svelte. Active versions live in components/map/. Safe to delete."
  },
  {
    "title": "Add comment pagination",
    "type": "task",
    "priority": "medium",
    "labels": ["scalability", "api"],
    "description": "comments.list and comments.listForShare return all comments in a single query with no pagination. For maps with many comments this will degrade. Add cursor-based pagination matching the pattern used in annotationService.list."
  },
  {
    "title": "Expose annotation changelog via API",
    "type": "task",
    "priority": "low",
    "labels": ["feature", "annotations"],
    "description": "annotation_changelog records add/mod/del patches with inverse operations but has no read API or UI. The inverse patches suggest an intended undo feature. Either build the undo UI or document that changelog is audit-only and remove inverse computation."
  },
  {
    "title": "Add share token expiry mechanism",
    "type": "task",
    "priority": "medium",
    "labels": ["security", "shares"],
    "description": "Share tokens have no expiry -- they are valid until manually revoked. Add an optional expiresAt column to the shares table and enforce it in shares.resolve and the share page server load."
  },
  {
    "title": "Misleading 'Invitation sent' toast -- no notification system",
    "type": "bug",
    "priority": "low",
    "labels": ["ux", "collaboration"],
    "description": "ShareDialog.svelte shows toastStore.success('Invitation sent.') after collaborators.invite, but there is no email or in-app notification. The collaborator has no way to know they were invited. Either add notification or change the toast message to 'Collaborator added.'"
  }
]
```

---

*Generated from source analysis. See [components.md](./components.md) for static structure, [behavior.md](./behavior.md) for runtime flows.*
