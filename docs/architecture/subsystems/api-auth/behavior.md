# API + Auth Cluster -- Behavior (Zoom Level 8)

> How the auth subsystem behaves at runtime. Traces six flows through actual code paths.
> Cross-references [components.md](./components.md) for structural context.

---

## 1. Login Flow

**Entry:** `POST /auth/login` (SvelteKit form action)

**File:** `apps/web/src/routes/auth/login/+page.server.ts`

### Sequence

```
User submits form (email, password)
  |
  v
+page.server.ts:actions.default
  |
  +--> checkRateLimit(getClientAddress())          -- rate-limit.ts:24
  |      fail(429) if >10 requests/60s from same IP
  |
  +--> Trim + lowercase email
  +--> Validate: email and password both present   -- :33-34
  +--> Validate: password.length <= 256            -- :37-38
  |
  +--> db.select().from(users).where(email)        -- :41
  |      |
  |      +-- Not found: verifyPassword(dummy, pw)  -- :44-45  (timing attack mitigation)
  |      |   return fail(400, 'Invalid email or password.')
  |      |
  |      +-- Found: verifyPassword(user.hashedPassword, password)  -- :49
  |           |
  |           +-- Invalid: fail(400, 'Invalid email or password.')
  |           +-- Valid but user.disabledAt set: fail(403, 'Account disabled...')  -- :54-55
  |           +-- Valid:
  |                |
  |                +--> lucia.createSession(user.id, {})        -- :58
  |                +--> lucia.createSessionCookie(session.id)   -- :59
  |                +--> cookies.set(cookie)                     -- :60-62
  |                +--> redirect(302, safeRedirect(url))        -- :65
```

### Key details

- **Rate limiting:** In-memory sliding window, 10 req/60s per IP (`lib/server/rate-limit.ts:8-9`). Resets on process restart.
- **Timing oracle mitigation:** When email not found, a dummy argon2 verify is executed to prevent timing-based user enumeration (`:44-45`).
- **Safe redirect:** Only allows relative paths starting with `/` but not `//`, defaults to `/dashboard` (`:10-13`).
- **Error format:** SvelteKit `fail()` returns `ActionData` with `{ field: string, message: string }`.
- **Password hashing:** Argon2id via `@node-rs/argon2` with memoryCost=19456 (19 MiB), timeCost=2, parallelism=1, outputLen=32 (`lib/server/auth/password.ts:3-8`).
- **Already logged in:** `load` function redirects to dashboard if `locals.user` is set (`:16-19`).

### Errors shown to user

| Condition | HTTP | Message |
|-----------|------|---------|
| Rate limited | 429 | "Too many login attempts. Please wait a few minutes before trying again." |
| Missing fields | 400 | "Email and password are required." |
| Password too long | 400 | "Password is too long." |
| Wrong email or password | 400 | "Invalid email or password." |
| Account disabled | 403 | "This account has been disabled. Contact support at admin@feltlikei.it for assistance." |

---

## 2. Registration Flow

**Entry:** `POST /auth/signup` (SvelteKit form action)

**File:** `apps/web/src/routes/auth/signup/+page.server.ts`

### Sequence

```
User submits form (name, email, password)
  |
  v
+page.server.ts:actions.default
  |
  +--> checkRateLimit(getClientAddress())           -- same rate limiter as login
  |
  +--> Validate name: required, length >= 1         -- :25-26
  +--> Validate email: required, contains '@'       -- :28-29
  +--> Validate password: length >= 8               -- :31-32
  +--> Validate password: length <= 256             -- :35-36
  |
  +--> db.select().from(users).where(email)         -- :40  (uniqueness check)
  |      Duplicate: fail(400, 'Account already exists.')
  |
  +--> hashPassword(password)                       -- :45  (argon2id)
  |
  +--> db.insert(users).values({email, hashedPassword, name}).returning({id})  -- :47-50
  |      Note: id is UUID defaultRandom() from DB
  |      isAdmin defaults to false
  |      disabledAt defaults to null
  |
  +--> lucia.createSession(user.id, {})             -- :56
  +--> lucia.createSessionCookie(session.id)        -- :57
  +--> cookies.set(cookie)                          -- :58-60
  +--> redirect(302, '/dashboard')                  -- :63
```

### Password requirements

| Rule | Value | Enforced at |
|------|-------|-------------|
| Minimum length | 8 characters | `+page.server.ts:31` |
| Maximum length | 256 characters | `+page.server.ts:35` |
| Complexity rules | **None** | -- |
| Confirm password | **No** (single field) | -- |

### Email uniqueness

