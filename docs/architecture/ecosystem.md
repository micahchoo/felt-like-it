# Ecosystem

## Monorepo Package Graph

```
root (felt-like-it)
├── apps/web          (@felt-like-it/web)
│   ├── @felt-like-it/shared-types   workspace:*
│   ├── @felt-like-it/geo-engine     workspace:*
│   └── @felt-like-it/import-engine  workspace:*   ← NEW
├── services/worker   (@felt-like-it/worker)
│   ├── @felt-like-it/shared-types   workspace:*
│   ├── @felt-like-it/geo-engine     workspace:*
│   └── @felt-like-it/import-engine  workspace:*   ← NEW
└── packages/
    ├── shared-types
    ├── geo-engine
    └── import-engine  (@felt-like-it/import-engine)  ← NEW
        ├── @felt-like-it/shared-types   workspace:*
        └── @felt-like-it/geo-engine     workspace:*
```

**import-engine** extracts format parsers (CSV, GeoJSON, Shapefile, GeoPackage, KML, GPX) and sanitization into a shared package consumed by both web and worker. This is an in-progress extraction — web and worker still retain direct dependencies on the same parsing libraries (`papaparse`, `shpjs`, `sql.js`, `@tmcw/togeojson`, `@xmldom/xmldom`). Once migration completes, those direct deps should be removed from consumers.

## Dependency Map

### Framework / App Shell
| Package | Version | Purpose |
|---------|---------|---------|
| svelte | ^5.17.3 | UI framework (Svelte 5 with runes) |
| @sveltejs/kit | ^2.15.1 | Full-stack web framework |
| @sveltejs/adapter-node | ^5.2.9 | Node.js SSR deployment |
| vite | ^6.0.0 | Dev server and bundler |
| turbo | ^2.3.3 | Monorepo build orchestration |
| typescript | ^5.7.3 | Type system (all packages) |

### Database / ORM
| Package | Version | Purpose |
|---------|---------|---------|
| pg | ^8.13.x | PostgreSQL client |
| drizzle-orm | ^0.38.3 | ORM with typed queries |
| @lucia-auth/adapter-drizzle | ^1.1.0 | Session storage adapter |

### Auth
| Package | Version | Purpose |
|---------|---------|---------|
| lucia | ^3.2.2 | Session-based auth framework |
| @node-rs/argon2 | ^2.0.0 | Argon2 password hashing (native Rust) |

### Geo / Spatial
| Package | Version | Purpose |
|---------|---------|---------|
| maplibre-gl | ^5.0.0 | WebGL map renderer |
| svelte-maplibre-gl | ^1.0.3 | Svelte bindings for MapLibre |
| deck.gl | ^9.2.9 | GPU-accelerated geospatial layers |
| @turf/turf | ^7.1.0 | Geospatial computation |
| terra-draw | ^1.0.7 | Map drawing/editing tools |
| wkx | ^0.5.0 | WKT/WKB geometry parsing |

### Data Import/Export
| Package | Version | Where | Purpose |
|---------|---------|-------|---------|
| shpjs | ^6.1.0 / ^6.2.0 | import-engine / web+worker | Shapefile parsing (version drift — see note) |
| @mapbox/shp-write | ^0.4.3 | web | Shapefile export |
| @tmcw/togeojson | ^7.1.2 | web, worker | KML/GPX → GeoJSON (legacy — being replaced by import-engine) |
| fast-xml-parser | ^4.5.0 | import-engine | **NEW** — streaming XML parser for KML/GPX (replaces @xmldom/xmldom in import-engine) |
| papaparse | ^5.4.1 | import-engine, web, worker | CSV parsing |
| sql.js | ^1.12.0 / ^1.14.0 | import-engine / web+worker | SQLite in WASM (GeoPackage) (version drift — see note) |
| exifr | ^7.1.3 | web | EXIF metadata extraction |

> **Version drift note:** import-engine pins older ranges for `shpjs` (^6.1.0) and `sql.js` (^1.12.0) vs web/worker (^6.2.0, ^1.14.0). These should be aligned to avoid duplicate installs and inconsistent behavior.

### Job Queue
| Package | Version | Purpose |
|---------|---------|---------|
| bullmq | ^5.34.6 | Redis-backed job queue |
| ioredis | ^5.4.2 | Redis client |

