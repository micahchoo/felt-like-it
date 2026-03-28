# Annotation + Collaboration Cluster — Components & Contracts

## Component Trees

### Annotations
```
AnnotationPanel (~1200 LOC, 40 commits)  — self-contained form + list
  ├── AnnotationContent (renders content by type in list)
  └── [inline form: anchor selector, content editor, EXIF GPS, thread UI]

MapCanvas
  └── AnnotationContent (in-map popup rendering)
```

**Content types:** text | emoji | gif | image | link | iiif | measurement
(measurement is write-gated to measurement panel; not in form selector)

**Anchor types:** point | region | feature | viewport
- Feature anchor stores `featureDeleted: boolean` with convertToPoint rescue path

### Collaboration (active vs dead)
```
Active (map/):                    Dead stubs (collaboration/):
├── ShareDialog (195 LOC, tRPC)   ├── ShareDialog (55 LOC, props-only)
├── ActivityFeed (230 LOC, tRPC)  ├── ActivityFeed (55 LOC, stub)
└── GuestCommentPanel             └── GuestCommentPanel
```

Only `map/` versions are imported by MapEditor. `collaboration/` directory contains earlier drafts never cleaned up.

## Data Model: v1 vs v2

### v1: `annotations` table (DEAD — no active write paths)
- anchor_point: PostGIS Point only, no threading, no versioning

### v2: `annotation_objects` table (ACTIVE)
- anchor: JSONB (supports point | region | feature | viewport)
- Threading: parent_id (max depth 1 enforced in service)
- Optimistic concurrency: version INTEGER (compare-and-swap UPDATE)
- Templates: template_id FK
- Limit: MAX_ANNOTATIONS_PER_MAP = 10,000

### Comments (separate domain object)
- `comments` table: free-form body + author_name + resolved flag
- No spatial anchor, no versioning
- Guest comments: userId=null, share-token validated

**AnnotationPanel renders both annotations and comments** in a unified UI feed via separate query keys.

## Share Token Flow

```
Owner: shares.create({ mapId, accessLevel })
  → requireMapOwnership → randomBytes(16).toString('base64url')
  → upsert shares table → return token
Guest: /share/[token]
  → shares.resolve (public procedure) → joins shares→maps→layers
  → renders read-only MapEditor
Guest comments: comments.createForShare (public) → userId: null
```

accessLevel: `public | unlisted` (comments always available)

## Permission Enforcement

- **Component layer:** userId prop → author-match gating (delete own)
- **tRPC layer:** all mutations call requireMapAccess server-side
- **Page load:** +page.server.ts calls requireMapAccess
- **Guest paths:** publicProcedure + share token validation
- **Collaborator management:** owner-only via requireMapOwnership

## Cross-Cutting Patterns

1. **Author name denormalization** — stored at insert time on annotations, comments (survives user deletion)
2. **No optimistic UI** — all mutations pessimistic (await server → invalidate query)
3. **No real-time** — ActivityFeed poll-on-trigger; no SSE/WebSocket
4. **Comments ≠ Annotations** — user sees unified feed; backend has two tables, routers, data models

**See also:** [subsystems](../subsystems.md)
