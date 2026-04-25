# Audit — `svelte-deployment` skill

Skill: `/home/micah/.claude/plugins/cache/svelte-skills-kit/svelte-skills/1.3.0/skills/svelte-deployment/SKILL.md` (+ `references/{cloudflare-gotchas,library-authoring,pwa-setup}.md`).
Project: `apps/web` — `@sveltejs/adapter-node@5.2.9`, SvelteKit 2.15.1, Svelte 5.17.3, Vite 6, pnpm 9.15.4, Turbo 2.3.3, multi-stage Dockerfile.
Skill scope is narrow (adapters / Vite / pnpm / library / PWA / production builds). It does NOT prescribe csrf, csp, or trailingSlash — most "production hardening" findings below are inferred from SvelteKit's own deployment surface even when not in the skill text. Severity reflects production blast radius.

Severity legend: 🔴 HIGH · 🟠 MED · 🟡 LOW · ✅ Clean.

---

## Findings

### 🟠 MED — Embed route opens `frame-ancestors *` for all callers
`apps/web/src/routes/(public)/embed/[token]/+page.server.ts:30-32` sets `Content-Security-Policy: frame-ancestors *` unconditionally on success. The comment explains intent (allow embedding anywhere); this is a deliberate decision but it's the only CSP header in the app and it's the most permissive value possible. Skill rule (cloudflare-gotchas indirectly + general production hygiene): document the decision in code AND in `audits/`. Fix: keep header but (a) add a per-share allow-list field if the schema allows, or (b) emit `frame-ancestors 'self' https://*` and require explicit opt-in. At minimum, surface this as a documented public-API contract — currently undeclared.

### 🟠 MED — Public SSR routes set no `Cache-Control`; share route also omits `setHeaders`
`apps/web/src/routes/(public)/share/[token]/+page.server.ts` (whole file, esp. lines 5, 30-39) returns map+layers without `setHeaders`. `embed/[token]/+page.server.ts:30` sets only CSP, no `Cache-Control`. With `adapter-node` behind any reverse proxy / CDN, the default is implementation-dependent and may cache token-keyed responses across users. Skill: SKILL.md "Notes" implicitly covers production builds; SvelteKit docs require explicit cache decisions on public, token-parameterised SSR. Fix: add `setHeaders({ 'Cache-Control': 'private, no-store' })` on both routes (or `public, max-age=60` only after the `mapStore` singleton fix referenced in `svelte-skills-audit.md:172`). **Confirms prior_findings MED.**

### 🟠 MED — `csrf.checkOrigin` not configured; relying on SvelteKit default
`apps/web/svelte.config.js:5-15` defines no `kit.csrf` block. Default is `checkOrigin: true`, which is correct — but the project also exposes a Bearer-token API (`hooks.server.ts:17-24`) that bypasses cookie-auth. If anyone disables csrf later for the API surface, the form-action surface goes with it. Skill: not directly covered, but pnpm/library-authoring reference assumes explicit config. Fix: pin the default in `svelte.config.js` (`kit.csrf = { checkOrigin: true }`) so the intent is explicit and a future PR cannot silently downgrade it. Same for `kit.csp` — unset → no nonce/hash for inline scripts.

### 🟠 MED — `paths`, `prerender`, `trailingSlash`, `version` all unset
`apps/web/svelte.config.js:7-15` configures only `adapter` and `alias`. Skill ref `library-authoring` and SKILL.md "Notes" call out production builds; SvelteKit prod-readiness checklist expects explicit decisions on `kit.version` (cache-busting / "new version" toast), `kit.prerender.entries` (none here, but SSR-only must be declared), and `paths.relative` for sub-path mounts. None are fatal under adapter-node, but the silence is technical debt. Fix: add `version: { name: process.env.GIT_SHA ?? 'dev' }` (paired with `Dockerfile.web` build args) so the client invalidates after deploy.

### 🟡 LOW — `process.env.*` reads bypass `$env/dynamic/private`
`apps/web/src/routes/api/v1/middleware.ts:128`, `apps/web/src/routes/api/v1/export/progress/+server.ts:29-30,63` read `process.env.API_RATE_LIMIT`, `EXPORT_SSE_STREAM_CAP`, `EXPORT_SSE_IDLE_MS`, `EXPORT_SSE_ERROR_HOLD_MS` directly. Cloudflare-gotchas reference §"Environment Variables" explicitly warns that this works on Node but not on edge adapters; even on adapter-node it sidesteps SvelteKit's env validation. Fix: route through `import { env } from '$env/dynamic/private'` (same pattern already in use at `lib/server/auth/index.ts:3`, `lib/server/db/index.ts:4`, etc.).

### 🟡 LOW — No service-worker, but `static/manifest.webmanifest` + maskable icons exist
`apps/web/static/manifest.webmanifest` plus `static/icons/icon-{192,512,512-maskable}.png` (listed under `service_worker` command output) ship a PWA manifest with no `src/service-worker.ts` and no `kit.serviceWorker.register` toggle. Skill ref `pwa-setup.md` makes registration a hard requirement when a manifest is present — otherwise installable-app prompts fire but offline doesn't work. Fix: either add `src/service-worker.ts` (workbox precache pattern from skill) or remove the manifest + icons. Currently advertising a capability the app does not provide.

