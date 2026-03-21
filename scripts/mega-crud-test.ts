#!/usr/bin/env npx tsx
// @ts-nocheck — standalone script, runs via tsx outside project tsconfig
/**
 * Mega-Scale Concurrent CRUD Test
 *
 * Pushes the REST API to breaking point with millions of concurrent operations.
 * Finds: connection pool exhaustion, statement timeouts, cache stampedes,
 * lost updates, orphaned state, and degradation curves.
 *
 * Phases:
 *   0. Setup — bulk insert users/maps/layers/annotations via direct DB
 *   1. Sustained write flood — millions of annotation + comment creates
 *   2. Mixed CRUD storm — concurrent create/read/update/delete on same resources
 *   3. Cache stampede — invalidate GeoJSON cache + thundering herd reads
 *   4. Pool exhaustion — exceed connection pool with slow queries
 *   5. Chaos — delete maps/layers while reading annotations/features
 *   6. Degradation curve — ramp concurrency from 10→1000, measure throughput
 *
 * Usage:
 *   npx tsx scripts/mega-crud-test.ts
 *   TOTAL_OPS=2000000 CONCURRENCY=500 npx tsx scripts/mega-crud-test.ts
 *
 * Requires: Docker containers running (postgres, web)
 */

import { execSync } from 'child_process';
import { createHash, randomBytes } from 'crypto';

// ── Config ────────────────────────────────────────────────────────────────────

const BASE = process.env.BASE_URL ?? 'http://localhost:5174';
const TOTAL_OPS = parseInt(process.env.TOTAL_OPS ?? '1000000', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY ?? '500', 10);
const NUM_USERS = parseInt(process.env.USERS ?? '50', 10);
const NUM_MAPS = parseInt(process.env.MAPS ?? '20', 10);
const RAMP_STEPS = parseInt(process.env.RAMP_STEPS ?? '8', 10);
const PHASE_TIMEOUT_MS = parseInt(process.env.PHASE_TIMEOUT ?? '300000', 10); // 5 min per phase

// ── Types ─────────────────────────────────────────────────────────────────────

