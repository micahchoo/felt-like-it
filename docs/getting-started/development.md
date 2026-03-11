# Development Setup

Get a local development environment running with one command.

## Prerequisites

- **Docker** and **Docker Compose** (for PostgreSQL + Redis)
- **Node.js 20+**
- **pnpm 9+** (`corepack enable && corepack prepare pnpm@latest --activate`)

## Quick Start

```bash
pnpm install
pnpm dev:up
```

This single command:
1. Starts PostgreSQL (PostGIS) and Redis via Docker Compose
2. Waits for Postgres to be healthy
3. Applies all pending database migrations
4. Starts the SvelteKit dev server on http://localhost:5173

Sign in with: `demo@felt-like-it.local` / `demo` (created by the seed script — run `pnpm seed` if the account doesn't exist).

## Background Worker

The import pipeline and job queue require the BullMQ worker. In a separate terminal:

```bash
pnpm --filter @felt-like-it/worker dev
```

## Project Structure

```
felt-like-it/
├── apps/
│   ├── web/                    # SvelteKit app (UI + tRPC API)
│   │   ├── src/
│   │   │   ├── routes/         # SvelteKit pages and API endpoints
│   │   │   ├── lib/
│   │   │   │   ├── components/ # Svelte 5 components
│   │   │   │   ├── server/     # Server-only: tRPC routers, services, DB
│   │   │   │   ├── stores/     # Svelte 5 rune stores (.svelte.ts)
│   │   │   │   └── utils/      # Client utilities
│   │   │   └── __tests__/      # Vitest tests
│   │   └── drizzle.config.ts   # Drizzle ORM config
│   └── worker/                 # BullMQ background job worker
├── packages/
│   ├── shared-types/           # Zod schemas, TypeScript types
│   └── geo-engine/             # Spatial utilities (transforms, filters, measurement)
├── docker/                     # Docker Compose files, Dockerfiles, migration runner
├── scripts/                    # CLI tools (migrate, seed, admin, dev-up)
└── docs/                       # Documentation
```

## Running Tests

```bash
pnpm test
```

Tests use Vitest with mocked Drizzle DB chains. All server-side tests require `@vitest-environment node` (for argon2 native bindings).

## Type-Check and Lint

```bash
pnpm check          # svelte-check across all packages
pnpm lint           # ESLint across all packages
```

Both should report 0 errors, 0 warnings.

## Database Migrations

Migrations are SQL files in `apps/web/src/lib/server/db/migrations/`. They are auto-discovered and applied in alphabetical order.

- **Local:** `pnpm migrate` (or automatically via `pnpm dev:up`)
- **Docker:** Auto-applied on container start via `docker/docker-entrypoint.sh`

To create a new migration, add a file named `NNNN_description.sql` (next number in sequence).

## Common Issues

| Problem | Solution |
|---------|----------|
| Port 5432 in use | Stop the existing Postgres: `docker stop felt-like-it-postgres-1` or change the port in `docker/docker-compose.yml` |
| Port 5173 in use | Another dev server is running. Stop it or use `--port 5174` |
| `ECONNREFUSED 127.0.0.1:5432` | Docker services aren't running. Run `pnpm dev:up` or start them manually: `docker compose -f docker/docker-compose.yml up -d postgres redis` |
| Migration errors | Check that Postgres is healthy: `docker compose -f docker/docker-compose.yml ps`. If a migration fails, fix the SQL and re-run `pnpm migrate`. |
| `demo@felt-like-it.local` doesn't work | Run `pnpm seed` to create the demo account |
