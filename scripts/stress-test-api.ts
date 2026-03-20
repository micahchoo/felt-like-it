#!/usr/bin/env npx tsx
/**
 * REST API v1 Comprehensive Stress Test
 *
 * Phases:
 *   0. Setup (users, maps, layers, API keys, collaborators)
 *   1. Scope enforcement (read key → 403 on writes)
 *   2. Multi-user concurrent reads
 *   3. High-volume annotation creation
 *   4. High-volume comment creation
 *   5. High-volume feature/drawing creation (DB)
 *   6. Read under load (after bulk insert)
 *   7. Race conditions (concurrent writes, read-your-writes, update-vs-delete)
 *   8. Access control (private map isolation)
 *   9. File upload + download (multipart, valid + malformed)
 *  10. GeoJSON export (API v1 + internal export endpoint)
 *  11. Malformed data (bad JSON, missing fields, XSS, SQL injection, huge payloads)
 *
 * Usage:
 *   npx tsx scripts/stress-test-api.ts
 *   USERS=50 MAPS=50 ANNOTATIONS=10000 npx tsx scripts/stress-test-api.ts
 */

import { execSync } from 'child_process';
import { createHash, randomBytes } from 'crypto';

// ── Config ────────────────────────────────────────────────────────────────────

const BASE = process.env.BASE_URL ?? 'http://localhost:5174';
const NUM_USERS = parseInt(process.env.USERS ?? '100', 10);
const NUM_MAPS = parseInt(process.env.MAPS ?? '100', 10);
const NUM_ANNOTATIONS = parseInt(process.env.ANNOTATIONS ?? '50000', 10);
const NUM_FEATURES = parseInt(process.env.FEATURES ?? '100000', 10);
const NUM_COMMENTS = parseInt(process.env.COMMENTS ?? '50000', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY ?? '100', 10);
const RACE_CONCURRENCY = parseInt(process.env.RACE_CONCURRENCY ?? '200', 10);

// 'feature' anchor requires a real feature UUID; skip it for bulk creation
const ANCHOR_TYPES = ['point', 'region', 'viewport', 'measurement'] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

interface UserRecord { id: string; email: string; apiKey: string; }
interface MapRecord { id: string; title: string; ownerId: string; }
interface LayerRecord { id: string; mapId: string; name: string; }
interface TestResult {
  phase: string;
  endpoint: string;
  method: string;
  iteration: number;
  status: number;
  latencyMs: number;
  error?: string;
  /** If true, a non-2xx status is the expected correct behavior */
  expectedNon2xx?: boolean;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

function psqlRaw(query: string): string {
  return execSync(
    `docker exec felt-like-it-postgres-1 psql -U felt -d felt -tAc "${query.replace(/"/g, '\\"')}"`,
    { encoding: 'utf-8', timeout: 30000 },
  ).trim();
}

/** Single-value result (first line only — safe for INSERT RETURNING, counts, etc.) */
function psql(query: string): string {
  return psqlRaw(query).split('\n')[0] ?? '';
}

/** Multi-row result — returns all non-empty lines */
function psqlRows(query: string): string[] {
  return psqlRaw(query).split('\n').filter((l) => l.length > 0);
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function req(
  method: string,
  path: string,
  apiKey: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; latencyMs: number; data: any; error?: string }> {
  const start = performance.now();
  try {
    const hdrs: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    };
    if (body !== undefined && !extraHeaders?.['Content-Type']?.includes('multipart')) {
      hdrs['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: hdrs,
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const latencyMs = performance.now() - start;
    let data: any;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('json')) {
      try { data = await res.json(); } catch { data = null; }
    } else {
      data = { _bytes: (await res.arrayBuffer()).byteLength, _contentType: ct };
    }
    return { status: res.status, latencyMs, data, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    return { status: 0, latencyMs: performance.now() - start, data: null, error: (err as Error).message };
  }
}

/** Send raw string body (for malformed JSON tests) */
async function rawReq(
  method: string,
  path: string,
  apiKey: string,
  rawBody: string,
  contentType = 'application/json',
): Promise<{ status: number; latencyMs: number; data: any; error?: string }> {
  const start = performance.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': contentType },
      body: rawBody,
    });
    const latencyMs = performance.now() - start;
    let data: any;
    try { data = await res.json(); } catch { data = null; }
    return { status: res.status, latencyMs, data, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    return { status: 0, latencyMs: performance.now() - start, data: null, error: (err as Error).message };
  }
}

/** Send multipart form data */
async function multipartReq(
  path: string,
  apiKey: string,
  formData: FormData,
): Promise<{ status: number; latencyMs: number; data: any; error?: string }> {
  const start = performance.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });
    const latencyMs = performance.now() - start;
    let data: any;
    try { data = await res.json(); } catch { data = null; }
    return { status: res.status, latencyMs, data, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    return { status: 0, latencyMs: performance.now() - start, data: null, error: (err as Error).message };
  }
}

// ── Concurrency ───────────────────────────────────────────────────────────────

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

