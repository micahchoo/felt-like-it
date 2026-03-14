# Admin User Management Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full user management (create, toggle admin, reset password, disable/enable) to the admin panel.

**Architecture:** New `disabledAt` column on users table with auth enforcement at all entry points (login, hooks, API keys). New `adminProcedure` in tRPC init. New `admin` tRPC router for all mutations. Existing admin page enhanced with action buttons and modals.

**Tech Stack:** Drizzle ORM, tRPC 11, Lucia auth, Svelte 5, argon2 via `@node-rs/argon2`

**Spec:** `docs/superpowers/specs/2026-03-14-admin-user-management-design.md`

---

## Chunk 1: Schema + Auth Foundation

### Task 1: Migration — add `disabled_at` column

**Files:**
- Modify: `apps/web/src/lib/server/db/schema.ts:33-44`
- Create: `apps/web/src/lib/server/db/migrations/0013_add_disabled_at.sql`

- [ ] **Step 1: Add `disabledAt` to schema.ts**

In `apps/web/src/lib/server/db/schema.ts`, add `disabledAt` to the users table columns (after `updatedAt`):

```ts
disabledAt: timestamp('disabled_at', { withTimezone: true }),
```

- [ ] **Step 2: Create migration SQL**

Create `apps/web/src/lib/server/db/migrations/0013_add_disabled_at.sql`:

```sql
ALTER TABLE users ADD COLUMN disabled_at timestamptz;
```

- [ ] **Step 3: Verify schema types**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors related to `disabledAt`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/server/db/schema.ts apps/web/src/lib/server/db/migrations/0013_add_disabled_at.sql
git commit -m "feat(schema): add disabled_at column to users table"
```

### Task 2: Update Lucia `DatabaseUserAttributes`

**Files:**
- Modify: `apps/web/src/lib/server/auth/index.ts`

- [ ] **Step 1: Add `disabledAt` to `getUserAttributes` and `DatabaseUserAttributes`**

In `apps/web/src/lib/server/auth/index.ts`, update `getUserAttributes`:

```ts
getUserAttributes: (attributes) => {
  return {
    email: attributes.email,
    name: attributes.name,
    isAdmin: attributes.isAdmin,
    disabledAt: attributes.disabledAt,
  };
},
```

Update the `DatabaseUserAttributes` interface:

```ts
DatabaseUserAttributes: {
  email: string;
  name: string;
  isAdmin: boolean;
  disabledAt: Date | null;
};
```

- [ ] **Step 2: Verify types**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/server/auth/index.ts
git commit -m "feat(auth): expose disabledAt in Lucia user attributes"
```

### Task 3: Enforce `disabledAt` in hooks.server.ts

**Files:**
- Modify: `apps/web/src/hooks.server.ts`

- [ ] **Step 1: Add `disabledAt` to API-key auth user select**

In `apps/web/src/hooks.server.ts`, find the API-key auth section where `userRow` is selected. Add `disabledAt` to the select and check it:

```ts
const [userRow] = await db
  .select({ id: users.id, email: users.email, name: users.name, isAdmin: users.isAdmin, disabledAt: users.disabledAt })
  .from(users)
  .where(eq(users.id, keyRow.userId));

if (userRow && !userRow.disabledAt) {
  event.locals.user = userRow;
  event.locals.session = null;
  // Fire-and-forget: update last_used_at
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, keyRow.id));
} else {
  event.locals.user = null;
  event.locals.session = null;
}
```

- [ ] **Step 2: Add `disabledAt` check to session cookie auth**

After `const { session, user } = await lucia.validateSession(sessionId);`, before the `session?.fresh` check, add:

```ts
if (user?.disabledAt) {
  // Disabled user — invalidate their session
  await lucia.invalidateSession(sessionId);
  const blankCookie = lucia.createBlankSessionCookie();
  event.cookies.set(blankCookie.name, blankCookie.value, {
    path: '.',
    ...blankCookie.attributes,
  });
  event.locals.user = null;
  event.locals.session = null;
} else {
  // existing session handling continues here...
```

Wrap the existing `session?.fresh` and `!session` blocks inside the `else` of the disabled check.

