<!-- Verified accurate as of 2026-03-29 -->
# API + Auth Cluster -- Contracts (Zoom Level 6)

> Interface boundaries of the auth subsystem. What each component promises to its consumers.
> Cross-references [components.md](./components.md) for structure and [behavior.md](./behavior.md) for runtime traces.

---

## 1. Auth <-> tRPC Boundary

### Context shape

**File:** `apps/web/src/lib/server/trpc/context.ts`

```typescript
interface Context {
  user: User | null;       // Lucia User: { id, email, name, isAdmin, disabledAt }
  session: Session | null; // Lucia Session: { id, userId, expiresAt } -- null for API key auth
  event: RequestEvent;     // Full SvelteKit event (cookies, url, request, etc.)
}
```

**Creation:** `createContext(event)` reads `event.locals.user` and `event.locals.session` -- populated by `hooks.server.ts` before any tRPC handler runs.

### Procedure tiers

**File:** `apps/web/src/lib/server/trpc/init.ts`

| Tier | Guard | Narrowed context | Error on fail |
|------|-------|-----------------|---------------|
| `publicProcedure` | None | `ctx.user: User \| null` | -- |
| `protectedProcedure` | `ctx.user && ctx.session` | `ctx.user: User` (non-null) | `UNAUTHORIZED` |
| `adminProcedure` | `ctx.user && ctx.session && ctx.user.isAdmin` | `ctx.user: User & {isAdmin: true}` | `UNAUTHORIZED` or `FORBIDDEN` |

All three tiers include `timingMiddleware` that logs calls >500ms or all calls when `DEBUG=true`.

### Contract details

- **protectedProcedure** checks both `ctx.user` AND `ctx.session` (`init.ts:38`). This means **API key-authenticated requests (which set `session: null`) will fail protectedProcedure**. This is intentional -- tRPC is the internal frontend API; REST v1 is for external callers.
- **adminProcedure** adds `isAdmin` check on top of the same user+session guard (`init.ts:51-55`).
- **Type narrowing:** After the middleware, downstream handlers receive a `ctx` with non-nullable `user` and `session` fields. TypeScript guarantees this at compile time.
- **Transformer:** superjson -- handles Date, Map, Set, BigInt serialization transparently.

### Router composition

**File:** `apps/web/src/lib/server/trpc/router.ts`

```typescript
export const appRouter = router({
  maps, layers, features, shares, events, comments,
  collaborators, geoprocessing, annotations, apiKeys, auditLog, admin
});
export type AppRouter = typeof appRouter;
```

12 sub-routers merged into one `appRouter`. `AppRouter` type is exported for client-side type inference.

---

## 2. Auth <-> REST v1 Boundary

### resolveAuth() contract

**File:** `apps/web/src/routes/api/v1/middleware.ts:34-88`

```typescript
interface ApiAuth {
  userId: string | null;         // null for share token access
  scope: 'read' | 'read-write'; // share tokens always 'read'
  mapScope: string | null;       // non-null only for share tokens (restricts to one map)
}

async function resolveAuth(event): Promise<ApiAuth | null>
// Returns null when no valid credentials found
```

### Auth resolution priority

1. `Authorization: Bearer flk_...` header -> API key auth -> `{ userId, scope, mapScope: null }`
2. `?token=...` query param -> Share token auth -> `{ userId: null, scope: 'read', mapScope }`
3. Neither -> returns `null`

### Error response contract

**File:** `apps/web/src/routes/api/v1/errors.ts`

```typescript
// Response body shape on auth failure:
{
  "error": {
    "code": "UNAUTHORIZED" | "FORBIDDEN",
    "message": string,
    "status": 401 | 403
  }
}
```

All error codes:

| Code | HTTP | Used when |
|------|------|-----------|
| `UNAUTHORIZED` | 401 | `resolveAuth()` returns null (no/invalid credentials) |
| `FORBIDDEN` | 403 | `requireScope()` fails (read-only key attempts write) |
| `MAP_NOT_FOUND` | 404 | `assertMapAccess()` fails (share token for wrong map) |
| `RATE_LIMITED` | 429 | `rateLimit()` threshold exceeded |
| `VALIDATION_ERROR` | 422 | Request body fails schema validation |
| `VERSION_CONFLICT` | 409 | Optimistic locking conflict |
| `INTERNAL_ERROR` | 500 | Unhandled server error |

### Response envelope

**File:** `apps/web/src/routes/api/v1/middleware.ts:111-117`