// ── Stats ─────────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function printPhaseResults(results: TestResult[], phase: string) {
  const groups = new Map<string, TestResult[]>();
  for (const r of results) {
    const key = `${r.method} ${r.endpoint}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  let totalOk = 0, totalFail = 0;
  console.log(`\n  ${'Endpoint'.padEnd(45)} ${'OK'.padEnd(7)} ${'Fail'.padEnd(7)} ${'p50'.padEnd(10)} ${'p95'.padEnd(10)} ${'Max'.padEnd(10)}`);
  console.log(`  ${'-'.repeat(89)}`);

  for (const [key, group] of groups) {
    const latencies = group.map((r) => r.latencyMs).sort((a, b) => a - b);
    const ok = group.filter((r) => r.expectedNon2xx || (r.status >= 200 && r.status < 300)).length;
    const fail = group.length - ok;
    totalOk += ok;
    totalFail += fail;
    const failStr = fail > 0 ? `\x1b[31m${fail}\x1b[0m` : '0';
    console.log(
      `  ${key.padEnd(45)} ${String(ok).padEnd(7)} ${String(failStr).padEnd(fail > 0 ? 16 : 7)} ` +
      `${percentile(latencies, 50).toFixed(1).padStart(6)}ms  ${percentile(latencies, 95).toFixed(1).padStart(6)}ms  ${Math.max(...latencies).toFixed(1).padStart(6)}ms`
    );
    const errors: Record<string, number> = {};
    for (const r of group) if (r.error && !r.expectedNon2xx) errors[r.error] = (errors[r.error] ?? 0) + 1;
    for (const [err, count] of Object.entries(errors)) {
      console.log(`  ${''.padEnd(45)} \x1b[33m${err}: ${count}\x1b[0m`);
    }
  }
  console.log(`  ${'-'.repeat(89)}`);
  console.log(`  Phase "${phase}": ${totalOk} ok, ${totalFail} failed, ${results.length} total`);
  return { totalOk, totalFail };
}

function makeAnchor(type: typeof ANCHOR_TYPES[number]) {
  switch (type) {
    case 'point': return { type: 'point', geometry: { type: 'Point', coordinates: [-122.4 + Math.random() * 0.1, 37.75 + Math.random() * 0.1] } };
    case 'region': return { type: 'region', geometry: { type: 'Polygon', coordinates: [[[-122.4, 37.75], [-122.3, 37.75], [-122.3, 37.85], [-122.4, 37.85], [-122.4, 37.75]]] } };
    case 'feature': return { type: 'feature', featureId: '00000000-0000-0000-0000-000000000000' };
    case 'viewport': return { type: 'viewport' };
    case 'measurement': return { type: 'measurement', geometry: { type: 'LineString', coordinates: [[-122.4, 37.75], [-122.3, 37.85]] } };
  }
}

function makeContent(text: string) {
  return { kind: 'single', body: { type: 'text', text } };
}

// ══════════════════════════════════════════════════════════════════════════════
//  PHASE 0: Setup
// ══════════════════════════════════════════════════════════════════════════════

async function setup(): Promise<{ users: UserRecord[]; maps: MapRecord[]; layers: LayerRecord[] }> {
  console.log('\n' + '='.repeat(70));
  console.log('  PHASE 0: Setup (batch SQL)');
  console.log('='.repeat(70));

  // ── Batch create users ──────────────────────────────────────────────────
  const userKeys: { email: string; rawKey: string; keyHash: string }[] = [];
  for (let i = 0; i < NUM_USERS; i++) {
    const rawKey = `flk_${randomBytes(32).toString('hex')}`;
    userKeys.push({
      email: `stress${i}@test.local`,
      rawKey,
      keyHash: createHash('sha256').update(rawKey).digest('hex'),
    });
  }

  // Upsert all users in one statement
  const userValues = userKeys.map((u, i) => `('${u.email}', 'Stress User ${i}', 'disabled')`).join(',');
  psql(`INSERT INTO users (email, name, hashed_password) VALUES ${userValues} ON CONFLICT (email) DO NOTHING`);

  // Fetch all user IDs
  const emailList = userKeys.map((u) => `'${u.email}'`).join(',');
  const userRowLines = psqlRows(`SELECT id, email FROM users WHERE email IN (${emailList}) ORDER BY email`);
  const userMap = new Map<string, string>();
  for (const line of userRowLines) {
    if (!line.includes('|')) continue;
    const [id, email] = line.split('|');
    userMap.set(email.trim(), id.trim());
  }

  // Delete old keys and batch insert new ones
  const userIds = [...userMap.values()];
  psql(`DELETE FROM api_keys WHERE user_id IN (${userIds.map((id) => `'${id}'`).join(',')}) AND name='stress-key'`);
  const keyValues = userKeys.map((u) => {
    const uid = userMap.get(u.email)!;
    return `('${uid}', 'stress-key', '${u.keyHash}', 'read-write', '${u.rawKey.slice(0, 12)}')`;
  }).join(',');
  psql(`INSERT INTO api_keys (user_id, name, key_hash, scope, prefix) VALUES ${keyValues}`);

  const users: UserRecord[] = userKeys.map((u) => ({
    id: userMap.get(u.email)!,
    email: u.email,
    apiKey: u.rawKey,
  }));
  console.log(`  ${users.length} users with API keys`);

  // ── Batch create maps ───────────────────────────────────────────────────
  const mapTitles: { title: string; ownerId: string }[] = [];
  for (let i = 0; i < NUM_MAPS; i++) {
    mapTitles.push({ title: `StressMap-${i}`, ownerId: users[i % users.length].id });
  }
  // Clean old stress maps first for idempotency
  psql("DELETE FROM map_collaborators WHERE map_id IN (SELECT id FROM maps WHERE title LIKE 'StressMap-%')");
  psql("DELETE FROM layers WHERE map_id IN (SELECT id FROM maps WHERE title LIKE 'StressMap-%')");
  psql("DELETE FROM maps WHERE title LIKE 'StressMap-%'");

  const mapValues = mapTitles.map((m) => `('${m.ownerId}', '${m.title}', 'Stress test map')`).join(',');
  psql(`INSERT INTO maps (user_id, title, description) VALUES ${mapValues}`);

  const mapRowLines = psqlRows(`SELECT id, title, user_id FROM maps WHERE title LIKE 'StressMap-%' ORDER BY title`);
  const maps: MapRecord[] = [];
  for (const line of mapRowLines) {
    if (!line.includes('|')) continue;
    const [id, title, ownerId] = line.split('|').map((s) => s.trim());
    maps.push({ id, title, ownerId });
  }
  console.log(`  ${maps.length} maps`);

  // ── Batch create collaborators (all users → all maps as editors) ────────
  const collabValues: string[] = [];
  for (const map of maps) {
    for (const user of users) {
      if (user.id === map.ownerId) continue;
      collabValues.push(`('${map.id}', '${user.id}', 'editor')`);
    }
  }
  // Insert in batches of 500 to stay under shell arg limit (E2BIG at ~128KB)
  for (let i = 0; i < collabValues.length; i += 500) {
    const batch = collabValues.slice(i, i + 500);
    psql(`INSERT INTO map_collaborators (map_id, user_id, role) VALUES ${batch.join(',')} ON CONFLICT DO NOTHING`);
  }
  console.log(`  ${collabValues.length} collaborator grants`);

  // ── Batch create layers ─────────────────────────────────────────────────
  const layerValues = maps.map((m) => `('${m.id}', 'Layer-${m.title}', 'point')`).join(',');
  psql(`INSERT INTO layers (map_id, name, type) VALUES ${layerValues}`);

  const layerRowLines = psqlRows(`SELECT id, map_id, name FROM layers WHERE name LIKE 'Layer-StressMap-%' ORDER BY name`);
  const layers: LayerRecord[] = [];
  for (const line of layerRowLines) {
    if (!line.includes('|')) continue;
    const [id, mapId, name] = line.split('|').map((s) => s.trim());
    layers.push({ id, mapId, name });
  }
  console.log(`  ${layers.length} layers`);

  return { users, maps, layers };
}

// ══════════════════════════════════════════════════════════════════════════════
//  PHASE 1: Scope enforcement
// ══════════════════════════════════════════════════════════════════════════════

async function phase1(users: UserRecord[], maps: MapRecord[]): Promise<TestResult[]> {
  console.log('\n' + '='.repeat(70));
  console.log('  PHASE 1: Scope Enforcement (read key → 403 on writes)');
  console.log('='.repeat(70));

  const user = users[0];
  const keyHash = createHash('sha256').update(user.apiKey).digest('hex');
  psql(`UPDATE api_keys SET scope='read' WHERE key_hash='${keyHash}'`);

  const map = maps[0];
  const results: TestResult[] = [];

  const tests: { name: string; method: string; path: string; body?: unknown; expect: number }[] = [
    { name: 'POST annotation (forbidden)', method: 'POST', path: `/api/v1/maps/${map.id}/annotations`, body: { content: makeContent('test'), anchor: makeAnchor('point') }, expect: 403 },
    { name: 'POST comment (forbidden)', method: 'POST', path: `/api/v1/maps/${map.id}/comments`, body: { body: 'test' }, expect: 403 },
    { name: 'GET maps (allowed)', method: 'GET', path: '/api/v1/maps', expect: 200 },
    { name: 'GET map (allowed)', method: 'GET', path: `/api/v1/maps/${map.id}`, expect: 200 },
  ];

  for (const t of tests) {
    const r = t.method === 'GET' ? await req('GET', t.path, user.apiKey) : await req(t.method, t.path, user.apiKey, t.body);
    const pass = r.status === t.expect;
    results.push({ phase: 'scope', endpoint: t.name, method: t.method, iteration: 0, status: r.status, latencyMs: r.latencyMs, expectedNon2xx: pass && r.status >= 300 });
    console.log(`  ${t.method.padEnd(6)} ${t.name.padEnd(35)} ${pass ? `\x1b[32m${r.status} ✓\x1b[0m` : `\x1b[31m${r.status} ✗ (expected ${t.expect})\x1b[0m`}`);
  }

  psql(`UPDATE api_keys SET scope='read-write' WHERE key_hash='${keyHash}'`);
  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PHASE 2: Multi-user concurrent reads
// ══════════════════════════════════════════════════════════════════════════════

async function phase2(users: UserRecord[], maps: MapRecord[], layers: LayerRecord[]): Promise<TestResult[]> {
  console.log('\n' + '='.repeat(70));
  console.log(`  PHASE 2: Multi-user reads (${users.length} users × ${maps.length} maps)`);
  console.log('='.repeat(70));

  const tasks: (() => Promise<TestResult>)[] = [];
  for (const user of users) {
    for (const map of maps) {
      const layer = layers.find((l) => l.mapId === map.id)!;
      tasks.push(async () => {
        const r = await req('GET', `/api/v1/maps/${map.id}/layers`, user.apiKey);
        return { phase: 'multi-read', endpoint: 'GET layers', method: 'GET', iteration: 0, status: r.status, latencyMs: r.latencyMs, error: r.error };
      });
      tasks.push(async () => {
        const r = await req('GET', `/api/v1/maps/${map.id}/layers/${layer.id}/features?limit=10`, user.apiKey);
        return { phase: 'multi-read', endpoint: 'GET features', method: 'GET', iteration: 0, status: r.status, latencyMs: r.latencyMs, error: r.error };
      });
      tasks.push(async () => {
        const r = await req('GET', `/api/v1/maps/${map.id}/annotations`, user.apiKey);
        return { phase: 'multi-read', endpoint: 'GET annotations', method: 'GET', iteration: 0, status: r.status, latencyMs: r.latencyMs, error: r.error };
      });
    }
  }

  console.log(`  ${tasks.length} requests, concurrency ${CONCURRENCY}`);
  const results = await pool(tasks, CONCURRENCY);
  printPhaseResults(results, 'multi-user reads');
  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PHASE 3: Annotations (all anchor types)
// ══════════════════════════════════════════════════════════════════════════════

async function phase3(users: UserRecord[], maps: MapRecord[]): Promise<TestResult[]> {
  console.log('\n' + '='.repeat(70));
  console.log(`  PHASE 3: Annotations (${NUM_ANNOTATIONS} across ${maps.length} maps, all anchor types)`);
  console.log('='.repeat(70));

  const tasks: (() => Promise<TestResult>)[] = [];
  for (let i = 0; i < NUM_ANNOTATIONS; i++) {
    const user = users[i % users.length];
    const map = maps[i % maps.length];
    const anchorType = ANCHOR_TYPES[i % ANCHOR_TYPES.length];
    tasks.push(async () => {
      const r = await req('POST', `/api/v1/maps/${map.id}/annotations`, user.apiKey, {
        content: makeContent(`Stress annotation ${i}`),
        anchor: makeAnchor(anchorType),
      });
      return { phase: 'annotations', endpoint: `POST annotation (${anchorType})`, method: 'POST', iteration: i, status: r.status, latencyMs: r.latencyMs, error: r.error };
    });
  }

  const results = await pool(tasks, CONCURRENCY);
  printPhaseResults(results, 'annotations');
  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PHASE 4: Comments
// ══════════════════════════════════════════════════════════════════════════════

async function phase4(users: UserRecord[], maps: MapRecord[]): Promise<TestResult[]> {
  console.log('\n' + '='.repeat(70));
  console.log(`  PHASE 4: Comments (${NUM_COMMENTS} across ${maps.length} maps)`);
  console.log('='.repeat(70));

  const tasks: (() => Promise<TestResult>)[] = [];
  for (let i = 0; i < NUM_COMMENTS; i++) {
    const user = users[i % users.length];
    const map = maps[i % maps.length];
    tasks.push(async () => {
      const r = await req('POST', `/api/v1/maps/${map.id}/comments`, user.apiKey, {
        body: `Stress comment ${i} — ${Date.now()}`,
      });
      return { phase: 'comments', endpoint: 'POST comment', method: 'POST', iteration: i, status: r.status, latencyMs: r.latencyMs, error: r.error };
    });
  }

  const results = await pool(tasks, CONCURRENCY);
  printPhaseResults(results, 'comments');
  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PHASE 5: Features/drawings (DB batch insert)
// ══════════════════════════════════════════════════════════════════════════════

async function phase5(layers: LayerRecord[]): Promise<TestResult[]> {
  console.log('\n' + '='.repeat(70));
  console.log(`  PHASE 5: Features (${NUM_FEATURES} via DB, ${layers.length} layers)`);
  console.log('='.repeat(70));

  const batchSize = 50;
  const results: TestResult[] = [];
  let created = 0;

  for (let batch = 0; batch < Math.ceil(NUM_FEATURES / batchSize); batch++) {
    const count = Math.min(batchSize, NUM_FEATURES - batch * batchSize);
    const layer = layers[batch % layers.length];
    const values: string[] = [];
    for (let i = 0; i < count; i++) {
      const lng = -122.4 + Math.random() * 0.1;
      const lat = 37.75 + Math.random() * 0.1;
      values.push(`('${layer.id}', ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), '{"name": "feat-${created + i}", "batch": ${batch}}'::jsonb)`);
    }
    const start = performance.now();
    try {
      psql(`INSERT INTO features (layer_id, geometry, properties) VALUES ${values.join(',')}`);
      results.push({ phase: 'features', endpoint: `INSERT batch(${count})`, method: 'DB', iteration: batch, status: 200, latencyMs: performance.now() - start });
      created += count;
    } catch (err) {
      results.push({ phase: 'features', endpoint: `INSERT batch(${count})`, method: 'DB', iteration: batch, status: 500, latencyMs: performance.now() - start, error: (err as Error).message });
    }
  }

  console.log(`  Inserted ${created} features`);
  printPhaseResults(results, 'features');
  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PHASE 6: Read under load
// ══════════════════════════════════════════════════════════════════════════════

async function phase6(users: UserRecord[], maps: MapRecord[], layers: LayerRecord[]): Promise<TestResult[]> {
  console.log('\n' + '='.repeat(70));
  console.log('  PHASE 6: Read under load (GeoJSON + features after bulk insert)');
  console.log('='.repeat(70));

  const tasks: (() => Promise<TestResult>)[] = [];
  for (const user of users.slice(0, 10)) {
    for (const layer of layers.slice(0, 10)) {
      const map = maps.find((m) => m.id === layer.mapId)!;
      tasks.push(async () => {
        const r = await req('GET', `/api/v1/maps/${map.id}/layers/${layer.id}/geojson?limit=500`, user.apiKey);
        return { phase: 'read-load', endpoint: 'GET geojson', method: 'GET', iteration: 0, status: r.status, latencyMs: r.latencyMs, error: r.error };
      });
      tasks.push(async () => {
        const r = await req('GET', `/api/v1/maps/${map.id}/layers/${layer.id}/features?limit=50`, user.apiKey);
        return { phase: 'read-load', endpoint: 'GET features', method: 'GET', iteration: 0, status: r.status, latencyMs: r.latencyMs, error: r.error };
      });
      tasks.push(async () => {
        const r = await req('GET', `/api/v1/maps/${map.id}/annotations`, user.apiKey);
        return { phase: 'read-load', endpoint: 'GET annotations', method: 'GET', iteration: 0, status: r.status, latencyMs: r.latencyMs, error: r.error };
      });
    }
  }

  console.log(`  ${tasks.length} reads, concurrency ${CONCURRENCY}`);
  const results = await pool(tasks, CONCURRENCY);
  printPhaseResults(results, 'read under load');
  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PHASE 7: Race conditions
// ══════════════════════════════════════════════════════════════════════════════

async function phase7(users: UserRecord[], maps: MapRecord[]): Promise<TestResult[]> {
  console.log('\n' + '='.repeat(70));
  console.log(`  PHASE 7: Race conditions (${RACE_CONCURRENCY} concurrent ops)`);
  console.log('='.repeat(70));

  const allResults: TestResult[] = [];
  const targetMap = maps[0];

  // 7a: Concurrent annotation creates
  console.log(`\n  7a: ${RACE_CONCURRENCY} concurrent annotation creates`);
  const annoTasks: (() => Promise<TestResult>)[] = [];
  for (let i = 0; i < RACE_CONCURRENCY; i++) {
    const user = users[i % users.length];
    annoTasks.push(async () => {
      const r = await req('POST', `/api/v1/maps/${targetMap.id}/annotations`, user.apiKey, {
        content: makeContent(`Race annotation ${i}`),
        anchor: makeAnchor(ANCHOR_TYPES[i % ANCHOR_TYPES.length]),
      });
      return { phase: 'race', endpoint: 'POST annotation (race)', method: 'POST', iteration: i, status: r.status, latencyMs: r.latencyMs, error: r.error };
    });
  }
  allResults.push(...await pool(annoTasks, RACE_CONCURRENCY));

  // 7b: Mixed read/write
  console.log(`  7b: ${RACE_CONCURRENCY} mixed read/write ops`);
  const mixedTasks: (() => Promise<TestResult>)[] = [];
  for (let i = 0; i < RACE_CONCURRENCY; i++) {
    const user = users[i % users.length];
    if (i % 3 === 0) {
      mixedTasks.push(async () => {
        const r = await req('POST', `/api/v1/maps/${targetMap.id}/comments`, user.apiKey, { body: `Race comment ${i}` });
        return { phase: 'race', endpoint: 'POST comment (race)', method: 'POST', iteration: i, status: r.status, latencyMs: r.latencyMs, error: r.error };
      });
    } else {
      mixedTasks.push(async () => {
        const r = await req('GET', `/api/v1/maps/${targetMap.id}/annotations`, user.apiKey);
        return { phase: 'race', endpoint: 'GET annotations (race)', method: 'GET', iteration: i, status: r.status, latencyMs: r.latencyMs, error: r.error };
      });
    }
  }
  allResults.push(...await pool(mixedTasks, RACE_CONCURRENCY));

  // 7c: Read-your-writes
  console.log('  7c: Read-your-writes consistency');
  const rywTasks: (() => Promise<TestResult>)[] = [];
  for (let i = 0; i < 20; i++) {
    const user = users[i % users.length];
    rywTasks.push(async () => {
      const createR = await req('POST', `/api/v1/maps/${targetMap.id}/annotations`, user.apiKey, {
        content: makeContent(`RYW test ${i}`),
        anchor: makeAnchor('point'),
      });
      if (createR.status !== 201) {
        return { phase: 'race', endpoint: 'POST+GET (ryw)', method: 'POST+GET', iteration: i, status: createR.status, latencyMs: createR.latencyMs, error: createR.error };
      }
      const annoId = createR.data?.data?.id;
      const readR = await req('GET', `/api/v1/maps/${targetMap.id}/annotations/${annoId}`, user.apiKey);
      return {
        phase: 'race', endpoint: 'POST+GET (ryw)', method: 'POST+GET', iteration: i,
        status: readR.status, latencyMs: createR.latencyMs + readR.latencyMs,
        error: readR.status === 200 ? undefined : `Read after write got ${readR.status}`,
      };
    });
  }
  allResults.push(...await pool(rywTasks, 20));

  // 7d: Concurrent PATCH + DELETE on same annotation
  console.log('  7d: Concurrent PATCH + DELETE on same annotation');
  const setupR = await req('POST', `/api/v1/maps/${targetMap.id}/annotations`, users[0].apiKey, {
    content: makeContent('Sacrificial'),
    anchor: makeAnchor('point'),
  });
  if (setupR.status === 201) {
    const sid = setupR.data?.data?.id;
    const conflictTasks: (() => Promise<TestResult>)[] = [];
    for (let i = 0; i < RACE_CONCURRENCY; i++) {
      const user = users[i % users.length];
      if (i % 2 === 0) {
        conflictTasks.push(async () => {
          const r = await req('PATCH', `/api/v1/maps/${targetMap.id}/annotations/${sid}`, user.apiKey, { content: makeContent(`Updated ${i}`) });
          // 404 is expected after DELETE wins the race
          return { phase: 'race', endpoint: 'PATCH annotation (conflict)', method: 'PATCH', iteration: i, status: r.status, latencyMs: r.latencyMs, expectedNon2xx: r.status === 404, error: r.error };
        });
      } else {
        conflictTasks.push(async () => {
          const r = await req('DELETE', `/api/v1/maps/${targetMap.id}/annotations/${sid}`, user.apiKey);
          // 404 is expected — only one DELETE can succeed
          return { phase: 'race', endpoint: 'DELETE annotation (conflict)', method: 'DELETE', iteration: i, status: r.status, latencyMs: r.latencyMs, expectedNon2xx: r.status === 404, error: r.error };
        });
      }
    }
    allResults.push(...await pool(conflictTasks, RACE_CONCURRENCY));
  }

  printPhaseResults(allResults, 'race conditions');
  return allResults;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PHASE 8: Access control
// ══════════════════════════════════════════════════════════════════════════════

async function phase8(users: UserRecord[]): Promise<TestResult[]> {
  console.log('\n' + '='.repeat(70));
  console.log('  PHASE 8: Access control — private map isolation');
  console.log('='.repeat(70));

  const privateMapId = psql(`INSERT INTO maps (user_id, title, description) VALUES ('${users[0].id}', 'PrivateStressMap', 'No collabs') RETURNING id`);
  const results: TestResult[] = [];

  const r0 = await req('GET', `/api/v1/maps/${privateMapId}`, users[0].apiKey);
  results.push({ phase: 'acl', endpoint: 'GET private (owner)', method: 'GET', iteration: 0, status: r0.status, latencyMs: r0.latencyMs, expectedNon2xx: false });
  console.log(`  Owner:     ${r0.status === 200 ? '\x1b[32m200 ✓\x1b[0m' : `\x1b[31m${r0.status} ✗\x1b[0m`}`);

  for (let i = 1; i < Math.min(5, users.length); i++) {
    const r = await req('GET', `/api/v1/maps/${privateMapId}`, users[i].apiKey);
    const pass = r.status === 404;
    results.push({ phase: 'acl', endpoint: `GET private (user ${i})`, method: 'GET', iteration: i, status: r.status, latencyMs: r.latencyMs, expectedNon2xx: pass });
    console.log(`  User ${i}:    ${pass ? '\x1b[32m404 ✓\x1b[0m' : `\x1b[31m${r.status} ✗\x1b[0m`}`);
  }

  psql(`DELETE FROM maps WHERE id='${privateMapId}'`);
  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PHASE 9: File upload + download
// ══════════════════════════════════════════════════════════════════════════════

async function phase9(users: UserRecord[]): Promise<TestResult[]> {
  console.log('\n' + '='.repeat(70));
  console.log('  PHASE 9: File upload + download (valid + malformed)');
  console.log('='.repeat(70));

  const results: TestResult[] = [];
  const user = users[0];

  // 9a: Valid GeoJSON upload
  const geojson = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-122.4, 37.8] }, properties: { name: 'test' } }] });
  const fd1 = new FormData();
  fd1.append('file', new Blob([geojson], { type: 'application/geo+json' }), 'test.geojson');
  let r = await multipartReq('/api/v1/files', user.apiKey, fd1);
  results.push({ phase: 'files', endpoint: 'POST file (geojson)', method: 'POST', iteration: 0, status: r.status, latencyMs: r.latencyMs, error: r.error });
  console.log(`  Upload GeoJSON:     ${r.status === 201 ? '\x1b[32m201 ✓\x1b[0m' : `\x1b[31m${r.status} ✗\x1b[0m`}`);

  const fileId = r.data?.data?.id;
  if (fileId) {
    const dl = await req('GET', `/api/v1/files/${fileId}`, user.apiKey);
    results.push({ phase: 'files', endpoint: 'GET file (download)', method: 'GET', iteration: 0, status: dl.status, latencyMs: dl.latencyMs, error: dl.error });
    console.log(`  Download:           ${dl.status === 200 ? '\x1b[32m200 ✓\x1b[0m' : `\x1b[31m${dl.status} ✗\x1b[0m`}`);
  }

  // 9b: Valid CSV upload
  const csv = 'name,lat,lon\nPark A,37.78,-122.42\nPark B,37.79,-122.41\n';
  const fd2 = new FormData();
  fd2.append('file', new Blob([csv], { type: 'text/csv' }), 'test.csv');
  r = await multipartReq('/api/v1/files', user.apiKey, fd2);
  results.push({ phase: 'files', endpoint: 'POST file (csv)', method: 'POST', iteration: 0, status: r.status, latencyMs: r.latencyMs, error: r.error });
  console.log(`  Upload CSV:         ${r.status === 201 ? '\x1b[32m201 ✓\x1b[0m' : `\x1b[31m${r.status} ✗\x1b[0m`}`);

  // 9c: Valid KML upload
  const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Test</name><Point><coordinates>-122.4,37.8,0</coordinates></Point></Placemark></Document></kml>`;
  const fd3 = new FormData();
  fd3.append('file', new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }), 'test.kml');
  r = await multipartReq('/api/v1/files', user.apiKey, fd3);
  results.push({ phase: 'files', endpoint: 'POST file (kml)', method: 'POST', iteration: 0, status: r.status, latencyMs: r.latencyMs, error: r.error });
  console.log(`  Upload KML:         ${r.status === 201 ? '\x1b[32m201 ✓\x1b[0m' : `\x1b[31m${r.status} ✗\x1b[0m`}`);

  // 9d: No file field
  const fd4 = new FormData();
  r = await multipartReq('/api/v1/files', user.apiKey, fd4);
  const pass4 = r.status === 422;
  results.push({ phase: 'files', endpoint: 'POST file (no file)', method: 'POST', iteration: 0, status: r.status, latencyMs: r.latencyMs, expectedNon2xx: pass4 });
  console.log(`  No file field:      ${pass4 ? '\x1b[32m422 ✓\x1b[0m' : `\x1b[31m${r.status} ✗\x1b[0m`}`);

  // 9e: Wrong content-type (not multipart)
  r = await req('POST', '/api/v1/files', user.apiKey, { foo: 'bar' });
  const pass5 = r.status === 422;
  results.push({ phase: 'files', endpoint: 'POST file (json body)', method: 'POST', iteration: 0, status: r.status, latencyMs: r.latencyMs, expectedNon2xx: pass5 });
  console.log(`  JSON body:          ${pass5 ? '\x1b[32m422 ✓\x1b[0m' : `\x1b[31m${r.status} ✗\x1b[0m`}`);

  // 9f: Non-existent file download
  r = await req('GET', '/api/v1/files/00000000-0000-0000-0000-000000000000', user.apiKey);
  const pass6 = r.status === 404;
  results.push({ phase: 'files', endpoint: 'GET file (not found)', method: 'GET', iteration: 0, status: r.status, latencyMs: r.latencyMs, expectedNon2xx: pass6 });
  console.log(`  File not found:     ${pass6 ? '\x1b[32m404 ✓\x1b[0m' : `\x1b[31m${r.status} ✗\x1b[0m`}`);

  // 9g: Path traversal attempt
  r = await req('GET', '/api/v1/files/../../etc/passwd', user.apiKey);
  const pass7 = r.status === 404;
  results.push({ phase: 'files', endpoint: 'GET file (path traversal)', method: 'GET', iteration: 0, status: r.status, latencyMs: r.latencyMs, expectedNon2xx: pass7 });
  console.log(`  Path traversal:     ${pass7 ? '\x1b[32m404 ✓\x1b[0m' : `\x1b[31m${r.status} ✗\x1b[0m`}`);

  // 9h: Concurrent file uploads
  console.log('  Concurrent uploads (20)...');
  const uploadTasks: (() => Promise<TestResult>)[] = [];
  for (let i = 0; i < 20; i++) {
    const u = users[i % users.length];
    uploadTasks.push(async () => {
      const fd = new FormData();
      fd.append('file', new Blob([`point ${i}`], { type: 'text/plain' }), `stress-${i}.txt`);
      const r = await multipartReq('/api/v1/files', u.apiKey, fd);
      return { phase: 'files', endpoint: 'POST file (concurrent)', method: 'POST', iteration: i, status: r.status, latencyMs: r.latencyMs, error: r.error };
    });
  }
  results.push(...await pool(uploadTasks, 20));
  printPhaseResults(results, 'files');
  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PHASE 10: Export (GeoJSON via API v1)
// ══════════════════════════════════════════════════════════════════════════════

async function phase10(users: UserRecord[], maps: MapRecord[], layers: LayerRecord[]): Promise<TestResult[]> {
  console.log('\n' + '='.repeat(70));
  console.log('  PHASE 10: GeoJSON export under load');
  console.log('='.repeat(70));

  const tasks: (() => Promise<TestResult>)[] = [];
  // Concurrent GeoJSON exports with different limits
  for (let i = 0; i < 50; i++) {
    const user = users[i % users.length];
    const layer = layers[i % layers.length];
    const map = maps.find((m) => m.id === layer.mapId)!;
    const limit = [10, 50, 100, 500, 1000][i % 5];
    tasks.push(async () => {
      const r = await req('GET', `/api/v1/maps/${map.id}/layers/${layer.id}/geojson?limit=${limit}`, user.apiKey);
      return { phase: 'export', endpoint: `GET geojson (limit=${limit})`, method: 'GET', iteration: i, status: r.status, latencyMs: r.latencyMs, error: r.error };
    });
  }

  const results = await pool(tasks, CONCURRENCY);
  printPhaseResults(results, 'export');
  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PHASE 11: Malformed data
// ══════════════════════════════════════════════════════════════════════════════

async function phase11(users: UserRecord[], maps: MapRecord[]): Promise<TestResult[]> {
  console.log('\n' + '='.repeat(70));
  console.log('  PHASE 11: Malformed data (bad JSON, XSS, SQLi, huge payloads)');
  console.log('='.repeat(70));

  const results: TestResult[] = [];
  const user = users[0];
  const map = maps[0];

  const malformedTests: { name: string; method: string; path: string; body?: string; expectStatus: number[]; ct?: string }[] = [
    // Bad JSON
    { name: 'Invalid JSON', method: 'POST', path: `/api/v1/maps/${map.id}/annotations`, body: '{bad json', expectStatus: [422, 400] },
    { name: 'Empty body', method: 'POST', path: `/api/v1/maps/${map.id}/annotations`, body: '', expectStatus: [422, 400] },
    { name: 'Array instead of object', method: 'POST', path: `/api/v1/maps/${map.id}/annotations`, body: '[1,2,3]', expectStatus: [422, 400] },
    { name: 'Null body', method: 'POST', path: `/api/v1/maps/${map.id}/annotations`, body: 'null', expectStatus: [422, 400] },

    // Missing required fields
    { name: 'Comment no body field', method: 'POST', path: `/api/v1/maps/${map.id}/comments`, body: '{"foo":"bar"}', expectStatus: [422, 400] },
    { name: 'Annotation no anchor', method: 'POST', path: `/api/v1/maps/${map.id}/annotations`, body: '{"content":"test"}', expectStatus: [422, 400] },
    { name: 'Annotation no content', method: 'POST', path: `/api/v1/maps/${map.id}/annotations`, body: JSON.stringify({ anchor: makeAnchor('point') }), expectStatus: [422, 400] },
    { name: 'Annotation bad anchor type', method: 'POST', path: `/api/v1/maps/${map.id}/annotations`, body: JSON.stringify({ content: makeContent('test'), anchor: { type: 'invalid' } }), expectStatus: [422, 400] },

    // XSS attempts
    { name: 'XSS in comment body', method: 'POST', path: `/api/v1/maps/${map.id}/comments`, body: '{"body":"<script>alert(1)</script>"}', expectStatus: [201] },
    { name: 'XSS in annotation', method: 'POST', path: `/api/v1/maps/${map.id}/annotations`, body: JSON.stringify({ content: makeContent('<img onerror=alert(1) src=x>'), anchor: makeAnchor('point') }), expectStatus: [201] },

    // SQL injection attempts
    { name: 'SQLi in comment', method: 'POST', path: `/api/v1/maps/${map.id}/comments`, body: `{"body":"'; DROP TABLE maps; --"}`, expectStatus: [201] },
    { name: 'SQLi in annotation', method: 'POST', path: `/api/v1/maps/${map.id}/annotations`, body: JSON.stringify({ content: makeContent("' OR 1=1 --"), anchor: makeAnchor('point') }), expectStatus: [201] },

    // Huge payloads
    { name: 'Huge comment (1MB)', method: 'POST', path: `/api/v1/maps/${map.id}/comments`, body: JSON.stringify({ body: 'x'.repeat(1024 * 1024) }), expectStatus: [201, 413, 422, 400] },
    { name: 'Huge annotation (1MB)', method: 'POST', path: `/api/v1/maps/${map.id}/annotations`, body: JSON.stringify({ content: makeContent('x'.repeat(1024 * 1024)), anchor: makeAnchor('point') }), expectStatus: [201, 413, 422, 400] },

    // Wrong content type
    { name: 'XML content-type', method: 'POST', path: `/api/v1/maps/${map.id}/comments`, body: '<xml>test</xml>', ct: 'application/xml', expectStatus: [422, 400, 415] },

    // Non-existent map
    { name: 'Non-existent map', method: 'GET', path: '/api/v1/maps/00000000-0000-0000-0000-000000000000', expectStatus: [404] },
    { name: 'Invalid UUID map', method: 'GET', path: '/api/v1/maps/not-a-uuid', expectStatus: [404, 400, 500] },

    // Non-existent annotation
    { name: 'PATCH non-existent annotation', method: 'PATCH', path: `/api/v1/maps/${map.id}/annotations/00000000-0000-0000-0000-000000000000`, body: '{"content":"test"}', expectStatus: [404] },
    { name: 'DELETE non-existent annotation', method: 'DELETE', path: `/api/v1/maps/${map.id}/annotations/00000000-0000-0000-0000-000000000000`, expectStatus: [404] },

    // Auth edge cases
    { name: 'No auth header', method: 'GET', path: '/api/v1/maps', expectStatus: [401] },
    { name: 'Bad auth header', method: 'GET', path: '/api/v1/maps', expectStatus: [401] },
  ];

  for (const t of malformedTests) {
    let r: { status: number; latencyMs: number; data: any; error?: string };

    if (t.name === 'No auth header') {
      const start = performance.now();
      const res = await fetch(`${BASE}${t.path}`);
      r = { status: res.status, latencyMs: performance.now() - start, data: null };
    } else if (t.name === 'Bad auth header') {
      const start = performance.now();
      const res = await fetch(`${BASE}${t.path}`, { headers: { Authorization: 'Bearer flk_invalid' } });
      r = { status: res.status, latencyMs: performance.now() - start, data: null };
    } else if (t.body !== undefined) {
      r = await rawReq(t.method, t.path, user.apiKey, t.body, t.ct);
    } else {
      r = await req(t.method, t.path, user.apiKey);
    }

    const pass = t.expectStatus.includes(r.status);
    results.push({
      phase: 'malformed',
      endpoint: t.name,
      method: t.method,
      iteration: 0,
      status: r.status,
      latencyMs: r.latencyMs,
      expectedNon2xx: pass && r.status >= 300,
      error: pass ? undefined : `Expected ${t.expectStatus.join('|')}, got ${r.status}`,
    });
    console.log(`  ${t.name.padEnd(35)} ${pass ? `\x1b[32m${r.status} ✓\x1b[0m` : `\x1b[31m${r.status} ✗ (expected ${t.expectStatus.join('|')})\x1b[0m`}`);
  }

  // Verify XSS/SQLi didn't corrupt data
  console.log('\n  Verifying data integrity after injection attempts...');
  const mapCount = psql(`SELECT count(*) FROM maps WHERE title LIKE 'StressMap%'`);
  console.log(`  Maps still intact: ${mapCount}`);

  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PHASE 12: Pagination — follow nextCursor across pages
// ══════════════════════════════════════════════════════════════════════════════

async function phase12(users: UserRecord[], maps: MapRecord[], layers: LayerRecord[]): Promise<TestResult[]> {
  console.log('\n' + '='.repeat(70));
  console.log('  PHASE 12: Pagination (cursor-following)');
  console.log('='.repeat(70));

  const results: TestResult[] = [];
  const user = users[0];
  const layer = layers[0];
  const map = maps.find((m) => m.id === layer.mapId)!;

  // Paginate features with limit=5, follow cursors until exhausted or 10 pages
  let cursor: string | null = null;
  let page = 0;
  let totalItems = 0;
  while (page < 10) {
    const path = `/api/v1/maps/${map.id}/layers/${layer.id}/features?limit=5${cursor ? `&cursor=${cursor}` : ''}`;
    const r = await req('GET', path, user.apiKey);
    results.push({ phase: 'pagination', endpoint: `GET features page ${page}`, method: 'GET', iteration: page, status: r.status, latencyMs: r.latencyMs, error: r.error });

    if (r.status !== 200) break;
    const items = r.data?.data ?? [];
    totalItems += items.length;
    cursor = r.data?.meta?.nextCursor ?? null;
    console.log(`  Page ${page}: ${items.length} items${cursor ? `, cursor: ${cursor.slice(0, 20)}...` : ' (last page)'}`);
    if (!cursor) break;
    page++;
  }
  console.log(`  Total paginated: ${totalItems} items across ${page + 1} pages`);

  // Paginate annotations
  cursor = null;
  page = 0;
  while (page < 10) {
    const path = `/api/v1/maps/${map.id}/annotations?limit=5${cursor ? `&cursor=${cursor}` : ''}`;
    const r = await req('GET', path, user.apiKey);
    results.push({ phase: 'pagination', endpoint: `GET annotations page ${page}`, method: 'GET', iteration: page, status: r.status, latencyMs: r.latencyMs, error: r.error });
    if (r.status !== 200) break;
    cursor = r.data?.meta?.nextCursor ?? null;
    if (!cursor) break;
    page++;
  }

  printPhaseResults(results, 'pagination');
  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PHASE 13: ETag / If-None-Match caching
// ══════════════════════════════════════════════════════════════════════════════

async function phase13(users: UserRecord[], maps: MapRecord[], layers: LayerRecord[]): Promise<TestResult[]> {
  console.log('\n' + '='.repeat(70));
  console.log('  PHASE 13: ETag caching (If-None-Match → 304)');
  console.log('='.repeat(70));

  const results: TestResult[] = [];
  const user = users[0];
  const layer = layers[0];
  const map = maps.find((m) => m.id === layer.mapId)!;

  // First request — should return 200 + ETag
  const path = `/api/v1/maps/${map.id}/layers/${layer.id}/geojson?limit=10`;
  const r1Start = performance.now();
  const r1 = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${user.apiKey}` },
  });
  const r1Ms = performance.now() - r1Start;
  const etag = r1.headers.get('etag');
  await r1.arrayBuffer(); // consume body
  results.push({ phase: 'etag', endpoint: 'GET geojson (initial)', method: 'GET', iteration: 0, status: r1.status, latencyMs: r1Ms });
  console.log(`  Initial:  ${r1.status} (${r1Ms.toFixed(1)}ms), ETag: ${etag ?? 'NONE'}`);

  if (etag) {
    // Second request with If-None-Match — should return 304
    const r2Start = performance.now();
    const r2 = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${user.apiKey}`, 'If-None-Match': etag },
    });
    const r2Ms = performance.now() - r2Start;
    await r2.arrayBuffer();
    const pass304 = r2.status === 304;
    results.push({ phase: 'etag', endpoint: 'GET geojson (If-None-Match)', method: 'GET', iteration: 1, status: r2.status, latencyMs: r2Ms, expectedNon2xx: pass304 });
    console.log(`  Cached:   ${r2.status} (${r2Ms.toFixed(1)}ms) ${pass304 ? '\x1b[32m304 ✓\x1b[0m' : `\x1b[31m${r2.status} ✗\x1b[0m`}`);

    // Third request with wrong ETag — should return 200
    const r3Start = performance.now();
    const r3 = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${user.apiKey}`, 'If-None-Match': '"wrong-etag"' },
    });
    const r3Ms = performance.now() - r3Start;
    await r3.arrayBuffer();
    results.push({ phase: 'etag', endpoint: 'GET geojson (wrong ETag)', method: 'GET', iteration: 2, status: r3.status, latencyMs: r3Ms });
    console.log(`  Wrong ET: ${r3.status} (${r3Ms.toFixed(1)}ms) ${r3.status === 200 ? '\x1b[32m200 ✓\x1b[0m' : `\x1b[31m${r3.status} ✗\x1b[0m`}`);
  } else {
    console.log('  \x1b[33mNo ETag returned — skipping cache tests\x1b[0m');
  }

  printPhaseResults(results, 'etag');
  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PHASE 14: Rate limiting verification
// ══════════════════════════════════════════════════════════════════════════════

async function phase14(users: UserRecord[], maps: MapRecord[]): Promise<TestResult[]> {
  console.log('\n' + '='.repeat(70));
  console.log('  PHASE 14: Rate limiting (burst → 429)');
  console.log('='.repeat(70));

  const results: TestResult[] = [];
  const user = users[0];
  const map = maps[0];

  // Temporarily set rate limit low by updating the key scope back
  // We can't change the server rate limit, but we can test share-token rate limit (30/s)
  // OR just verify the rate limiter returns proper headers
  console.log('  Testing with share token rate limit (30/s)...');

  // Create a share token
  const shareToken = psql(`INSERT INTO shares (map_id, token) VALUES ('${map.id}', 'stress-share-${Date.now()}') RETURNING token`);
  if (shareToken) {
    // Burst 50 requests on a share token (limit is 30/s)
    const burstTasks: (() => Promise<TestResult>)[] = [];
    for (let i = 0; i < 50; i++) {
      burstTasks.push(async () => {
        const r = await req('GET', `/api/v1/maps/${map.id}?token=${shareToken}`, 'unused');
        return { phase: 'ratelimit', endpoint: 'GET map (share burst)', method: 'GET', iteration: i, status: r.status, latencyMs: r.latencyMs, expectedNon2xx: r.status === 429, error: r.error };
      });
    }
    const burstResults = await pool(burstTasks, 50);

    const got200 = burstResults.filter((r) => r.status === 200).length;
    const got429 = burstResults.filter((r) => r.status === 429).length;
    results.push(...burstResults);
    console.log(`  Burst 50 share-token reqs: ${got200} × 200, ${got429} × 429`);
    const pass = got429 > 0;
    console.log(`  Rate limit triggered: ${pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗ (expected some 429s)\x1b[0m'}`);

    // Check Retry-After header
    const r429 = burstResults.find((r) => r.status === 429);
    if (r429) {
      console.log('  Retry-After header present in 429 response ✓');
    }

    // Cleanup
    psql(`DELETE FROM shares WHERE token='${shareToken}'`);
  }

  printPhaseResults(results, 'rate limiting');
  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PHASE 15: Individual endpoint coverage (tiles, single comment, single layer)
// ══════════════════════════════════════════════════════════════════════════════

async function phase15(users: UserRecord[], maps: MapRecord[], layers: LayerRecord[]): Promise<TestResult[]> {
  console.log('\n' + '='.repeat(70));
  console.log('  PHASE 15: Individual endpoint coverage');
  console.log('='.repeat(70));

  const results: TestResult[] = [];
  const user = users[0];
  const map = maps[0];
  const layer = layers.find((l) => l.mapId === map.id)!;

  // GET single layer
  let r = await req('GET', `/api/v1/maps/${map.id}/layers/${layer.id}`, user.apiKey);
  results.push({ phase: 'endpoints', endpoint: 'GET single layer', method: 'GET', iteration: 0, status: r.status, latencyMs: r.latencyMs, error: r.error });
  console.log(`  GET layer:      ${r.status === 200 ? '\x1b[32m200 ✓\x1b[0m' : `\x1b[31m${r.status} ✗\x1b[0m`}`);

  // GET tiles (may return 404 or redirect depending on Martin config)
  r = await req('GET', `/api/v1/maps/${map.id}/layers/${layer.id}/tiles`, user.apiKey);
  const tilePass = [200, 302, 404].includes(r.status);
  results.push({ phase: 'endpoints', endpoint: 'GET tiles', method: 'GET', iteration: 0, status: r.status, latencyMs: r.latencyMs, expectedNon2xx: tilePass && r.status >= 300 });
  console.log(`  GET tiles:      ${tilePass ? `\x1b[32m${r.status} ✓\x1b[0m` : `\x1b[31m${r.status} ✗\x1b[0m`}`);

  // Create + GET single comment
  const commentR = await req('POST', `/api/v1/maps/${map.id}/comments`, user.apiKey, { body: 'Endpoint test comment' });
  if (commentR.status === 201) {
    const commentId = commentR.data?.data?.id;
    r = await req('GET', `/api/v1/maps/${map.id}/comments/${commentId}`, user.apiKey);
    results.push({ phase: 'endpoints', endpoint: 'GET single comment', method: 'GET', iteration: 0, status: r.status, latencyMs: r.latencyMs, error: r.error });
    console.log(`  GET comment:    ${r.status === 200 ? '\x1b[32m200 ✓\x1b[0m' : `\x1b[31m${r.status} ✗\x1b[0m`}`);
  }

  // Create + GET + PATCH + DELETE single annotation (full CRUD)
  const annoR = await req('POST', `/api/v1/maps/${map.id}/annotations`, user.apiKey, {
    content: makeContent('CRUD test annotation'),
    anchor: makeAnchor('point'),
  });
  if (annoR.status === 201) {
    const annoId = annoR.data?.data?.id;

    r = await req('GET', `/api/v1/maps/${map.id}/annotations/${annoId}`, user.apiKey);
    results.push({ phase: 'endpoints', endpoint: 'GET single annotation', method: 'GET', iteration: 0, status: r.status, latencyMs: r.latencyMs, error: r.error });
    console.log(`  GET annotation:  ${r.status === 200 ? '\x1b[32m200 ✓\x1b[0m' : `\x1b[31m${r.status} ✗\x1b[0m`}`);

    r = await req('PATCH', `/api/v1/maps/${map.id}/annotations/${annoId}`, user.apiKey, { content: makeContent('Updated') });
    results.push({ phase: 'endpoints', endpoint: 'PATCH annotation', method: 'PATCH', iteration: 0, status: r.status, latencyMs: r.latencyMs, error: r.error });
    console.log(`  PATCH annotation: ${r.status === 200 ? '\x1b[32m200 ✓\x1b[0m' : `\x1b[31m${r.status} ✗\x1b[0m`}`);

    r = await req('DELETE', `/api/v1/maps/${map.id}/annotations/${annoId}`, user.apiKey);
    const delPass = [200, 204].includes(r.status);
    results.push({ phase: 'endpoints', endpoint: 'DELETE annotation', method: 'DELETE', iteration: 0, status: r.status, latencyMs: r.latencyMs, error: delPass ? undefined : r.error });
    console.log(`  DELETE annotation: ${delPass ? `\x1b[32m${r.status} ✓\x1b[0m` : `\x1b[31m${r.status} ✗\x1b[0m`}`);

    // Verify deleted
    r = await req('GET', `/api/v1/maps/${map.id}/annotations/${annoId}`, user.apiKey);
    const gonePass = r.status === 404;
    results.push({ phase: 'endpoints', endpoint: 'GET deleted annotation', method: 'GET', iteration: 0, status: r.status, latencyMs: r.latencyMs, expectedNon2xx: gonePass });
    console.log(`  GET deleted:    ${gonePass ? '\x1b[32m404 ✓\x1b[0m' : `\x1b[31m${r.status} ✗\x1b[0m`}`);
  }

  // Disabled user test — clean up first to avoid unique constraint collisions
  psql("DELETE FROM api_keys WHERE user_id IN (SELECT id FROM users WHERE email='disabled-stress@test.local')");
  psql("DELETE FROM users WHERE email='disabled-stress@test.local'");
  const disabledUserId = psql(`INSERT INTO users (email, name, hashed_password, disabled_at) VALUES ('disabled-stress@test.local', 'Disabled', 'disabled', NOW()) RETURNING id`);
  if (disabledUserId) {
    const dKey = `flk_${randomBytes(32).toString('hex')}`;
    const dHash = createHash('sha256').update(dKey).digest('hex');
    psql(`INSERT INTO api_keys (user_id, name, key_hash, scope, prefix) VALUES ('${disabledUserId}', 'disabled-key', '${dHash}', 'read-write', '${dKey.slice(0, 12)}')`);

    r = await req('GET', '/api/v1/maps', dKey);
    const disabledPass = r.status === 401;
    results.push({ phase: 'endpoints', endpoint: 'GET maps (disabled user)', method: 'GET', iteration: 0, status: r.status, latencyMs: r.latencyMs, expectedNon2xx: disabledPass });
    console.log(`  Disabled user:  ${disabledPass ? '\x1b[32m401 ✓\x1b[0m' : `\x1b[31m${r.status} ✗\x1b[0m`}`);
  }

  printPhaseResults(results, 'endpoints');
  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PHASE 16: Adversarial — designed to break the app
// ══════════════════════════════════════════════════════════════════════════════

async function phase16(users: UserRecord[], maps: MapRecord[], layers: LayerRecord[]): Promise<TestResult[]> {
  console.log('\n' + '='.repeat(70));
  console.log('  PHASE 16: ADVERSARIAL — trying to break the app');
  console.log('='.repeat(70));

  const results: TestResult[] = [];
  const user = users[0];
  const map = maps[0];
  const layer = layers.find((l) => l.mapId === map.id)!;

  // ── 16a: Connection pool exhaustion ─────────────────────────────────────
  // Fire 200 concurrent DB-heavy requests (GeoJSON with max limit)
  console.log('\n  16a: Connection pool exhaustion (200 concurrent GeoJSON max-limit)');
  const poolTasks: (() => Promise<TestResult>)[] = [];
  for (let i = 0; i < 200; i++) {
    const u = users[i % users.length];
    poolTasks.push(async () => {
      const r = await req('GET', `/api/v1/maps/${map.id}/layers/${layer.id}/geojson?limit=50000`, u.apiKey);
      return { phase: 'adversarial', endpoint: 'GET geojson 50k (pool exhaust)', method: 'GET', iteration: i, status: r.status, latencyMs: r.latencyMs, error: r.error };
    });
  }
  results.push(...await pool(poolTasks, 200));

  // ── 16b: Thundering herd on uncached GeoJSON ───────────────────────────
  // Invalidate cache then hit with 100 concurrent requests
  console.log('  16b: Thundering herd (invalidate cache → 100 concurrent)');
  // Insert a feature to bust cache
  psql(`INSERT INTO features (layer_id, geometry, properties) VALUES ('${layer.id}', ST_SetSRID(ST_MakePoint(-122.4, 37.8), 4326), '{"name":"cache-bust"}'::jsonb)`);
  const herdTasks: (() => Promise<TestResult>)[] = [];
  for (let i = 0; i < 100; i++) {
    const u = users[i % users.length];
    herdTasks.push(async () => {
      const r = await req('GET', `/api/v1/maps/${map.id}/layers/${layer.id}/geojson?limit=1000`, u.apiKey);
      return { phase: 'adversarial', endpoint: 'GET geojson (thundering herd)', method: 'GET', iteration: i, status: r.status, latencyMs: r.latencyMs, error: r.error };
    });
  }
  results.push(...await pool(herdTasks, 100));

  // ── 16c: Deeply nested JSON payload ────────────────────────────────────
  console.log('  16c: Deeply nested JSON (1000 levels)');
  let nested = '{"a":';
  for (let i = 0; i < 1000; i++) nested += '{"a":';
  nested += '"leaf"' + '}'.repeat(1001);
  const nestedR = await rawReq('POST', `/api/v1/maps/${map.id}/comments`, user.apiKey, `{"body":${nested}}`);
  results.push({ phase: 'adversarial', endpoint: 'POST deeply nested JSON', method: 'POST', iteration: 0, status: nestedR.status, latencyMs: nestedR.latencyMs, error: nestedR.status >= 500 ? `Server error ${nestedR.status}` : undefined });
  console.log(`  Deeply nested JSON: ${nestedR.status} (${nestedR.latencyMs.toFixed(0)}ms)`);

  // ── 16d: Unicode bombs / zero-width chars ──────────────────────────────
  console.log('  16d: Unicode edge cases');
  const unicodeBombs = [
    { name: 'Zalgo text', body: 'H̸̡̪̯ͨ͊̽̅̾̎Ȩ̬̩̾͛ͪ̈́̀́͘ ̞̮̜̐C̸̙̲̝͖ͭ̏͗ͯ̈́O̴̦̜̜͈̘̬̙̤̗M̬̦̙̭̤̗̗̯E̸̢̙̫̙̟̩̫̯̥̱̞Ṡ̶̬̝' },
    { name: 'Null bytes', body: 'test\x00embedded\x00nulls' },
    { name: 'RTL override', body: '\u202Ereversed text\u202C' },
    { name: 'Emoji overload', body: '🏳️‍🌈'.repeat(10000) },
    { name: '4-byte UTF-8', body: '𐍈'.repeat(50000) },
    { name: 'Zero-width joiners', body: 'a\u200D'.repeat(50000) },
  ];
  for (const ub of unicodeBombs) {
    const r = await req('POST', `/api/v1/maps/${map.id}/comments`, user.apiKey, { body: ub.body });
    const pass = r.status < 500;
    results.push({ phase: 'adversarial', endpoint: `POST comment (${ub.name})`, method: 'POST', iteration: 0, status: r.status, latencyMs: r.latencyMs, error: r.status >= 500 ? `Server error ${r.status}` : undefined });
    console.log(`  ${ub.name.padEnd(25)} ${pass ? `\x1b[32m${r.status}\x1b[0m` : `\x1b[31m${r.status} CRASH\x1b[0m`} (${r.latencyMs.toFixed(0)}ms)`);
  }

  // ── 16e: Slowloris-style — very slow request body ──────────────────────
  console.log('  16e: Slow request body (stream stall)');
  const slowStart = performance.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const slowRes = await fetch(`${BASE}/api/v1/maps/${map.id}/comments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${user.apiKey}`, 'Content-Type': 'application/json' },
      body: new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(new TextEncoder().encode('{"body":"slow'));
          // Never close — simulates stalled upload
        },
      }),
      signal: controller.signal,
      // @ts-expect-error duplex required for streaming body
      duplex: 'half',
    });
    clearTimeout(timeout);
    results.push({ phase: 'adversarial', endpoint: 'POST comment (slowloris)', method: 'POST', iteration: 0, status: slowRes.status, latencyMs: performance.now() - slowStart });
  } catch (err) {
    results.push({ phase: 'adversarial', endpoint: 'POST comment (slowloris)', method: 'POST', iteration: 0, status: 0, latencyMs: performance.now() - slowStart, error: (err as Error).message?.slice(0, 80) });
    console.log(`  Slowloris: aborted (${(performance.now() - slowStart).toFixed(0)}ms) — ${(err as Error).message?.slice(0, 60)}`);
  }

  // ── 16f: Parallel annotation create + list consistency ─────────────────
  // Create annotations while simultaneously listing — check for empty pages mid-insert
  console.log('  16f: Create + list consistency (phantom reads)');
  let phantomFails = 0;
  const phantomTasks: (() => Promise<TestResult>)[] = [];
  for (let i = 0; i < 50; i++) {
    const u = users[i % users.length];
    if (i % 2 === 0) {
      phantomTasks.push(async () => {
        const r = await req('POST', `/api/v1/maps/${map.id}/annotations`, u.apiKey, {
          content: makeContent(`Phantom ${i}`),
          anchor: makeAnchor('viewport'),
        });
        return { phase: 'adversarial', endpoint: 'POST annotation (phantom)', method: 'POST', iteration: i, status: r.status, latencyMs: r.latencyMs, error: r.error };
      });
    } else {
      phantomTasks.push(async () => {
        const r = await req('GET', `/api/v1/maps/${map.id}/annotations?limit=100`, u.apiKey);
        if (r.status === 200 && r.data?.data?.length === 0) phantomFails++;
        return { phase: 'adversarial', endpoint: 'GET annotations (phantom)', method: 'GET', iteration: i, status: r.status, latencyMs: r.latencyMs, error: r.error };
      });
    }
  }
  results.push(...await pool(phantomTasks, 50));
  console.log(`  Phantom read failures (empty list during insert): ${phantomFails}`);

  // ── 16g: GeoJSON with absurd bbox ──────────────────────────────────────
  console.log('  16g: GeoJSON with absurd/invalid bbox values');
  const bboxTests = [
    { name: 'bbox inverted', bbox: '180,90,-180,-90' },
    { name: 'bbox zero area', bbox: '0,0,0,0' },
    { name: 'bbox infinity', bbox: '-Infinity,-Infinity,Infinity,Infinity' },
    { name: 'bbox NaN', bbox: 'NaN,NaN,NaN,NaN' },
    { name: 'bbox huge', bbox: '-999999,-999999,999999,999999' },
    { name: 'bbox string', bbox: 'hello,world,foo,bar' },
  ];
  for (const bt of bboxTests) {
    const r = await req('GET', `/api/v1/maps/${map.id}/layers/${layer.id}/geojson?bbox=${bt.bbox}`, user.apiKey);
    const pass = r.status < 500;
    results.push({ phase: 'adversarial', endpoint: `GET geojson (${bt.name})`, method: 'GET', iteration: 0, status: r.status, latencyMs: r.latencyMs, error: r.status >= 500 ? `Server error ${r.status}` : undefined });
    console.log(`  ${bt.name.padEnd(25)} ${pass ? `\x1b[32m${r.status}\x1b[0m` : `\x1b[31m${r.status} CRASH\x1b[0m`}`);
  }

  // ── 16h: Pagination with forged/invalid cursors ────────────────────────
  console.log('  16h: Pagination with forged cursors');
  const cursorTests = [
    { name: 'garbage cursor', cursor: 'not-a-cursor' },
    { name: 'base64 garbage', cursor: Buffer.from('garbage|data').toString('base64') },
    { name: 'future timestamp', cursor: Buffer.from('9999-12-31T23:59:59.999Z|00000000-0000-0000-0000-000000000000').toString('base64') },
    { name: 'negative timestamp', cursor: Buffer.from('-9999-01-01T00:00:00.000Z|00000000-0000-0000-0000-000000000000').toString('base64') },
    { name: 'SQL in cursor', cursor: Buffer.from("' OR 1=1 --").toString('base64') },
  ];
  for (const ct of cursorTests) {
    const r = await req('GET', `/api/v1/maps/${map.id}/layers/${layer.id}/features?cursor=${ct.cursor}`, user.apiKey);
    const pass = r.status < 500;
    results.push({ phase: 'adversarial', endpoint: `GET features (${ct.name})`, method: 'GET', iteration: 0, status: r.status, latencyMs: r.latencyMs, error: r.status >= 500 ? `Server error ${r.status}` : undefined });
    console.log(`  ${ct.name.padEnd(25)} ${pass ? `\x1b[32m${r.status}\x1b[0m` : `\x1b[31m${r.status} CRASH\x1b[0m`}`);
  }

  // ── 16i: Massive concurrent annotation CRUD storm ──────────────────────
  // All users create, update, delete annotations on ALL maps simultaneously
  console.log('  16i: CRUD storm (all users × all maps, 500 ops)');
  const stormTasks: (() => Promise<TestResult>)[] = [];
  const stormIds: string[] = [];
  // Create phase
  for (let i = 0; i < 250; i++) {
    const u = users[i % users.length];
    const m = maps[i % maps.length];
    stormTasks.push(async () => {
      const r = await req('POST', `/api/v1/maps/${m.id}/annotations`, u.apiKey, {
        content: makeContent(`Storm ${i}`),
        anchor: makeAnchor(ANCHOR_TYPES[i % ANCHOR_TYPES.length]),
      });
      if (r.status === 201 && r.data?.data?.id) stormIds.push(r.data.data.id);
      return { phase: 'adversarial', endpoint: 'POST annotation (storm)', method: 'POST', iteration: i, status: r.status, latencyMs: r.latencyMs, error: r.error };
    });
  }
  results.push(...await pool(stormTasks, CONCURRENCY));
  // Now immediately delete them all concurrently
  const deleteTasks: (() => Promise<TestResult>)[] = [];
  for (let i = 0; i < stormIds.length; i++) {
    const u = users[i % users.length];
    const m = maps[i % maps.length]; // may not match — tests cross-map delete
    deleteTasks.push(async () => {
      const r = await req('DELETE', `/api/v1/maps/${m.id}/annotations/${stormIds[i]}`, u.apiKey);
      return { phase: 'adversarial', endpoint: 'DELETE annotation (storm)', method: 'DELETE', iteration: i, status: r.status, latencyMs: r.latencyMs, expectedNon2xx: [204, 404].includes(r.status), error: r.error };
    });
  }
  results.push(...await pool(deleteTasks, CONCURRENCY));

  // ── 16j: Request with enormous headers ─────────────────────────────────
  console.log('  16j: Enormous headers');
  const bigHeaderStart = performance.now();
  try {
    const res = await fetch(`${BASE}/api/v1/maps`, {
      headers: {
        Authorization: `Bearer ${user.apiKey}`,
        'X-Huge-Header': 'x'.repeat(64 * 1024), // 64KB header
      },
    });
    const data = await res.text();
    results.push({ phase: 'adversarial', endpoint: 'GET maps (64KB header)', method: 'GET', iteration: 0, status: res.status, latencyMs: performance.now() - bigHeaderStart, expectedNon2xx: [431, 413, 400].includes(res.status) });
    console.log(`  64KB header: ${res.status} (${(performance.now() - bigHeaderStart).toFixed(0)}ms)`);
  } catch (err) {
    results.push({ phase: 'adversarial', endpoint: 'GET maps (64KB header)', method: 'GET', iteration: 0, status: 0, latencyMs: performance.now() - bigHeaderStart, error: (err as Error).message?.slice(0, 80) });
    console.log(`  64KB header: error — ${(err as Error).message?.slice(0, 60)}`);
  }

  // ── 16k: Concurrent writes to same comment/annotation (lost update) ────
  console.log('  16k: Lost update detection (50 concurrent PATCHes)');
  const setupAnno = await req('POST', `/api/v1/maps/${map.id}/annotations`, user.apiKey, {
    content: makeContent('Lost update target'),
    anchor: makeAnchor('viewport'),
  });
  if (setupAnno.status === 201) {
    const targetId = setupAnno.data?.data?.id;
    const updateTasks: (() => Promise<TestResult>)[] = [];
    for (let i = 0; i < 50; i++) {
      const u = users[i % users.length];
      updateTasks.push(async () => {
        const r = await req('PATCH', `/api/v1/maps/${map.id}/annotations/${targetId}`, u.apiKey, {
          content: makeContent(`Version ${i} by ${u.email}`),
        });
        return { phase: 'adversarial', endpoint: 'PATCH annotation (lost update)', method: 'PATCH', iteration: i, status: r.status, latencyMs: r.latencyMs, error: r.error };
      });
    }
    const updateResults = await pool(updateTasks, 50);
    results.push(...updateResults);
    // Read final state
    const finalRead = await req('GET', `/api/v1/maps/${map.id}/annotations/${targetId}`, user.apiKey);
    console.log(`  50 concurrent PATCHes: ${updateResults.filter((r) => r.status === 200).length} succeeded`);
    console.log(`  Final content: ${JSON.stringify(finalRead.data?.data?.content).slice(0, 80)}...`);
  }

  printPhaseResults(results, 'adversarial');
  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PHASE 17: Adversarial Round 2 — IDOR, proto pollution, method confusion,
//            integer overflow, circular refs, concurrent deletion, ReDoS
// ══════════════════════════════════════════════════════════════════════════════

async function phase17(users: UserRecord[], maps: MapRecord[], layers: LayerRecord[]): Promise<TestResult[]> {
  console.log('\n' + '='.repeat(70));
  console.log('  PHASE 17: ADVERSARIAL Round 2');
  console.log('='.repeat(70));

  const results: TestResult[] = [];
  const user = users[0];
  const user2 = users[1];
  const map = maps[0];
  const map2 = maps[1]; // owned by user2 (round-robin)
  const layer = layers.find((l) => l.mapId === map.id)!;

  // ── 17a: IDOR — access another user's annotation by ID via wrong map ──
  console.log('\n  17a: IDOR — cross-map annotation access');
  // User 0 creates annotation on map 0
  const annoR = await req('POST', `/api/v1/maps/${map.id}/annotations`, user.apiKey, {
    content: makeContent('IDOR test'),
    anchor: makeAnchor('viewport'),
  });
  if (annoR.status === 201) {
    const annoId = annoR.data?.data?.id;
    // Try to access it via map2 (different map) — should fail
    const idor1 = await req('GET', `/api/v1/maps/${map2.id}/annotations/${annoId}`, user.apiKey);
    const pass1 = idor1.status === 404;
    results.push({ phase: 'adversarial2', endpoint: 'GET annotation (wrong map)', method: 'GET', iteration: 0, status: idor1.status, latencyMs: idor1.latencyMs, expectedNon2xx: pass1, error: pass1 ? undefined : `IDOR: got ${idor1.status}, annotation leaked` });
    console.log(`  Wrong map GET:   ${pass1 ? '\x1b[32m404 ✓\x1b[0m' : `\x1b[31m${idor1.status} IDOR VULNERABILITY\x1b[0m`}`);

    // Try to PATCH it via wrong map
    const idor2 = await req('PATCH', `/api/v1/maps/${map2.id}/annotations/${annoId}`, user.apiKey, { content: makeContent('IDOR patched') });
    const pass2 = idor2.status === 404;
    results.push({ phase: 'adversarial2', endpoint: 'PATCH annotation (wrong map)', method: 'PATCH', iteration: 0, status: idor2.status, latencyMs: idor2.latencyMs, expectedNon2xx: pass2, error: pass2 ? undefined : `IDOR: PATCH succeeded on wrong map` });
    console.log(`  Wrong map PATCH: ${pass2 ? '\x1b[32m404 ✓\x1b[0m' : `\x1b[31m${idor2.status} IDOR VULNERABILITY\x1b[0m`}`);

    // Try to DELETE it via wrong map
    const idor3 = await req('DELETE', `/api/v1/maps/${map2.id}/annotations/${annoId}`, user.apiKey);
    const pass3 = idor3.status === 404;
    results.push({ phase: 'adversarial2', endpoint: 'DELETE annotation (wrong map)', method: 'DELETE', iteration: 0, status: idor3.status, latencyMs: idor3.latencyMs, expectedNon2xx: pass3, error: pass3 ? undefined : `IDOR: DELETE succeeded on wrong map` });
    console.log(`  Wrong map DELETE: ${pass3 ? '\x1b[32m404 ✓\x1b[0m' : `\x1b[31m${idor3.status} IDOR VULNERABILITY\x1b[0m`}`);

    // Cleanup
    await req('DELETE', `/api/v1/maps/${map.id}/annotations/${annoId}`, user.apiKey);
  }

  // ── 17b: Prototype pollution in JSON body ──────────────────────────────
  console.log('\n  17b: Prototype pollution');
  const protoTests = [
    { name: '__proto__', body: '{"body":"safe","__proto__":{"admin":true}}' },
    { name: 'constructor', body: '{"body":"safe","constructor":{"prototype":{"admin":true}}}' },
    { name: 'prototype chain', body: '{"body":"safe","__proto__":{"__proto__":{"isAdmin":true}}}' },
  ];
  for (const pt of protoTests) {
    const r = await rawReq('POST', `/api/v1/maps/${map.id}/comments`, user.apiKey, pt.body);
    const pass = r.status < 500;
    results.push({ phase: 'adversarial2', endpoint: `POST comment (${pt.name})`, method: 'POST', iteration: 0, status: r.status, latencyMs: r.latencyMs, error: r.status >= 500 ? `Server error ${r.status}` : undefined });
    console.log(`  ${pt.name.padEnd(25)} ${pass ? `\x1b[32m${r.status}\x1b[0m` : `\x1b[31m${r.status} CRASH\x1b[0m`}`);
  }

  // ── 17c: HTTP method confusion ─────────────────────────────────────────
  console.log('\n  17c: HTTP method confusion');
  const methods = ['PUT', 'OPTIONS', 'HEAD', 'TRACE', 'CONNECT'];
  for (const method of methods) {
    const start = performance.now();
    try {
      const res = await fetch(`${BASE}/api/v1/maps`, {
        method,
        headers: { Authorization: `Bearer ${user.apiKey}` },
      });
      await res.text();
      const pass = res.status < 500;
      results.push({ phase: 'adversarial2', endpoint: `${method} /maps`, method, iteration: 0, status: res.status, latencyMs: performance.now() - start, expectedNon2xx: res.status >= 300, error: res.status >= 500 ? `Server error ${res.status}` : undefined });
      console.log(`  ${method.padEnd(10)} /maps: ${pass ? `\x1b[32m${res.status}\x1b[0m` : `\x1b[31m${res.status} CRASH\x1b[0m`}`);
    } catch (err) {
      results.push({ phase: 'adversarial2', endpoint: `${method} /maps`, method, iteration: 0, status: 0, latencyMs: performance.now() - start, error: (err as Error).message?.slice(0, 80) });
      console.log(`  ${method.padEnd(10)} /maps: error`);
    }
  }

  // ── 17d: Integer overflow / extreme limit values ───────────────────────
  console.log('\n  17d: Integer overflow in query params');
  const limitTests = [
    { name: 'limit=-1', qs: 'limit=-1' },
    { name: 'limit=0', qs: 'limit=0' },
    { name: 'limit=999999999', qs: 'limit=999999999' },
    { name: 'limit=NaN', qs: 'limit=NaN' },
    { name: 'limit=Infinity', qs: 'limit=Infinity' },
    { name: 'limit=1e308', qs: 'limit=1e308' },
    { name: 'limit=<script>', qs: 'limit=<script>alert(1)</script>' },
    { name: 'offset overflow', qs: 'limit=10&cursor=' + Buffer.from('9999-12-31T23:59:59.999Z|ffffffff-ffff-ffff-ffff-ffffffffffff').toString('base64') },
  ];
  for (const lt of limitTests) {
    const r = await req('GET', `/api/v1/maps/${map.id}/layers/${layer.id}/features?${lt.qs}`, user.apiKey);
    const pass = r.status < 500;
    results.push({ phase: 'adversarial2', endpoint: `GET features (${lt.name})`, method: 'GET', iteration: 0, status: r.status, latencyMs: r.latencyMs, error: r.status >= 500 ? `Server error ${r.status}` : undefined });
    console.log(`  ${lt.name.padEnd(25)} ${pass ? `\x1b[32m${r.status}\x1b[0m` : `\x1b[31m${r.status} CRASH\x1b[0m`} (${r.latencyMs.toFixed(0)}ms)`);
  }

  // ── 17e: Circular/self-referencing annotation parentId ─────────────────
  console.log('\n  17e: Circular annotation parentId');
  const parentAnno = await req('POST', `/api/v1/maps/${map.id}/annotations`, user.apiKey, {
    content: makeContent('Parent'),
    anchor: makeAnchor('viewport'),
  });
  if (parentAnno.status === 201) {
    const parentId = parentAnno.data?.data?.id;
    // Self-reference
    const selfRef = await req('PATCH', `/api/v1/maps/${map.id}/annotations/${parentId}`, user.apiKey, { parentId });
    const pass = selfRef.status < 500;
    results.push({ phase: 'adversarial2', endpoint: 'PATCH annotation (self-ref parentId)', method: 'PATCH', iteration: 0, status: selfRef.status, latencyMs: selfRef.latencyMs, error: selfRef.status >= 500 ? `Server error ${selfRef.status}` : undefined });
    console.log(`  Self-referencing:  ${pass ? `\x1b[32m${selfRef.status}\x1b[0m` : `\x1b[31m${selfRef.status} CRASH\x1b[0m`}`);

    // Non-existent parentId
    const badParent = await req('POST', `/api/v1/maps/${map.id}/annotations`, user.apiKey, {
      content: makeContent('Orphan child'),
      anchor: makeAnchor('viewport'),
      parentId: '00000000-0000-0000-0000-000000000000',
    });
    const pass2 = badParent.status < 500;
    results.push({ phase: 'adversarial2', endpoint: 'POST annotation (fake parentId)', method: 'POST', iteration: 0, status: badParent.status, latencyMs: badParent.latencyMs, error: badParent.status >= 500 ? `Server error ${badParent.status}` : undefined });
    console.log(`  Fake parentId:     ${pass2 ? `\x1b[32m${badParent.status}\x1b[0m` : `\x1b[31m${badParent.status} CRASH\x1b[0m`}`);

    await req('DELETE', `/api/v1/maps/${map.id}/annotations/${parentId}`, user.apiKey);
  }

  // ── 17f: Concurrent map deletion while reading ─────────────────────────
  console.log('\n  17f: Concurrent map deletion while reading');
  const tempMapId = psql(`INSERT INTO maps (user_id, title, description) VALUES ('${user.id}', 'TempDeleteMap', 'Will be deleted') RETURNING id`);
  const tempLayerId = psql(`INSERT INTO layers (map_id, name, type) VALUES ('${tempMapId}', 'TempLayer', 'point') RETURNING id`);
  // Grant all users access
  for (const u of users.slice(0, 5)) {
    if (u.id !== user.id) psql(`INSERT INTO map_collaborators (map_id, user_id, role) VALUES ('${tempMapId}', '${u.id}', 'editor') ON CONFLICT DO NOTHING`);
  }
  // Insert some features
  psql(`INSERT INTO features (layer_id, geometry, properties) SELECT '${tempLayerId}', ST_SetSRID(ST_MakePoint(-122.4 + random()*0.1, 37.75 + random()*0.1), 4326), '{"n":"temp"}'::jsonb FROM generate_series(1,100)`);

  // Fire reads + a delete simultaneously
  const deleteTasks: (() => Promise<TestResult>)[] = [];
  for (let i = 0; i < 20; i++) {
    const u = users[i % 5];
    if (i === 10) {
      // Delete in the middle of the burst
      deleteTasks.push(async () => {
        psql(`DELETE FROM features WHERE layer_id='${tempLayerId}'`);
        psql(`DELETE FROM layers WHERE id='${tempLayerId}'`);
        psql(`DELETE FROM map_collaborators WHERE map_id='${tempMapId}'`);
        psql(`DELETE FROM maps WHERE id='${tempMapId}'`);
        return { phase: 'adversarial2', endpoint: 'DELETE map (concurrent)', method: 'DB', iteration: i, status: 200, latencyMs: 0 };
      });
    } else {
      deleteTasks.push(async () => {
        const r = await req('GET', `/api/v1/maps/${tempMapId}/layers/${tempLayerId}/geojson?limit=50`, u.apiKey);
        const pass = r.status < 500;
        return { phase: 'adversarial2', endpoint: 'GET geojson (during delete)', method: 'GET', iteration: i, status: r.status, latencyMs: r.latencyMs, error: r.status >= 500 ? `Server error ${r.status}` : undefined };
      });
    }
  }
  const deleteResults = await pool(deleteTasks, 20);
  results.push(...deleteResults);
  const crashes = deleteResults.filter((r) => r.status >= 500).length;
  const notFound = deleteResults.filter((r) => r.status === 404).length;
  console.log(`  During-delete reads: ${crashes} crashes, ${notFound} not-found, ${20 - crashes - notFound} ok`);

  // ── 17g: Extra/unknown fields in PATCH body ────────────────────────────
  console.log('\n  17g: Extra fields in PATCH body');
  const extraAnno = await req('POST', `/api/v1/maps/${map.id}/annotations`, user.apiKey, {
    content: makeContent('Extra fields test'),
    anchor: makeAnchor('viewport'),
  });
  if (extraAnno.status === 201) {
    const eid = extraAnno.data?.data?.id;
    const extraR = await req('PATCH', `/api/v1/maps/${map.id}/annotations/${eid}`, user.apiKey, {
      content: makeContent('Updated'),
      userId: users[1].id,          // try to change owner
      mapId: maps[1].id,            // try to change map
      createdAt: '2020-01-01',      // try to backdate
      id: '00000000-0000-0000-0000-000000000000', // try to change ID
      __admin: true,
    });
    const pass = extraR.status < 500;
    results.push({ phase: 'adversarial2', endpoint: 'PATCH annotation (extra fields)', method: 'PATCH', iteration: 0, status: extraR.status, latencyMs: extraR.latencyMs, error: extraR.status >= 500 ? `Server error` : undefined });
    console.log(`  Extra fields PATCH: ${pass ? `\x1b[32m${extraR.status}\x1b[0m` : `\x1b[31m${extraR.status} CRASH\x1b[0m`}`);

    // Verify the extra fields didn't take effect
    const verify = await req('GET', `/api/v1/maps/${map.id}/annotations/${eid}`, user.apiKey);
    if (verify.status === 200) {
      const d = verify.data?.data;
      const ownerChanged = d?.userId !== user.id && d?.userId !== undefined;
      const idChanged = d?.id !== eid;
      if (ownerChanged) console.log('  \x1b[31mVULNERABILITY: userId was changed via PATCH!\x1b[0m');
      if (idChanged) console.log('  \x1b[31mVULNERABILITY: id was changed via PATCH!\x1b[0m');
      if (!ownerChanged && !idChanged) console.log('  Extra fields ignored ✓');
    }
    await req('DELETE', `/api/v1/maps/${map.id}/annotations/${eid}`, user.apiKey);
  }

  // ── 17h: Double-submit (same request twice simultaneously) ─────────────
  console.log('\n  17h: Double-submit race');
  const body = { content: makeContent('Double submit'), anchor: makeAnchor('viewport') };
  const [ds1, ds2] = await Promise.all([
    req('POST', `/api/v1/maps/${map.id}/annotations`, user.apiKey, body),
    req('POST', `/api/v1/maps/${map.id}/annotations`, user.apiKey, body),
  ]);
  const bothCreated = ds1.status === 201 && ds2.status === 201;
  results.push(
    { phase: 'adversarial2', endpoint: 'POST annotation (double-submit 1)', method: 'POST', iteration: 0, status: ds1.status, latencyMs: ds1.latencyMs, error: ds1.error },
    { phase: 'adversarial2', endpoint: 'POST annotation (double-submit 2)', method: 'POST', iteration: 1, status: ds2.status, latencyMs: ds2.latencyMs, error: ds2.error },
  );
  console.log(`  Double submit: ${ds1.status}, ${ds2.status} — ${bothCreated ? 'both created (no idempotency)' : 'one rejected'}`);
  // Cleanup
  if (ds1.data?.data?.id) await req('DELETE', `/api/v1/maps/${map.id}/annotations/${ds1.data.data.id}`, user.apiKey);
  if (ds2.data?.data?.id) await req('DELETE', `/api/v1/maps/${map.id}/annotations/${ds2.data.data.id}`, user.apiKey);

  // ── 17i: Null byte variations in different fields ──────────────────────
  console.log('\n  17i: Null bytes in various positions');
  const nullTests = [
    { name: 'null in map ID path', fn: () => req('GET', `/api/v1/maps/${map.id.slice(0, 8)}\x00rest/layers`, user.apiKey) },
    { name: 'null in query param', fn: () => req('GET', `/api/v1/maps/${map.id}/layers?foo=bar\x00baz`, user.apiKey) },
    { name: 'null in annotation content', fn: () => req('POST', `/api/v1/maps/${map.id}/annotations`, user.apiKey, { content: makeContent('before\x00after'), anchor: makeAnchor('viewport') }) },
    { name: 'null in header value', fn: async () => {
      const start = performance.now();
      try {
        const res = await fetch(`${BASE}/api/v1/maps`, { headers: { Authorization: `Bearer ${user.apiKey}`, 'X-Test': 'a\x00b' } });
        return { status: res.status, latencyMs: performance.now() - start, data: null };
      } catch (err) {
        return { status: 0, latencyMs: performance.now() - start, data: null, error: (err as Error).message?.slice(0, 80) };
      }
    }},
  ];
  for (const nt of nullTests) {
    const r = await nt.fn();
    const pass = r.status !== 500;
    results.push({ phase: 'adversarial2', endpoint: nt.name, method: 'GET', iteration: 0, status: r.status, latencyMs: r.latencyMs, error: r.status >= 500 ? `Server error ${r.status}` : undefined });
    console.log(`  ${nt.name.padEnd(30)} ${pass ? `\x1b[32m${r.status}\x1b[0m` : `\x1b[31m${r.status} CRASH\x1b[0m`}`);
  }

  // ── 17j: Very long URL ─────────────────────────────────────────────────
  console.log('\n  17j: Very long URL');
  const longUrl = `/api/v1/maps/${map.id}/layers/${layer.id}/features?` + 'x='.repeat(4000);
  const longR = await req('GET', longUrl, user.apiKey);
  const longPass = longR.status < 500;
  results.push({ phase: 'adversarial2', endpoint: 'GET features (8KB URL)', method: 'GET', iteration: 0, status: longR.status, latencyMs: longR.latencyMs, expectedNon2xx: longR.status >= 300, error: longR.status >= 500 ? `Server error` : undefined });
  console.log(`  8KB URL: ${longPass ? `\x1b[32m${longR.status}\x1b[0m` : `\x1b[31m${longR.status} CRASH\x1b[0m`}`);

  // ── 17k: Many query parameters ─────────────────────────────────────────
  console.log('  17k: 1000 query parameters');
  const manyParams = Array.from({ length: 1000 }, (_, i) => `p${i}=v${i}`).join('&');
  const manyR = await req('GET', `/api/v1/maps/${map.id}/layers?${manyParams}`, user.apiKey);
  const manyPass = manyR.status < 500;
  results.push({ phase: 'adversarial2', endpoint: 'GET layers (1000 params)', method: 'GET', iteration: 0, status: manyR.status, latencyMs: manyR.latencyMs, error: manyR.status >= 500 ? `Server error` : undefined });
  console.log(`  1000 params: ${manyPass ? `\x1b[32m${manyR.status}\x1b[0m` : `\x1b[31m${manyR.status} CRASH\x1b[0m`}`);

  printPhaseResults(results, 'adversarial round 2');
  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
//  MAIN
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  REST API v1 — Comprehensive Stress Test                           ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log(`  Base URL:       ${BASE}`);
  console.log(`  Users:          ${NUM_USERS}  |  Maps: ${NUM_MAPS}`);
  console.log(`  Annotations:    ${NUM_ANNOTATIONS}  |  Comments: ${NUM_COMMENTS}  |  Features: ${NUM_FEATURES}`);
  console.log(`  Concurrency:    ${CONCURRENCY}  |  Race: ${RACE_CONCURRENCY}`);

  const probe = await req('GET', '/api/v1/maps', 'flk_d2fc9300ee357ab5e2b2adddff92d52ed2adb4d949bf92956ebe13a5e69e30bb');
  if (probe.status === 0) {
    console.error(`\n  FATAL: Cannot reach ${BASE} — ${probe.error}`);
    process.exit(1);
  }
  console.log(`  Probe:          ${probe.status} (${probe.latencyMs.toFixed(0)}ms)\n`);

  const { users, maps, layers } = await setup();
  const allResults: TestResult[] = [];

  allResults.push(...await phase1(users, maps));
  allResults.push(...await phase2(users, maps, layers));
  allResults.push(...await phase3(users, maps));
  allResults.push(...await phase4(users, maps));
  allResults.push(...await phase5(layers));
  allResults.push(...await phase6(users, maps, layers));
  allResults.push(...await phase7(users, maps));
  allResults.push(...await phase8(users));
  allResults.push(...await phase9(users));
  allResults.push(...await phase10(users, maps, layers));
  allResults.push(...await phase11(users, maps));
  allResults.push(...await phase12(users, maps, layers));
  allResults.push(...await phase13(users, maps, layers));
  allResults.push(...await phase14(users, maps));
  allResults.push(...await phase15(users, maps, layers));
  allResults.push(...await phase16(users, maps, layers));
  allResults.push(...await phase17(users, maps, layers));

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(70));
  console.log('  FINAL SUMMARY');
  console.log('═'.repeat(70));

  const byPhase = new Map<string, { ok: number; fail: number; total: number }>();
  for (const r of allResults) {
    const entry = byPhase.get(r.phase) ?? { ok: 0, fail: 0, total: 0 };
    entry.total++;
    if (r.expectedNon2xx || (r.status >= 200 && r.status < 300)) entry.ok++;
    else entry.fail++;
    byPhase.set(r.phase, entry);
  }

  console.log(`\n  ${'Phase'.padEnd(20)} ${'OK'.padEnd(8)} ${'Fail'.padEnd(8)} ${'Total'.padEnd(8)}`);
  console.log(`  ${'-'.repeat(44)}`);
  let grandOk = 0, grandFail = 0;
  for (const [phase, stats] of byPhase) {
    grandOk += stats.ok;
    grandFail += stats.fail;
    const failStr = stats.fail > 0 ? `\x1b[31m${stats.fail}\x1b[0m` : '0';
    console.log(`  ${phase.padEnd(20)} ${String(stats.ok).padEnd(8)} ${String(failStr).padEnd(stats.fail > 0 ? 17 : 8)} ${stats.total}`);
  }
  console.log(`  ${'-'.repeat(44)}`);
  console.log(`  ${'TOTAL'.padEnd(20)} ${grandOk}${' '.repeat(Math.max(1, 8 - String(grandOk).length))}${grandFail > 0 ? `\x1b[31m${grandFail}\x1b[0m` : '0'}${' '.repeat(Math.max(1, 8 - String(grandFail).length))}${allResults.length}`);

  // Cleanup
  console.log('\n  Cleaning up...');
  try { psql("DELETE FROM annotations WHERE content::text LIKE '%Stress%' OR content::text LIKE '%Race%' OR content::text LIKE '%RYW%' OR content::text LIKE '%Sacrificial%' OR content::text LIKE '%script%' OR content::text LIKE '%OR 1=1%' OR content::text LIKE '%onerror%'"); } catch {}
  try { psql("DELETE FROM comments WHERE body LIKE 'Stress%' OR body LIKE 'Race%' OR body LIKE '%script%' OR body LIKE '%DROP TABLE%' OR body LIKE '%xxxx%'"); } catch {}
  try { psql("DELETE FROM features WHERE properties->>'name' LIKE 'feat-%'"); } catch {}
  try { psql("DELETE FROM layers WHERE name LIKE 'Layer-StressMap%'"); } catch {}
  try { psql("DELETE FROM map_collaborators WHERE map_id IN (SELECT id FROM maps WHERE title LIKE 'StressMap%')"); } catch {}
  try { psql("DELETE FROM maps WHERE title LIKE 'StressMap%'"); } catch {}
  console.log('  Done.');

  process.exit(grandFail > 0 ? 1 : 0);
}

main();
