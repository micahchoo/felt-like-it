## Vision

Build a **self-hostable, collaborative web GIS platform** — a Felt.com alternative that a single developer can deploy, maintain, and extend. The system makes complex geospatial workflows feel simple through intuitive design, while being architecturally robust enough to scale from a small team to an organization. Built with Svelte 5, SvelteKit, and PostGIS. Zero cloud dependencies. One `docker compose up` to run everything.

This is **not** Dekart (read-only SQL visualization wrapping Kepler.gl), **not** Placemark (single-user data editor that failed as SaaS), and **not** QGIS-in-the-browser. It is a collaborative, read-write GIS platform with PostGIS as both storage and analysis engine, and a deployment model that sidesteps the pricing death zone that killed Placemark.

---

## Why Svelte 5 & SvelteKit (Not React, Not Next.js, Not Angular)

### Against Next.js / React

The GIS ecosystem (MapLibre, deck.gl, Kepler.gl) is historically React-centric, but MapLibre GL JS is framework-agnostic and has first-class Svelte 5 wrappers (`svelte-maplibre-gl` by MIERUNE, plus `svelte-maplibre-components` for export, legend, measure, and attribute table plugins). The React argument dissolves once you use MapLibre directly instead of embedding Kepler.gl as a black box (a lesson from Dekart's ceiling problem).

Next.js adds deployment friction for self-hosters. It wants to own server, routing, and API layer, making it hard to scale frontend and backend independently. Placemark was built on Blitz.js/Next.js and Tom MacWright called the result "a fairly complicated codebase" that was painful to decompose for open source. SSR/ISR/edge-function value propositions are wasted on an app that is 90% a WebGL map canvas.

### Against Angular

The geospatial JavaScript ecosystem has virtually no Angular integration. MapLibre wrappers are unofficial and unmaintained. Contributor pool for Angular + GIS is near zero.

### For SvelteKit

**`adapter-node` produces a standard Node.js server.** One `docker build`, one `docker run`. Self-hosters get a familiar deployment model. No Vercel-specific runtime, no serverless cold starts, no platform lock-in.

**SvelteKit IS the backend.** Server routes (`+server.ts`), form actions, hooks, and `load` functions eliminate the need for a separate Fastify or Express server. tRPC integrates via `trpc-sveltekit` (with experimental WebSocket support for real-time features) or natively through SvelteKit's Fetch-based API routes with tRPC 11's Fetch adapter. The API lives inside the same project but remains cleanly separated by convention.

**Svelte 5 runes are ideal for complex map state.** A GIS app has deeply nested, highly reactive state: map viewport, layer stack, feature selections, styling rules, active tool, undo history. Svelte 5's `$state`, `$derived`, and `$effect` runes provide fine-grained, signal-based reactivity without Redux boilerplate or Zustand wrappers. Shared state across components lives in `.svelte.ts` files using universal reactivity — no store API, no context gymnastics, just reactive variables that work everywhere.

**Smaller bundles, faster renders.** Svelte compiles to vanilla DOM manipulation with no virtual DOM diffing. For a map-heavy app where the framework manages sidebar panels, layer controls, and data tables while MapLibre handles the canvas, Svelte's minimal runtime footprint means less JS competing with WebGL for the main thread.

**SvelteKit's file-based routing is right-sized.** The app has roughly 5-8 routes (dashboard, map editor, settings, admin, shared map view, embed). SvelteKit's routing handles this without the overhead of React Router or Next.js's increasingly complex routing model.

---

## Technical Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Framework** | SvelteKit + `adapter-node` + TypeScript | Full-stack, self-hostable Node.js server |
| **UI Reactivity** | Svelte 5 runes (`$state`, `$derived`, `$effect`) | Signal-based, fine-grained, no external state library |
| **Map Engine** | MapLibre GL JS (via `svelte-maplibre-gl`) | Open source, no Mapbox token, WebGL, Svelte 5 native wrapper |
| **Advanced Viz** | deck.gl (optional, Phase 4+) | Large-scale point clouds, 3D, heatmaps |
| **API Layer** | SvelteKit server routes + tRPC (via `trpc-sveltekit` or Fetch adapter) | End-to-end type safety, WebSocket support |
| **Validation** | Zod | Shared schemas between client and server |
| **Spatial DB** | PostgreSQL + PostGIS | Industry-standard spatial queries, the analysis engine |
| **ORM / Query** | Drizzle ORM (with PostGIS extensions) | Typed queries, lightweight, migration support |
| **Tile Server** | Martin (Rust) | Serves vector tiles directly from PostGIS |
| **Tile Generation** | Tippecanoe | Best-in-class vector tile compression for static datasets |
| **Geocoding** | Nominatim (self-hosted) or Pelias | No external API dependency |
| **Job Queue** | BullMQ (Redis-backed) | File processing, tiling, geocoding background jobs |
| **Real-time** | Yjs (CRDT) over WebSocket | Conflict-free collaboration without OT complexity |
| **File Storage** | Local disk / S3-compatible (MinIO) | Self-hostable object storage |
| **Auth** | Lucia Auth (v3+) or custom session-based with SvelteKit hooks | Flexible, self-hosted, no third-party dependency |
| **CSS** | Tailwind CSS 4 | Utility-first, design system consistency |
| **Containerization** | Docker Compose (dev/small), Helm chart (prod) | One-command deployment |
| **Reverse Proxy** | Caddy or Traefik | Auto-TLS, simple config |

---

## Project Structure (Monorepo)

```
geo-platform/
├── apps/
│   └── web/                        # SvelteKit application (frontend + API)
│       ├── src/
│       │   ├── lib/
│       │   │   ├── server/          # Server-only code (DB, auth, jobs)
│       │   │   │   ├── db/          # Drizzle schema, migrations, queries
│       │   │   │   ├── auth/        # Lucia auth config, session utils
│       │   │   │   ├── geo/         # Server-side geo operations (PostGIS)
│       │   │   │   ├── import/      # File parsing pipelines (GeoJSON, CSV, Shapefile)
│       │   │   │   ├── export/      # Export formatters
│       │   │   │   ├── jobs/        # BullMQ job definitions
│       │   │   │   └── trpc/        # tRPC router, context, procedures
│       │   │   ├── components/
│       │   │   │   ├── map/         # MapLibre wrapper, layers, controls, drawing
│       │   │   │   ├── data/        # Data table, import dialog, export dialog
│       │   │   │   ├── style/       # Layer styling panel, legend, color pickers
│       │   │   │   ├── collab/      # Presence indicators, comments, cursors
│       │   │   │   └── ui/          # Shared UI primitives (buttons, modals, toasts)
│       │   │   ├── stores/          # Svelte 5 reactive state (.svelte.ts files)
│       │   │   │   ├── map.svelte.ts       # Viewport, basemap, interaction mode
│       │   │   │   ├── layers.svelte.ts    # Layer stack, visibility, ordering
│       │   │   │   ├── selection.svelte.ts # Selected features, active tool
│       │   │   │   ├── style.svelte.ts     # Styling rules, legends
│       │   │   │   └── undo.svelte.ts      # Command history for undo/redo
│       │   │   ├── utils/           # Client-side geo utilities (Turf.js wrappers)
│       │   │   └── types/           # Shared TypeScript types and Zod schemas
│       │   ├── routes/
│       │   │   ├── (app)/           # Authenticated app routes (layout group)
│       │   │   │   ├── dashboard/   # Map listing, create new
│       │   │   │   ├── map/[id]/    # Map editor (the core experience)
│       │   │   │   ├── settings/    # User settings, team management
│       │   │   │   └── admin/       # Admin panel (users, storage, jobs)
│       │   │   ├── (public)/        # Public routes (no auth required)
│       │   │   │   ├── share/[id]/  # Shared map viewer (read-only)
│       │   │   │   └── embed/[id]/  # Embeddable map iframe
│       │   │   ├── auth/            # Login, signup, forgot password
│       │   │   └── api/             # REST endpoints (file upload, webhooks, tRPC)
│       │   │       └── trpc/[...trpc]/ # tRPC catch-all route
│       │   ├── hooks.server.ts      # Auth session, tRPC handle, rate limiting
│       │   └── app.d.ts            # SvelteKit type augmentation (session, locals)
│       ├── static/                  # Favicon, manifest, OG images
│       ├── svelte.config.js         # adapter-node config
│       ├── vite.config.ts
│       └── tailwind.config.ts
├── packages/
│   ├── geo-engine/              # Pure TS spatial logic (format detection, transforms)
│   ├── shared-types/            # Zod schemas + inferred TS types (used by all)
│   └── db/                      # Drizzle schema as standalone package for CLI tools
├── services/
│   ├── worker/                  # BullMQ worker process (file import, tiling, geocoding)
│   └── tile-server/             # Martin config + Dockerfile
├── docker/
│   ├── docker-compose.yml       # Dev: all services
│   ├── docker-compose.prod.yml  # Prod: optimized, with volumes
│   ├── Dockerfile.web           # SvelteKit app
│   ├── Dockerfile.worker        # Job processor
│   └── Dockerfile.martin        # Tile server
├── scripts/
│   ├── seed.ts                  # Demo data seeder
│   ├── migrate.ts               # DB migration runner
│   └── admin-cli.ts             # Create user, reset password, etc.
├── docs/
│   ├── architecture.md          # Architecture decision records
│   ├── deployment.md            # Self-hosting guide
│   └── api.md                   # Auto-generated from tRPC router
├── turbo.json                   # Turborepo config
├── pnpm-workspace.yaml
└── package.json
```

---

## Architecture Enforcement — Tests, Linters & Guardrails as Code

A solo developer cannot rely on code review to maintain architectural boundaries. The architecture must be machine-enforced through linting rules, import restrictions, test coverage requirements, and CI gates. Every rule below should fail CI if violated.

### Import Boundary Enforcement

**Tool: `eslint-plugin-boundaries` or `eslint-plugin-import/no-restricted-paths`**

These rules encode the dependency graph. They are the most important architectural guardrails in the project.

```jsonc
// .eslintrc — import boundary rules
{
  "rules": {
    "import/no-restricted-paths": ["error", {
      "zones": [
        // Components CANNOT import from server code
        { "target": "./src/lib/components/**", "from": "./src/lib/server/**",
          "message": "Components must not import server modules. Use load functions or tRPC." },

        // Stores CANNOT import from components (dependency inversion)
        { "target": "./src/lib/stores/**", "from": "./src/lib/components/**",
          "message": "Stores must not depend on components." },

        // Server code CANNOT import from components or stores
        { "target": "./src/lib/server/**", "from": "./src/lib/components/**",
          "message": "Server code must not import client components." },
        { "target": "./src/lib/server/**", "from": "./src/lib/stores/**",
          "message": "Server code must not import client stores." },

        // geo-engine package must be pure (no SvelteKit, no DB, no Node APIs)
        { "target": "../packages/geo-engine/**", "from": "./src/**",
          "message": "geo-engine must remain framework-agnostic." },

        // shared-types must have zero runtime dependencies
        { "target": "../packages/shared-types/**", "from": "./src/lib/server/**",
          "message": "shared-types must not import app code." },

        // Public routes cannot import auth-required utilities
        { "target": "./src/routes/(public)/**", "from": "./src/lib/server/auth/**",
          "message": "Public routes must not use auth utilities directly." }
      ]
    }]
  }
}
```

### Strict TypeScript Configuration

**No `any`. No implicit types. No escape hatches.**

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true
  }
}
```

ESLint enforces no `any` and no type assertions:

```jsonc
{
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-non-null-assertion": "error",
  "@typescript-eslint/consistent-type-imports": ["error", { "prefer": "type-imports" }],
  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-member-access": "error",
  "@typescript-eslint/no-unsafe-call": "error"
}
```

### Test Suite Strategy

**Tool: Vitest (unit + integration), Playwright (E2E)**

The test strategy is layered by risk. Not everything needs the same coverage — spatial logic and data pipelines need exhaustive tests; UI components need smoke tests and a few interaction tests.

```
Layer                  Tool        Coverage Target  What To Test
──────────────────────────────────────────────────────────────────
packages/geo-engine    Vitest      95%+            Format detection, coordinate transforms,
                                                    geometry validation, Turf.js wrappers.
                                                    These are pure functions — test exhaustively.