```typescript
// Success response shape:
{
  "data": T,
  "meta": { totalCount?, limit?, nextCursor? },
  "links": { self?, next? }
}
```

### Scope enforcement helpers

```typescript
function requireScope(auth: ApiAuth, required: 'read' | 'read-write'): void
// Throws Error('FORBIDDEN') if scope insufficient

function assertMapAccess(auth: ApiAuth, mapId: string): void
// Throws Error('MAP_NOT_FOUND') if mapScope set and doesn't match

function rateLimit(auth: ApiAuth): Response | null
// Returns 429 Response if over limit, null if OK
// API key: 100/1s per userId; Share token: 30/1s per mapScope
```

### Handler pattern (every REST v1 endpoint follows this)

```typescript
export const GET: RequestHandler = async ({ request, url }) => {
  const auth = await resolveAuth({ request, url });
  if (!auth) return toErrorResponse('UNAUTHORIZED');
  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;
  // ... handler logic
};
```

---

## 3. Auth <-> Database Boundary

### Users table

**File:** `apps/web/src/lib/server/db/schema.ts:33-48`

| Column | Type | Constraints | Auth role |
|--------|------|-------------|-----------|
| `id` | uuid | PK, defaultRandom | User identity |
| `email` | text | NOT NULL, unique index | Login credential |
| `hashed_password` | text | NOT NULL | Argon2id hash |
| `name` | text | NOT NULL | Display name |
| `is_admin` | boolean | NOT NULL, default false | Admin guard |
| `created_at` | timestamptz | NOT NULL, defaultNow | -- |
| `updated_at` | timestamptz | NOT NULL, defaultNow | -- |
| `disabled_at` | timestamptz | nullable | Account disable flag |

### Sessions table (Lucia-managed)

**File:** `apps/web/src/lib/server/db/schema.ts:49-56`

| Column | Type | Constraints | Auth role |
|--------|------|-------------|-----------|
| `id` | text | PK (Lucia generates, NOT UUID) | Session identifier |
| `user_id` | uuid | FK -> users.id, ON DELETE CASCADE | Session owner |
| `expires_at` | timestamptz | NOT NULL | Lucia handles expiry |

### API Keys table

**File:** `apps/web/src/lib/server/db/schema.ts:352-376`

| Column | Type | Constraints | Auth role |
|--------|------|-------------|-----------|
| `id` | uuid | PK, defaultRandom | Key identity |
| `user_id` | uuid | FK -> users.id, ON DELETE CASCADE | Key owner |
| `name` | text | NOT NULL | User-assigned label |
| `key_hash` | text | NOT NULL, unique index | SHA-256 of raw key |
| `scope` | text | NOT NULL, default 'read' | Access level (**no CHECK constraint**) |
| `prefix` | text | NOT NULL | First 12 chars for display |
| `last_used_at` | timestamptz | nullable | Updated fire-and-forget |
| `created_at` | timestamptz | NOT NULL, defaultNow | -- |

### Shares table

**File:** `apps/web/src/lib/server/db/schema.ts:130-148`

| Column | Type | Constraints | Auth role |
|--------|------|-------------|-----------|
| `id` | uuid | PK, defaultRandom | Share identity |
| `map_id` | uuid | FK -> maps.id, ON DELETE CASCADE | Scoped map |
| `token` | text | NOT NULL, unique index | URL/API token |
| `access_level` | text | NOT NULL, default 'unlisted' | 'public' or 'unlisted' |
| `created_at` | timestamptz | NOT NULL, defaultNow | -- |
| `updated_at` | timestamptz | NOT NULL, defaultNow | -- |

### Audit Log table

**File:** `apps/web/src/lib/server/db/schema.ts:319-350`

| Column | Type | Constraints | Auth role |
|--------|------|-------------|-----------|
| `seq` | bigserial | PK | Total ordering |
| `user_id` | uuid | FK -> users.id, ON DELETE SET NULL | Actor |
| `action` | text | NOT NULL | Dot-namespaced verb |
| `entity_type` | text | NOT NULL | 'map', 'share', 'collaborator', 'apiKey' |
| `entity_id` | text | nullable | Affected entity |
| `map_id` | uuid | FK -> maps.id, ON DELETE SET NULL | Context |
| `metadata` | jsonb | nullable | Additional context |
| `prev_hash` | text | NOT NULL | Previous chain_hash |
| `chain_hash` | text | NOT NULL | SHA-256 tamper detection |
| `created_at` | timestamptz | NOT NULL, defaultNow | -- |