### 🟡 LOW — `playwright.config.ts` runs against `pnpm dev`, not preview build
`apps/web/playwright.config.ts:30-35` uses `command: 'pnpm dev'`. Skill ref `pwa-setup.md → Testing PWA` and the SKILL.md "Notes" production-build line both say preview builds catch ssr-vs-csr, hydration, and adapter-node-specific bugs that dev mode masks (Tailwind 4 JIT differences, manualChunks reality, MapLibre worker bundling — the very thing `vite.config.ts:9-14` comments warn about). Fix: add an opt-in `webServer.command = 'pnpm build && pnpm preview --port 5173'` profile, or a CI-only env flag.

### 🟡 LOW — `apps/web/.env` is the only env file; no `.env.example`
`apps/web/.env` exists; no `.env.example` at app or repo root. Skill ref `cloudflare-gotchas.md` Environment Variables section + general operability: a checked-in example with `PUBLIC_*` and private keys (without values) is the documented contract. Fix: commit `apps/web/.env.example` covering `DATABASE_URL`, `REDIS_URL`, `UPLOAD_DIR`, `PUBLIC_MARTIN_URL`, the four `EXPORT_SSE_*` knobs, and `API_RATE_LIMIT`.

### 🟡 LOW — `docker/Dockerfile.web:44` `pnpm install --prod` after copying source
`docker/Dockerfile.web:30-49` runs `pnpm install --frozen-lockfile --prod` in the runner stage AFTER the builder stage already did `pnpm install --frozen-lockfile`. Skill ref `library-authoring → Publishing Checklist` and pnpm-workspace conventions: prefer `pnpm deploy --prod` from the builder stage, or `pnpm fetch` + `pnpm install --offline --prod` to skip the second network round-trip. Current approach inflates image build time and pulls registry on every cold build.

### ✅ Clean — confirmed from skill rules

- `apps/web/svelte.config.js:8-11` — `adapter-node` with explicit `out: 'build'` matches SKILL.md Adapters section and the runner CMD `node apps/web/build/index.js` in `docker/Dockerfile.web:79`.
- `apps/web/vite.config.ts:14` `build.target: 'es2022'` with the precise MapLibre worker reason commented (lines 9-13). Cross-references `optimizeDeps.esbuildOptions.target: 'es2022'` at line 63 — prevents the dev/prod helper-mismatch class. Confirms prior_findings clean.
- `apps/web/vite.config.ts:18-23` — `manualChunks` isolates `maplibre-gl` + `@maplibre/*`. Largest dep, correct chunk. Confirms prior_findings.
- `apps/web/vite.config.ts:35-49` — vitest `coverage.exclude` correctly skips browser-only stores (`map.svelte.ts`, `selection.svelte.ts`, `style.svelte.ts`) and infrastructure (jobs, trpc context/router, shapefile importer). Confirms prior_findings.
- `apps/web/package.json:7-15` — `dev/build/preview/check/test/test:e2e` scripts all present and one-to-one with skill expectations.
- `apps/web/src/hooks.server.ts:1-117` — single `handle` chain, Bearer-then-session order documented (lines 13-15) so future contributors won't reorder it.
- `pnpm-workspace.yaml:1-4` — three buckets (`apps/*`, `packages/*`, `services/*`); `Dockerfile.web` copies each manifest individually (lines 9-14, 36-41) so layer cache invalidates per-package, not on every source edit. Best-practice for pnpm monorepo.
- `docker/Dockerfile.web:67-69` — non-root `sveltekit:nodejs` (uid 1001), `chown` of upload volume. Skill doesn't prescribe but production hygiene confirmed.
- `turbo.json` — `build.outputs` includes `.svelte-kit/**`, `build/**`, `dist/**`; `test.cache: false` (correct because vitest reads env). `inputs` includes `.env*` so cache busts on env changes.

---

## Confirm / refute prior_findings

- ✅ **MED — public SSR routes interact with leaky singletons → cache-header audit needed.** Confirmed and elevated: `share/[token]/+page.server.ts` has no `setHeaders` at all (worse than feared), `embed/[token]/+page.server.ts:30` only sets CSP. Fix `Cache-Control: private, no-store` before any singleton fix lands.
- ✅ **Clean — vite build target / manualChunks / optimizeDeps / vitest coverage / adapter-node single output.** All confirmed at file:line above.

---

## Recommended fix order

1. Add `Cache-Control: private, no-store` to both `(public)/share/[token]/+page.server.ts` and `(public)/embed/[token]/+page.server.ts` (5 min, blocks the §1 leak amplification).
2. Migrate the four `process.env.*` callsites in `routes/api/v1/middleware.ts` and `export/progress/+server.ts` to `$env/dynamic/private` (10 min).
3. Pin `kit.csrf.checkOrigin = true` and add `kit.version.name` in `svelte.config.js` (5 min).
4. Decide PWA: add `src/service-worker.ts` per skill ref, OR delete `static/manifest.webmanifest` + icons (1 hour vs 2 min).
5. Commit `apps/web/.env.example` (15 min).
6. Tighten `embed` `frame-ancestors` once a per-share embedding-policy field exists (schema change — defer).
7. Switch `playwright.config.ts` to preview-mode in CI profile (30 min).
8. Switch `Dockerfile.web` to `pnpm deploy --prod` (1 hour, image-size win).
