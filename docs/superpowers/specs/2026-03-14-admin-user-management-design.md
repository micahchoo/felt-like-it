# Admin User Management Page

## Summary

Add full user management to the existing admin panel. The admin main page already shows a read-only users table — extend it with create, toggle admin, reset password, and disable/enable actions. All actions happen inline with modals for forms.

## Context

- **Existing**: Admin main page at `/admin` renders a users table (name, email, role, created date)
- **Existing**: Admin CLI (`scripts/admin-cli.ts`) has create-user, reset-password, promote, demote via raw SQL
- **Existing**: `requireMapOwnership` and admin layout guard (`isAdmin` check)
- **Gap**: No tRPC router for admin user operations. No disable/soft-delete mechanism.

## Schema Change

**Migration**: Add `disabled_at` column to `users` table.

```sql
ALTER TABLE users ADD COLUMN disabled_at timestamptz;
```

- `NULL` = active user
- Non-null = disabled (timestamp of when admin disabled them)
- Auth login check must reject users where `disabledAt IS NOT NULL`

**Schema update** in `schema.ts`:

```ts
disabledAt: timestamp('disabled_at', { withTimezone: true }),
```

## Backend: Admin tRPC Router

New file: `apps/web/src/lib/server/trpc/routers/admin.ts`

Add an `adminProcedure` to `apps/web/src/lib/server/trpc/init.ts` that extends `protectedProcedure` with an `isAdmin` guard. All procedures in this router use `adminProcedure`. Router registered in `apps/web/src/lib/server/trpc/router.ts`.

### Procedures

| Procedure | Type | Input | Description |
|-----------|------|-------|-------------|
| `listUsers` | query | `{ page?, search? }` | Paginated user list with optional email/name search |
| `createUser` | mutation | `{ email, name, password, isAdmin? }` | Create user with argon2 hash. Reuse `ARGON2_OPTIONS` from auth. |
| `toggleAdmin` | mutation | `{ userId }` | Flip `isAdmin`. Prevent self-demotion. |
| `resetPassword` | mutation | `{ userId, newPassword }` | Hash and update password. |
| `toggleDisabled` | mutation | `{ userId }` | Set/clear `disabledAt`. Prevent self-disable. Invalidate all sessions on disable. |

### Auth Integration

- **Login flow** (`apps/web/src/routes/auth/login/+page.server.ts`) must check `disabledAt` and reject with "Account disabled" error
- **Lucia `DatabaseUserAttributes`** (`apps/web/src/lib/server/auth/index.ts`) must include `disabledAt` in the interface and `getUserAttributes` so it's available on `event.locals.user`
- **hooks.server.ts** must check `disabledAt` on every request — both cookie-auth (Lucia `validateSession`) and API-key auth paths. Reject with 403 if disabled.
- **`toggleDisabled` (disable)** must delete all sessions for that user to force immediate logout
- **Password validation**: `createUser` and `resetPassword` must enforce minimum password length (8 chars, matching signup)

## Frontend: Admin Page Enhancement

Modify existing `apps/web/src/routes/(app)/admin/+page.svelte` and `+page.server.ts`.

### Table Enhancements

- Add "Status" column showing Active/Disabled badge
- Add "Actions" column with icon buttons: toggle admin, reset password, disable/enable
- Add search input above table
- Add "Create User" button above table

### Modals

**Create User Modal:**
- Fields: email, name, password, confirm password, admin checkbox
- Validation: email format, password match, minimum length
- On success: refresh table, show toast

**Reset Password Modal:**
- Fields: new password, confirm password
- Shows which user is being reset
- On success: show toast with confirmation

### Confirmations

- Toggle admin: confirm dialog ("Promote X to admin?" / "Remove admin from X?")
- Disable: confirm dialog ("Disable X? They will be logged out immediately.")
- Enable: no confirmation needed

## Data Flow

```
Admin Page (Svelte)
  → tRPC client call (admin.createUser / admin.toggleAdmin / etc.)
    → admin tRPC router (isAdmin guard)
      → Drizzle query (users table)
      → Session cleanup (on disable)
    ← Result
  ← Invalidate + refresh table
```

## Testing

- **Admin router unit tests** (`apps/web/src/__tests__/admin.test.ts`):
  - createUser: happy path, duplicate email rejection, non-admin rejection
  - toggleAdmin: promote, demote, self-demotion prevention
  - resetPassword: happy path, user-not-found
  - toggleDisabled: disable + session cleanup, enable, self-disable prevention
- **Auth login test**: disabled user cannot log in

## Files to Create/Modify

| File | Action |
|------|--------|
| `apps/web/src/lib/server/db/migrations/NNNN_add_disabled_at.sql` | Create — migration (use Drizzle Kit `pnpm drizzle-kit generate` to produce) |
| `apps/web/src/lib/server/db/schema.ts` | Modify — add `disabledAt` column |
| `apps/web/src/lib/server/auth/index.ts` | Modify — add `disabledAt` to `DatabaseUserAttributes` and `getUserAttributes` |
| `apps/web/src/hooks.server.ts` | Modify — check `disabledAt` in both cookie-auth and API-key auth paths |
| `apps/web/src/lib/server/trpc/init.ts` | Modify — add `adminProcedure` |
| `apps/web/src/lib/server/trpc/routers/admin.ts` | Create — admin tRPC router |
| `apps/web/src/lib/server/trpc/router.ts` | Modify — register admin router |
| `apps/web/src/routes/(app)/admin/+page.server.ts` | Modify — use tRPC for user listing |
| `apps/web/src/routes/(app)/admin/+page.svelte` | Modify — add actions, modals, search |
| `apps/web/src/routes/auth/login/+page.server.ts` | Modify — reject disabled users |
| `apps/web/src/__tests__/admin.test.ts` | Create — admin router tests |

## Out of Scope

- Email-based invite flow (no SMTP infra)
- Email-based password reset (admin sets password directly)
- Hard delete of users (soft disable covers the use case)
- User self-service profile editing (separate feature)