packages/shared-types  Vitest      100%            Zod schema parsing, edge cases, serialization
                                                    round-trips. If a schema is wrong, everything
                                                    downstream breaks.

lib/server/import      Vitest      90%+            File parsing (GeoJSON, CSV, Shapefile).
                                                    Test with fixture files: valid, malformed,
                                                    huge, empty, wrong encoding, mixed geometry.

lib/server/geo         Vitest      85%+            PostGIS query builders, spatial operations.
                                                    Use testcontainers with PostGIS Docker image
                                                    for integration tests against real DB.

lib/server/auth        Vitest      80%+            Session creation, permission checks, role
                                                    guards. Mock DB layer.

lib/server/trpc        Vitest      80%+            Procedure input validation, auth guards,
                                                    error codes. Use tRPC caller for unit tests.

lib/stores             Vitest      70%+            State transitions, undo/redo stack, derived
                                                    computations. Test the .svelte.ts files as
                                                    plain modules.

lib/components         Vitest +    60%+            Smoke render tests. Key interaction tests
                       @testing-                    for data table, layer panel, drawing tools.
                       library/svelte               Not pixel-perfect — just "does it mount,
                                                    does clicking X trigger Y".

E2E critical paths     Playwright  Key flows       Upload file → see it on map → style it →
                                   only            share link → open shared view. Auth flow.
                                                    Export flow. These are integration contracts.