- [ ] **Step 3: Verify types**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks.server.ts
git commit -m "feat(auth): reject disabled users in hooks.server.ts auth paths"
```

### Task 4: Enforce `disabledAt` in login flow

**Files:**
- Modify: `apps/web/src/routes/auth/login/+page.server.ts`

- [ ] **Step 1: Add disabled check after password verification**

In `apps/web/src/routes/auth/login/+page.server.ts`, after `const valid = await verifyPassword(...)` and the `if (!valid)` block, add:

```ts
if (user.disabledAt) {
  return fail(403, { field: '', message: 'This account has been disabled.' });
}
```

This must go before `lucia.createSession(...)`.

- [ ] **Step 2: Verify types**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/auth/login/+page.server.ts
git commit -m "feat(auth): reject disabled users at login"
```

---

## Chunk 2: Admin tRPC Router

### Task 5: Update `mockContext` and add `adminProcedure`

**Files:**
- Modify: `apps/web/src/__tests__/test-utils.ts`
- Modify: `apps/web/src/lib/server/trpc/init.ts`

- [ ] **Step 1: Add `disabledAt` to `mockContext`**

In `apps/web/src/__tests__/test-utils.ts`, add `disabledAt` to the `mockContext` overrides and user object:

Update the overrides type:

```ts
export function mockContext(overrides?: {
	userId?: string;
	userName?: string;
	userEmail?: string;
	isAdmin?: boolean;
	disabledAt?: Date | null;
}) {
```

Add to the returned user object (after the `isAdmin` line):

```ts
disabledAt: overrides?.disabledAt ?? null,
```

- [ ] **Step 2: Write failing test**

Create `apps/web/src/__tests__/admin.test.ts` with the first test:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockContext } from './test-utils.js';

// Mock db before importing router
vi.mock('$lib/server/db/index.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
  },
  users: { id: 'id', email: 'email', name: 'name', isAdmin: 'is_admin', hashedPassword: 'hashed_password', createdAt: 'created_at', updatedAt: 'updated_at', disabledAt: 'disabled_at' },
  sessions: { id: 'id', userId: 'user_id' },
}));

vi.mock('$lib/server/auth/password.js', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed_password_mock'),
}));

vi.mock('$lib/server/auth/index.js', () => ({
  lucia: {
    invalidateUserSessions: vi.fn().mockResolvedValue(undefined),
  },
}));

const { adminRouter } = await import('$lib/server/trpc/routers/admin.js');
const { db } = await import('$lib/server/db/index.js');

import { drizzleChain } from './test-utils.js';

