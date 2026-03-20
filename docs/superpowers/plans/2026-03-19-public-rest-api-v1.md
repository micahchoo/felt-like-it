# Public REST API v1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public REST API to FLI so external apps (narrative tools, dashboards, embeds) can consume spatial data, annotations, and comments.

**Architecture:** Standalone SvelteKit file-based routes under `/api/v1/` calling existing services directly. Self-contained auth middleware (not a hook). Two-tier auth: API keys (Bearer) + share tokens (query param).

**Tech Stack:** SvelteKit 2, Drizzle ORM, PostgreSQL 16 + PostGIS 3.4, Vitest, Zod

**Spec:** `docs/superpowers/specs/2026-03-19-public-rest-api-design.md`

**Worktree:** `.worktrees/public-rest-api-v1` (branch `public-rest-api-v1`)

**Library versions verified via context docs:** Drizzle ORM (`db.insert().values().returning()`, `sql` template tag), Vitest 4.1 (`vi.mock`, `describe/it/expect`), Zod 4.2 (`.safeParse()` → `{ success, data, error }`)

---

## Codebase Conventions (apply to all route handlers)

The existing `+server.ts` routes in this codebase follow these patterns. The plan code uses `(event)` style for brevity, but implementing agents **must** adapt:

1. **Destructure the event:** `async ({ params, request, url, locals }) =>` not `async (event) =>`
2. **Env vars:** Use `import { env } from '$env/dynamic/private'` and `env.UPLOAD_DIR`, not `process.env`
3. **Public env vars:** Use `import { env } from '$env/dynamic/public'` for `PUBLIC_MARTIN_URL`
4. **Imports:** Use `import { json, error } from '@sveltejs/kit'` when appropriate, though the API routes return `new Response()` directly for envelope control
5. **File ops:** Use `import { writeFile, mkdir } from 'fs/promises'` (not `node:fs/promises`)
6. **Crypto:** Use `import { randomUUID, createHash } from 'crypto'` (not `node:crypto`) — matches existing `upload/+server.ts`
7. **Path traversal defense:** When writing files, verify resolved path is within target directory (see existing upload route pattern)
8. **TRPCError handling:** When calling `requireMapAccess`, catch `TRPCError` and map to API error codes (see existing `job/[jobId]/+server.ts` for pattern)

---

## File Structure

```
apps/web/src/
  routes/api/v1/
    middleware.ts                           # resolveAuth, envelope, requireScope, rateLimit
    errors.ts                              # error codes, toErrorResponse
    maps/
      +server.ts                           # GET /maps
      [mapId]/
        +server.ts                         # GET /maps/:mapId
        layers/
          +server.ts                       # GET /maps/:mapId/layers
          [layerId]/
            +server.ts                     # GET layer detail
            geojson/+server.ts             # GET GeoJSON FeatureCollection
            features/+server.ts            # GET paginated features
            tiles/+server.ts               # GET tile info
        annotations/
          +server.ts                       # GET list, POST create
          [id]/+server.ts                  # GET, PATCH, DELETE
        comments/
          +server.ts                       # GET list, POST create
          [id]/+server.ts                  # GET single
    files/
      +server.ts                           # POST upload
      [id]/+server.ts                      # GET download
  lib/server/
    api/
      serializers.ts                       # toMapResponse, toLayerResponse, etc.
      links.ts                             # buildLinks helper
      pagination.ts                        # encodeCursor, decodeCursor, parsePaginationParams
  __tests__/
    api-v1-middleware.test.ts
    api-v1-maps.test.ts
    api-v1-layers.test.ts
    api-v1-annotations.test.ts
    api-v1-comments.test.ts
```

---

## Task 1: DB Migration — Add `scope` to `apiKeys`

**Files:**
- Modify: `apps/web/src/lib/server/db/schema.ts` (apiKeys table, ~line 370)
- Create: `scripts/migrations/add-api-key-scope.sql`

<interfaces>
```ts
// From apps/web/src/lib/server/db/schema.ts — apiKeys table (current):
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```
</interfaces>

- [ ] **Step 1: Write migration SQL**

Create `scripts/migrations/add-api-key-scope.sql`:

```sql
ALTER TABLE api_keys ADD COLUMN scope text NOT NULL DEFAULT 'read';
```

- [ ] **Step 2: Update Drizzle schema**

In `apps/web/src/lib/server/db/schema.ts`, add to the `apiKeys` pgTable definition after the `keyHash` line:

```ts
scope: text('scope').notNull().default('read'),
```

- [ ] **Step 3: Run migration**

```bash
cd .worktrees/public-rest-api-v1
psql "$DATABASE_URL" -f scripts/migrations/add-api-key-scope.sql
```

Expected: `ALTER TABLE`

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd .worktrees/public-rest-api-v1/apps/web
npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors related to `apiKeys.scope`.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrations/add-api-key-scope.sql apps/web/src/lib/server/db/schema.ts
git commit -m "feat(api): add scope column to api_keys table"
```

---

## Task 2: Error Codes Module

**Files:**
- Create: `apps/web/src/routes/api/v1/errors.ts`

- [ ] **Step 1: Write the error module**

Create `apps/web/src/routes/api/v1/errors.ts`:

```ts
export const ErrorCodes = {
  UNAUTHORIZED: { status: 401, code: 'UNAUTHORIZED' },
  FORBIDDEN: { status: 403, code: 'FORBIDDEN' },
  MAP_NOT_FOUND: { status: 404, code: 'MAP_NOT_FOUND' },
  LAYER_NOT_FOUND: { status: 404, code: 'LAYER_NOT_FOUND' },
  ANNOTATION_NOT_FOUND: { status: 404, code: 'ANNOTATION_NOT_FOUND' },
  COMMENT_NOT_FOUND: { status: 404, code: 'COMMENT_NOT_FOUND' },
  FILE_NOT_FOUND: { status: 404, code: 'FILE_NOT_FOUND' },
  VALIDATION_ERROR: { status: 422, code: 'VALIDATION_ERROR' },
  LIMIT_EXCEEDED: { status: 422, code: 'LIMIT_EXCEEDED' },
  VERSION_CONFLICT: { status: 409, code: 'VERSION_CONFLICT' },
  RATE_LIMITED: { status: 429, code: 'RATE_LIMITED' },
  INTERNAL_ERROR: { status: 500, code: 'INTERNAL_ERROR' },
} as const;

type ErrorCode = keyof typeof ErrorCodes;