```

**CI gate:** Coverage thresholds are enforced per-package in `vitest.config.ts`:

```typescript
// vitest.config.ts (per workspace package)
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      thresholds: {
        // These fail CI if not met
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85
      }
    }
  }
})
```

### Linting & Formatting

**Tools: ESLint (flat config), Prettier, `svelte-check`**

```jsonc
// Key ESLint rules beyond TypeScript strictness
{
  "no-console": ["warn", { "allow": ["warn", "error"] }],
  "no-restricted-imports": ["error", {
    "patterns": [
      { "group": ["$env/static/*"], "importNames": ["default"],
        "message": "Use $env/dynamic for runtime config in self-hosted deployments." }
    ]
  }],
  "svelte/no-reactive-reassign": "error",
  "svelte/require-each-key": "error",
  "svelte/no-dom-manipulating": "warn"
}
```

**`svelte-check`** runs in CI as a type-checking gate (it catches template type errors that `tsc` alone misses):

```bash
pnpm svelte-check --tsconfig ./tsconfig.json --fail-on-warnings
```

### Dependency Hygiene

**Tools: `knip` (dead code/dependency detection), `depcheck`, `syncpack`**

- **`knip`**: Runs in CI. Detects unused exports, unused dependencies, unused files. Prevents dead code accumulation that makes a solo-maintained codebase unnavigable.
- **`syncpack`**: Enforces consistent dependency versions across all monorepo packages. No version drift.
- **`npm-audit` / `pnpm audit`**: Runs in CI. Fails on high/critical vulnerabilities.

```bash
# CI pipeline dependency checks
pnpm knip --no-progress          # Dead code detection
pnpm syncpack list-mismatches    # Version consistency
pnpm audit --audit-level=high    # Security
```

### Database Schema Enforcement

**Tool: Drizzle Kit + custom migration tests**

- All schema changes go through Drizzle migrations. No manual SQL against production.
- A CI job runs `drizzle-kit check` to ensure the schema file and migration history are in sync.
- Integration tests spin up a PostGIS container via `testcontainers` and run migrations against it before every test suite.
- Spatial column types are validated: every geometry column must specify SRID 4326 (WGS84) and geometry type.

```typescript
// Example: schema enforcement test
import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import * as schema from './schema';