### Lucia adapter configuration

**File:** `apps/web/src/lib/server/auth/index.ts`

```typescript
const adapter = new DrizzlePostgreSQLAdapter(db, sessions, users);
export const lucia = new Lucia(adapter, {
  sessionCookie: {
    attributes: { secure: secureCookies, sameSite: 'lax' }
  },
  getUserAttributes: (attr) => ({
    email: attr.email, name: attr.name, isAdmin: attr.isAdmin, disabledAt: attr.disabledAt
  })
});
```

- `secure` flag is conditional on `ORIGIN` env starting with `https://` (`auth/index.ts:11`).
- `sameSite: 'lax'` allows cookies on top-level navigations but not cross-origin POSTs.
- `getUserAttributes` maps DB columns to the Lucia User type available in `event.locals.user`.

---

## 4. Auth <-> Frontend Boundary

### How the frontend knows who is logged in

**Two layout layers expose user data to pages:**

#### Root layout (all pages)

**File:** `apps/web/src/routes/+layout.server.ts`

```typescript
// Returns for ALL routes (including public/auth pages):
{ user: { id, email, name } | null }
```

Note: Root layout does NOT include `isAdmin` -- it casts to strip it.

#### App layout (authenticated pages only)

**File:** `apps/web/src/routes/(app)/+layout.server.ts`

```typescript
// Redirects to /auth/login if not authenticated
// Returns for all (app)/* routes:
{ user: { id, email, name, isAdmin } }
```

The `(app)` layout adds `isAdmin` and guarantees user is non-null (redirects otherwise).

### PageData type

**File:** `apps/web/src/app.d.ts`

```typescript
interface PageData {
  user?: User | null;
}
```

Available in Svelte components via `$page.data.user`. The `?` makes it optional because not all pages provide it.

### Auth state availability

| Route group | User data shape | Guaranteed non-null? |
|-------------|----------------|---------------------|
| `/auth/*` | `{ id, email, name } \| null` | No -- may be null |
| `/(public)/*` | `{ id, email, name } \| null` | No -- guests have null |
| `/(app)/*` | `{ id, email, name, isAdmin }` | Yes -- redirect to login if null |
| `/(app)/admin/*` | Same + `isAdmin` verified true | Yes -- 403 if not admin |

### No client-side auth store

There is no dedicated Svelte store for auth state. The `$page.data.user` from SvelteKit's page data is the single source of truth on the client. This means:
- Auth state updates require a page navigation or invalidation
- No real-time session expiry detection on the client
- Server-side session invalidation (admin disable) only takes effect on next server request

---

## 5. Audit Log Contract

### Event schema

**File:** `apps/web/src/lib/server/audit/index.ts`

```typescript
type AuditAction =
  | 'map.create' | 'map.update' | 'map.delete' | 'map.clone' | 'map.createFromTemplate'
  | 'share.create' | 'share.update' | 'share.delete'
  | 'collaborator.invite' | 'collaborator.remove' | 'collaborator.updateRole'
  | 'apiKey.create' | 'apiKey.revoke';

interface AuditEntry {
  userId: string | null;            // null if user deleted
  action: AuditAction;              // dot-namespaced verb
  entityType: string;               // 'map', 'share', 'collaborator', 'apiKey'
  entityId?: string;                // UUID of affected entity
  mapId?: string;                   // context map (null for account-level events)
  metadata?: Record<string, unknown>; // additional context (accessLevel, scope, etc.)
}
```

### Logged events (by call site)

| Caller | Actions | File |
|--------|---------|------|
| maps/operations.ts | map.update, map.delete, map.clone, map.createFromTemplate | `:35, :62, :136, :199` |
| routers/maps.ts | map.create (inferred from pattern) | `:124` |
| routers/shares.ts | share.create, share.update, share.delete | `:36, :59, :87` |
| routers/apiKeys.ts | apiKey.create, apiKey.revoke | `:73, :100` |
| routers/collaborators.ts | collaborator.invite, collaborator.remove, collaborator.updateRole | `:97, :118, :168` |

### Fire-and-forget contract

```typescript
// All callers use this pattern:
void appendAuditLog({ userId, action, entityType, entityId, mapId, metadata });
```

- The `void` prefix discards the Promise -- the caller does NOT await.
- `appendAuditLog` catches all errors internally and logs to stderr (`audit/index.ts:79-80`).
- The primary mutation ALWAYS succeeds regardless of audit log outcome.
- This means: **audit entries can be silently dropped** if the DB transaction or advisory lock fails.