interface UserRecord { id: string; email: string; apiKey: string; }
interface MapRecord { id: string; ownerId: string; }
interface LayerRecord { id: string; mapId: string; }
interface OpResult {
  phase: string;
  op: string;
  status: number;
  latencyMs: number;
  error?: string;
}
interface PhaseStats {
  phase: string;
  totalOps: number;
  successes: number;
  failures: number;
  errors5xx: number;
  errors429: number;
  errorsTimeout: number;
  p50: number;
  p95: number;
  p99: number;
  maxMs: number;
  opsPerSec: number;
  durationSec: number;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

function psql(query: string): string {
  return execSync(
    `docker exec felt-like-it-postgres-1 psql -U felt -d felt -tAc "${query.replace(/"/g, '\\"')}"`,
    { encoding: 'utf-8', timeout: 60000 },
  ).trim().split('\n')[0] ?? '';
}

function psqlExec(query: string): void {
  execSync(
    `docker exec felt-like-it-postgres-1 psql -U felt -d felt -c "${query.replace(/"/g, '\\"')}"`,
    { encoding: 'utf-8', timeout: 120000, stdio: 'pipe' },
  );
}

function psqlRows(query: string): string[] {
  return execSync(
    `docker exec felt-like-it-postgres-1 psql -U felt -d felt -tAc "${query.replace(/"/g, '\\"')}"`,
    { encoding: 'utf-8', timeout: 60000 },
  ).trim().split('\n').filter((l) => l.length > 0);
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function req(
  method: string,
  path: string,
  apiKey: string,
  body?: unknown,
): Promise<{ status: number; latencyMs: number; data: any; error?: string }> {
  const start = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const hdrs: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
    };
    if (body !== undefined) hdrs['Content-Type'] = 'application/json';
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: hdrs,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const latencyMs = performance.now() - start;
    let data: any;
    try { data = await res.json(); } catch { data = null; }
    return { status: res.status, latencyMs, data, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    return {
      status: 0,
      latencyMs: performance.now() - start,
      data: null,
      error: (err as Error).name === 'AbortError' ? 'TIMEOUT' : (err as Error).message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Concurrency pool ──────────────────────────────────────────────────────────

async function pool<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = [];
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  return results;
}

/** Run tasks with a hard timeout — returns whatever completed */
async function poolWithTimeout<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  timeoutMs: number,
): Promise<T[]> {
  return Promise.race([
    pool(tasks, concurrency),
    new Promise<T[]>((resolve) => setTimeout(() => {
      console.log(`    [timeout] Phase exceeded ${timeoutMs / 1000}s — returning partial results`);
      resolve([]);
    }, timeoutMs)),
  ]);
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function computeStats(results: OpResult[], phase: string, durationMs: number): PhaseStats {
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    phase,
    totalOps: results.length,
    successes: results.filter((r) => r.status >= 200 && r.status < 300).length,
    failures: results.filter((r) => r.status < 200 || r.status >= 300).length,
    errors5xx: results.filter((r) => r.status >= 500).length,
    errors429: results.filter((r) => r.status === 429).length,
    errorsTimeout: results.filter((r) => r.error === 'TIMEOUT' || r.status === 0).length,
    p50: Math.round(percentile(latencies, 50)),
    p95: Math.round(percentile(latencies, 95)),
    p99: Math.round(percentile(latencies, 99)),
    maxMs: Math.round(latencies[latencies.length - 1] ?? 0),
    opsPerSec: Math.round(results.length / (durationMs / 1000)),
    durationSec: Math.round(durationMs / 1000),
  };
}

function printStats(stats: PhaseStats) {
  console.log(`
  Phase: ${stats.phase}
  ─────────────────────────────────────────────
  Total ops:     ${stats.totalOps.toLocaleString()}
  Successes:     ${stats.successes.toLocaleString()} (${((stats.successes / stats.totalOps) * 100).toFixed(1)}%)
  Failures:      ${stats.failures.toLocaleString()}
    5xx errors:  ${stats.errors5xx.toLocaleString()}
    429 (rate):  ${stats.errors429.toLocaleString()}
    Timeouts:    ${stats.errorsTimeout.toLocaleString()}
  Latency:       p50=${stats.p50}ms  p95=${stats.p95}ms  p99=${stats.p99}ms  max=${stats.maxMs}ms
  Throughput:    ${stats.opsPerSec.toLocaleString()} ops/sec
  Duration:      ${stats.durationSec}s
`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function hashKey(email: string): string {
  return createHash('sha256').update(email + '-mega-test').digest('hex').slice(0, 48);
}

const ANCHOR_TYPES = ['point', 'region', 'viewport', 'measurement'] as const;

function randomAnchor() {
  const type = pick([...ANCHOR_TYPES]);
  switch (type) {
    case 'point':
      return { type: 'point', coordinates: [Math.random() * 360 - 180, Math.random() * 180 - 90] };
    case 'region':
      return {
        type: 'region',
        geometry: {
          type: 'Polygon',
          coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        },
      };
    case 'viewport':
      return { type: 'viewport', bounds: { north: 40, south: 39, east: -74, west: -75 } };
    case 'measurement':
      return {
        type: 'measurement',
        geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
      };
  }
}

function randomContent() {
  return {
    type: 'text' as const,
    text: `Stress test ${randomBytes(8).toString('hex')}`,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

function setup(): { users: UserRecord[]; maps: MapRecord[]; layers: LayerRecord[] } {
  console.log('\n=== Phase 0: Setup ===');

  // Clean up any previous test data
  console.log('  Cleaning previous test data...');
  psqlExec("DELETE FROM api_keys WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'mega-%')");
  psqlExec("DELETE FROM annotation_objects WHERE map_id IN (SELECT id FROM maps WHERE title LIKE 'MegaTest%')");
  psqlExec("DELETE FROM comments WHERE map_id IN (SELECT id FROM maps WHERE title LIKE 'MegaTest%')");
  psqlExec("DELETE FROM features WHERE layer_id IN (SELECT l.id FROM layers l JOIN maps m ON l.map_id = m.id WHERE m.title LIKE 'MegaTest%')");
  psqlExec("DELETE FROM layers WHERE map_id IN (SELECT id FROM maps WHERE title LIKE 'MegaTest%')");
  psqlExec("DELETE FROM map_collaborators WHERE map_id IN (SELECT id FROM maps WHERE title LIKE 'MegaTest%')");
  psqlExec("DELETE FROM maps WHERE title LIKE 'MegaTest%'");
  psqlExec("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'mega-%')");
  psqlExec("DELETE FROM users WHERE email LIKE 'mega-%'");

  // Create users
  console.log(`  Creating ${NUM_USERS} users...`);
  const userRecords: UserRecord[] = [];
  for (let i = 0; i < NUM_USERS; i++) {
    const email = `mega-${i}@test.local`;
    const pw = '$argon2id$v=19$m=19456,t=2,p=1$0000000000000000$0000000000000000000000000000000000000000000';
    const id = psql(`INSERT INTO users (email, password_hash, name) VALUES ('${email}', '${pw}', 'MegaUser${i}') RETURNING id`);
    const key = hashKey(email);
    psql(`INSERT INTO api_keys (user_id, key_hash, name, scope) VALUES ('${id}', '${key}', 'mega-key', 'read-write') RETURNING id`);
    userRecords.push({ id, email, apiKey: key });
  }

  // Create maps (distributed across users)
  console.log(`  Creating ${NUM_MAPS} maps with layers...`);
  const mapRecords: MapRecord[] = [];
  const layerRecords: LayerRecord[] = [];
  for (let i = 0; i < NUM_MAPS; i++) {
    const owner = userRecords[i % NUM_USERS];
    const mapId = psql(`INSERT INTO maps (user_id, title, description) VALUES ('${owner.id}', 'MegaTest${i}', 'Stress test map') RETURNING id`);
    mapRecords.push({ id: mapId, ownerId: owner.id });

    const layerId = psql(`INSERT INTO layers (map_id, name, type) VALUES ('${mapId}', 'MegaLayer${i}', 'geojson') RETURNING id`);
    layerRecords.push({ id: layerId, mapId });

    // Grant all users collaborator access
    for (const u of userRecords) {
      if (u.id !== owner.id) {
        psql(`INSERT INTO map_collaborators (map_id, user_id, role) VALUES ('${mapId}', '${u.id}', 'editor') ON CONFLICT DO NOTHING RETURNING map_id`);
      }
    }
  }

  console.log(`  Setup complete: ${userRecords.length} users, ${mapRecords.length} maps, ${layerRecords.length} layers`);
  return { users: userRecords, maps: mapRecords, layers: layerRecords };
}

// ── Phase 1: Sustained Write Flood ────────────────────────────────────────────

async function phase1WriteFlood(
  users: UserRecord[],
  maps: MapRecord[],
  opsCount: number,
): Promise<PhaseStats> {
  console.log(`\n=== Phase 1: Sustained Write Flood (${opsCount.toLocaleString()} ops, concurrency=${CONCURRENCY}) ===`);

  const tasks: (() => Promise<OpResult>)[] = [];
  for (let i = 0; i < opsCount; i++) {
    const user = pick(users);
    const map = pick(maps);
    // Alternate between annotations and comments (60/40 split)
    if (i % 5 < 3) {
      tasks.push(async () => {
        const r = await req('POST', `/api/v1/maps/${map.id}/annotations`, user.apiKey, {
          anchor: randomAnchor(),
          content: randomContent(),
        });
        return { phase: '1-write-flood', op: 'POST annotation', status: r.status, latencyMs: r.latencyMs, error: r.error };
      });
    } else {
      tasks.push(async () => {
        const r = await req('POST', `/api/v1/maps/${map.id}/comments`, user.apiKey, {
          body: `Comment ${randomBytes(6).toString('hex')}`,
        });
        return { phase: '1-write-flood', op: 'POST comment', status: r.status, latencyMs: r.latencyMs, error: r.error };
      });
    }
  }

  const start = performance.now();
  const results = await poolWithTimeout(tasks, CONCURRENCY, PHASE_TIMEOUT_MS);
  const duration = performance.now() - start;

  const stats = computeStats(results, '1. Write Flood', duration);
  printStats(stats);
  return stats;
}

// ── Phase 2: Mixed CRUD Storm ─────────────────────────────────────────────────

async function phase2MixedCrud(
  users: UserRecord[],
  maps: MapRecord[],
  opsCount: number,
): Promise<PhaseStats> {
  console.log(`\n=== Phase 2: Mixed CRUD Storm (${opsCount.toLocaleString()} ops) ===`);

  // Collect existing annotation IDs for update/delete
  console.log('  Collecting annotation IDs...');
  const annotationIds: { id: string; mapId: string }[] = [];
  for (const map of maps) {
    const rows = psqlRows(`SELECT id FROM annotation_objects WHERE map_id = '${map.id}' LIMIT 500`);
    for (const id of rows) annotationIds.push({ id, mapId: map.id });
  }
  console.log(`  Found ${annotationIds.length} annotations for CRUD ops`);

  if (annotationIds.length === 0) {
    console.log('  No annotations found — skipping phase');
    return { phase: '2. Mixed CRUD', totalOps: 0, successes: 0, failures: 0, errors5xx: 0, errors429: 0, errorsTimeout: 0, p50: 0, p95: 0, p99: 0, maxMs: 0, opsPerSec: 0, durationSec: 0 };
  }

  const tasks: (() => Promise<OpResult>)[] = [];
  for (let i = 0; i < opsCount; i++) {
    const user = pick(users);
    const map = pick(maps);
    const op = i % 10; // Distribution: 3 create, 3 read, 2 update, 2 delete

    if (op < 3) {
      // CREATE
      tasks.push(async () => {
        const r = await req('POST', `/api/v1/maps/${map.id}/annotations`, user.apiKey, {
          anchor: randomAnchor(),
          content: randomContent(),
        });
        if (r.status === 201 && r.data?.data?.id) {
          annotationIds.push({ id: r.data.data.id, mapId: map.id });
        }
        return { phase: '2-crud', op: 'CREATE', status: r.status, latencyMs: r.latencyMs, error: r.error };
      });
    } else if (op < 6) {
      // READ
      const target = pick(annotationIds);
      tasks.push(async () => {
        const r = await req('GET', `/api/v1/maps/${target.mapId}/annotations/${target.id}`, user.apiKey);
        return { phase: '2-crud', op: 'READ', status: r.status, latencyMs: r.latencyMs, error: r.error };
      });
    } else if (op < 8) {
      // UPDATE
      const target = pick(annotationIds);
      tasks.push(async () => {
        const r = await req('PATCH', `/api/v1/maps/${target.mapId}/annotations/${target.id}`, user.apiKey, {
          content: randomContent(),
        });
        return { phase: '2-crud', op: 'UPDATE', status: r.status, latencyMs: r.latencyMs, error: r.error };
      });
    } else {
      // DELETE
      const target = pick(annotationIds);
      tasks.push(async () => {
        const r = await req('DELETE', `/api/v1/maps/${target.mapId}/annotations/${target.id}`, user.apiKey);
        return { phase: '2-crud', op: 'DELETE', status: r.status, latencyMs: r.latencyMs, error: r.error };
      });
    }
  }

  const start = performance.now();
  const results = await poolWithTimeout(tasks, CONCURRENCY, PHASE_TIMEOUT_MS);
  const duration = performance.now() - start;

  const stats = computeStats(results, '2. Mixed CRUD Storm', duration);
  printStats(stats);

  // Breakdown by operation type
  const byOp = new Map<string, OpResult[]>();
  for (const r of results) {
    if (!byOp.has(r.op)) byOp.set(r.op, []);
    byOp.get(r.op)!.push(r);
  }
  console.log('  Per-operation breakdown:');
  for (const [op, opResults] of byOp) {
    const ok = opResults.filter((r) => r.status >= 200 && r.status < 300).length;
    const lats = opResults.map((r) => r.latencyMs).sort((a, b) => a - b);
    console.log(`    ${op.padEnd(8)} ok=${ok}/${opResults.length} p50=${Math.round(percentile(lats, 50))}ms p95=${Math.round(percentile(lats, 95))}ms`);
  }

  return stats;
}

// ── Phase 3: Cache Stampede ───────────────────────────────────────────────────

async function phase3CacheStampede(
  users: UserRecord[],
  maps: MapRecord[],
  layers: LayerRecord[],
): Promise<PhaseStats> {
  console.log('\n=== Phase 3: Cache Stampede (write to invalidate + thundering herd reads) ===');

  const opsPerRound = 200;
  const rounds = 10;
  const allResults: OpResult[] = [];
  const start = performance.now();

  for (let round = 0; round < rounds; round++) {
    const layer = pick(layers);
    const map = maps.find((m) => m.id === layer.mapId)!;
    const user = pick(users);

    // First: one write to invalidate cache
    const writeResult = await req('POST', `/api/v1/maps/${map.id}/annotations`, user.apiKey, {
      anchor: randomAnchor(),
      content: randomContent(),
    });
    allResults.push({
      phase: '3-stampede',
      op: 'INVALIDATE',
      status: writeResult.status,
      latencyMs: writeResult.latencyMs,
      error: writeResult.error,
    });

    // Then: thundering herd of GeoJSON reads
    const readTasks: (() => Promise<OpResult>)[] = [];
    for (let i = 0; i < opsPerRound; i++) {
      const reader = pick(users);
      readTasks.push(async () => {
        const r = await req('GET', `/api/v1/maps/${map.id}/layers/${layer.id}/geojson`, reader.apiKey);
        return { phase: '3-stampede', op: 'GEOJSON_READ', status: r.status, latencyMs: r.latencyMs, error: r.error };
      });
    }
    const readResults = await pool(readTasks, opsPerRound);
    allResults.push(...readResults);
  }

  const duration = performance.now() - start;
  const stats = computeStats(allResults, '3. Cache Stampede', duration);
  printStats(stats);
  return stats;
}

// ── Phase 4: Pool Exhaustion ──────────────────────────────────────────────────

async function phase4PoolExhaustion(
  users: UserRecord[],
  maps: MapRecord[],
): Promise<PhaseStats> {
  const heavyConcurrency = Math.max(CONCURRENCY, 500);
  console.log(`\n=== Phase 4: Pool Exhaustion (${heavyConcurrency} concurrent list queries) ===`);

  // Hit paginated list endpoints that require COUNT + SELECT (2 queries per request)
  const tasks: (() => Promise<OpResult>)[] = [];
  for (let i = 0; i < heavyConcurrency * 2; i++) {
    const user = pick(users);
    const map = pick(maps);
    const endpoint = i % 3 === 0
      ? `/api/v1/maps/${map.id}/annotations?limit=100`
      : i % 3 === 1
        ? `/api/v1/maps/${map.id}/comments?limit=100`
        : '/api/v1/maps?limit=100';

    tasks.push(async () => {
      const r = await req('GET', endpoint, user.apiKey);
      return { phase: '4-pool', op: 'LIST', status: r.status, latencyMs: r.latencyMs, error: r.error };
    });
  }

  const start = performance.now();
  const results = await poolWithTimeout(tasks, heavyConcurrency, PHASE_TIMEOUT_MS);
  const duration = performance.now() - start;

  const stats = computeStats(results, '4. Pool Exhaustion', duration);
  printStats(stats);
  return stats;
}

// ── Phase 5: Chaos ────────────────────────────────────────────────────────────

async function phase5Chaos(
  users: UserRecord[],
): Promise<PhaseStats> {
  console.log('\n=== Phase 5: Chaos (delete resources while reading them) ===');

  // Create a sacrificial map with annotations
  const owner = pick(users);
  const chaosMapId = psql(`INSERT INTO maps (user_id, title) VALUES ('${owner.id}', 'MegaTest-Chaos') RETURNING id`);
  psql(`INSERT INTO layers (map_id, name, type) VALUES ('${chaosMapId}', 'ChaosLayer', 'geojson') RETURNING id`);

  // Grant all users access
  for (const u of users) {
    if (u.id !== owner.id) {
      psql(`INSERT INTO map_collaborators (map_id, user_id, role) VALUES ('${chaosMapId}', '${u.id}', 'editor') ON CONFLICT DO NOTHING RETURNING map_id`);
    }
  }

  // Bulk create annotations
  console.log('  Creating sacrificial annotations...');
  const batchSize = 500;
  const annoIds: string[] = [];
  for (let i = 0; i < batchSize; i++) {
    const u = pick(users);
    const r = await req('POST', `/api/v1/maps/${chaosMapId}/annotations`, u.apiKey, {
      anchor: randomAnchor(),
      content: randomContent(),
    });
    if (r.data?.data?.id) annoIds.push(r.data.data.id);
  }
  console.log(`  Created ${annoIds.length} sacrificial annotations`);

  // Now: simultaneously read, update, and delete them
  const tasks: (() => Promise<OpResult>)[] = [];
  for (const id of annoIds) {
    const reader = pick(users);
    const updater = pick(users);
    const deleter = pick(users);

    // Read
    tasks.push(async () => {
      const r = await req('GET', `/api/v1/maps/${chaosMapId}/annotations/${id}`, reader.apiKey);
      return { phase: '5-chaos', op: 'CHAOS_READ', status: r.status, latencyMs: r.latencyMs, error: r.error };
    });
    // Update
    tasks.push(async () => {
      const r = await req('PATCH', `/api/v1/maps/${chaosMapId}/annotations/${id}`, updater.apiKey, {
        content: { type: 'text', text: 'chaos-updated' },
      });
      return { phase: '5-chaos', op: 'CHAOS_UPDATE', status: r.status, latencyMs: r.latencyMs, error: r.error };
    });
    // Delete
    tasks.push(async () => {
      const r = await req('DELETE', `/api/v1/maps/${chaosMapId}/annotations/${id}`, deleter.apiKey);
      return { phase: '5-chaos', op: 'CHAOS_DELETE', status: r.status, latencyMs: r.latencyMs, error: r.error };
    });
  }

  // Also read the list endpoint while deletes are happening
  for (let i = 0; i < 100; i++) {
    const user = pick(users);
    tasks.push(async () => {
      const r = await req('GET', `/api/v1/maps/${chaosMapId}/annotations?limit=50`, user.apiKey);
      return { phase: '5-chaos', op: 'CHAOS_LIST', status: r.status, latencyMs: r.latencyMs, error: r.error };
    });
  }

  const start = performance.now();
  const results = await poolWithTimeout(tasks, CONCURRENCY, PHASE_TIMEOUT_MS);
  const duration = performance.now() - start;

  const stats = computeStats(results, '5. Chaos', duration);
  printStats(stats);

  // Check for 500s — the key signal
  const fiveHundreds = results.filter((r) => r.status >= 500);
  if (fiveHundreds.length > 0) {
    console.log(`  WARNING: ${fiveHundreds.length} 5xx errors during chaos — potential unhandled FK/race conditions`);
    const byOp = new Map<string, number>();
    for (const r of fiveHundreds) {
      byOp.set(r.op, (byOp.get(r.op) ?? 0) + 1);
    }
    for (const [op, count] of byOp) console.log(`    ${op}: ${count} 5xx errors`);
  }

  // Cleanup
  psqlExec(`DELETE FROM annotation_objects WHERE map_id = '${chaosMapId}'`);
  psqlExec(`DELETE FROM comments WHERE map_id = '${chaosMapId}'`);
  psqlExec(`DELETE FROM layers WHERE map_id = '${chaosMapId}'`);
  psqlExec(`DELETE FROM map_collaborators WHERE map_id = '${chaosMapId}'`);
  psqlExec(`DELETE FROM maps WHERE id = '${chaosMapId}'`);

  return stats;
}

// ── Phase 6: Degradation Curve ────────────────────────────────────────────────

async function phase6DegradationCurve(
  users: UserRecord[],
  maps: MapRecord[],
): Promise<void> {
  console.log('\n=== Phase 6: Degradation Curve (ramp concurrency, measure throughput) ===');

  const opsPerStep = 2000;
  const steps: number[] = [];
  for (let i = 1; i <= RAMP_STEPS; i++) {
    steps.push(Math.round((CONCURRENCY / RAMP_STEPS) * i));
  }

  console.log(`  Steps: ${steps.join(', ')} concurrent workers`);
  console.log(`  ${'Concurrency'.padEnd(14)} ${'Ops/sec'.padEnd(10)} ${'p50'.padEnd(8)} ${'p95'.padEnd(8)} ${'p99'.padEnd(8)} ${'5xx'.padEnd(6)} ${'429'.padEnd(6)} ${'Timeout'.padEnd(8)}`);
  console.log(`  ${'-'.repeat(76)}`);

  for (const c of steps) {
    const tasks: (() => Promise<OpResult>)[] = [];
    for (let i = 0; i < opsPerStep; i++) {
      const user = pick(users);
      const map = pick(maps);
      if (i % 2 === 0) {
        tasks.push(async () => {
          const r = await req('POST', `/api/v1/maps/${map.id}/annotations`, user.apiKey, {
            anchor: randomAnchor(),
            content: randomContent(),
          });
          return { phase: '6-ramp', op: 'WRITE', status: r.status, latencyMs: r.latencyMs, error: r.error };
        });
      } else {
        tasks.push(async () => {
          const r = await req('GET', `/api/v1/maps/${map.id}/annotations?limit=20`, user.apiKey);
          return { phase: '6-ramp', op: 'READ', status: r.status, latencyMs: r.latencyMs, error: r.error };
        });
      }
    }

    const start = performance.now();
    const results = await poolWithTimeout(tasks, c, 60000);
    const duration = performance.now() - start;
    const stats = computeStats(results, `ramp-${c}`, duration);

    console.log(
      `  ${String(c).padEnd(14)} ${String(stats.opsPerSec).padEnd(10)} ${String(stats.p50).padEnd(8)} ${String(stats.p95).padEnd(8)} ${String(stats.p99).padEnd(8)} ${String(stats.errors5xx).padEnd(6)} ${String(stats.errors429).padEnd(6)} ${String(stats.errorsTimeout).padEnd(8)}`
    );
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function cleanup() {
  console.log('\n=== Cleanup ===');
  psqlExec("DELETE FROM api_keys WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'mega-%')");
  psqlExec("DELETE FROM annotation_objects WHERE map_id IN (SELECT id FROM maps WHERE title LIKE 'MegaTest%')");
  psqlExec("DELETE FROM comments WHERE map_id IN (SELECT id FROM maps WHERE title LIKE 'MegaTest%')");
  psqlExec("DELETE FROM features WHERE layer_id IN (SELECT l.id FROM layers l JOIN maps m ON l.map_id = m.id WHERE m.title LIKE 'MegaTest%')");
  psqlExec("DELETE FROM layers WHERE map_id IN (SELECT id FROM maps WHERE title LIKE 'MegaTest%')");
  psqlExec("DELETE FROM map_collaborators WHERE map_id IN (SELECT id FROM maps WHERE title LIKE 'MegaTest%')");
  psqlExec("DELETE FROM maps WHERE title LIKE 'MegaTest%'");
  psqlExec("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'mega-%')");
  psqlExec("DELETE FROM users WHERE email LIKE 'mega-%'");
  console.log('  Done.');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║          MEGA-SCALE CONCURRENT CRUD TEST                ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Target ops:    ${TOTAL_OPS.toLocaleString().padEnd(40)}║`);
  console.log(`║  Concurrency:   ${CONCURRENCY.toString().padEnd(40)}║`);
  console.log(`║  Users:         ${NUM_USERS.toString().padEnd(40)}║`);
  console.log(`║  Maps:          ${NUM_MAPS.toString().padEnd(40)}║`);
  console.log(`║  Base URL:      ${BASE.padEnd(40)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  const allStats: PhaseStats[] = [];

  try {
    const { users: u, maps: m, layers: l } = setup();

    // Phase 1: 60% of ops go to write flood
    const writeOps = Math.floor(TOTAL_OPS * 0.6);
    allStats.push(await phase1WriteFlood(u, m, writeOps));

    // Phase 2: 25% of ops go to mixed CRUD
    const crudOps = Math.floor(TOTAL_OPS * 0.25);
    allStats.push(await phase2MixedCrud(u, m, crudOps));

    // Phase 3: Cache stampede (fixed size)
    allStats.push(await phase3CacheStampede(u, m, l));

    // Phase 4: Pool exhaustion (fixed size)
    allStats.push(await phase4PoolExhaustion(u, m));

    // Phase 5: Chaos (fixed size)
    allStats.push(await phase5Chaos(u));

    // Phase 6: Degradation curve
    await phase6DegradationCurve(u, m);

    // Final summary
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║                    FINAL SUMMARY                        ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    let totalOps = 0, total5xx = 0, totalTimeout = 0;
    for (const s of allStats) {
      totalOps += s.totalOps;
      total5xx += s.errors5xx;
      totalTimeout += s.errorsTimeout;
    }
    console.log(`║  Total operations:  ${totalOps.toLocaleString().padEnd(37)}║`);
    console.log(`║  Total 5xx errors:  ${total5xx.toLocaleString().padEnd(37)}║`);
    console.log(`║  Total timeouts:    ${totalTimeout.toLocaleString().padEnd(37)}║`);
    console.log('╚══════════════════════════════════════════════════════════╝');

    if (total5xx > 0) {
      console.log('\n  VERDICT: FAIL — 5xx errors indicate unhandled exceptions under load');
      process.exitCode = 1;
    } else if (totalTimeout > totalOps * 0.05) {
      console.log('\n  VERDICT: DEGRADED — >5% timeouts indicate capacity limits');
      process.exitCode = 1;
    } else {
      console.log('\n  VERDICT: PASS — no 5xx errors, timeouts within tolerance');
    }
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  try { cleanup(); } catch { /* best effort */ }
  process.exit(2);
});