- Application-level check via `SELECT ... WHERE email = ?` before insert (`:40`).
- DB-level backup: `uniqueIndex('users_email_idx').on(t.email)` in schema (`schema.ts:48`).
- **Race condition:** Two concurrent signups with the same email could both pass the SELECT check. The DB unique index would catch the second INSERT as a constraint violation, which would surface as an unhandled error (500) rather than a friendly duplicate message.

---

## 3. API Key Auth Flow

**Entry:** Any HTTP request with `Authorization: Bearer flk_...` header

**Two parallel paths exist:**

### Path A: hooks.server.ts (populates `event.locals` for ALL requests)

**File:** `apps/web/src/hooks.server.ts:17-48`

```
Request arrives with Authorization header
  |
  +--> authHeader.startsWith('Bearer flk_') ?       -- :18
  |
  +--> rawKey = authHeader.slice(7)                  -- :19  (strips "Bearer ")
  +--> hash = SHA-256(rawKey).hex()                  -- :20
  |
  +--> db.select({id, userId}).from(apiKeys).where(keyHash == hash)  -- :22-25
  |      |
  |      +-- Not found: locals.user = null, locals.session = null    -- :46-48
  |      +-- Found:
  |           |
  |           +--> db.select({id,email,name,isAdmin,disabledAt}).from(users)  -- :28-31
  |                |
  |                +-- User exists and NOT disabled:
  |                |     locals.user = userRow                  -- :34
  |                |     locals.session = null                  -- :35
  |                |     void db.update(apiKeys).set({lastUsedAt})  -- :37-40  (fire-and-forget)
  |                |
  |                +-- User missing or disabled:
  |                      locals.user = null, locals.session = null  -- :42-43
```

### Path B: REST v1 middleware resolveAuth() (per-handler, returns ApiAuth)

**File:** `apps/web/src/routes/api/v1/middleware.ts:34-88`

```
resolveAuth(event)
  |
  +--> Check Bearer header for 'Bearer flk_'        -- :38
  |      hash = SHA-256(rawKey)                      -- :40
  |      Lookup apiKeys by keyHash                   -- :42-45
  |      Lookup user, check disabledAt              -- :49-55
  |      Return { userId, scope, mapScope: null }   -- :60-64
  |
  +--> Check ?token query param (share tokens)       -- :68
  |      Lookup shares by token                      -- :70-73
  |      Return { userId: null, scope: 'read', mapScope: shareRow.mapId }  -- :77-81
  |
  +--> Neither: return null (caller returns 401)     -- :87
```

### Key format

- Pattern: `flk_<64-hex-chars>` = 68 characters total
- Generation: `randomBytes(32).toString('hex')` prefixed with `flk_` (`routers/apiKeys.ts:generateApiKey`)
- Storage: Only SHA-256 hash stored in DB (`api_keys.key_hash`). Plaintext returned once at creation.
- Display: First 12 chars stored as `prefix` for UI display (e.g., `flk_a1b2c3d4`)

### Rotation support

**None.** There is no key rotation mechanism:
- `apiKeys.create` generates a new key (user can have multiple)
- `apiKeys.revoke` deletes a key
- No "replace" or "rotate" operation exists
- User must create a new key, update their client, then revoke the old one manually

### Scope model

- Column: `api_keys.scope` -- text, default `'read'`
- Values: `'read' | 'read-write'` (enforced in TypeScript, **no DB CHECK constraint** -- see components.md confirmed findings)
- **Note:** The `create` mutation in `apiKeys.ts` does NOT accept a scope input -- all keys are created with default `'read'` scope. There is no mutation to change scope after creation.

---

## 4. Session Validation on Every Request

**File:** `apps/web/src/hooks.server.ts`

### Complete middleware chain

```
Every request enters handle()
  |
  +--> [1] Check for Bearer API key auth              -- :17-48
  |      (see Flow 3 Path A above)
  |
  +--> [2] Else: Session cookie auth                   -- :50-88
  |      |
  |      +--> sessionId = cookies.get(lucia.sessionCookieName)   -- :51
  |      |
  |      +--> No cookie: locals = { user: null, session: null }  -- :53-55
  |      |
  |      +--> Has cookie:
  |           |
  |           +--> lucia.validateSession(sessionId)              -- :57
  |           |
  |           +--> user.disabledAt set?                          -- :59
  |           |      YES: invalidateSession + blank cookie       -- :60-67
  |           |           locals = { user: null, session: null }
  |           |
  |           +--> session.fresh?                                -- :69
  |           |      YES: refresh session cookie (sliding window) -- :70-74
  |           |
  |           +--> !session (expired/invalid)?                   -- :77
  |           |      YES: set blank cookie                       -- :78-82
  |           |
  |           +--> Set locals.user = user, locals.session = session  -- :85-86
  |
  +--> [3] resolve(event) -- execute route handler                -- :91
  |
  +--> [4] Request logging (skip /_app/ and /favicon.svg)         -- :94-107
  |      Log level based on status: error(>=500), warn(>=400), info
  |
  +--> Return response                                            -- :109
```

