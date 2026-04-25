# SvelteKit Data Flow Audit

Skill applied: `svelte-skills/1.3.0/skills/sveltekit-data-flow` (SKILL + 5 references).
Scope: `apps/web/src/routes/**` server load files, layout loads, form actions, invalidation. Read-only.

Severity legend: HIGH = correctness/security risk per skill; MED = pattern violation, perf or DX cost; LOW = nit.

---

## H1 — MED — Drizzle `Date` columns leak through server-load returns un-stringified

**Skill rule:** `serialization.md` → "Date" is in the **NOT serializable** table; **Quick Checklist** #2: "No Date objects? (convert to `.toISOString()`)". Devalue does in fact preserve Date over the wire, but the skill is unambiguous: convert at the server-load boundary so the contract on `data.foo` is a string and consumers don't accidentally `JSON.stringify` it.

Violations (each returns Drizzle rows with `timestamp()` columns):

- `routes/(app)/dashboard/+page.server.ts:87-94` — `maps.createdAt`, `maps.updatedAt` returned via spread `{ ...m, layerCount }`. Same in the `sharedMaps` branch (lines ~80-85).
- `routes/(app)/settings/+page.server.ts:49-59, 61-` — `apiKeys.lastUsedAt`, `apiKeys.createdAt` selected raw and returned in `userKeys`.
- `routes/(app)/map/[id]/+page.server.ts:32-37` — returns the full Drizzle `map` row (`{ map, layers: mapLayers, ... }`); both `maps` and `layers` carry `createdAt/updatedAt: Date`.
- `routes/(public)/share/[token]/+page.server.ts:30-39` — `result.layers` returned wholesale; `layers.createdAt/updatedAt` are `Date`.
- `routes/(public)/embed/[token]/+page.server.ts:34-42` — same as share.
- `routes/(app)/admin/+page.server.ts:80-90` — `userList`, `jobList`, `auditLog: auditEntries` returned raw; `auditLog.createdAt`, `users.disabledAt`, `importJobs.createdAt` are `Date`.

Counter-evidence the skill is right anyway: `share/[token]/+page.server.ts:27` already does `expiredAt: result.expiredAt.toISOString()` for the expiry path — pick a side and apply it everywhere.

**Fix:** project the column with `.toISOString()` at the load boundary, or wrap with a serializer in `lib/server/api/serializers.ts` (already exists for the v1 API — reuse).

---

## H2 — MED — `invalidateAll()` overused; zero `depends()` calls anywhere

**Skill rule:** `load-functions.md` → "Pattern 3: Depends for Revalidation". `client-auth-invalidation.md` → "`invalidateAll()` is the nuclear option - it re-runs ALL load functions for the current page".

`grep -rn 'depends('` returns zero hits in `apps/web/src`. Twelve `invalidateAll()` callsites in app routes:

- `routes/(app)/admin/+page.svelte:45, 51, 60, 73`
- `routes/(app)/settings/+page.svelte:47, 56, 74, 86`
- `routes/(app)/dashboard/+page.svelte:65, 82`
- `routes/(app)/map/[id]/+page.svelte:21` (retry handler — defensible)
- `routes/(public)/share/[token]/+page.svelte:13` (retry handler — defensible)

Each form-action success in admin/settings/dashboard re-runs `+layout.server.ts (root)` + `+layout.server.ts ((app))` + the page load. For `settings`, that means re-fetching `apiKeys` for a name change. For `admin`, every toggle re-walks the upload directory (`getDirectoryStats` is recursive `readdir + stat`).

**Fix:** add `depends('settings:profile')`, `depends('settings:keys')`, `depends('admin:audit')`, `depends('admin:storage')`, `depends('dashboard:maps')` in the relevant loads. Replace `invalidateAll()` with `invalidate('settings:keys')` etc. in the handler.

Confirms prior audit MED, with sharper line numbers and the "zero `depends()`" framing.

---

## H3 — LOW — `+page.server.ts:8` returns from `redirect()` instead of letting it throw via the void path

**Skill rule:** `error-redirect-handling.md` → "**Throw** redirect()". SvelteKit ≥ 2 lets `redirect(...)` throw internally even when called bare — both forms are correct in modern SvelteKit, and this codebase uses the bare form consistently (`redirect(302, ...)` without `throw`). The skill examples still all show `throw redirect(...)`.

Sites (consistent style — flag only because skill examples differ):
- `routes/+page.server.ts:6, 8`
- `routes/(app)/+layout.server.ts:6`
- `routes/(app)/dashboard/+page.server.ts:19, 99, 104, 113, ...` (all actions + load)
- `routes/(app)/settings/+page.server.ts:47, 73, 87, ...`
- `routes/auth/{signup,login,logout}/+page.server.ts` (multiple)

**Fix:** none required — the bare form is supported. Optionally add `throw` for skill-style consistency, or document the project convention. Do **not** wrap any of these in `try/catch` (see H4).

---

## H4 — Clean — No `try/catch` swallows a redirect/error

**Skill rule:** `error-redirect-handling.md` → "❌ Catching redirect Without Rethrowing".

Searched all `+page.server.ts` for `throw redirect|throw error` inside `try` blocks. None of the form actions wrap `redirect(...)` in a `try/catch`. The two `try/catch` blocks in form actions (`routes/auth/signup/+page.server.ts:54-64` for `db.insert` 23505 unique-violation) execute **before** the redirect and rethrow non-handled errors. Confirms prior audit "Clean".

---

## H5 — LOW — `fail()` shape inconsistency: `dashboard` actions drop the `field` key

**Skill rule:** `form-actions.md` → "Return validation errors + form data to repopulate fields"; project mulch convention `mx-…` says "All SvelteKit form actions that return fail() must use { error: string } as the key" — but the established codebase shape is `{ field, message }` (every auth + settings + admin action).