### Hash chain integrity

```typescript
function computeChainHash(entry, prevHash: string, createdAt: Date): string {
  const content = JSON.stringify({
    userId, action, entityType, entityId, mapId, metadata, prevHash, createdAt: ISO
  });
  return SHA-256(content).hex();
}
```

- `GENESIS_HASH`: `'0'.repeat(64)` for the first entry.
- Advisory lock: `pg_advisory_xact_lock(12345678)` serializes all appends.
- Verification: `auditLog.verify` tRPC query (admin-only) reads all rows and recomputes chain.

---

## 6. CSRF Protection

### SvelteKit built-in

- `kit.csrf.checkOrigin` defaults to `true` in SvelteKit 2.
- `svelte.config.js` does NOT set `csrf: { checkOrigin: false }`, so the default applies.
- SvelteKit compares the `Origin` header against the configured `ORIGIN` env variable for all non-GET requests.
- **Scope:** Protects form actions (login, signup, logout) and any other POST/PUT/PATCH/DELETE to SvelteKit routes.

### Not applicable to

- **REST v1 endpoints:** Use `Authorization: Bearer` header (not cookies), so CSRF is not a vector.
- **tRPC mutations:** Called via `fetch()` from the SvelteKit frontend with the session cookie. SvelteKit's origin check applies because tRPC is mounted as a SvelteKit route handler. Protected.
- **Share token access:** Read-only via GET requests or query params. No state-changing operations.

### Custom CSRF tokens

**None.** The Origin header check is the sole CSRF defense. This is standard for SvelteKit applications and sufficient given:
- Cookies use `sameSite: 'lax'` (no cross-origin POST with cookies)
- Origin check provides defense-in-depth on top of SameSite

---

## Contract Stability Matrix

| Interface | Stability | Change risk |
|-----------|-----------|-------------|
| Locals type (`app.d.ts`) | Stable | Low -- Lucia types are well-defined |
| tRPC Context shape | Stable | Low -- mirrors Locals |
| protectedProcedure/adminProcedure | Stable | Low -- guards are simple null checks |
| resolveAuth() return shape | Stable | Medium -- adding scopes or auth methods would change ApiAuth |
| REST error envelope | Stable | Low -- follows JSON:API-like convention |
| Audit entry schema | Growing | Medium -- new actions added as features ship |
| DB schema (auth tables) | Stable | Low -- migration-controlled |
| Session cookie config | Stable | Low -- Lucia manages internally |

---

## Proposed Seeds

```json
[
  {
    "title": "protectedProcedure rejects API key auth silently",
    "type": "documentation",
    "priority": "low",
    "labels": ["auth", "api", "dx"],
    "description": "protectedProcedure checks ctx.session which is null for API key auth. This is intentional (tRPC is internal) but undocumented. An API key user hitting a tRPC endpoint gets UNAUTHORIZED with no explanation. Add a developer-facing note or distinct error message."
  },
  {
    "title": "Root layout strips isAdmin from user data",
    "type": "documentation",
    "priority": "low",
    "labels": ["auth", "frontend"],
    "description": "Root +layout.server.ts casts user to strip isAdmin, while (app) layout includes it. This means public pages cannot conditionally show admin UI even if the user is logged in. Document whether this is intentional information hiding or an oversight."
  },
  {
    "title": "No client-side session expiry detection",
    "type": "enhancement",
    "priority": "low",
    "labels": ["auth", "ux"],
    "description": "When an admin disables a user or a session expires, the client has no way to know until the next server request. Long-lived tabs could show stale authenticated UI. Consider a periodic session heartbeat or SSE notification."
  },
  {
    "title": "Audit log entries can be silently dropped",
    "type": "documentation",
    "priority": "low",
    "labels": ["audit", "observability"],
    "description": "appendAuditLog is fire-and-forget with error swallowing. If the advisory lock or insert fails, the entry is lost with only a stderr log. Consider adding a dead-letter mechanism or at minimum an error counter metric for monitoring."
  },
  {
    "title": "Add CHECK constraint for api_keys.scope column",
    "type": "bug",
    "priority": "low",
    "labels": ["auth", "data-integrity"],
    "description": "api_keys.scope is text with no DB CHECK constraint. Invalid values like 'admin' or '' could be inserted via direct DB access. Add CHECK (scope IN ('read', 'read-write')) migration. Also applies to shares.access_level."
  }
]
```