### Type contract (app.d.ts)

```typescript
interface Locals {
  user: User | null;    // Lucia User type (id, email, name, isAdmin, disabledAt)
  session: Session | null;  // Lucia Session type (id, userId, expiresAt)
}
```

### Important behaviors

1. **Bearer auth takes priority** over session cookies (`:17-48` runs before `:50-88`).
2. **Disabled user check** is in the hooks layer, not in individual routes. A disabled user's session is immediately invalidated and their cookie cleared.
3. **Session refresh** uses Lucia's built-in `fresh` flag -- if the session is within its refresh window, a new cookie is issued with extended expiry (sliding window).
4. **API key users get `session: null`** -- they have a user object but no session. This is observable downstream.

---

## 5. Admin Operations

### User disable/enable

**File:** `apps/web/src/lib/server/trpc/routers/admin.ts` (toggleDisabled mutation)

```
Admin calls admin.toggleDisabled({ userId })
  |
  +--> adminProcedure enforces:                      -- init.ts:51-64
  |      ctx.user exists (UNAUTHORIZED)
  |      ctx.user.isAdmin (FORBIDDEN)
  |
  +--> Self-disable guard: userId !== ctx.user.id
  |      Throws BAD_REQUEST if trying to disable self
  |
  +--> Lookup current user.disabledAt
  |      Not found: throw NOT_FOUND
  |
  +--> Toggle: newDisabledAt = current ? null : new Date()
  |
  +--> db.update(users).set({ disabledAt, updatedAt })
  |
  +--> If disabling (newDisabledAt is set):
  |      lucia.invalidateUserSessions(userId)        -- immediate session kill
  |
  +--> Return updated user
```

### Admin route guards (layered)

```
Request to /admin/*
  |
  +--> hooks.server.ts: populate locals.user         -- (Flow 4)
  |
  +--> (app)/+layout.server.ts:                      -- :4-7
  |      if (!locals.user) redirect(302, '/auth/login?redirect=...')
  |      Returns { user: { id, email, name, isAdmin } }
  |
  +--> (app)/admin/+layout.server.ts:                -- :4-6
  |      const { user } = await parent()
  |      if (!user.isAdmin) error(403, 'Forbidden')
  |
  +--> (app)/admin/+page.server.ts:                  -- :35-91
         Loads: userList, importJobs, auditLog (last 200), storageStats
```

Three-layer guard: hooks (auth) -> app layout (login required) -> admin layout (isAdmin required).

---

## 6. Share Token / Guest Flow

### Share creation

**File:** `apps/web/src/lib/server/trpc/routers/shares.ts`

```
Owner calls shares.create({ mapId, accessLevel })
  |
  +--> protectedProcedure (must be logged in)
  +--> requireMapOwnership(ctx.user.id, mapId)
  |
  +--> Check if share already exists for this map
  |      |
  |      +-- Exists: update accessLevel, audit log 'share.update'
  |      +-- New:
  |           token = randomBytes(16).toString('base64url')    -- ~22 chars
  |           db.insert(shares).values({mapId, token, accessLevel})
  |           audit log 'share.create'
  |
  +--> Return share record
```

### Guest access via browser (SSR)

**File:** `apps/web/src/routes/(public)/share/[token]/+page.server.ts`

```
GET /share/{token}
  |
  +--> No auth required ((public) route group -- no (app) layout guard)
  |
  +--> db.select().from(shares).where(token)
  |      Not found: return { error: 'not_found' }
  |
  +--> db.select().from(maps).where(id == share.mapId)
  |      Not found: return { error: 'not_found' }
  |
  +--> db.select().from(layers).where(mapId).orderBy(zIndex)
  |
  +--> Return { map: {id, title, viewport, basemap}, layers, share: {token, accessLevel} }
```

### Guest access via REST API

**File:** `apps/web/src/routes/api/v1/middleware.ts:67-82`

```
GET /api/v1/maps?token={shareToken}
  |
  +--> resolveAuth() checks ?token param
  |      Lookup shares by token
  |      Return { userId: null, scope: 'read', mapScope: shareRow.mapId }
  |
  +--> Handler checks auth.mapScope:
  |      Can only access the specific map in mapScope
  |      scope is always 'read' (no writes)
```

### Guest access via tRPC

