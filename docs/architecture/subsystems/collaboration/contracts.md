# Collaboration Subsystem — Contracts (L6)

> Share tokens, guest auth, permission model, and tRPC router contracts.

## Share Token Contract

### Generation

- **Function:** `generateToken()` in `shares.ts` router — `randomBytes(16).toString('base64url')`
- **Result:** 22-character URL-safe base64 string (128 bits of entropy)
- **Storage:** `shares` table, `token` column with `uniqueIndex('shares_token_idx')`

### DB Schema: `shares`

| Column       | Type                     | Notes                          |
|--------------|--------------------------|--------------------------------|
| id           | uuid PK                  | defaultRandom()                |
| mapId        | uuid FK -> maps.id       | CASCADE on delete              |
| token        | text NOT NULL             | unique index                   |
| accessLevel  | text NOT NULL             | default 'unlisted'; values: 'public' / 'unlisted' |
| createdAt    | timestamptz              | defaultNow()                   |
| updatedAt    | timestamptz              | defaultNow()                   |

- One share per map (upsert pattern: `create` checks for existing, updates accessLevel if found).
- Shared types: `CreateShareSchema` from `@felt-like-it/shared-types` (`packages/shared-types/src/schemas/share.ts`).

### Validation

- Share route: `routes/(public)/share/[token]/+page.server.ts` — direct DB lookup, returns `{ error: 'not_found' }` if missing (no redirect, no throw).
- tRPC `shares.resolve`: `publicProcedure`, throws `TRPCError NOT_FOUND` if token invalid.
- No expiration mechanism — tokens are permanent until the owner deletes them.

## Guest Auth: Reduced-Trust Context

### What Guests Can Do

| Action                | Auth Required? | Procedure Type    | Access Check              |
|-----------------------|----------------|-------------------|---------------------------|
| View shared map       | No             | Page server load  | Token lookup only          |
| List comments (share) | No             | `publicProcedure` | Share token validation     |
| Post guest comment    | No             | `publicProcedure` | Share token validation     |
| View embedded map     | No             | Page server load  | Token lookup only          |

### What Guests Cannot Do

All of these require `protectedProcedure` (session cookie) + role checks:

- Create/delete share links (owner only via `requireMapOwnership`)
- Invite/remove/update collaborators (owner only)
- List/create authenticated comments (viewer+ / commenter+ via `requireMapAccess`)
- Delete comments (author-only, session-matched)
- Toggle comment resolved status (owner only)
- Log or list activity events (owner only)
- Any map/layer/feature mutations

### Guest Comment Trust Model

- **No authentication.** Guest comments use `publicProcedure`.
- **Author name:** Free-text input from the caller (1-100 chars, trimmed). No verification.
- **userId:** Stored as `null` — distinguishes guest comments from authenticated ones.
- **Body:** 1-5000 chars, trimmed.
- **Rate limiting:** Not implemented at the tRPC level for guest endpoints. The share route is in the `(public)` layout group which bypasses session-based rate limiting.

## Permission Model

### Access Control (`apps/web/src/lib/server/geo/access.ts`)

Two functions, hierarchical:

**`requireMapOwnership(userId, mapId)`**
- Checks `maps.userId === userId`
- Throws `NOT_FOUND` if not owner (hides map existence)

**`requireMapAccess(userId, mapId, minRole)`**
- Role hierarchy: `viewer (0) < commenter (1) < editor (2)`
- Owner fast-path: always granted regardless of minRole
- `minRole === 'owner'`: non-owners get NOT_FOUND
- Collaborator with sufficient role: granted
- Collaborator with insufficient role: FORBIDDEN
- No collaborator record: NOT_FOUND (hides existence)

### DB Schema: `map_collaborators`

| Column    | Type                     | Notes                                          |
|-----------|--------------------------|-------------------------------------------------|
| id        | uuid PK                  | defaultRandom()                                 |
| mapId     | uuid FK -> maps.id       | CASCADE on delete                               |
| userId    | uuid FK -> users.id      | CASCADE on delete; unique with mapId             |
| role      | text NOT NULL             | default 'viewer'; CHECK ('viewer','commenter','editor') |
| invitedBy | uuid FK -> users.id      | SET NULL on delete                              |
| createdAt | timestamptz              | defaultNow()                                    |

### Per-Router Permission Summary

| Router          | Procedure         | Auth       | Access Check                  |
|-----------------|-------------------|------------|-------------------------------|
| shares.create   | protected         | Session    | requireMapOwnership           |
| shares.getForMap| protected         | Session    | requireMapOwnership           |
| shares.delete   | protected         | Session    | requireMapOwnership           |
| shares.resolve  | public            | None       | Token lookup                  |
| comments.list   | protected         | Session    | requireMapAccess(viewer)      |
| comments.create | protected         | Session    | requireMapAccess(commenter)   |
| comments.delete | protected         | Session    | Author-match (userId WHERE)   |
| comments.toggleResolved | protected | Session    | requireMapOwnership           |
| comments.listForShare   | public    | None       | Share token validation        |
| comments.createForShare | public    | None       | Share token validation        |
| collaborators.list      | protected | Session    | requireMapOwnership           |
| collaborators.invite    | protected | Session    | requireMapOwnership           |
| collaborators.remove    | protected | Session    | requireMapOwnership           |
| collaborators.updateRole| protected | Session    | requireMapOwnership           |
| events.list     | protected         | Session    | requireMapOwnership           |
| events.log      | protected         | Session    | requireMapOwnership           |

## DB Schema: `comments`

| Column     | Type                     | Notes                                    |
|------------|--------------------------|------------------------------------------|
| id         | uuid PK                  | defaultRandom()                          |
| mapId      | uuid FK -> maps.id       | CASCADE on delete; indexed               |
| userId     | uuid FK -> users.id      | SET NULL on delete; null for guests       |
| authorName | text NOT NULL             | Denormalized from user or guest input     |
| body       | text NOT NULL             | Max 5000 chars (enforced at tRPC)         |
| resolved   | boolean NOT NULL          | default false                            |
| createdAt  | timestamptz              | defaultNow(); indexed                    |
| updatedAt  | timestamptz              | defaultNow()                             |

## Audit Trail

All share and collaborator mutations fire `appendAuditLog()` (fire-and-forget via `void`):
- `share.create`, `share.update`, `share.delete`
- `collaborator.invite`, `collaborator.remove`, `collaborator.updateRole`

Stored in the `audit_log` table with `userId`, `action`, `entityType`, `entityId`, `mapId`, `metadata`.
