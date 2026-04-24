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

import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { hash } from '@node-rs/argon2';
import {
  FIXTURE_USERS,
  FIXTURE_MAPS,
  FIXTURE_LAYERS,
  FIXTURE_SHARE_TOKEN_BOB,
  FIXTURE_API_KEY_ALICE_PLAINTEXT,
  FIXTURE_API_KEY_ALICE_PREFIX,
  FIXTURE_API_KEY_BOB_PLAINTEXT,
  FIXTURE_API_KEY_BOB_PREFIX,
} from '../apps/web/src/lib/server/db/fixtures.js';

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
    const demoAlreadySeeded = (existing.rowCount ?? 0) > 0;
    if (demoAlreadySeeded) {
      console.log('Demo user already exists — skipping demo + template seed.');
    }
    if (!demoAlreadySeeded) {
      await seedDemo(client);
    }

    // Adversarial fixtures are gated separately; see seedAdversarialFixtures.
    await seedAdversarialFixtures(client);

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

async function seedDemo(client: pg.Client): Promise<void> {
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

}

/**
 * Two-tenant fixture for adversarial API testing.
 * Seeds alice + bob with one map / one layer / three features each, plus
 * a share token on bobMap and a read-scoped API key for alice.
 *
 * Idempotent per-tenant — re-running is safe.
 */
async function seedAdversarialFixtures(client: pg.Client): Promise<void> {
  // Security gate: fixture credentials are committed to the repo. Refuse to
  // create them in production unless explicitly opted in.
  const isProd = process.env['NODE_ENV'] === 'production';
  const optIn = process.env['SEED_FIXTURES'] === '1';
  if (isProd && !optIn) {
    console.log('Skipping adversarial fixtures: NODE_ENV=production and SEED_FIXTURES≠1.');
    return;
  }
  if (!isProd && !optIn && process.env['SEED_FIXTURES'] !== undefined) {
    // SEED_FIXTURES explicitly set to something other than "1" → opt out.
    console.log('Skipping adversarial fixtures: SEED_FIXTURES opt-out.');
    return;
  }

  const aliceExisting = await client.query<{ id: string }>(
    'SELECT id FROM users WHERE id = $1',
    [FIXTURE_USERS.alice.id]
  );
  if ((aliceExisting.rowCount ?? 0) > 0) {
    console.log('Adversarial fixtures already present — skipping.');
    return;
  }

  const argonOpts = { memoryCost: 19456, timeCost: 2, outputLen: 32, parallelism: 1 } as const;

  for (const u of [FIXTURE_USERS.alice, FIXTURE_USERS.bob]) {
    const pw = await hash(u.password, argonOpts);
    await client.query(
      'INSERT INTO users (id, email, hashed_password, name, is_admin) VALUES ($1, $2, $3, $4, false)',
      [u.id, u.email, pw, u.name]
    );
  }
  console.log('✓ Fixture users: alice, bob');

  const viewport = JSON.stringify({ center: [0, 0], zoom: 2, bearing: 0, pitch: 0 });
  const minimalStyle = {
    paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.4 },
    layout: {},
    legend: [{ label: 'Test', color: '#3b82f6' }],
  };

  const tenants = [
    { userId: FIXTURE_USERS.alice.id, mapId: FIXTURE_MAPS.aliceMap, layerId: FIXTURE_LAYERS.aliceLayer, title: "Alice's Map" },
    { userId: FIXTURE_USERS.bob.id,   mapId: FIXTURE_MAPS.bobMap,   layerId: FIXTURE_LAYERS.bobLayer,   title: "Bob's Map" },
  ];

  for (const t of tenants) {
    await client.query(
      `INSERT INTO maps (id, user_id, title, description, viewport, basemap)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'osm')`,
      [t.mapId, t.userId, t.title, 'Adversarial-testing fixture map.', viewport]
    );
    await client.query(
      `INSERT INTO layers (id, map_id, name, type, style, z_index)
       VALUES ($1, $2, $3, 'polygon', $4::jsonb, 0)`,
      [t.layerId, t.mapId, 'Fixture Layer', JSON.stringify(minimalStyle)]
    );
    // Three deterministic point features so probes can assert collection sizes.
    for (let i = 0; i < 3; i++) {
      const geom = JSON.stringify({ type: 'Point', coordinates: [i * 0.1, i * 0.1] });
      const props = JSON.stringify({ idx: i, tenant: t.title });
      await client.query(
        `INSERT INTO features (id, layer_id, geometry, properties)
         VALUES ($1, $2, ST_GeomFromGeoJSON($3), $4::jsonb)`,
        [randomUUID(), t.layerId, geom, props]
      );
    }
  }
  console.log('✓ Fixture maps, layers, features (alice, bob)');

  // Read-only share token on bobMap.
  await client.query(
    `INSERT INTO shares (map_id, token, access_level)
     VALUES ($1, $2, 'unlisted')`,
    [FIXTURE_MAPS.bobMap, FIXTURE_SHARE_TOKEN_BOB]
  );
  console.log('✓ Fixture share token on bobMap');

  // Write-scoped API keys for alice and bob. The /api/v1/* surface only
  // authenticates via Bearer flk_* (or ?token=<share>) — session cookies do
  // not count. Both users need write scope so probes can exercise mutations.
  const apiKeys: Array<[string, string, string, string]> = [
    [FIXTURE_USERS.alice.id, 'fixture-alice-write', FIXTURE_API_KEY_ALICE_PLAINTEXT, FIXTURE_API_KEY_ALICE_PREFIX],
    [FIXTURE_USERS.bob.id,   'fixture-bob-write',   FIXTURE_API_KEY_BOB_PLAINTEXT,   FIXTURE_API_KEY_BOB_PREFIX],
  ];
  for (const [userId, name, plaintext, prefix] of apiKeys) {
    const keyHash = createHash('sha256').update(plaintext).digest('hex');
    await client.query(
      `INSERT INTO api_keys (user_id, name, key_hash, scope, prefix)
       VALUES ($1, $2, $3, 'read-write', $4)`,
      [userId, name, keyHash, prefix]
    );
  }
  console.log('✓ Fixture API keys (alice, bob — scope=read-write)');
}

await seed();