**File:** `apps/web/src/lib/server/trpc/routers/shares.ts` and `comments.ts`

```
shares.resolve({ token })                           -- publicProcedure, returns map + layers
comments.listForShare({ shareToken })               -- publicProcedure, returns comments for shared map
comments.createForShare({ shareToken, authorName, body })  -- publicProcedure, creates anonymous comment
```

### What guests CAN do

| Action | Channel | Auth |
|--------|---------|------|
| View map + layers | SSR (`/share/[token]`) | Share token in URL |
| View map + layers | tRPC (`shares.resolve`) | Share token in input |
| View map data | REST (`?token=...`) | Share token in query param |
| List comments | tRPC (`comments.listForShare`) | Share token in input |
| Post anonymous comment | tRPC (`comments.createForShare`) | Share token + authorName |

### What guests CANNOT do

- Edit map, layers, or features (no write scope)
- Access other maps (mapScope enforcement)
- Access user account features
- Create API keys or manage shares
- View audit log

### Permission enforcement

- **REST:** `resolveAuth()` returns `scope: 'read'`, `mapScope: shareRow.mapId`. `requireScope()` and `assertMapAccess()` enforce these at handler level.
- **tRPC:** The `publicProcedure` endpoints validate the share token themselves (query DB for token, fail if not found). There is no middleware-level share token validation for tRPC -- each procedure handles it inline.
- **SSR:** The `(public)` route group is outside `(app)`, so no login redirect fires. The `+page.server.ts` validates the token directly.

---

## Logout Flow (supplementary)

**File:** `apps/web/src/routes/auth/logout/+page.server.ts`

```
POST /auth/logout (form action)
  |
  +--> if (locals.session): lucia.invalidateSession(session.id)
  +--> cookies.set(blankCookie)
  +--> redirect(302, '/auth/login')
```

Session is invalidated server-side (deleted from DB). Cookie is overwritten with blank value. No client-side token storage to clear.

---

## Cross-Cutting Observations

### CSRF Protection

- **SvelteKit default:** `kit.csrf.checkOrigin` defaults to `true` when not explicitly set. The `svelte.config.js` does not override it, so SvelteKit's built-in Origin header check is active for all form submissions (POST/PUT/PATCH/DELETE).
- **No custom CSRF tokens** are used. The Origin check is the sole CSRF defense.
- **REST API:** Not subject to CSRF protection because API keys are sent via Authorization header (not cookies), and share tokens are in query params.

### Rate Limiting Summary

| Surface | Mechanism | Limits | File |
|---------|-----------|--------|------|
| Login form | In-memory sliding window | 10/60s per IP | `lib/server/rate-limit.ts` |
| Signup form | Same as login | 10/60s per IP | Same |
| REST v1 (API key) | In-memory sliding window | 100/1s per userId | `api/v1/middleware.ts:128-160` |
| REST v1 (share token) | In-memory sliding window | 30/1s per mapScope | Same |
| tRPC public procedures | **None** | -- | -- |
| tRPC protected procedures | **None** | -- | -- |

### Session lifecycle

| Event | What happens |
|-------|-------------|
| Login | `lucia.createSession()` -> row in `sessions` table -> cookie set |
| Page load (fresh session) | Cookie refreshed (sliding expiry) |
| Logout | `lucia.invalidateSession()` -> row deleted -> blank cookie |
| Admin disables user | `lucia.invalidateUserSessions()` -> all sessions deleted |
| Disabled user visits | hooks.server.ts detects `disabledAt`, invalidates current session, blanks cookie |

---

## Proposed Seeds

```json
[
  {
    "title": "Race condition in signup email uniqueness check",
    "type": "bug",
    "priority": "low",
    "labels": ["auth", "data-integrity"],
    "description": "Concurrent signups with same email can both pass the SELECT check. DB unique index catches it but returns 500 instead of friendly duplicate message. Add try/catch around INSERT to handle unique constraint violation gracefully."
  },
  {
    "title": "API key scope is hardcoded to read on creation",
    "type": "enhancement",
    "priority": "medium",
    "labels": ["api", "auth"],
    "description": "apiKeys.create does not accept a scope parameter. All keys default to read. Users who need read-write cannot get it through the API. Either add scope to the create input or add an updateScope mutation."
  },
  {
    "title": "No rate limiting on tRPC public procedures",
    "type": "bug",
    "priority": "medium",
    "labels": ["security", "rate-limiting"],
    "description": "comments.listForShare and comments.createForShare are publicProcedure with no rate limiting. An attacker could spam anonymous comments or enumerate share tokens via listForShare. Add IP-based rate limiting to these endpoints."
  }
]
```