describe('schema invariants', () => {
  it('all geometry columns use SRID 4326', () => {
    // Walk all tables, find geometry columns, assert SRID
  });

  it('all tables have created_at and updated_at timestamps', () => {
    for (const table of Object.values(schema)) {
      const cols = getTableColumns(table);
      expect(cols).toHaveProperty('createdAt');
      expect(cols).toHaveProperty('updatedAt');
    }
  });

  it('no table uses serial IDs (use UUIDs for self-hosted portability)', () => {
    // Assert all primary keys are uuid type
  });
});
```

### Architectural Decision Records (ADRs)

Every significant technical decision is recorded in `docs/adr/` as a numbered markdown file. These are not optional documentation — they are the institutional memory for a solo developer. When you revisit a decision 6 months later, the ADR tells you why you made it and what alternatives you rejected.

```
docs/adr/
├── 001-sveltekit-over-nextjs.md
├── 002-postgis-as-analysis-engine.md
├── 003-crdt-over-ot-for-collaboration.md
├── 004-martin-over-pg_tileserv.md
├── 005-uuid-primary-keys.md
├── 006-bullmq-over-pg-boss.md
└── ...
```

### CI Pipeline Summary

Every pull request must pass all of these gates:

```yaml
# .github/workflows/ci.yml (simplified)
jobs:
  check:
    steps:
      - pnpm install --frozen-lockfile
      - pnpm svelte-check --fail-on-warnings     # Svelte + TS template types
      - pnpm lint                                  # ESLint (import boundaries, strict TS, Svelte rules)
      - pnpm format:check                         # Prettier
      - pnpm knip                                  # Dead code / unused deps
      - pnpm syncpack list-mismatches             # Dependency version consistency
      - pnpm test -- --coverage                    # Vitest (unit + integration with coverage gates)
      - pnpm audit --audit-level=high             # Security audit
      - pnpm build                                 # SvelteKit production build (catches import errors)
      - pnpm test:e2e                             # Playwright (critical paths only)
