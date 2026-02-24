/**
 * Seeds the database with demo data.
 *
 * Creates:
 *   - Demo user:  demo@felt-like-it.local / demo
 *   - Map:        "San Francisco Parks"
 *   - Layer:      "Parks" (polygon, green fill auto-style)
 *   - Features:   5 SF park polygons
 *
 * Usage: pnpm seed
 *   or:  DATABASE_URL=postgresql://... tsx scripts/seed.ts
 *
 * Safe to re-run — exits early if demo user already exists.
 */

import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { hash } from '@node-rs/argon2';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://felt:felt@localhost:5432/felt';

// ── Approximate GeoJSON polygons for five SF parks ─────────────────────────
const SF_PARKS: GeoJSONFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        name: 'Golden Gate Park',
        area_acres: 1017,
        established: 1870,
        category: 'Regional Park',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-122.5117, 37.7694],
            [-122.4534, 37.7694],
            [-122.4534, 37.7715],
            [-122.5117, 37.7715],
            [-122.5117, 37.7694],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: {
        name: 'Mission Dolores Park',
        area_acres: 16,
        established: 1905,
        category: 'Neighborhood Park',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-122.4278, 37.7601],
            [-122.4244, 37.7601],
            [-122.4244, 37.7636],
            [-122.4278, 37.7636],
            [-122.4278, 37.7601],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: {
        name: 'Alamo Square',
        area_acres: 12.7,
        established: 1892,
        category: 'Neighborhood Park',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-122.4349, 37.7759],
            [-122.4321, 37.7759],
            [-122.4321, 37.7779],
            [-122.4349, 37.7779],
            [-122.4349, 37.7759],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: {
        name: 'Buena Vista Park',
        area_acres: 36,
        established: 1894,
        category: 'Neighborhood Park',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-122.4435, 37.7692],
            [-122.4408, 37.7692],
            [-122.4408, 37.7714],
            [-122.4435, 37.7714],
            [-122.4435, 37.7692],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: {
        name: 'Crissy Field',
        area_acres: 100,
        established: 2001,
        category: 'Regional Park',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-122.471, 37.802],
            [-122.45, 37.802],
            [-122.45, 37.8055],
            [-122.471, 37.8055],
            [-122.471, 37.802],
          ],
        ],
      },
    },
  ],
};

// ── Auto-style for polygon layers (green fill) ──────────────────────────────
const PARKS_STYLE = {
  type: 'simple',
  paint: {
    'fill-color': '#22c55e',
    'fill-opacity': 0.5,
    'fill-outline-color': '#15803d',
  },
  layout: {},
  legend: [{ label: 'Park', color: '#22c55e' }],
};

// ── Minimal GeoJSON types for this script ──────────────────────────────────
interface GeoJSONFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
}
interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

async function seed(): Promise<void> {
  const client = new pg.Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    console.log('Connected to database.');

    // ── Idempotency check ─────────────────────────────────────────────────
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      ['demo@felt-like-it.local']
    );
    if ((existing.rowCount ?? 0) > 0) {
      console.log('Demo user already exists — seed already applied. Skipping.');
      return;
    }

    // ── Create demo user ──────────────────────────────────────────────────
    const hashedPassword = await hash('demo', {
      memoryCost: 19456,
      timeCost: 2,
      outputLen: 32,
      parallelism: 1,
    });
    const userId = randomUUID();

    await client.query(
      'INSERT INTO users (id, email, hashed_password, name, is_admin) VALUES ($1, $2, $3, $4, $5)',
      [userId, 'demo@felt-like-it.local', hashedPassword, 'Demo User', true]
    );
    console.log('✓ Demo user created: demo@felt-like-it.local / demo');

    // ── Create map ────────────────────────────────────────────────────────
    const mapId = randomUUID();
    const viewport = JSON.stringify({
      center: [-122.449, 37.7749],
      zoom: 12,
      bearing: 0,
      pitch: 0,
    });

    await client.query(
      `INSERT INTO maps (id, user_id, title, description, viewport, basemap)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        mapId,
        userId,
        'San Francisco Parks',
        'A map of parks in San Francisco, CA.',
        viewport,
        'osm',
      ]
    );
    console.log('✓ Map created: "San Francisco Parks"');

    // ── Create layer ──────────────────────────────────────────────────────
    const layerId = randomUUID();
    await client.query(
      `INSERT INTO layers (id, map_id, name, type, style, z_index)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [layerId, mapId, 'Parks', 'polygon', JSON.stringify(PARKS_STYLE), 0]
    );
    console.log('✓ Layer created: "Parks"');

    // ── Insert features ───────────────────────────────────────────────────
    let featureCount = 0;
    for (const feature of SF_PARKS.features) {
      const featureId = randomUUID();
      await client.query(
        `INSERT INTO features (id, layer_id, geometry, properties)
         VALUES ($1, $2, ST_GeomFromGeoJSON($3), $4::jsonb)`,
        [
          featureId,
          layerId,
          JSON.stringify(feature.geometry),
          JSON.stringify(feature.properties),
        ]
      );
      featureCount++;
    }
    console.log(`✓ Inserted ${featureCount} park features`);

    // ── Create template maps ──────────────────────────────────────────────
    // Templates are config-only starters (no features). They are visible to
    // all users via maps.listTemplates and cloned via maps.createFromTemplate.
    const TEMPLATES = [
      {
        title: 'World Overview',
        description: 'A blank world map starting at a global zoom level.',
        viewport: { center: [0, 20] as [number, number], zoom: 2, bearing: 0, pitch: 0 },
        basemap: 'osm',
      },
      {
        title: 'North America',
        description: 'A blank map centered on North America.',
        viewport: { center: [-98, 40] as [number, number], zoom: 3, bearing: 0, pitch: 0 },
        basemap: 'osm',
      },
      {
        title: 'Europe',
        description: 'A blank map centered on Europe.',
        viewport: { center: [15, 52] as [number, number], zoom: 4, bearing: 0, pitch: 0 },
        basemap: 'osm',
      },
    ];

    for (const tpl of TEMPLATES) {
      const tplId = randomUUID();
      await client.query(
        `INSERT INTO maps (id, user_id, title, description, viewport, basemap, is_template)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, true)`,
        [tplId, userId, tpl.title, tpl.description, JSON.stringify(tpl.viewport), tpl.basemap]
      );
      console.log(`✓ Template created: "${tpl.title}"`);
    }

    console.log('');
    console.log('Seed complete!');
    console.log('');
    console.log('  URL:      http://localhost:3000');
    console.log('  Email:    demo@felt-like-it.local');
    console.log('  Password: demo');
    console.log('');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

await seed();
