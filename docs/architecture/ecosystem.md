# Ecosystem

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
| Package | Version | Purpose |
|---------|---------|---------|
| shpjs | ^6.2.0 | Shapefile parsing |
| @mapbox/shp-write | ^0.4.3 | Shapefile export |
| @tmcw/togeojson | ^7.1.2 | KML/GPX → GeoJSON |
| papaparse | ^5.4.1 | CSV parsing |
| sql.js | ^1.14.0 | SQLite in WASM (GeoPackage) |
| exifr | ^7.1.3 | EXIF metadata extraction |

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

| Concern | Library | Risk Notes |
|---------|---------|-----------|
| Password hashing | @node-rs/argon2 | Native Rust binding. Also in worker (audit: needed?) |
| Session management | lucia | Sessions stored in PostgreSQL via Drizzle adapter |
| Input validation | zod | Shared schemas across web + worker |
| XML parsing | @xmldom/xmldom | Parses untrusted KML/GPX — XXE risk if external entities not disabled |
| EXIF extraction | exifr | Parses untrusted images — metadata injection surface |
| SQLite (WASM) | sql.js | GeoPackage parsing — verify parameterized queries |
| File format parsing | shpjs, papaparse | User-uploaded files parsed in-process |
| tRPC procedures | @trpc/server | All procedures need auth middleware audit |

## Sister Projects

- **Research-Narratives** — network-level integration via REST API v1 (no workspace dependency)

**See also:** [domain](domain.md) | [infrastructure](infrastructure.md)