```

---

## Lessons from Dekart and Placemark (Applied to This Architecture)

### From Dekart: What to Absorb, What to Avoid

**Absorb: Radical deployment simplicity.** Dekart is a single Docker container with a Go backend wrapping Kepler.gl. It stores metadata in PostgreSQL and caches query results in cloud storage. For a solo developer, this constraint is a feature. Start with the smallest number of moving parts (`docker compose up` runs everything).

**Absorb: SQL-first data access.** Dekart's users write SQL to query their warehouse and results appear on a map. Clear contract, zero ambiguity. PostGIS gives you the same power: every analysis operation is ultimately a SQL query. Expose this to power users while hiding it behind UI tools for everyone else.

**Avoid: Wrapping a rendering library as a black box.** Dekart embeds Kepler.gl (a React+Redux component) and inherits all its opinions and limitations. Dekart even maintains a fork of Kepler to work around issues. Use MapLibre GL JS directly via `svelte-maplibre-gl`. You write more code initially, but you have complete control and no ceiling.

**Avoid: Read-only architecture.** Dekart has no data editing or creation. Your platform is read-write from day one — editing and creating spatial data is what separates a GIS platform from a dashboard.

**Avoid: Cloud-warehouse dependency.** Dekart requires BigQuery, Snowflake, or Athena. Your data lives in PostGIS locally. Zero external service dependencies for core functionality.

### From Placemark: What to Absorb, What to Avoid

**Absorb: Beautiful, opinionated UX for geospatial data.** Placemark committed to being a data editing tool with a clear, modern interface. It respected GIS concepts (geometry types, coordinate systems, properties) without dumbing them down. Don't hide complexity — make it approachable.

**Absorb: Format fluency.** Placemark handled GeoJSON, KML, Shapefile, GPX, TopoJSON, CSV, WKT and more. Start with GeoJSON and CSV, but architect the import/export layer as a plugin system (`lib/server/import/` with one file per format) so adding formats is trivial.

**Absorb: Client-side processing for instant feedback.** Placemark ran format conversion and basic geometry operations in the browser using Turf.js. Adopt the same hybrid approach: lightweight operations (draw, edit, buffer small geometries) in the browser via Turf.js, heavy operations (spatial joins on large datasets, complex queries) in PostGIS server-side.

**Absorb: Modular open-source libraries.** Tom MacWright built standalone libraries (toGeoJSON, check-geojson) that outlived the product. Build your geo utilities in `packages/geo-engine/` as independent, testable modules, not tangled into Svelte components.

**Avoid: General-purpose positioning.** Tom MacWright's post-mortem: "I stopped Placemark because it didn't generate enough revenue... the high end is captured by Esri, the low end is captured by free tools." Self-hosted open source sidesteps this. Your "customer" is teams that need collaborative GIS but can't or won't use Esri or cloud-only tools (government, NGOs, defense, utilities, environmental orgs with data sovereignty requirements).

**Avoid: Monolithic full-stack framework coupling.** Placemark on Blitz.js/Next.js was "a fairly complicated codebase" that was painful to decompose. SvelteKit's convention of `lib/server/` vs `lib/components/` + enforced import boundaries via ESLint prevents this. The architecture is decomposable by design.

**Avoid: No marketing strategy for open source.** Tom admitted he should have done more marketing. For self-hosted OSS, your "marketing" is: a `docker compose up` that works in under 5 minutes, a demo dataset that loads automatically, excellent documentation, and a GIF in the README that shows the product in action.

---

## Differentiation Matrix

| | Dekart | Placemark | This Platform |
|---|---|---|---|
| **Primary function** | Visualize SQL query results | Edit geospatial data | Full collaborative GIS |
| **Data source** | Cloud data warehouses | File uploads, in-browser | PostGIS (local, persistent) |
| **Data editing** | Read-only | Full editing | Full editing + spatial analysis |
| **Collaboration** | Share links to maps | None (single-user) | Real-time multiplayer (Phase 3) |
| **Deployment** | Self-hosted, cloud-dependent | SaaS (then abandoned OSS) | Self-hosted, zero cloud deps |
| **Map engine** | Kepler.gl (wrapped, forked) | Mapbox GL JS | MapLibre GL JS (direct, via svelte-maplibre-gl) |
| **Framework** | Go + React (CRA + Redux) | Blitz.js / Next.js | SvelteKit + adapter-node |
| **Spatial DB** | External warehouse only | PostgreSQL (no PostGIS) | PostGIS (storage + analysis engine) |
| **Analysis tools** | SQL only | Turf.js (client-side only) | PostGIS + Turf.js (hybrid) |
| **Target user** | Data analysts who know SQL | GIS data editors | Teams needing collaborative GIS |
| **Architecture enforcement** | None documented | None documented | Linters, import boundaries, test gates, ADRs |

The key architectural insight: **PostGIS is the analysis engine**, not just storage. Dekart outsources computation to BigQuery/Snowflake. Placemark did geometry operations client-side with Turf.js. This platform does both — lightweight operations in the browser for instant feedback, heavy spatial queries in PostGIS for scale.

---

## Feature Specification

### 1. Interactive Map Engine
- MapLibre GL JS via `svelte-maplibre-gl` (Svelte 5 native, declarative components)
- Multiple basemap providers (OSM raster, vector styles, satellite, custom tile sources)
- Smooth pan/zoom/rotate/pitch with millions of features via vector tiles
- Drawing tools: point, line, polygon, circle, rectangle, freehand (Terra Draw integration or custom)
- Annotation layer: text labels, arrows, markers with custom icons
- Configurable popups and tooltips on feature hover/click
- Keyboard shortcuts for all map tools

### 2. Data Management & Pipelines
- **Import**: Drag-and-drop upload for GeoJSON, Shapefile (.shp/.zip), KML/KMZ, GPX, CSV (with lat/lng or address columns), GeoPackage, GeoTIFF (raster)
- **Geocoding pipeline**: CSV addresses → geocoded points (pluggable: Nominatim default, optional Mapbox/Google)
- **Tiling engine**: Auto-generate vector tiles from uploaded data via Martin (live) and Tippecanoe (optimized static tiles). Background job with progress reporting via BullMQ
- **Data table view**: Spreadsheet-style attribute view, inline editing, sorting, filtering, column toggles, click-to-zoom
- **Export**: GeoJSON, GeoPackage, GeoTIFF, Shapefile, CSV, high-res PNG/PDF map image exports

### 3. Spatial Analysis Tools
- **Geoprocessing**: Buffer, clip, intersect, union, dissolve, difference, convex hull, centroid
- **Spatial joins**: Point-in-polygon, nearest neighbor, attribute join by location
- **Filtering**: Attribute filters (numeric range, text, category) + spatial filters (within boundary, within radius)
- **Aggregation**: Aggregate point data into polygons (count, sum, avg, min, max)
- **Boundary/demographic analysis**: Census or admin boundary datasets; choropleth maps by aggregated metrics
- **Measurement tools**: Distance, area, perimeter with unit conversion

### 4. Styling & Visualization
- Auto-detect data type → sensible default symbology (points get circles, polygons get fills)
- Auto-detect categorical attributes → distinct color palette
- Auto-detect numeric attributes → graduated color ramp
- Manual override: fill color, stroke, opacity, size, icon, label placement
- Data-driven styling: property values drive visual properties
- Auto-generated interactive legend
- Layer ordering, grouping, visibility toggles
- Cluster rendering for dense point data

### 5. Real-Time Collaboration (Phase 3)
- Yjs CRDT over WebSocket for conflict-free multi-user editing
- Multiplayer cursors showing who's viewing/editing what
- Presence indicators (who's online, what they're looking at)
- Comment threads anchored to map locations or features
- Guest commenting: share a link, guests comment without an account
- Activity feed / change log per map

### 6. Sharing & Permissions
- Granular permissions: Owner, Editor, Viewer, Commenter — per map and per team
- Share via link: public, unlisted (anyone with link), private (invited only)
- Embeddable maps: iframe embed code with configurable controls
- Team Library: shared dataset repository — upload once, reuse across maps
- Map templates: save and clone map configurations

### 7. User & Team Management
- **Auth**: Email/password + OAuth2 (Google, GitHub, OIDC/SAML for SSO)
- **Teams & Organizations**: create teams, invite members, assign roles (Admin, Member)
- **Content transfer**: reassign maps/data when a member leaves
- **Default permissions**: org-level defaults for new maps
- **Audit log**: who did what, when

### 8. Security & Compliance
- HTTPS everywhere, CSRF protection, rate limiting (via SvelteKit hooks)
- Row-level security on all spatial data queries
- API key management for programmatic access
- Data encryption at rest (DB-level) and in transit
- GDPR-friendly: data export, deletion endpoints, cookie consent
- SOC 2-aligned logging and access controls

---

## MVP Scope (Phase 1)

The MVP proves three things: the map experience is fast and beautiful by default, data flows in and out easily, and sharing works. Everything else is Phase 2+.

### MVP Includes

**Map viewer & interaction**: MapLibre GL JS canvas, OSM basemap, pan/zoom/rotate, layer panel with toggle/reorder, popup on feature click.

**Data import**: Drag-and-drop GeoJSON and CSV (with lat/lng). Auto-detection of coordinate columns. Stored in PostGIS, not just browser memory. Background processing with progress for large files.

**Auto-styling ("great defaults")**: Detect geometry type → apply sensible style. Detect categorical attribute → distinct colors. Detect numeric attribute → graduated ramp. Auto-generated legend.

**Data table**: Spreadsheet view of attributes alongside map. Click row → zoom to feature. Click feature → highlight row. Column sort + text filter.

**Drawing tools**: Point, line, polygon creation. Edit vertices, delete features. Saves to same PostGIS-backed layer.

**Sharing**: Generate shareable link (public/unlisted). View-only mode for shared links.

**Auth (minimal)**: Email/password signup/login. Session-based. One user = one workspace.

**Export**: Download any layer as GeoJSON. Screenshot map as PNG.

### MVP Explicitly Excludes

No real-time collaboration, no tiling pipeline (small datasets render fine as raw GeoJSON), no geocoding, no spatial analysis, no teams/permissions, no SSO, no embed, no raster.

### Why This Scope

This is "geojson.io that persists your data and lets you share it" — the exact gap Tom MacWright identified. The difference: PostGIS as the backbone means every future feature (spatial joins, tiling, boundary analysis) is a natural extension, not a rewrite.

---

## Implementation Phases

**Phase 1 — Foundation (MVP)**: Auth, map viewer, data upload (GeoJSON/CSV), auto-styling, data table, drawing, share via link, Docker Compose deployment. Seed script with demo data. 5-minute setup experience.

**Phase 2 — Power Features**: Martin tile server integration, Tippecanoe pipeline, geocoding, Shapefile/KML/GPX import, attribute filtering, image/PDF export, map templates.

**Phase 3 — Collaboration**: Yjs CRDT real-time editing, comments, presence indicators, team library, granular permissions, guest commenting.

**Phase 4 — Analysis**: PostGIS geoprocessing tools (buffer, clip, intersect, join), aggregation, boundary/demographic analysis, measurement tools, deck.gl integration for advanced viz.

**Phase 5 — Enterprise Polish**: SSO/SAML, audit logs, embeddable maps, Helm chart, plugin system, API keys, raster support, regional hosting documentation.

---

## Non-Functional Requirements

- **Performance**: Render 500K+ features smoothly via vector tiles. Sub-200ms API responses. Tile cache hits < 50ms.
- **Reliability**: Health checks on all services. Auto-restart policies. DB connection retry. Graceful shutdown.
- **Observability**: Structured JSON logging (pino). OpenTelemetry traces (optional). Prometheus-compatible `/metrics` endpoint.
- **Developer Experience**: Hot reload via Vite. Seed scripts for demo data. CLI for admin tasks. Comprehensive README with architecture diagrams. `docker compose up` works on first try.
- **Accessibility**: WCAG 2.1 AA for all non-map UI. Keyboard navigation for map controls where feasible.

---

## Deployment Targets

1. **Minimal (single server)**: `docker compose up` — runs SvelteKit app, PostgreSQL+PostGIS, Redis, Martin tile server on one machine. Good for teams < 20.
2. **Production**: Separate containers for DB, Redis, tile server, SvelteKit app, worker. S3/MinIO for file storage. Behind Caddy/Traefik with auto-TLS.
3. **Regional hosting**: Documentation for deploying in specific cloud regions (EU, US, APAC) for data residency compliance.
