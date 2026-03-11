# Felt Like It

Self-hostable collaborative GIS platform. Create maps, import spatial data, style layers, annotate, and collaborate — all from Docker Compose.

## Features

- **Maps** — create, clone from templates, save viewports, switch basemaps (OSM / satellite)
- **Import** — GeoJSON, CSV (lat/lng or address geocoding), Shapefile, KML, GPX, GeoPackage
- **Draw** — points, lines, polygons with undo/redo
- **Style** — simple color, categorical, choropleth, heatmap
- **Analyze** — buffer, clip, intersect, union, dissolve, convex hull, centroid, point-in-polygon, nearest neighbor, aggregate
- **Annotate** — pin, region, or map-level annotations with text, emoji, GIF, image, link, or IIIF content
- **Collaborate** — viewer/commenter/editor roles, comment threads, guest links, activity feed
- **Export** — GeoJSON, Shapefile, GeoPackage, PDF, PNG screenshot
- **Measure** — distance, area, perimeter with unit switching
- **Share** — public links, iframe embeds, API keys

## Quickstart

**Development** (requires Docker, Node 20+, pnpm):

```bash
git clone <repo-url> felt-like-it && cd felt-like-it
pnpm install
pnpm dev:up
```

Open http://localhost:5173. Sign in: `demo@felt-like-it.local` / `demo`.

**Production** (requires Docker):

```bash
git clone <repo-url> felt-like-it && cd felt-like-it
./setup.sh
```

See [Self-Hosting Guide](docs/getting-started/self-hosting.md) for reverse proxy, TLS, and backup configuration.

## Documentation

| Section | Audience | Description |
|---------|----------|-------------|
| [Development Setup](docs/getting-started/development.md) | Contributors | One-command onboarding, project structure, tests |
| [Self-Hosting](docs/getting-started/self-hosting.md) | Deployers | Production Docker, reverse proxy, backups |
| [Maps & Layers](docs/guides/maps-and-layers.md) | Users | Create, import, draw, geoprocess, export |
| [Styling](docs/guides/styling.md) | Users | Color, categorical, choropleth, heatmap |
| [Annotations](docs/guides/annotations.md) | Users | Pins, regions, content types, threads |
| [Collaboration](docs/guides/collaboration.md) | Users | Roles, comments, sharing, activity |
| [API Reference](docs/reference/api.md) | Developers | tRPC procedures, auth levels |
| [Database Schema](docs/reference/database-schema.md) | Developers | Tables, relationships, migrations |
| [Environment Variables](docs/reference/environment-variables.md) | Deployers | All config options by service |
| [Architecture](docs/ARCHITECTURE.md) | Developers | System design, request flow, module boundaries |
| [Roadmap](docs/ROADMAP.md) | Everyone | Feature status by phase |
| [ADRs](docs/adr/) | Developers | Key architecture decisions |