### API / Data Layer
| Package | Version | Purpose |
|---------|---------|---------|
| @trpc/client + server | ^11.0.0 | Type-safe RPC |
| @tanstack/svelte-query | ^6.1.0 | Async state management |
| superjson | ^2.2.6 | tRPC serialization (Date handling) |

### UI
| Package | Version | Purpose |
|---------|---------|---------|
| tailwindcss | ^4.0.6 | Utility CSS (v4, Vite plugin) |
| lucide-svelte | ^0.469.0 | Icon set |
| pdfkit | ^0.17.2 | Server-side PDF generation |
| html-to-image | ^1.11.13 | DOM-to-image export |

### Validation
| Package | Version | Purpose |
|---------|---------|---------|
| zod | ^3.24.1 | Schema validation (shared across all packages) |

### Logging
| Package | Version | Purpose |
|---------|---------|---------|
| pino | ^10.3.1 | Structured logging |

### Testing
| Package | Version | Purpose |
|---------|---------|---------|
| vitest | ^2.1.8 | Unit/integration tests |
| @playwright/test | ^1.49.1 | E2E tests |
| @testing-library/svelte | ^5.2.7 | Component tests |

### Build / DX
| Package | Version | Purpose |
|---------|---------|---------|
| knip | ^5.41.0 | Dead code detection |
| prettier | ^3.4.2 | Formatting |
| eslint | ^9.18.0 | Linting (flat config) |

## External Integrations

- **PostgreSQL + PostGIS** — primary data store with spatial extensions
- **Redis** — BullMQ job queue backend
- **Martin** — vector tile server (MapLibre MVT protocol)
- **Nominatim** — geocoding for CSV imports (defaults to OSM public instance)
- **Research-Narratives** — sister project consuming FLI as spatial data backend via REST API v1

## Platform Constraints

- Node.js >= 20.0.0
- pnpm 9.15.4 (exact, enforced via `packageManager`)
- ESM-only (`"type": "module"` in all packages)
- Server-side rendering via `@sveltejs/adapter-node` (not static/edge)
- WASM support required (sql.js for GeoPackage)

## Security Surface

| Concern | Library | Where | Risk Notes |
|---------|---------|-------|-----------|
| Password hashing | @node-rs/argon2 | root, web, worker | Native Rust binding. Also in worker (audit: needed?) |
| Session management | lucia | web | Sessions stored in PostgreSQL via Drizzle adapter |
| Input validation | zod | web, worker | Shared schemas across web + worker |
| XML parsing (legacy) | @xmldom/xmldom | web, worker | Parses untrusted KML/GPX — XXE risk if external entities not disabled |
| XML parsing (new) | fast-xml-parser | import-engine | **NEW** — parses untrusted KML/GPX. Default config disables entity expansion but verify `processEntities: false` and `allowBooleanAttributes` settings. Different attack surface than @xmldom/xmldom |
| EXIF extraction | exifr | web | Parses untrusted images — metadata injection surface |
| SQLite (WASM) | sql.js | import-engine, web, worker | GeoPackage parsing — verify parameterized queries |
| File format parsing | shpjs, papaparse | import-engine, web, worker | User-uploaded files parsed in-process |
| tRPC procedures | @trpc/server | web | All procedures need auth middleware audit |

### Import-Engine Security Notes

The import-engine extraction creates a **single audit point** for all format parsing — a security improvement over the previous pattern where web and worker each had independent parsing code. However, during the transition period:

1. **Dual XML parsers** — `@xmldom/xmldom` (web/worker direct) and `fast-xml-parser` (import-engine) coexist. Both parse untrusted user input. Both need hardening audit.
2. **fast-xml-parser defaults** — by default does not process external entities, which is safer than @xmldom/xmldom. Verify `processEntities` is not enabled in KML/GPX parser config.
3. **Duplicate parsing paths** — until legacy direct deps are removed from web/worker, there are two code paths that can parse the same format, doubling the attack surface.

## Sister Projects

- **Research-Narratives** — network-level integration via REST API v1 (no workspace dependency)

**See also:** [domain](domain.md) | [infrastructure](infrastructure.md)