describe('admin router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('access control', () => {
    it('rejects non-admin users', async () => {
      const caller = adminRouter.createCaller(mockContext({ isAdmin: false }));
      await expect(caller.listUsers({ page: 1 })).rejects.toThrow('Admin access required');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/__tests__/admin.test.ts 2>&1 | tail -20`
Expected: FAIL — `adminRouter` doesn't exist yet

- [ ] **Step 3: Add `adminProcedure` to init.ts**

In `apps/web/src/lib/server/trpc/init.ts`, add after `protectedProcedure`:

```ts
/** Admin procedure — requires authenticated admin user */
export const adminProcedure = t.procedure.use(timingMiddleware).use(({ ctx, next }) => {
  if (!ctx.user || !ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You must be logged in.' });
  }
  if (!ctx.user.isAdmin) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required.' });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      session: ctx.session,
    },
  });
});
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/__tests__/test-utils.ts apps/web/src/lib/server/trpc/init.ts
git commit -m "feat(trpc): add adminProcedure middleware and update mockContext with disabledAt"
```

### Task 6: Create admin tRPC router — `listUsers`

**Files:**
- Create: `apps/web/src/lib/server/trpc/routers/admin.ts`
- Modify: `apps/web/src/lib/server/trpc/router.ts`

- [ ] **Step 1: Add listUsers test**

Add to `apps/web/src/__tests__/admin.test.ts`, inside the `describe('admin router')` block:

```ts
describe('listUsers', () => {
  it('returns paginated user list for admin', async () => {
    const mockUsers = [
      { id: 'u1', email: 'a@test.com', name: 'Alice', isAdmin: false, createdAt: new Date(), disabledAt: null },
    ];
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([{ total: 1 }]))   // count query
      .mockReturnValueOnce(drizzleChain(mockUsers));         // user list query

    const caller = adminRouter.createCaller(mockContext({ isAdmin: true }));
    const result = await caller.listUsers({ page: 1 });
    expect(result.users).toEqual(mockUsers);
    expect(result.total).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/__tests__/admin.test.ts 2>&1 | tail -20`
Expected: FAIL

- [ ] **Step 3: Create admin router with `listUsers`**

Create `apps/web/src/lib/server/trpc/routers/admin.ts`:

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, desc, or, ilike, count } from 'drizzle-orm';
import { router, adminProcedure } from '../init.js';
import { db, users } from '../../db/index.js';
import { hashPassword } from '../../auth/password.js';
import { lucia } from '../../auth/index.js';

const PAGE_SIZE = 50;

export const adminRouter = router({
  listUsers: adminProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      search: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const offset = (input.page - 1) * PAGE_SIZE;

      const baseWhere = input.search
        ? or(
            ilike(users.email, `%${input.search}%`),
            ilike(users.name, `%${input.search}%`),
          )
        : undefined;

      const [totalResult] = await db
        .select({ total: count() })
        .from(users)
        .where(baseWhere);

      const userList = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          isAdmin: users.isAdmin,
          createdAt: users.createdAt,
          disabledAt: users.disabledAt,
        })
        .from(users)
        .where(baseWhere)
        .orderBy(desc(users.createdAt))
        .limit(PAGE_SIZE)
        .offset(offset);

      return {
        users: userList,
        total: totalResult?.total ?? 0,
        page: input.page,
        pageSize: PAGE_SIZE,
      };
    }),
});
```

- [ ] **Step 4: Register in router.ts**

In `apps/web/src/lib/server/trpc/router.ts`, add:

```ts
import { adminRouter } from './routers/admin.js';
```

And add to the `appRouter`:

```ts
admin: adminRouter,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/__tests__/admin.test.ts 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/server/trpc/routers/admin.ts apps/web/src/lib/server/trpc/router.ts apps/web/src/__tests__/admin.test.ts
git commit -m "feat(admin): add admin tRPC router with listUsers"
```

### Task 7: Add `createUser` procedure

**Files:**
- Modify: `apps/web/src/lib/server/trpc/routers/admin.ts`
- Modify: `apps/web/src/__tests__/admin.test.ts`

- [ ] **Step 1: Write tests**

Add to `apps/web/src/__tests__/admin.test.ts`:

```ts
describe('createUser', () => {
  it('creates a user with hashed password', async () => {
    vi.mocked(db.insert).mockReturnValue(drizzleChain([{ id: 'new-id' }]));

    const caller = adminRouter.createCaller(mockContext({ isAdmin: true }));
    await caller.createUser({
      email: 'new@test.com',
      name: 'New User',
      password: 'securepass123',
    });

    expect(db.insert).toHaveBeenCalled();
  });

  it('rejects password shorter than 8 characters', async () => {
    const caller = adminRouter.createCaller(mockContext({ isAdmin: true }));
    await expect(
      caller.createUser({ email: 'x@test.com', name: 'X', password: 'short' })
    ).rejects.toThrow();
  });

  it('rejects duplicate email with friendly error', async () => {
    const dupeError = new Error('duplicate key') as Error & { code: string };
    dupeError.code = '23505';
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockRejectedValue(dupeError),
      }),
    } as ReturnType<typeof db.insert>);

    const caller = adminRouter.createCaller(mockContext({ isAdmin: true }));
    await expect(
      caller.createUser({ email: 'dupe@test.com', name: 'Dupe', password: 'securepass123' })
    ).rejects.toThrow('email already exists');
  });

  it('rejects non-admin users', async () => {
    const caller = adminRouter.createCaller(mockContext({ isAdmin: false }));
    await expect(
      caller.createUser({ email: 'x@test.com', name: 'X', password: 'securepass123' })
    ).rejects.toThrow('Admin access required');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/__tests__/admin.test.ts 2>&1 | tail -20`
Expected: FAIL — `createUser` not defined

- [ ] **Step 3: Implement `createUser`**

Add to the router object in `apps/web/src/lib/server/trpc/routers/admin.ts`:

```ts
createUser: adminProcedure
  .input(z.object({
    email: z.string().email(),
    name: z.string().min(1).max(200),
    password: z.string().min(8).max(256),
    isAdmin: z.boolean().default(false),
  }))
  .mutation(async ({ input }) => {
    const hashedPassword = await hashPassword(input.password);

    try {
      const [created] = await db
        .insert(users)
        .values({
          email: input.email.toLowerCase().trim(),
          name: input.name.trim(),
          hashedPassword,
          isAdmin: input.isAdmin,
        })
        .returning({ id: users.id });

      if (!created) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create user.' });
      }

      return { id: created.id };
    } catch (e: unknown) {
      if (e instanceof TRPCError) throw e;
      const dbError = e as { code?: string };
      if (dbError.code === '23505') {
        throw new TRPCError({ code: 'CONFLICT', message: 'A user with this email already exists.' });
      }
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create user.' });
    }
  }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/__tests__/admin.test.ts 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/trpc/routers/admin.ts apps/web/src/__tests__/admin.test.ts
git commit -m "feat(admin): add createUser procedure"
```

### Task 8: Add `toggleAdmin` procedure

**Files:**
- Modify: `apps/web/src/lib/server/trpc/routers/admin.ts`
- Modify: `apps/web/src/__tests__/admin.test.ts`

- [ ] **Step 1: Write tests**

Add to `apps/web/src/__tests__/admin.test.ts`:

```ts
describe('toggleAdmin', () => {
  it('promotes a regular user to admin', async () => {
    vi.mocked(db.select).mockReturnValue(drizzleChain([{ id: 'u2', isAdmin: false }]));
    vi.mocked(db.update).mockReturnValue(drizzleChain([{ id: 'u2', isAdmin: true }]));

    const caller = adminRouter.createCaller(mockContext({ isAdmin: true }));
    const result = await caller.toggleAdmin({ userId: 'u2' });
    expect(result.isAdmin).toBe(true);
  });

  it('prevents self-demotion', async () => {
    const ctx = mockContext({ isAdmin: true, userId: 'self-id' });
    vi.mocked(db.select).mockReturnValue(drizzleChain([{ id: 'self-id', isAdmin: true }]));

    const caller = adminRouter.createCaller(ctx);
    await expect(caller.toggleAdmin({ userId: 'self-id' })).rejects.toThrow('Cannot change your own admin status');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/__tests__/admin.test.ts 2>&1 | tail -20`
Expected: FAIL

- [ ] **Step 3: Implement `toggleAdmin`**

Add to the router in `apps/web/src/lib/server/trpc/routers/admin.ts`:

```ts
toggleAdmin: adminProcedure
  .input(z.object({ userId: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    if (input.userId === ctx.user.id) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot change your own admin status.' });
    }

    const [user] = await db
      .select({ id: users.id, isAdmin: users.isAdmin })
      .from(users)
      .where(eq(users.id, input.userId));

    if (!user) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
    }

    const [updated] = await db
      .update(users)
      .set({ isAdmin: !user.isAdmin, updatedAt: new Date() })
      .where(eq(users.id, input.userId))
      .returning({ id: users.id, isAdmin: users.isAdmin });

    return updated!;
  }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/__tests__/admin.test.ts 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/trpc/routers/admin.ts apps/web/src/__tests__/admin.test.ts
git commit -m "feat(admin): add toggleAdmin procedure with self-demotion guard"
```

### Task 9: Add `resetPassword` procedure

**Files:**
- Modify: `apps/web/src/lib/server/trpc/routers/admin.ts`
- Modify: `apps/web/src/__tests__/admin.test.ts`

- [ ] **Step 1: Write tests**

Add to `apps/web/src/__tests__/admin.test.ts`:

```ts
describe('resetPassword', () => {
  it('resets password for existing user', async () => {
    vi.mocked(db.update).mockReturnValue(drizzleChain([{ id: 'u1' }]));

    const caller = adminRouter.createCaller(mockContext({ isAdmin: true }));
    await caller.resetPassword({ userId: 'u1', newPassword: 'newsecurepass' });

    expect(db.update).toHaveBeenCalled();
  });

  it('rejects password shorter than 8 characters', async () => {
    const caller = adminRouter.createCaller(mockContext({ isAdmin: true }));
    await expect(
      caller.resetPassword({ userId: 'u1', newPassword: 'short' })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/__tests__/admin.test.ts 2>&1 | tail -20`
Expected: FAIL

- [ ] **Step 3: Implement `resetPassword`**

Add to the router in `apps/web/src/lib/server/trpc/routers/admin.ts`:

```ts
resetPassword: adminProcedure
  .input(z.object({
    userId: z.string().uuid(),
    newPassword: z.string().min(8).max(256),
  }))
  .mutation(async ({ input }) => {
    const hashedPassword = await hashPassword(input.newPassword);

    const [updated] = await db
      .update(users)
      .set({ hashedPassword, updatedAt: new Date() })
      .where(eq(users.id, input.userId))
      .returning({ id: users.id });

    if (!updated) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
    }

    // Invalidate all sessions so user must log in with new password
    await lucia.invalidateUserSessions(input.userId);

    return { success: true };
  }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/__tests__/admin.test.ts 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/trpc/routers/admin.ts apps/web/src/__tests__/admin.test.ts
git commit -m "feat(admin): add resetPassword procedure with session invalidation"
```

### Task 10: Add `toggleDisabled` procedure

**Files:**
- Modify: `apps/web/src/lib/server/trpc/routers/admin.ts`
- Modify: `apps/web/src/__tests__/admin.test.ts`

- [ ] **Step 1: Write tests**

Add to `apps/web/src/__tests__/admin.test.ts`:

```ts
describe('toggleDisabled', () => {
  it('disables an active user and invalidates sessions', async () => {
    const { lucia } = await import('$lib/server/auth/index.js');
    vi.mocked(db.select).mockReturnValue(drizzleChain([{ id: 'u1', disabledAt: null }]));
    vi.mocked(db.update).mockReturnValue(drizzleChain([{ id: 'u1', disabledAt: new Date() }]));

    const caller = adminRouter.createCaller(mockContext({ isAdmin: true }));
    const result = await caller.toggleDisabled({ userId: 'u1' });
    expect(result.disabledAt).not.toBeNull();
    expect(lucia.invalidateUserSessions).toHaveBeenCalledWith('u1');
  });

  it('enables a disabled user', async () => {
    vi.mocked(db.select).mockReturnValue(drizzleChain([{ id: 'u1', disabledAt: new Date() }]));
    vi.mocked(db.update).mockReturnValue(drizzleChain([{ id: 'u1', disabledAt: null }]));

    const caller = adminRouter.createCaller(mockContext({ isAdmin: true }));
    const result = await caller.toggleDisabled({ userId: 'u1' });
    expect(result.disabledAt).toBeNull();
  });

  it('prevents self-disable', async () => {
    const ctx = mockContext({ isAdmin: true, userId: 'self-id' });
    const caller = adminRouter.createCaller(ctx);
    await expect(caller.toggleDisabled({ userId: 'self-id' })).rejects.toThrow('Cannot disable your own account');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/__tests__/admin.test.ts 2>&1 | tail -20`
Expected: FAIL

- [ ] **Step 3: Implement `toggleDisabled`**

Add to the router in `apps/web/src/lib/server/trpc/routers/admin.ts`:

```ts
toggleDisabled: adminProcedure
  .input(z.object({ userId: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    if (input.userId === ctx.user.id) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot disable your own account.' });
    }

    const [user] = await db
      .select({ id: users.id, disabledAt: users.disabledAt })
      .from(users)
      .where(eq(users.id, input.userId));

    if (!user) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
    }

    const newDisabledAt = user.disabledAt ? null : new Date();

    const [updated] = await db
      .update(users)
      .set({ disabledAt: newDisabledAt, updatedAt: new Date() })
      .where(eq(users.id, input.userId))
      .returning({ id: users.id, disabledAt: users.disabledAt });

    // If disabling, invalidate all sessions immediately
    if (newDisabledAt) {
      await lucia.invalidateUserSessions(input.userId);
    }

    return updated!;
  }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/__tests__/admin.test.ts 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/trpc/routers/admin.ts apps/web/src/__tests__/admin.test.ts
git commit -m "feat(admin): add toggleDisabled with session invalidation"
```

---

## Chunk 3: Admin Page Frontend

### Task 11: Update admin page data loading

**Files:**
- Modify: `apps/web/src/routes/(app)/admin/+page.server.ts`

- [ ] **Step 1: Update load function to include `disabledAt`**

Replace `apps/web/src/routes/(app)/admin/+page.server.ts`:

```ts
import { desc } from 'drizzle-orm';
import { db } from '$lib/server/db/index.js';
import { users } from '$lib/server/db/schema.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const userList = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isAdmin: users.isAdmin,
      createdAt: users.createdAt,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt));

  return { users: userList };
};
```

- [ ] **Step 2: Verify types**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/'(app)'/admin/+page.server.ts
git commit -m "feat(admin): include disabledAt in admin page data"
```

### Task 12: Enhanced admin page with actions and modals

**Files:**
- Modify: `apps/web/src/routes/(app)/admin/+page.svelte`

- [ ] **Step 1: Rewrite admin page with full management UI**

Replace `apps/web/src/routes/(app)/admin/+page.svelte` with a component that includes:

1. Search input above table
2. "Create User" button
3. Table with columns: Name, Email, Role, Status, Created, Actions
4. Status column: Active (green) / Disabled (red) badges
5. Actions column: toggle admin, reset password, disable/enable buttons
6. Create User modal (email, name, password, confirm password, admin checkbox)
7. Reset Password modal (new password, confirm password)
8. Confirmation dialogs for toggle admin and disable

The page uses tRPC client calls for mutations (`trpc.admin.createUser.mutate(...)`, etc.) and `invalidateAll()` to refresh after mutations.

Key implementation details:
- Import `trpc` from `$lib/utils/trpc.js` for mutations
- Import `invalidateAll` from `$app/navigation` for refreshing data
- Use `$state()` for modal visibility and form fields
- Confirm dialogs use `window.confirm()` for simplicity
- Toast feedback via a simple `$state` message that auto-clears

```svelte
<script lang="ts">
  import type { PageData } from './$types';
  import { invalidateAll } from '$app/navigation';
  import { trpc } from '$lib/utils/trpc.js';

  let { data }: { data: PageData } = $props();

  // Modal state
  let showCreateModal = $state(false);
  let showResetModal = $state(false);
  let resetUserId = $state('');
  let resetUserName = $state('');
  let toast = $state('');

  // Create form
  let createEmail = $state('');
  let createName = $state('');
  let createPassword = $state('');
  let createConfirm = $state('');
  let createIsAdmin = $state(false);
  let createError = $state('');

  // Reset form
  let resetPassword = $state('');
  let resetConfirm = $state('');
  let resetError = $state('');

  function showToast(msg: string) {
    toast = msg;
    setTimeout(() => (toast = ''), 3000);
  }

  async function handleCreate() {
    createError = '';
    if (createPassword !== createConfirm) {
      createError = 'Passwords do not match.';
      return;
    }
    if (createPassword.length < 8) {
      createError = 'Password must be at least 8 characters.';
      return;
    }
    try {
      await trpc.admin.createUser.mutate({
        email: createEmail,
        name: createName,
        password: createPassword,
        isAdmin: createIsAdmin,
      });
      showCreateModal = false;
      createEmail = createName = createPassword = createConfirm = '';
      createIsAdmin = false;
      showToast('User created.');
      await invalidateAll();
    } catch (e: unknown) {
      createError = e instanceof Error ? e.message : 'Failed to create user.';
    }
  }

  async function handleResetPassword() {
    resetError = '';
    if (resetPassword !== resetConfirm) {
      resetError = 'Passwords do not match.';
      return;
    }
    if (resetPassword.length < 8) {
      resetError = 'Password must be at least 8 characters.';
      return;
    }
    try {
      await trpc.admin.resetPassword.mutate({
        userId: resetUserId,
        newPassword: resetPassword,
      });
      showResetModal = false;
      resetPassword = resetConfirm = '';
      showToast('Password reset.');
    } catch (e: unknown) {
      resetError = e instanceof Error ? e.message : 'Failed to reset password.';
    }
  }

  async function handleToggleAdmin(userId: string, userName: string, currentlyAdmin: boolean) {
    const action = currentlyAdmin ? 'Remove admin from' : 'Promote to admin:';
    if (!window.confirm(`${action} ${userName}?`)) return;
    try {
      await trpc.admin.toggleAdmin.mutate({ userId });
      showToast(currentlyAdmin ? 'Admin removed.' : 'Promoted to admin.');
      await invalidateAll();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed.');
    }
  }

  async function handleToggleDisabled(userId: string, userName: string, currentlyDisabled: boolean) {
    if (!currentlyDisabled) {
      if (!window.confirm(`Disable ${userName}? They will be logged out immediately.`)) return;
    }
    try {
      await trpc.admin.toggleDisabled.mutate({ userId });
      showToast(currentlyDisabled ? 'User enabled.' : 'User disabled.');
      await invalidateAll();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed.');
    }
  }

  function openResetModal(userId: string, userName: string) {
    resetUserId = userId;
    resetUserName = userName;
    resetPassword = resetConfirm = resetError = '';
    showResetModal = true;
  }
</script>

<!-- Toast -->
{#if toast}
  <div class="fixed top-4 right-4 z-50 px-4 py-2 rounded bg-emerald-600 text-white text-sm shadow-lg">
    {toast}
  </div>
{/if}

<div class="flex items-center justify-between mb-6">
  <h1 class="text-2xl font-bold">Users</h1>
  <button
    class="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
    onclick={() => (showCreateModal = true)}
  >
    Create User
  </button>
</div>

<!-- Users Table -->
<div class="overflow-x-auto">
  <table class="w-full text-sm text-left">
    <thead class="text-xs text-slate-400 uppercase border-b border-white/10">
      <tr>
        <th class="px-4 py-3">Name</th>
        <th class="px-4 py-3">Email</th>
        <th class="px-4 py-3">Role</th>
        <th class="px-4 py-3">Status</th>
        <th class="px-4 py-3">Created</th>
        <th class="px-4 py-3">Actions</th>
      </tr>
    </thead>
    <tbody>
      {#each data.users as user (user.id)}
        <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
          <td class="px-4 py-3 font-medium text-white">{user.name}</td>
          <td class="px-4 py-3 text-slate-300">{user.email}</td>
          <td class="px-4 py-3">
            {#if user.isAdmin}
              <span class="px-2 py-0.5 rounded text-xs font-medium bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30">Admin</span>
            {:else}
              <span class="text-slate-500">User</span>
            {/if}
          </td>
          <td class="px-4 py-3">
            {#if user.disabledAt}
              <span class="px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-300 ring-1 ring-red-500/30">Disabled</span>
            {:else}
              <span class="px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30">Active</span>
            {/if}
          </td>
          <td class="px-4 py-3 text-slate-400">{new Date(user.createdAt).toLocaleDateString()}</td>
          <td class="px-4 py-3 flex gap-2">
            <button
              class="px-2 py-1 rounded text-xs bg-white/5 hover:bg-white/10 text-slate-300 transition-colors"
              onclick={() => handleToggleAdmin(user.id, user.name, user.isAdmin)}
              title={user.isAdmin ? 'Remove admin' : 'Make admin'}
            >
              {user.isAdmin ? 'Demote' : 'Promote'}
            </button>
            <button
              class="px-2 py-1 rounded text-xs bg-white/5 hover:bg-white/10 text-slate-300 transition-colors"
              onclick={() => openResetModal(user.id, user.name)}
            >
              Reset PW
            </button>
            <button
              class="px-2 py-1 rounded text-xs transition-colors {user.disabledAt
                ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300'
                : 'bg-red-500/10 hover:bg-red-500/20 text-red-300'}"
              onclick={() => handleToggleDisabled(user.id, user.name, !!user.disabledAt)}
            >
              {user.disabledAt ? 'Enable' : 'Disable'}
            </button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

{#if data.users.length === 0}
  <p class="text-slate-400 text-center py-10">No users found.</p>
{/if}

<!-- Create User Modal -->
{#if showCreateModal}
  <div class="fixed inset-0 z-40 bg-black/50 flex items-center justify-center" onclick={() => (showCreateModal = false)}>
    <div class="bg-slate-800 rounded-lg p-6 w-full max-w-md shadow-xl" onclick={(e) => e.stopPropagation()}>
      <h2 class="text-lg font-semibold mb-4">Create User</h2>
      {#if createError}
        <p class="text-red-400 text-sm mb-3">{createError}</p>
      {/if}
      <form onsubmit={(e) => { e.preventDefault(); handleCreate(); }} class="space-y-3">
        <div>
          <label class="block text-xs text-slate-400 mb-1" for="create-email">Email</label>
          <input id="create-email" type="email" required bind:value={createEmail}
            class="w-full px-3 py-2 rounded bg-slate-700 border border-white/10 text-white text-sm" />
        </div>
        <div>
          <label class="block text-xs text-slate-400 mb-1" for="create-name">Name</label>
          <input id="create-name" type="text" required bind:value={createName}
            class="w-full px-3 py-2 rounded bg-slate-700 border border-white/10 text-white text-sm" />
        </div>
        <div>
          <label class="block text-xs text-slate-400 mb-1" for="create-pw">Password</label>
          <input id="create-pw" type="password" required minlength="8" bind:value={createPassword}
            class="w-full px-3 py-2 rounded bg-slate-700 border border-white/10 text-white text-sm" />
        </div>
        <div>
          <label class="block text-xs text-slate-400 mb-1" for="create-confirm">Confirm Password</label>
          <input id="create-confirm" type="password" required minlength="8" bind:value={createConfirm}
            class="w-full px-3 py-2 rounded bg-slate-700 border border-white/10 text-white text-sm" />
        </div>
        <label class="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" bind:checked={createIsAdmin} class="rounded" />
          Admin
        </label>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick={() => (showCreateModal = false)}
            class="px-4 py-2 rounded text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
          <button type="submit"
            class="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors">Create</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- Reset Password Modal -->
{#if showResetModal}
  <div class="fixed inset-0 z-40 bg-black/50 flex items-center justify-center" onclick={() => (showResetModal = false)}>
    <div class="bg-slate-800 rounded-lg p-6 w-full max-w-md shadow-xl" onclick={(e) => e.stopPropagation()}>
      <h2 class="text-lg font-semibold mb-1">Reset Password</h2>
      <p class="text-sm text-slate-400 mb-4">For: {resetUserName}</p>
      {#if resetError}
        <p class="text-red-400 text-sm mb-3">{resetError}</p>
      {/if}
      <form onsubmit={(e) => { e.preventDefault(); handleResetPassword(); }} class="space-y-3">
        <div>
          <label class="block text-xs text-slate-400 mb-1" for="reset-pw">New Password</label>
          <input id="reset-pw" type="password" required minlength="8" bind:value={resetPassword}
            class="w-full px-3 py-2 rounded bg-slate-700 border border-white/10 text-white text-sm" />
        </div>
        <div>
          <label class="block text-xs text-slate-400 mb-1" for="reset-confirm">Confirm Password</label>
          <input id="reset-confirm" type="password" required minlength="8" bind:value={resetConfirm}
            class="w-full px-3 py-2 rounded bg-slate-700 border border-white/10 text-white text-sm" />
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick={() => (showResetModal = false)}
            class="px-4 py-2 rounded text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
          <button type="submit"
            class="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors">Reset</button>
        </div>
      </form>
    </div>
  </div>
{/if}
```

- [ ] **Step 2: Verify types**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/'(app)'/admin/+page.svelte
git commit -m "feat(admin): add user management UI with create, toggle, reset, disable"
```

### Task 13: Type check + lint + full test run

- [ ] **Step 1: Run type check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 2: Run lint**

Run: `cd apps/web && pnpm lint`
Expected: PASS (fix any issues)

- [ ] **Step 3: Run all tests**

Run: `cd apps/web && pnpm test`
Expected: All tests PASS

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -u
git commit -m "fix: resolve lint and type issues from admin user management"
```

- [ ] **Step 5: Push**

```bash
git push felt-like-it master
```
