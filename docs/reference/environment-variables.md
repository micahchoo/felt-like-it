# Environment Variables

Canonical reference for all configuration options, grouped by service.

## Web Application

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DATABASE_URL` | `postgresql://felt:felt@postgres:5432/felt` | Yes | PostgreSQL connection string |
| `REDIS_URL` | `redis://redis:6379` | Yes | Redis connection string. Include password if set: `redis://:password@redis:6379` |
| `SESSION_SECRET` | — | Yes | Session encryption key. Generate: `openssl rand -hex 32` |
| `ORIGIN` | `http://localhost:3000` | Yes | Public URL of the app. Must match the URL users see in their browser. Required for CSRF protection. |
| `PUBLIC_MARTIN_URL` | `http://localhost:3001` | No | Browser-facing URL for the Martin vector tile server. Set to `""` to disable vector tiles (falls back to GeoJSON rendering). |
| `NOMINATIM_URL` | _(uses OSM Nominatim)_ | No | Self-hosted Nominatim URL for CSV address geocoding. OSM Nominatim has a 1 req/s limit and prohibits bulk use. |
| `GEOCODING_USER_AGENT` | — | If `NOMINATIM_URL` set | Required alongside `NOMINATIM_URL`. Identifies your instance to the geocoding service. |
| `UPLOAD_DIR` | `/uploads` | No | Directory for uploaded files (images, imports). Must be a volume in Docker. |
| `LOG_LEVEL` | `info` | No | Logging verbosity: `debug`, `info`, `warn`, `error`. |
| `NODE_ENV` | `production` | No | Node.js environment. Set to `production` in Docker, `development` locally. |

## Worker

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DATABASE_URL` | _(same as web)_ | Yes | Must match the web app's database connection. |
| `REDIS_URL` | _(same as web)_ | Yes | Must match the web app's Redis connection. |
| `UPLOAD_DIR` | `/uploads` | No | Must match the web app's upload directory (shared volume). |
| `LOG_LEVEL` | `info` | No | Same as web app. |

## PostgreSQL

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `POSTGRES_USER` | `felt` | No | Database superuser name. |
| `POSTGRES_PASSWORD` | `felt` | Yes (production) | Database password. Generate: `openssl rand -hex 32`. Update `DATABASE_URL` to match. |
| `POSTGRES_DB` | `felt` | No | Database name. |

## Redis

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `REDIS_PASSWORD` | — | Yes (production) | Redis authentication password. Generate: `openssl rand -hex 32`. Update `REDIS_URL` to include it. |

## Traefik / Production

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DOMAIN` | — | Yes (production) | Your server's domain (e.g. `maps.example.com`). Used for Traefik routing and TLS certificate. |
| `ACME_EMAIL` | — | Yes (production) | Email for Let's Encrypt certificate registration. |
