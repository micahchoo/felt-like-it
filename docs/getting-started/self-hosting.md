# Self-Hosting Guide

Deploy Felt Like It on your own server with Docker Compose.

## Prerequisites

- A Linux server with Docker and Docker Compose v2
- A domain name with DNS pointing to your server (for HTTPS)
- Ports 80 and 443 open

## Quick Setup

The interactive setup script generates secrets, creates your `.env` file, and starts all services:

```bash
git clone <repo-url> felt-like-it && cd felt-like-it
./setup.sh
```

It will ask for:
- **Domain** — your server's domain (e.g. `maps.example.com`), or `localhost` for local testing
- **ACME email** — for Let's Encrypt TLS certificates (production only)

The script generates secure random passwords for Postgres, Redis, and session secrets.

## Manual Setup

If you prefer to configure manually:

1. Copy the environment template:

   ```bash
   cp docker/.env.example docker/.env
   ```

2. Edit `docker/.env` — set at minimum:
   - `DOMAIN` — your server's domain
   - `ACME_EMAIL` — for Let's Encrypt
   - `POSTGRES_PASSWORD` — generate with `openssl rand -hex 32`
   - `SESSION_SECRET` — generate with `openssl rand -hex 32`
   - `REDIS_PASSWORD` — generate with `openssl rand -hex 32`
   - `ORIGIN` — full URL (e.g. `https://maps.example.com`)

   See [Environment Variables Reference](../reference/environment-variables.md) for the full list.

3. Start all services:

   ```bash
   cd docker
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   ```

## What Gets Started

| Service | Purpose | Port |
|---------|---------|------|
| **postgres** | PostGIS 16 database | 5432 (internal only) |
| **redis** | Job queue (BullMQ) | 6379 (internal only) |
| **web** | SvelteKit application | via Traefik |
| **worker** | Background job processor (2 replicas) | none |
| **martin** | Vector tile server | via Traefik at `/tiles` |
| **traefik** | Reverse proxy + TLS | 80, 443 |

Database migrations run automatically on container start. No manual migration step needed.

## Reverse Proxy

### Traefik (included)

The production compose file includes Traefik with automatic Let's Encrypt TLS. No additional configuration needed — just set `DOMAIN` and `ACME_EMAIL` in your `.env`.

### Nginx (alternative)

If you prefer nginx, use the base compose file only (no Traefik) and expose port 3000:

```bash
docker compose up -d --build
```

Example nginx config:

```nginx
server {
    listen 443 ssl;
    server_name maps.example.com;

    ssl_certificate     /etc/letsencrypt/live/maps.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/maps.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /tiles/ {
        proxy_pass http://127.0.0.1:3001/;
        proxy_set_header Host $host;
    }
}
```

### Caddy (alternative)

```
maps.example.com {
    reverse_proxy localhost:3000
    handle_path /tiles/* {
        reverse_proxy localhost:3001
    }
}
```

## Admin Panel

Access the admin panel at `/admin` (requires an admin user). Features:
- **Users** — view all registered users
- **Import Jobs** — monitor background import status and errors
- **Audit Log** — tamper-evident log of all map/share/collaborator actions with chain verification
- **Storage** — upload directory size and file count

To make a user admin: `pnpm admin promote <email>`

## Backups

### Database

```bash
# Backup
docker compose -f docker/docker-compose.yml exec -T postgres \
  pg_dump -U felt felt | gzip > backup-$(date +%Y%m%d).sql.gz

# Restore
gunzip -c backup-20260311.sql.gz | \
  docker compose -f docker/docker-compose.yml exec -T postgres \
  psql -U felt felt
```

### Uploads

Uploaded files are stored in the `uploads` Docker volume. Back it up with:

```bash
docker run --rm -v felt-like-it_uploads:/data -v $(pwd):/backup \
  alpine tar czf /backup/uploads-$(date +%Y%m%d).tar.gz -C /data .
```

## Updating

```bash
cd felt-like-it
git pull
cd docker
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Migrations run automatically on container start. No manual migration step needed.

## Localhost Mode

For local testing without a domain, `setup.sh` detects `localhost` and skips Traefik:

```bash
./setup.sh    # enter "localhost" when prompted
```

This starts services with port 3000 exposed directly. Access at http://localhost:3000.