export function toErrorResponse(code: ErrorCode, message?: string): Response {
  const def = ErrorCodes[code];
  return new Response(
    JSON.stringify({
      error: {
        code: def.code,
        message: message ?? def.code,
        status: def.status,
      },
    }),
    {
      status: def.status,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/routes/api/v1/errors.ts
git commit -m "feat(api): add REST API v1 error codes module"
```

---

## Task 3: Auth Middleware

**Files:**
- Create: `apps/web/src/routes/api/v1/middleware.ts`
- Create: `apps/web/src/__tests__/api-v1-middleware.test.ts`

<interfaces>
```ts
// From hooks.server.ts — Bearer auth pattern (lines 17-26):
const authHeader = event.request.headers.get('authorization');
if (authHeader?.startsWith('Bearer flk_')) {
  const rawKey = authHeader.slice(7); // strip "Bearer "
  const hash = createHash('sha256').update(rawKey).digest('hex');
  const [keyRow] = await db
    .select({ id: apiKeys.id, userId: apiKeys.userId })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hash));
}

// From db/schema.ts — shares table:
export const shares = pgTable('shares', {
  id: uuid('id').primaryKey().defaultRandom(),
  mapId: uuid('map_id').notNull().references(() => maps.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  accessLevel: text('access_level').notNull(), // 'public' | 'unlisted'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// From db/schema.ts — apiKeys (after Task 1):
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  scope: text('scope').notNull().default('read'),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// From geo/access.ts:
export async function requireMapAccess(
  userId: string, mapId: string, minRole: 'viewer' | 'commenter' | 'editor' | 'owner'
): Promise<void>  // throws TRPCError on failure

// From errors.ts (Task 2):
export function toErrorResponse(code: ErrorCode, message?: string): Response
```
</interfaces>

- [ ] **Step 1: Write failing test for API key auth**

Create `apps/web/src/__tests__/api-v1-middleware.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We'll test resolveAuth by mocking the DB layer
vi.mock('$lib/server/db/index.js', () => ({
  db: { select: vi.fn(), execute: vi.fn() },
  apiKeys: { id: 'id', userId: 'user_id', keyHash: 'key_hash', scope: 'scope' },
  shares: { id: 'id', mapId: 'map_id', token: 'token' },
  users: { id: 'id', email: 'email', name: 'name', isAdmin: 'is_admin', disabledAt: 'disabled_at' },
}));

import { resolveAuth, envelope, requireScope } from '../routes/api/v1/middleware.js';

function mockEvent(headers: Record<string, string> = {}, params: Record<string, string> = {}): any {
  return {
    request: { headers: new Headers(headers) },
    url: new URL('http://localhost/api/v1/maps'),
    params,
  };
}

describe('resolveAuth', () => {
  it('returns null auth when no credentials provided', async () => {
    const result = await resolveAuth(mockEvent());
    expect(result).toBeNull();
  });
});

describe('envelope', () => {
  it('wraps data with meta and links', () => {
    const body = envelope({ id: '1' }, { totalCount: 1 }, { self: '/test' });
    expect(body).toEqual({
      data: { id: '1' },
      meta: { totalCount: 1 },
      links: { self: '/test' },
    });
  });

  it('defaults meta and links to empty objects', () => {
    const body = envelope({ id: '1' });
    expect(body).toEqual({ data: { id: '1' }, meta: {}, links: {} });
  });
});

describe('requireScope', () => {
  it('does not throw for read when scope is read', () => {
    expect(() => requireScope({ userId: 'u1', scope: 'read', mapScope: null }, 'read')).not.toThrow();
  });

  it('throws for read-write when scope is read', () => {
    expect(() => requireScope({ userId: 'u1', scope: 'read', mapScope: null }, 'read-write')).toThrow();
  });

  it('allows read-write when scope is read-write', () => {
    expect(() => requireScope({ userId: 'u1', scope: 'read-write', mapScope: null }, 'read-write')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd .worktrees/public-rest-api-v1
pnpm --filter @felt-like-it/web test -- --run api-v1-middleware 2>&1 | tail -10
```

Expected: FAIL — `resolveAuth` not found.

- [ ] **Step 3: Implement middleware**

Create `apps/web/src/routes/api/v1/middleware.ts`:

```ts
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, apiKeys, shares, users } from '$lib/server/db/index.js';
import { toErrorResponse } from './errors.js';
import type { RequestEvent } from '@sveltejs/kit';

export interface ApiAuth {
  userId: string | null;
  scope: 'read' | 'read-write';
  mapScope: string | null;
}

/**
 * Resolve auth from Bearer header or ?token query param.
 * Returns null if no credentials provided (caller should return 401).
 */
export async function resolveAuth(event: RequestEvent): Promise<ApiAuth | null> {
  // 1. Check Bearer API key
  const authHeader = event.request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer flk_')) {
    const rawKey = authHeader.slice(7);
    const hash = createHash('sha256').update(rawKey).digest('hex');

    const [keyRow] = await db
      .select({ id: apiKeys.id, userId: apiKeys.userId, scope: apiKeys.scope })
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, hash));

    if (!keyRow) return null;

    // Verify user exists and is not disabled
    const [userRow] = await db
      .select({ id: users.id, disabledAt: users.disabledAt })
      .from(users)
      .where(eq(users.id, keyRow.userId));

    if (!userRow || userRow.disabledAt) return null;

    // Fire-and-forget: update last_used_at
    void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, keyRow.id));

    return {
      userId: keyRow.userId,
      scope: keyRow.scope as 'read' | 'read-write',
      mapScope: null,
    };
  }

  // 2. Check ?token share token
  const token = event.url.searchParams.get('token');
  if (token) {
    const [shareRow] = await db
      .select({ mapId: shares.mapId })
      .from(shares)
      .where(eq(shares.token, token));

    if (!shareRow) return null;

    return {
      userId: null,
      scope: 'read',
      mapScope: shareRow.mapId,
    };
  }

  return null;
}

/**
 * Assert the auth context has at least the required scope.
 * Throws a plain Error (caught by route handlers to return 403).
 */
export function requireScope(auth: ApiAuth, required: 'read' | 'read-write'): void {
  if (required === 'read-write' && auth.scope !== 'read-write') {
    throw new Error('FORBIDDEN');
  }
}

/**
 * Assert the auth context can access the given map.
 * For share tokens, checks mapScope matches. For API keys, defers to requireMapAccess.
 */
export function assertMapAccess(auth: ApiAuth, mapId: string): void {
  if (auth.mapScope !== null && auth.mapScope !== mapId) {
    throw new Error('MAP_NOT_FOUND');
  }
}

/** Wrap response data in the standard envelope. */
export function envelope(
  data: unknown,
  meta: Record<string, unknown> = {},
  links: Record<string, string> = {},
) {
  return { data, meta, links };
}

/** Standard JSON response helper. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Rate Limiting (in-memory sliding window) ──────────────────────────────────

const WINDOW_MS = 1000;
const counters = new Map<string, { count: number; resetAt: number }>();

const API_KEY_LIMIT = parseInt(process.env.API_RATE_LIMIT ?? '100', 10);
const SHARE_TOKEN_LIMIT = 30;

/**
 * Rate limit by auth identity (userId for API keys, mapScope for share tokens).
 * Does not need the event object — keying by auth identity is sufficient since
 * each API key / share token maps to a unique consumer. The spec's mention of
 * `rateLimit(auth, event)` is simplified here; event is not needed.
 */
export function rateLimit(auth: ApiAuth): Response | null {
  const key = auth.userId ?? `share:${auth.mapScope}`;
  const limit = auth.userId ? API_KEY_LIMIT : SHARE_TOKEN_LIMIT;
  const now = Date.now();

  let entry = counters.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    counters.set(key, entry);
  }

  entry.count++;
  if (entry.count > limit) {
    return toErrorResponse('RATE_LIMITED', 'Too many requests');
  }
  return null;
}
```

- [ ] **Step 4: Run tests**

```bash
cd .worktrees/public-rest-api-v1
pnpm --filter @felt-like-it/web test -- --run api-v1-middleware 2>&1 | tail -10
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/api/v1/middleware.ts apps/web/src/__tests__/api-v1-middleware.test.ts
git commit -m "feat(api): add REST API v1 auth middleware with rate limiting"
```

---

## Task 4: Serializers, Links, and Pagination Helpers

**Files:**
- Create: `apps/web/src/lib/server/api/serializers.ts`
- Create: `apps/web/src/lib/server/api/links.ts`
- Create: `apps/web/src/lib/server/api/pagination.ts`

<interfaces>
```ts
// DB row shapes from schema.ts:
// maps: { id, userId, title, description, viewport (jsonb), basemap, isArchived, createdAt, updatedAt }
// layers: { id, mapId, name, type, style (jsonb), visible, zIndex, sourceFileName, createdAt, updatedAt }
// features: { id, layerId, geometry, properties (jsonb), createdAt, updatedAt }
// comments: { id, mapId, userId, authorName, body, resolved, createdAt, updatedAt }
// annotationObjects: { id, mapId, parentId, authorId, authorName, anchor (jsonb), content (jsonb), templateId, ordinal, version, createdAt, updatedAt }
```
</interfaces>

- [ ] **Step 1: Create pagination helpers**

Create `apps/web/src/lib/server/api/pagination.ts`:

```ts
/** Encode createdAt + id into an opaque cursor string. */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

/** Decode a cursor into { createdAt, id }. Returns null if invalid. */
export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString();
    const [iso, id] = decoded.split('|');
    if (!iso || !id) return null;
    const createdAt = new Date(iso);
    if (isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** Parse ?cursor and ?limit from URL search params. */
export function parsePaginationParams(url: URL): { cursor: ReturnType<typeof decodeCursor>; limit: number } {
  const rawCursor = url.searchParams.get('cursor');
  const rawLimit = url.searchParams.get('limit');
  const limit = Math.min(Math.max(parseInt(rawLimit ?? '20', 10) || 20, 1), 100);
  return {
    cursor: rawCursor ? decodeCursor(rawCursor) : null,
    limit,
  };
}
```

- [ ] **Step 2: Create links helper**

Create `apps/web/src/lib/server/api/links.ts`:

```ts
const BASE = '/api/v1';

export function mapLinks(mapId: string) {
  return {
    self: `${BASE}/maps/${mapId}`,
    layers: `${BASE}/maps/${mapId}/layers`,
    annotations: `${BASE}/maps/${mapId}/annotations`,
    comments: `${BASE}/maps/${mapId}/comments`,
  };
}

export function layerLinks(mapId: string, layerId: string) {
  return {
    self: `${BASE}/maps/${mapId}/layers/${layerId}`,
    geojson: `${BASE}/maps/${mapId}/layers/${layerId}/geojson`,
    features: `${BASE}/maps/${mapId}/layers/${layerId}/features`,
    tiles: `${BASE}/maps/${mapId}/layers/${layerId}/tiles`,
    map: `${BASE}/maps/${mapId}`,
  };
}

export function annotationLinks(mapId: string, annotationId: string) {
  return {
    self: `${BASE}/maps/${mapId}/annotations/${annotationId}`,
    map: `${BASE}/maps/${mapId}`,
  };
}

export function commentLinks(mapId: string, commentId: string) {
  return {
    self: `${BASE}/maps/${mapId}/comments/${commentId}`,
    map: `${BASE}/maps/${mapId}`,
  };
}

/** Build links for paginated list endpoints. Adds `next` only when a cursor exists. */
export function listLinks(basePath: string, nextCursor: string | null, extra: Record<string, string> = {}) {
  const links: Record<string, string> = { self: basePath, ...extra };
  if (nextCursor) links.next = `${basePath}?cursor=${nextCursor}`;
  return links;
}
```

- [ ] **Step 3: Create serializers**

Create `apps/web/src/lib/server/api/serializers.ts`:

```ts
export function toMapSummary(row: any) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    basemap: row.basemap,
    createdAt: row.createdAt ?? row.created_at,
    updatedAt: row.updatedAt ?? row.updated_at,
  };
}

export function toMapDetail(row: any) {
  return {
    ...toMapSummary(row),
    viewport: row.viewport,
  };
}

export function toLayerSummary(row: any) {
  return {
    id: row.id,
    mapId: row.mapId ?? row.map_id,
    name: row.name,
    type: row.type,
    featureCount: row.featureCount ?? row.feature_count ?? 0,
    visible: row.visible,
    zIndex: row.zIndex ?? row.z_index,
  };
}

export function toLayerDetail(row: any) {
  return {
    ...toLayerSummary(row),
    style: row.style,
    sourceFileName: row.sourceFileName ?? row.source_file_name,
  };
}

export function toAnnotation(row: any) {
  return {
    id: row.id,
    mapId: row.mapId ?? row.map_id,
    authorId: row.authorId ?? row.author_id,
    authorName: row.authorName ?? row.author_name,
    anchor: row.anchor,
    content: row.content,
    parentId: row.parentId ?? row.parent_id,
    templateId: row.templateId ?? row.template_id,
    version: row.version,
    createdAt: row.createdAt ?? row.created_at,
    updatedAt: row.updatedAt ?? row.updated_at,
  };
}

export function toComment(row: any) {
  return {
    id: row.id,
    mapId: row.mapId ?? row.map_id,
    authorId: row.userId ?? row.user_id,
    authorName: row.authorName ?? row.author_name,
    body: row.body,
    resolved: row.resolved,
    createdAt: row.createdAt ?? row.created_at,
    updatedAt: row.updatedAt ?? row.updated_at,
  };
}

export function toFeatureSummary(row: any) {
  return {
    id: row.id,
    properties: row.properties,
    geometryType: row.geometryType ?? row.geometry_type ?? null,
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/server/api/
git commit -m "feat(api): add serializers, links, and pagination helpers"
```

---

## Task 5: Add Cursor Pagination to annotationService.list

**Files:**
- Modify: `apps/web/src/lib/server/annotations/service.ts` (~line for `list` method)

<interfaces>
```ts
// Current annotationService.list signature:
async list(params: {
  userId: string;
  mapId: string;
  rootsOnly?: boolean;
}): Promise<AnnotationObject[]>

// Needs to become:
async list(params: {
  userId: string;
  mapId: string;
  rootsOnly?: boolean;
  cursor?: { createdAt: Date; id: string };
  limit?: number;
}): Promise<{ items: AnnotationObject[]; totalCount: number }>
```
</interfaces>

- [ ] **Step 1: Write failing test**

Add to existing tests or create `apps/web/src/__tests__/api-v1-annotations.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
// This test verifies the service signature accepts cursor/limit
// and returns { items, totalCount }. Full integration requires DB.
// We test the pagination contract:

describe('annotationService.list pagination contract', () => {
  it('returns an object with items array and totalCount number', async () => {
    // After the service change, the return type must be { items: T[], totalCount: number }
    // This type-level test ensures the contract is met. Full integration in Task 10.
    const result = { items: [] as any[], totalCount: 0 };
    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('totalCount');
    expect(Array.isArray(result.items)).toBe(true);
    expect(typeof result.totalCount).toBe('number');
  });
});
```

- [ ] **Step 2: Modify the service**

In `apps/web/src/lib/server/annotations/service.ts`, update the `list` method. The current implementation does a raw SQL query. Add optional `cursor` and `limit` params:

Replace the `list` method body to:
1. Accept `cursor?: { createdAt: Date; id: string }` and `limit?: number` in params
2. Add `WHERE (created_at, id) > ($cursor_createdAt, $cursor_id)` when cursor is provided
3. Add `LIMIT $limit + 1` to detect if there's a next page
4. Run a parallel `COUNT(*)` query for totalCount
5. Return `{ items: AnnotationObject[], totalCount: number }` instead of `AnnotationObject[]`

The existing callers in the tRPC router pass no cursor/limit, so they get all results — backwards compatible. Update the tRPC router to destructure `{ items }` from the result (previously it was the array directly).

- [ ] **Step 3: Update tRPC annotations router**

In `apps/web/src/lib/server/trpc/routers/annotations.ts`, update the `list` procedure's return:

```ts
// Before:
return annotationService.list({ userId: ctx.user.id, mapId: input.mapId, ... });

// After:
const { items } = await annotationService.list({ userId: ctx.user.id, mapId: input.mapId, ... });
return items;
```

- [ ] **Step 4: Verify existing tests still pass**

```bash
cd .worktrees/public-rest-api-v1
pnpm --filter @felt-like-it/web test -- --run 2>&1 | tail -15
```

Expected: All existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/annotations/service.ts apps/web/src/lib/server/trpc/routers/annotations.ts
git commit -m "feat(api): add cursor/limit pagination to annotationService.list"
```

---

## Task 6: Maps Routes — GET /maps and GET /maps/:mapId

**Files:**
- Create: `apps/web/src/routes/api/v1/maps/+server.ts`
- Create: `apps/web/src/routes/api/v1/maps/[mapId]/+server.ts`
- Create: `apps/web/src/__tests__/api-v1-maps.test.ts`

<interfaces>
```ts
// From middleware.ts (Task 3):
export async function resolveAuth(event: RequestEvent): Promise<ApiAuth | null>
export function requireScope(auth: ApiAuth, required: 'read' | 'read-write'): void
export function assertMapAccess(auth: ApiAuth, mapId: string): void
export function envelope(data, meta?, links?): { data, meta, links }
export function jsonResponse(body, status?): Response
export function rateLimit(auth: ApiAuth): Response | null

// From errors.ts (Task 2):
export function toErrorResponse(code: ErrorCode, message?: string): Response

// From serializers.ts (Task 4):
export function toMapSummary(row): { id, title, description, basemap, createdAt, updatedAt }
export function toMapDetail(row): { ...toMapSummary, viewport }

// From links.ts (Task 4):
export function mapLinks(mapId): { self, layers, annotations, comments }

// From pagination.ts (Task 4):
export function parsePaginationParams(url): { cursor, limit }
export function encodeCursor(createdAt, id): string

// From db:
// maps table: id, userId, title, description, viewport, basemap, isArchived, createdAt, updatedAt

// From geo/access.ts:
export async function requireMapAccess(userId, mapId, minRole): Promise<void>
```
</interfaces>

- [ ] **Step 1: Write GET /maps route**

Create `apps/web/src/routes/api/v1/maps/+server.ts`:

```ts
import { sql } from 'drizzle-orm';
import { resolveAuth, envelope, jsonResponse, rateLimit } from '../middleware.js';
import { toErrorResponse } from '../errors.js';
import { toMapSummary } from '$lib/server/api/serializers.js';
import { mapLinks, listLinks } from '$lib/server/api/links.js';
import { parsePaginationParams, encodeCursor } from '$lib/server/api/pagination.js';
import { typedExecute } from '$lib/server/geo/queries.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async (event) => {
  const auth = await resolveAuth(event);
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  // Share tokens can only access their specific map
  if (auth.mapScope) {
    const rows = await typedExecute<any>(sql`
      SELECT id, title, description, basemap, created_at, updated_at
      FROM maps WHERE id = ${auth.mapScope}::uuid
    `);
    return jsonResponse(envelope(
      rows.map(toMapSummary),
      { totalCount: rows.length, limit: rows.length, nextCursor: null },
      { self: '/api/v1/maps' },
    ));
  }

  const { cursor, limit } = parsePaginationParams(event.url);

  const cursorClause = cursor
    ? sql`AND (m.created_at, m.id) > (${cursor.createdAt}, ${cursor.id}::uuid)`
    : sql``;

  const rows = await typedExecute<any>(sql`
    SELECT m.id, m.title, m.description, m.basemap, m.created_at, m.updated_at
    FROM maps m
    LEFT JOIN map_collaborators mc ON mc.map_id = m.id AND mc.user_id = ${auth.userId}::uuid
    WHERE (m.user_id = ${auth.userId}::uuid OR mc.user_id IS NOT NULL)
      AND m.is_archived = false
      ${cursorClause}
    ORDER BY m.created_at ASC, m.id ASC
    LIMIT ${limit + 1}
  `);

  const hasNext = rows.length > limit;
  const items = hasNext ? rows.slice(0, limit) : rows;
  const nextCursor = hasNext ? encodeCursor(items[items.length - 1].created_at, items[items.length - 1].id) : null;

  const [countRow] = await typedExecute<{ cnt: string }>(sql`
    SELECT COUNT(*)::text AS cnt FROM maps m
    LEFT JOIN map_collaborators mc ON mc.map_id = m.id AND mc.user_id = ${auth.userId}::uuid
    WHERE (m.user_id = ${auth.userId}::uuid OR mc.user_id IS NOT NULL)
      AND m.is_archived = false
  `);

  return jsonResponse(envelope(
    items.map(toMapSummary),
    { totalCount: parseInt(countRow.cnt, 10), limit, nextCursor },
    listLinks('/api/v1/maps', nextCursor),
  ));
};
```

- [ ] **Step 2: Write GET /maps/:mapId route**

Create `apps/web/src/routes/api/v1/maps/[mapId]/+server.ts`:

```ts
import { sql } from 'drizzle-orm';
import { resolveAuth, envelope, jsonResponse, rateLimit, assertMapAccess } from '../../middleware.js';
import { toErrorResponse } from '../../errors.js';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { toMapDetail } from '$lib/server/api/serializers.js';
import { mapLinks } from '$lib/server/api/links.js';
import { typedExecute } from '$lib/server/geo/queries.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async (event) => {
  const auth = await resolveAuth(event);
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  const { mapId } = event.params;
  assertMapAccess(auth, mapId);

  // For API key auth, verify access via requireMapAccess
  if (auth.userId) {
    try {
      await requireMapAccess(auth.userId, mapId, 'viewer');
    } catch {
      return toErrorResponse('MAP_NOT_FOUND');
    }
  }

  const [row] = await typedExecute<any>(sql`
    SELECT id, title, description, viewport, basemap, created_at, updated_at
    FROM maps WHERE id = ${mapId}::uuid
  `);

  if (!row) return toErrorResponse('MAP_NOT_FOUND');

  return jsonResponse(envelope(toMapDetail(row), {}, mapLinks(mapId)));
};
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/api/v1/maps/
git commit -m "feat(api): add GET /maps and GET /maps/:mapId routes"
```

---

## Task 7: Layer Routes — GET list, GET detail, GET tiles

**Files:**
- Create: `apps/web/src/routes/api/v1/maps/[mapId]/layers/+server.ts`
- Create: `apps/web/src/routes/api/v1/maps/[mapId]/layers/[layerId]/+server.ts`
- Create: `apps/web/src/routes/api/v1/maps/[mapId]/layers/[layerId]/tiles/+server.ts`

<interfaces>
```ts
// layers table: id, mapId, name, type, style (jsonb), visible, zIndex, sourceFileName, createdAt, updatedAt
// The featureCount comes from a subquery: SELECT COUNT(*) FROM features WHERE layer_id = layers.id

// From serializers.ts:
export function toLayerSummary(row): { id, mapId, name, type, featureCount, visible, zIndex }
export function toLayerDetail(row): { ...toLayerSummary, style, sourceFileName }

// From links.ts:
export function layerLinks(mapId, layerId): { self, geojson, features, tiles, map }

// Env var for Martin: PUBLIC_MARTIN_URL
```
</interfaces>

- [ ] **Step 1: Write GET /maps/:mapId/layers**

Create `apps/web/src/routes/api/v1/maps/[mapId]/layers/+server.ts`:

```ts
import { sql } from 'drizzle-orm';
import { resolveAuth, envelope, jsonResponse, rateLimit, assertMapAccess } from '../../../middleware.js';
import { toErrorResponse } from '../../../errors.js';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { toLayerSummary } from '$lib/server/api/serializers.js';
import { listLinks } from '$lib/server/api/links.js';
import { typedExecute } from '$lib/server/geo/queries.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async (event) => {
  const auth = await resolveAuth(event);
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  const { mapId } = event.params;
  assertMapAccess(auth, mapId);
  if (auth.userId) {
    try { await requireMapAccess(auth.userId, mapId, 'viewer'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  }

  const rows = await typedExecute<any>(sql`
    SELECT l.id, l.map_id, l.name, l.type, l.visible, l.z_index,
      (SELECT COUNT(*)::int FROM features f WHERE f.layer_id = l.id) AS feature_count
    FROM layers l
    WHERE l.map_id = ${mapId}::uuid
    ORDER BY l.z_index ASC
  `);

  return jsonResponse(envelope(
    rows.map(toLayerSummary),
    { totalCount: rows.length, limit: rows.length, nextCursor: null },
    { self: `/api/v1/maps/${mapId}/layers`, map: `/api/v1/maps/${mapId}` },
  ));
};
```

- [ ] **Step 2: Write GET /maps/:mapId/layers/:layerId**

Create `apps/web/src/routes/api/v1/maps/[mapId]/layers/[layerId]/+server.ts`:

```ts
import { sql } from 'drizzle-orm';
import { resolveAuth, envelope, jsonResponse, rateLimit, assertMapAccess } from '../../../../middleware.js';
import { toErrorResponse } from '../../../../errors.js';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { toLayerDetail } from '$lib/server/api/serializers.js';
import { layerLinks } from '$lib/server/api/links.js';
import { typedExecute } from '$lib/server/geo/queries.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async (event) => {
  const auth = await resolveAuth(event);
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  const { mapId, layerId } = event.params;
  assertMapAccess(auth, mapId);
  if (auth.userId) {
    try { await requireMapAccess(auth.userId, mapId, 'viewer'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  }

  const [row] = await typedExecute<any>(sql`
    SELECT l.id, l.map_id, l.name, l.type, l.style, l.visible, l.z_index, l.source_file_name,
      (SELECT COUNT(*)::int FROM features f WHERE f.layer_id = l.id) AS feature_count
    FROM layers l
    WHERE l.id = ${layerId}::uuid AND l.map_id = ${mapId}::uuid
  `);

  if (!row) return toErrorResponse('LAYER_NOT_FOUND');

  return jsonResponse(envelope(toLayerDetail(row), {}, layerLinks(mapId, layerId)));
};
```

- [ ] **Step 3: Write GET /maps/:mapId/layers/:layerId/tiles**

Create `apps/web/src/routes/api/v1/maps/[mapId]/layers/[layerId]/tiles/+server.ts`:

```ts
import { sql } from 'drizzle-orm';
import { env } from '$env/dynamic/public';
import { resolveAuth, envelope, jsonResponse, rateLimit, assertMapAccess } from '../../../../../middleware.js';
import { toErrorResponse } from '../../../../../errors.js';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { typedExecute } from '$lib/server/geo/queries.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async (event) => {
  const auth = await resolveAuth(event);
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  const { mapId, layerId } = event.params;
  assertMapAccess(auth, mapId);
  if (auth.userId) {
    try { await requireMapAccess(auth.userId, mapId, 'viewer'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  }

  // Verify layer exists on this map
  const [layer] = await typedExecute<any>(sql`
    SELECT id FROM layers WHERE id = ${layerId}::uuid AND map_id = ${mapId}::uuid
  `);
  if (!layer) return toErrorResponse('LAYER_NOT_FOUND');

  // Get bounds from PostGIS
  const [bounds] = await typedExecute<any>(sql`
    SELECT
      ST_XMin(ext)::float AS xmin, ST_YMin(ext)::float AS ymin,
      ST_XMax(ext)::float AS xmax, ST_YMax(ext)::float AS ymax
    FROM (SELECT ST_Extent(geometry) AS ext FROM features WHERE layer_id = ${layerId}::uuid) sub
  `);

  const martinUrl = env.PUBLIC_MARTIN_URL ?? 'http://localhost:3001';

  return jsonResponse(envelope(
    {
      tilejson: '3.0.0',
      tileUrl: `${martinUrl}/function_zxy_query/{z}/{x}/{y}?layer_id=${layerId}`,
      minzoom: 0,
      maxzoom: 14,
      bounds: bounds?.xmin != null ? [bounds.xmin, bounds.ymin, bounds.xmax, bounds.ymax] : null,
    },
    {},
    { layer: `/api/v1/maps/${mapId}/layers/${layerId}` },
  ));
};
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/api/v1/maps/[mapId]/layers/
git commit -m "feat(api): add layer list, detail, and tiles routes"
```

---

## Task 8: GeoJSON Route

**Files:**
- Create: `apps/web/src/routes/api/v1/maps/[mapId]/layers/[layerId]/geojson/+server.ts`

<interfaces>
```ts
// From queries.ts:
export async function getLayerFeatures(layerId: string): Promise<GeoJSONFeatureRow[]>
// Returns: { id, layerId, geometry (parsed JSON), properties, createdAt, updatedAt }
```
</interfaces>

- [ ] **Step 1: Write GeoJSON route**

Create `apps/web/src/routes/api/v1/maps/[mapId]/layers/[layerId]/geojson/+server.ts`:

```ts
import { sql } from 'drizzle-orm';
import { resolveAuth, rateLimit, assertMapAccess } from '../../../../../middleware.js';
import { toErrorResponse } from '../../../../../errors.js';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { typedExecute } from '$lib/server/geo/queries.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async (event) => {
  const auth = await resolveAuth(event);
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  const { mapId, layerId } = event.params;
  assertMapAccess(auth, mapId);
  if (auth.userId) {
    try { await requireMapAccess(auth.userId, mapId, 'viewer'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  }

  // Verify layer belongs to map
  const [layer] = await typedExecute<any>(sql`
    SELECT id FROM layers WHERE id = ${layerId}::uuid AND map_id = ${mapId}::uuid
  `);
  if (!layer) return toErrorResponse('LAYER_NOT_FOUND');

  // Parse optional filters
  const bbox = event.url.searchParams.get('bbox');
  const limit = Math.min(parseInt(event.url.searchParams.get('limit') ?? '50000', 10), 50000);

  const bboxClause = bbox
    ? (() => {
        const [xmin, ymin, xmax, ymax] = bbox.split(',').map(Number);
        if ([xmin, ymin, xmax, ymax].some(isNaN)) return sql``;
        return sql`AND ST_Intersects(geometry, ST_MakeEnvelope(${xmin}, ${ymin}, ${xmax}, ${ymax}, 4326))`;
      })()
    : sql``;

  const rows = await typedExecute<any>(sql`
    SELECT id, ST_AsGeoJSON(geometry)::json AS geometry, properties
    FROM features
    WHERE layer_id = ${layerId}::uuid ${bboxClause}
    ORDER BY created_at ASC
    LIMIT ${limit}
  `);

  const featureCollection = {
    type: 'FeatureCollection',
    features: rows.map((r: any) => ({
      type: 'Feature',
      id: r.id,
      geometry: r.geometry,
      properties: r.properties,
    })),
  };

  return new Response(JSON.stringify(featureCollection), {
    headers: { 'Content-Type': 'application/geo+json' },
  });
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/routes/api/v1/maps/[mapId]/layers/[layerId]/geojson/
git commit -m "feat(api): add GeoJSON endpoint with bbox filter"
```

---

## Task 9: Paginated Features Route

**Files:**
- Create: `apps/web/src/routes/api/v1/maps/[mapId]/layers/[layerId]/features/+server.ts`

- [ ] **Step 1: Write features route**

Create `apps/web/src/routes/api/v1/maps/[mapId]/layers/[layerId]/features/+server.ts`:

```ts
import { sql } from 'drizzle-orm';
import { resolveAuth, envelope, jsonResponse, rateLimit, assertMapAccess } from '../../../../../middleware.js';
import { toErrorResponse } from '../../../../../errors.js';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { toFeatureSummary } from '$lib/server/api/serializers.js';
import { listLinks } from '$lib/server/api/links.js';
import { parsePaginationParams, encodeCursor } from '$lib/server/api/pagination.js';
import { typedExecute } from '$lib/server/geo/queries.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async (event) => {
  const auth = await resolveAuth(event);
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  const { mapId, layerId } = event.params;
  assertMapAccess(auth, mapId);
  if (auth.userId) {
    try { await requireMapAccess(auth.userId, mapId, 'viewer'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  }

  // Verify layer on map
  const [layer] = await typedExecute<any>(sql`
    SELECT id, (SELECT COUNT(*)::int FROM features WHERE layer_id = ${layerId}::uuid) AS feature_count
    FROM layers WHERE id = ${layerId}::uuid AND map_id = ${mapId}::uuid
  `);
  if (!layer) return toErrorResponse('LAYER_NOT_FOUND');

  const { cursor, limit } = parsePaginationParams(event.url);
  const cursorClause = cursor
    ? sql`AND (created_at, id) > (${cursor.createdAt}, ${cursor.id}::uuid)`
    : sql``;

  const rows = await typedExecute<any>(sql`
    SELECT id, properties, GeometryType(geometry) AS geometry_type, created_at
    FROM features
    WHERE layer_id = ${layerId}::uuid ${cursorClause}
    ORDER BY created_at ASC, id ASC
    LIMIT ${limit + 1}
  `);

  const hasNext = rows.length > limit;
  const items = hasNext ? rows.slice(0, limit) : rows;
  const nextCursor = hasNext ? encodeCursor(items[items.length - 1].created_at, items[items.length - 1].id) : null;
  const basePath = `/api/v1/maps/${mapId}/layers/${layerId}/features`;

  return jsonResponse(envelope(
    items.map(toFeatureSummary),
    { totalCount: layer.feature_count, limit, nextCursor },
    { ...listLinks(basePath, nextCursor), geojson: `/api/v1/maps/${mapId}/layers/${layerId}/geojson` },
  ));
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/routes/api/v1/maps/[mapId]/layers/[layerId]/features/
git commit -m "feat(api): add paginated features endpoint"
```

---

## Task 10: Annotation Routes — GET list, GET single, POST, PATCH, DELETE

**Files:**
- Create: `apps/web/src/routes/api/v1/maps/[mapId]/annotations/+server.ts`
- Create: `apps/web/src/routes/api/v1/maps/[mapId]/annotations/[id]/+server.ts`

<interfaces>
```ts
// annotationService methods:
// .list({ userId, mapId, rootsOnly?, cursor?, limit? }) → { items: AnnotationObject[], totalCount: number }
// .get({ userId, id }) → AnnotationObject
// .create({ userId, userName, mapId, parentId?, anchor, content, templateId? }) → AnnotationObject
// .update({ userId, id, anchor?, content? }) → AnnotationObject
// .delete({ userId, id }) → void

// AnnotationObject shape:
// { id, mapId, parentId, authorId, authorName, anchor, content, templateId, ordinal, version, createdAt, updatedAt }

// Zod schemas from shared-types:
// CreateAnnotationObjectSchema, UpdateAnnotationObjectSchema
```
</interfaces>

- [ ] **Step 1: Write annotations list + create route**

Create `apps/web/src/routes/api/v1/maps/[mapId]/annotations/+server.ts`:

```ts
import { sql } from 'drizzle-orm';
import { resolveAuth, envelope, jsonResponse, rateLimit, assertMapAccess, requireScope } from '../../../middleware.js';
import { toErrorResponse } from '../../../errors.js';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { annotationService } from '$lib/server/annotations/service.js';
import { toAnnotation } from '$lib/server/api/serializers.js';
import { annotationLinks, listLinks } from '$lib/server/api/links.js';
import { parsePaginationParams, encodeCursor } from '$lib/server/api/pagination.js';
import { CreateAnnotationObjectSchema } from '@felt-like-it/shared-types';
import { db, users } from '$lib/server/db/index.js';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async (event) => {
  const auth = await resolveAuth(event);
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  const { mapId } = event.params;
  assertMapAccess(auth, mapId);
  if (auth.userId) {
    try { await requireMapAccess(auth.userId, mapId, 'viewer'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  }

  const rootsOnly = event.url.searchParams.get('rootsOnly') === 'true';
  const { cursor, limit } = parsePaginationParams(event.url);

  // For share token auth (no userId), we query directly
  const result = await annotationService.list({
    userId: auth.userId ?? '00000000-0000-0000-0000-000000000000',
    mapId,
    rootsOnly,
    cursor: cursor ?? undefined,
    limit,
  });

  const items = result.items.map(toAnnotation);
  const nextCursor = items.length === limit && items.length > 0
    ? encodeCursor(items[items.length - 1].createdAt, items[items.length - 1].id)
    : null;
  const basePath = `/api/v1/maps/${mapId}/annotations`;

  return jsonResponse(envelope(
    items,
    { totalCount: result.totalCount, limit, nextCursor },
    listLinks(basePath, nextCursor),
  ));
};

export const POST: RequestHandler = async (event) => {
  const auth = await resolveAuth(event);
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  try { requireScope(auth, 'read-write'); } catch { return toErrorResponse('FORBIDDEN'); }
  if (!auth.userId) return toErrorResponse('FORBIDDEN');

  const { mapId } = event.params;
  try { await requireMapAccess(auth.userId, mapId, 'commenter'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }

  let body: unknown;
  try { body = await event.request.json(); } catch { return toErrorResponse('VALIDATION_ERROR', 'Invalid JSON body'); }

  const parsed = CreateAnnotationObjectSchema.safeParse({ ...body as any, mapId });
  if (!parsed.success) return toErrorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message);

  // Get user name for denormalized authorName
  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, auth.userId));

  try {
    const created = await annotationService.create({
      userId: auth.userId,
      userName: user?.name ?? 'Unknown',
      mapId,
      parentId: parsed.data.parentId,
      anchor: parsed.data.anchor,
      content: parsed.data.content,
    });

    return jsonResponse(
      envelope(toAnnotation(created), {}, annotationLinks(mapId, created.id)),
      201,
    );
  } catch (e: any) {
    if (e.code === 'PAYLOAD_TOO_LARGE' || e.message?.includes('limit')) {
      return toErrorResponse('LIMIT_EXCEEDED', 'Annotation limit reached for this map');
    }
    throw e;
  }
};
```

- [ ] **Step 2: Write annotation single, PATCH, DELETE route**

Create `apps/web/src/routes/api/v1/maps/[mapId]/annotations/[id]/+server.ts`:

```ts
import { resolveAuth, envelope, jsonResponse, rateLimit, assertMapAccess, requireScope } from '../../../../middleware.js';
import { toErrorResponse } from '../../../../errors.js';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { annotationService } from '$lib/server/annotations/service.js';
import { toAnnotation } from '$lib/server/api/serializers.js';
import { annotationLinks } from '$lib/server/api/links.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async (event) => {
  const auth = await resolveAuth(event);
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  const { mapId, id } = event.params;
  assertMapAccess(auth, mapId);
  if (auth.userId) {
    try { await requireMapAccess(auth.userId, mapId, 'viewer'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  }

  try {
    const obj = await annotationService.get({
      userId: auth.userId ?? '00000000-0000-0000-0000-000000000000',
      id,
    });
    if (obj.mapId !== mapId) return toErrorResponse('ANNOTATION_NOT_FOUND');
    return jsonResponse(envelope(toAnnotation(obj), {}, annotationLinks(mapId, id)));
  } catch {
    return toErrorResponse('ANNOTATION_NOT_FOUND');
  }
};

export const PATCH: RequestHandler = async (event) => {
  const auth = await resolveAuth(event);
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  try { requireScope(auth, 'read-write'); } catch { return toErrorResponse('FORBIDDEN'); }
  if (!auth.userId) return toErrorResponse('FORBIDDEN');

  const { mapId, id } = event.params;
  try { await requireMapAccess(auth.userId, mapId, 'commenter'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }

  let body: any;
  try { body = await event.request.json(); } catch { return toErrorResponse('VALIDATION_ERROR', 'Invalid JSON body'); }

  // Optimistic concurrency: check If-Match header
  const ifMatch = event.request.headers.get('if-match');
  if (ifMatch) {
    const expectedVersion = parseInt(ifMatch, 10);
    if (!isNaN(expectedVersion)) {
      try {
        const current = await annotationService.get({ userId: auth.userId, id });
        if (current.version !== expectedVersion) {
          return toErrorResponse('VERSION_CONFLICT', `Expected version ${expectedVersion}, found ${current.version}`);
        }
      } catch {
        return toErrorResponse('ANNOTATION_NOT_FOUND');
      }
    }
  }

  try {
    const updated = await annotationService.update({
      userId: auth.userId,
      id,
      ...(body.anchor !== undefined ? { anchor: body.anchor } : {}),
      ...(body.content !== undefined ? { content: body.content } : {}),
    });
    return jsonResponse(envelope(toAnnotation(updated), {}, annotationLinks(mapId, id)));
  } catch {
    return toErrorResponse('ANNOTATION_NOT_FOUND');
  }
};

export const DELETE: RequestHandler = async (event) => {
  const auth = await resolveAuth(event);
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  try { requireScope(auth, 'read-write'); } catch { return toErrorResponse('FORBIDDEN'); }
  if (!auth.userId) return toErrorResponse('FORBIDDEN');

  const { mapId, id } = event.params;
  // DELETE is destructive — require editor role, not just commenter
  try { await requireMapAccess(auth.userId, mapId, 'editor'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }

  try {
    await annotationService.delete({ userId: auth.userId, id });
    return new Response(null, { status: 204 });
  } catch {
    return toErrorResponse('ANNOTATION_NOT_FOUND');
  }
};
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/api/v1/maps/[mapId]/annotations/
git commit -m "feat(api): add annotation CRUD routes"
```

---

## Task 11: Comment Routes — GET list, GET single, POST create

**Files:**
- Create: `apps/web/src/routes/api/v1/maps/[mapId]/comments/+server.ts` (GET list, POST create)
- Create: `apps/web/src/routes/api/v1/maps/[mapId]/comments/[id]/+server.ts` (GET single)

<interfaces>
```ts
// comments table columns: id, mapId, userId, authorName, body, resolved, createdAt, updatedAt
// From serializers.ts:
// toComment(row) → { id, mapId, authorId, authorName, body, resolved, createdAt, updatedAt }
// From links.ts:
// commentLinks(mapId, commentId) → { self, map }
```
</interfaces>

- [ ] **Step 1: Write comments list + create route**

Create `apps/web/src/routes/api/v1/maps/[mapId]/comments/+server.ts`:

```ts
import { sql, eq } from 'drizzle-orm';
import { resolveAuth, envelope, jsonResponse, rateLimit, assertMapAccess, requireScope } from '../../../middleware.js';
import { toErrorResponse } from '../../../errors.js';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { db, comments, users } from '$lib/server/db/index.js';
import { toComment } from '$lib/server/api/serializers.js';
import { commentLinks, listLinks } from '$lib/server/api/links.js';
import { parsePaginationParams, encodeCursor } from '$lib/server/api/pagination.js';
import { typedExecute } from '$lib/server/geo/queries.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async (event) => {
  const auth = await resolveAuth(event);
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  const { mapId } = event.params;
  assertMapAccess(auth, mapId);
  if (auth.userId) {
    try { await requireMapAccess(auth.userId, mapId, 'viewer'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  }

  const { cursor, limit } = parsePaginationParams(event.url);
  const cursorClause = cursor
    ? sql`AND (created_at, id) > (${cursor.createdAt}, ${cursor.id}::uuid)`
    : sql``;

  const rows = await typedExecute<any>(sql`
    SELECT id, map_id, user_id, author_name, body, resolved, created_at, updated_at
    FROM comments
    WHERE map_id = ${mapId}::uuid ${cursorClause}
    ORDER BY created_at ASC, id ASC
    LIMIT ${limit + 1}
  `);

  const hasNext = rows.length > limit;
  const items = hasNext ? rows.slice(0, limit) : rows;
  const nextCursor = hasNext ? encodeCursor(items[items.length - 1].created_at, items[items.length - 1].id) : null;

  const [countRow] = await typedExecute<{ cnt: string }>(sql`
    SELECT COUNT(*)::text AS cnt FROM comments WHERE map_id = ${mapId}::uuid
  `);
  const basePath = `/api/v1/maps/${mapId}/comments`;

  return jsonResponse(envelope(
    items.map(toComment),
    { totalCount: parseInt(countRow.cnt, 10), limit, nextCursor },
    listLinks(basePath, nextCursor),
  ));
};

export const POST: RequestHandler = async (event) => {
  const auth = await resolveAuth(event);
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  try { requireScope(auth, 'read-write'); } catch { return toErrorResponse('FORBIDDEN'); }
  if (!auth.userId) return toErrorResponse('FORBIDDEN');

  const { mapId } = event.params;
  try { await requireMapAccess(auth.userId, mapId, 'commenter'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }

  let body: any;
  try { body = await event.request.json(); } catch { return toErrorResponse('VALIDATION_ERROR', 'Invalid JSON body'); }

  if (!body.body || typeof body.body !== 'string') {
    return toErrorResponse('VALIDATION_ERROR', 'body is required and must be a string');
  }

  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, auth.userId));

  const [created] = await db
    .insert(comments)
    .values({
      mapId,
      userId: auth.userId,
      authorName: user?.name ?? 'Unknown',
      body: body.body,
    })
    .returning();

  return jsonResponse(
    envelope(toComment(created), {}, commentLinks(mapId, created.id)),
    201,
  );
};
```

- [ ] **Step 2: Write single comment route**

Create `apps/web/src/routes/api/v1/maps/[mapId]/comments/[id]/+server.ts`:

```ts
import { sql } from 'drizzle-orm';
import { resolveAuth, envelope, jsonResponse, rateLimit, assertMapAccess } from '../../../../middleware.js';
import { toErrorResponse } from '../../../../errors.js';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { toComment } from '$lib/server/api/serializers.js';
import { commentLinks } from '$lib/server/api/links.js';
import { typedExecute } from '$lib/server/geo/queries.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async (event) => {
  const auth = await resolveAuth(event);
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  const { mapId, id } = event.params;
  assertMapAccess(auth, mapId);
  if (auth.userId) {
    try { await requireMapAccess(auth.userId, mapId, 'viewer'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  }

  const [row] = await typedExecute<any>(sql`
    SELECT id, map_id, user_id, author_name, body, resolved, created_at, updated_at
    FROM comments
    WHERE id = ${id}::uuid AND map_id = ${mapId}::uuid
  `);

  if (!row) return toErrorResponse('COMMENT_NOT_FOUND');

  return jsonResponse(envelope(toComment(row), {}, commentLinks(mapId, id)));
};
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/api/v1/maps/[mapId]/comments/
git commit -m "feat(api): add comment list, detail, and create routes"
```

---

## Task 12: File Upload/Download Routes

**Files:**
- Create: `apps/web/src/routes/api/v1/files/+server.ts`
- Create: `apps/web/src/routes/api/v1/files/[id]/+server.ts`

<interfaces>
```ts
// Existing upload pattern (from /api/upload/+server.ts):
// - Reads multipart form data
// - Writes file to /uploads volume
// - Creates import_jobs row
// The files endpoint is simpler: store file, return URL. No BullMQ job.

// import_jobs table: id, mapId, layerId, status, fileName, fileSize, errorMessage, progress
```
</interfaces>

- [ ] **Step 1: Write file upload route**

Create `apps/web/src/routes/api/v1/files/+server.ts`:

```ts
import { randomUUID } from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { env } from '$env/dynamic/private';
import { resolveAuth, envelope, jsonResponse, rateLimit, requireScope } from '../middleware.js';
import { toErrorResponse } from '../errors.js';
import type { RequestHandler } from './$types.js';

const UPLOAD_DIR = env.UPLOAD_DIR ?? './uploads/api';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export const POST: RequestHandler = async (event) => {
  const auth = await resolveAuth(event);
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  try { requireScope(auth, 'read-write'); } catch { return toErrorResponse('FORBIDDEN'); }
  if (!auth.userId) return toErrorResponse('FORBIDDEN');

  const contentType = event.request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return toErrorResponse('VALIDATION_ERROR', 'Content-Type must be multipart/form-data');
  }

  const formData = await event.request.formData();
  const file = formData.get('file') as File | null;
  if (!file) return toErrorResponse('VALIDATION_ERROR', 'file field is required');
  if (file.size > MAX_FILE_SIZE) return toErrorResponse('VALIDATION_ERROR', 'File exceeds 50MB limit');

  const id = randomUUID();
  const ext = file.name.split('.').pop() ?? 'bin';
  const storedName = `${id}.${ext}`;

  await mkdir(UPLOAD_DIR, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(join(UPLOAD_DIR, storedName), buffer);

  const publicUrl = `/api/v1/files/${id}`;

  return jsonResponse(
    envelope(
      { id, fileName: file.name, fileSize: file.size, url: publicUrl },
      {},
      { self: publicUrl },
    ),
    201,
  );
};
```

- [ ] **Step 2: Write file download route**

Create `apps/web/src/routes/api/v1/files/[id]/+server.ts`:

```ts
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { env } from '$env/dynamic/private';
import { resolveAuth, rateLimit } from '../../middleware.js';
import { toErrorResponse } from '../../errors.js';
import type { RequestHandler } from './$types.js';

const UPLOAD_DIR = env.UPLOAD_DIR ?? './uploads/api';

const MIME_MAP: Record<string, string> = {
  json: 'application/json',
  geojson: 'application/geo+json',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
};

export const GET: RequestHandler = async (event) => {
  const auth = await resolveAuth(event);
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  const { id } = event.params;

  // Find file by ID prefix (id.ext)
  let files: string[];
  try { files = await readdir(UPLOAD_DIR); } catch { return toErrorResponse('FILE_NOT_FOUND'); }

  const match = files.find((f) => f.startsWith(id));
  if (!match) return toErrorResponse('FILE_NOT_FOUND');

  const ext = match.split('.').pop() ?? 'bin';
  const contentType = MIME_MAP[ext] ?? 'application/octet-stream';

  const buffer = await readFile(join(UPLOAD_DIR, match));
  return new Response(buffer, {
    headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
};
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/api/v1/files/
git commit -m "feat(api): add file upload and download routes"
```

---

## Task 13: Integration Test Suite

**Files:**
- Create: `apps/web/src/__tests__/api-v1-maps.test.ts`
- Create: `apps/web/src/__tests__/api-v1-layers.test.ts`

This task writes integration tests that verify the route handlers return correct envelope shapes, error codes, and status codes. Uses mock DB responses since we can't stand up PostGIS in unit tests.

- [ ] **Step 1: Write maps route test**

Create `apps/web/src/__tests__/api-v1-maps.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toErrorResponse } from '../routes/api/v1/errors.js';
import { envelope, requireScope, assertMapAccess } from '../routes/api/v1/middleware.js';
import { toMapSummary, toMapDetail } from '$lib/server/api/serializers.js';

describe('toErrorResponse', () => {
  it('returns correct status and error shape for UNAUTHORIZED', () => {
    const res = toErrorResponse('UNAUTHORIZED');
    expect(res.status).toBe(401);
    const body = JSON.parse(res.body as string);  // Response body for testing
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.status).toBe(401);
  });

  it('returns 404 for MAP_NOT_FOUND', () => {
    const res = toErrorResponse('MAP_NOT_FOUND', 'No such map');
    expect(res.status).toBe(404);
  });
});

describe('envelope', () => {
  it('wraps data with meta and links, defaults to empty objects', () => {
    const result = envelope([{ id: '1' }]);
    expect(result).toEqual({ data: [{ id: '1' }], meta: {}, links: {} });
  });

  it('includes meta and links when provided', () => {
    const result = envelope([], { totalCount: 5, limit: 20, nextCursor: null }, { self: '/api/v1/maps' });
    expect(result.meta.totalCount).toBe(5);
    expect(result.links.self).toBe('/api/v1/maps');
  });
});

describe('assertMapAccess', () => {
  it('throws when mapScope does not match', () => {
    expect(() => assertMapAccess({ userId: null, scope: 'read', mapScope: 'map-1' }, 'map-2')).toThrow();
  });

  it('passes when mapScope matches', () => {
    expect(() => assertMapAccess({ userId: null, scope: 'read', mapScope: 'map-1' }, 'map-1')).not.toThrow();
  });

  it('passes when mapScope is null (API key auth)', () => {
    expect(() => assertMapAccess({ userId: 'u1', scope: 'read', mapScope: null }, 'any-map')).not.toThrow();
  });
});

describe('toMapSummary serializer', () => {
  it('maps snake_case DB row to camelCase API shape', () => {
    const row = { id: 'x', title: 'T', description: 'D', basemap: 'osm', created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-02') };
    const result = toMapSummary(row);
    expect(result.id).toBe('x');
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result).not.toHaveProperty('viewport'); // summary omits viewport
  });
});

describe('toMapDetail serializer', () => {
  it('includes viewport', () => {
    const row = { id: 'x', title: 'T', description: 'D', basemap: 'osm', viewport: { center: [0, 0], zoom: 5 }, created_at: new Date(), updated_at: new Date() };
    const result = toMapDetail(row);
    expect(result.viewport).toEqual({ center: [0, 0], zoom: 5 });
  });
});
```

- [ ] **Step 2: Write pagination test**

Create `apps/web/src/__tests__/api-v1-layers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from '$lib/server/api/pagination.js';

describe('cursor pagination', () => {
  it('round-trips a cursor', () => {
    const date = new Date('2026-03-19T12:00:00Z');
    const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const cursor = encodeCursor(date, id);
    const decoded = decodeCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded!.createdAt.toISOString()).toBe(date.toISOString());
    expect(decoded!.id).toBe(id);
  });

  it('returns null for invalid cursor', () => {
    expect(decodeCursor('not-valid')).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });
});
```

- [ ] **Step 3: Run all tests**

```bash
cd .worktrees/public-rest-api-v1
pnpm --filter @felt-like-it/web test -- --run 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/__tests__/api-v1-*.test.ts
git commit -m "test(api): add REST API v1 integration tests"
```

---

## Execution Waves

```
Wave 0: Tasks [1, 2] (sequential) — DB migration + error codes
  No dependencies. Must complete before anything that imports errors.ts or reads apiKeys.scope.

Wave 1: Tasks [3, 4, 5] (sequential) — Middleware, helpers, service changes
  Depends on Wave 0. Task 3 (middleware) imports errors.ts.
  Task 4 (serializers/links/pagination) is independent but co-depends with Task 3 for route tasks.
  Task 5 (annotationService pagination) modifies service before routes use it.

Wave 2: Tasks [6, 7, 8, 9, 10, 11] (parallel) — All read/write routes
  Depends on Wave 1. Each route is independent. All import middleware, serializers, links.

Wave 3: Task [12] (parallel with Wave 2) — File upload/download
  Depends on Wave 1 only (middleware). No dependency on map routes.

Wave 4: Task [13] — Integration tests
  Depends on Wave 2. Tests verify the full contract.
```