Inconsistency:
- `routes/(app)/dashboard/+page.server.ts:103, 109(deleteMap), 116(cloneMap), 124(useTemplate)` — return `fail(500, { message: '...' })` with no `field`. Every other action in the project returns `{ field: '<name>'|'', message: '...' }`.

Impact: `+page.svelte` consumers that read `form?.field === 'title'` will get `undefined` and miss field-targeted error rendering.

**Fix:** add `field: ''` (or the relevant input name) to dashboard `fail()` returns. Or codify the contract in a Zod-validated `fail()` helper in `lib/server/forms.ts`.

---

## H6 — LOW — Public SSR routes (`share`, `embed`) call `setHeaders` without `Cache-Control`, but that's fine; only `embed` sets a header at all

**Skill rule:** `load-functions.md` → server-load runs per-request; cache headers amplify singleton bleed. (Cross-ref to `svelte-deployment` audit's MED on leaky singletons.)

- `routes/(public)/share/[token]/+page.server.ts` — does NOT call `setHeaders`. No `Cache-Control: public` risk. Safe.
- `routes/(public)/embed/[token]/+page.server.ts:30-32` — sets `Content-Security-Policy: frame-ancestors *` only. No caching directive. Safe.

Refutes the prior audit's "LOW: public route caching headers may amplify SSR singleton leak" — the singleton-leak risk exists, but it isn't aggravated by cache headers because there are none. Keep the singleton fix; drop the cache-header concern.

---

## H7 — LOW — `+layout.server.ts` (root) returns `null` for unauthenticated user; `(app)/+layout.server.ts` re-derives the same shape

**Skill rule:** `load-functions.md` → child loads receive parent data automatically; don't refetch.

- `routes/+layout.server.ts:3-13` returns `{ user: locals.user ? {...} : null }` (omits `isAdmin`).
- `routes/(app)/+layout.server.ts:4-17` redirects-if-unauth then returns `{ user: { id, email, name, isAdmin } }` — re-projecting `locals.user`. Doesn't `await parent()`.
- `routes/(app)/admin/+layout.server.ts:4-7` correctly does `const { user } = await parent()` and uses `user.isAdmin` — but `user.isAdmin` only exists because `(app)/+layout.server.ts` re-added it; the root layout's `user` shape is missing `isAdmin`, so admin layout depends on the **app** layout, not the root.

This is fine but fragile. If anyone navigates to admin via a route that doesn't sit under `(app)`, `user.isAdmin` will be `undefined`. Also, the cast `(locals.user as { id; email; name })` at `+layout.server.ts:8-9` exists only because `App.Locals.user` likely lacks the typed shape — fix the type instead of casting at every callsite.

**Fix:** widen the root layout's `user` projection to include `isAdmin` once and stop re-projecting in `(app)/+layout.server.ts` (just check the redirect there). Drop the inline `as` casts by tightening `App.Locals`.

---

## H8 — Clean — No non-default named action without `form` prop awareness

`form-actions.md` → "Form Prop in Page". Dashboard, settings, admin all use named actions (`createMap`, `useTemplate`, `changePassword`, `deleteApiKey`, `toggleDisable`, etc.). The `+page.svelte` files use `use:enhance` and read `form` (already verified by prior audit). No `?/{action}` URL bug found.

---

## H9 — Clean — No `+page.ts` hybrid loads; no `$lib/server/*` import in universal code

`find` for `+page.ts`/`+layout.ts` under `routes/` returns 0 results. There is no risk of accidentally importing `$lib/server/*` into a universal load.

Implication: there is also no opportunity to do **Pattern 1 (Server + Universal)** parallelization for client-side `fetch` — every public-data `fetch` happens inside `+page.svelte` `$effect` instead. Not a skill violation; flagging as a follow-up if waterfall load times become a concern (`map/[id]` does 2 sequential DB queries; `embed/[token]` does 3 sequential `db.select()` chains — `Promise.all` available).

Sequential-DB sites worth parallelizing in load (independent reads):
- `routes/(public)/embed/[token]/+page.server.ts:8, 14, 20` — `share → map → layers` is serial **but `layers` only depends on `share.mapId`**, so `map` and `layers` can be `Promise.all`'d once `share` is resolved. Modest win.
- `routes/(app)/admin/+page.server.ts:36-…` — already uses `Promise.all([userList, jobList, auditEntries, storageStats])`. Good.

---

## H10 — Clean — `parent()` usage minimal and correct

Only callsite: `routes/(app)/admin/+layout.server.ts:5` — awaits parent before the auth check. Correct (no waterfall — there's no other work in this load).

---

## Confirm/Refute against prior audit

| Prior finding | Verdict |
|---|---|
| MED: `invalidateAll()` overuse, 12 sites | **Confirmed** (see H2) — sharpened to "zero `depends()` calls anywhere"; line numbers verified. |
| LOW: public route caching amplifies SSR singleton leak | **Refuted** (see H6) — neither `share` nor `embed` sets `Cache-Control`. Singleton fix still required (separate skill). |
| Clean: `fail()` shape consistent `{field, message}` | **Partially refuted** (see H5) — dashboard actions drop `field`. |
| Clean: no `+page.ts` hybrid | **Confirmed** (H9). |
| Clean: redirect not in try/catch | **Confirmed** (H4). |
| Clean: cookies server-only | **Confirmed** — `cookies.set` only in `+page.server.ts` files (signup, login, logout). |

## New findings beyond prior audit

- H1 — Date serialization deviation (load-boundary contract).
- H7 — root vs `(app)` layout shape duplication / fragile `isAdmin` provenance.
- H9 — sequential DB chains in `embed` load (parallelization available).
