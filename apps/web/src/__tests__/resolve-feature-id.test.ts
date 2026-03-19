// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolveFeatureId } from '$lib/utils/resolve-feature-id.js';

const UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const UUID_B = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const UUID_C = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const NUMERIC_ID = '12345';

// ── source patterns ──────────────────────────────────────────────────────────

describe('resolveFeatureId — GeoJSON source pattern (properties._id)', () => {
  it('resolves UUID from properties._id', () => {
    const feat = { properties: { _id: UUID_A } };
    expect(resolveFeatureId(feat)).toBe(UUID_A);
  });

  it('returns null when properties._id is a numeric tile ID string', () => {
    const feat = { properties: { _id: NUMERIC_ID } };
    expect(resolveFeatureId(feat)).toBeNull();
  });
});

describe('resolveFeatureId — Martin vector tile pattern (properties.id)', () => {
  it('resolves UUID from properties.id', () => {
    const feat = { properties: { id: UUID_B } };
    expect(resolveFeatureId(feat)).toBe(UUID_B);
  });

  it('returns null when properties.id is a numeric tile ID string', () => {
    const feat = { properties: { id: NUMERIC_ID } };
    expect(resolveFeatureId(feat)).toBeNull();
  });
});

describe('resolveFeatureId — feat.id fallback', () => {
  it('resolves UUID from feat.id when properties has no UUID', () => {
    const feat = { id: UUID_C, properties: {} };
    expect(resolveFeatureId(feat)).toBe(UUID_C);
  });

  it('returns null when feat.id is a non-UUID string', () => {
    const feat = { id: NUMERIC_ID, properties: {} };
    expect(resolveFeatureId(feat)).toBeNull();
  });

  it('returns null when feat.id is a number (MapLibre numeric tile ID)', () => {
    const feat = { id: 42, properties: {} };
    expect(resolveFeatureId(feat)).toBeNull();
  });
});

// ── priority ─────────────────────────────────────────────────────────────────

describe('resolveFeatureId — priority: _id > id > feat.id', () => {
  it('prefers properties._id over properties.id', () => {
    const feat = { properties: { _id: UUID_A, id: UUID_B }, id: UUID_C };
    expect(resolveFeatureId(feat)).toBe(UUID_A);
  });

  it('prefers properties.id over feat.id when _id is absent', () => {
    const feat = { properties: { id: UUID_B }, id: UUID_C };
    expect(resolveFeatureId(feat)).toBe(UUID_B);
  });

  it('falls back to feat.id when _id and id are absent', () => {
    const feat = { properties: {}, id: UUID_C };
    expect(resolveFeatureId(feat)).toBe(UUID_C);
  });

  it('skips invalid _id and resolves from properties.id', () => {
    const feat = { properties: { _id: NUMERIC_ID, id: UUID_B }, id: UUID_C };
    expect(resolveFeatureId(feat)).toBe(UUID_B);
  });

  it('skips invalid _id and id, resolves from feat.id', () => {
    const feat = { properties: { _id: NUMERIC_ID, id: NUMERIC_ID }, id: UUID_C };
    expect(resolveFeatureId(feat)).toBe(UUID_C);
  });
});

// ── null / missing cases ─────────────────────────────────────────────────────

describe('resolveFeatureId — returns null when no valid UUID exists', () => {
  it('returns null when all three levels have numeric IDs', () => {
    const feat = { properties: { _id: NUMERIC_ID, id: NUMERIC_ID }, id: NUMERIC_ID };
    expect(resolveFeatureId(feat)).toBeNull();
  });

  it('returns null when properties and feat.id are all absent', () => {
    const feat = { properties: {} };
    expect(resolveFeatureId(feat)).toBeNull();
  });

  it('returns null when feat has no properties and no id', () => {
    expect(resolveFeatureId({})).toBeNull();
  });
});

// ── edge cases ───────────────────────────────────────────────────────────────

describe('resolveFeatureId — edge cases', () => {
  it('handles properties: null gracefully', () => {
    const feat = { id: UUID_A, properties: null };
    expect(resolveFeatureId(feat)).toBe(UUID_A);
  });

  it('handles properties: null with no feat.id', () => {
    const feat: { id?: string; properties: null } = { properties: null };
    expect(resolveFeatureId(feat)).toBeNull();
  });

  it('handles properties: empty object', () => {
    const feat = { properties: {} };
    expect(resolveFeatureId(feat)).toBeNull();
  });

  it('handles properties: undefined (omitted field)', () => {
    const feat: { id?: string } = {};
    expect(resolveFeatureId(feat)).toBeNull();
  });

  it('accepts uppercase UUID hex digits (case-insensitive validation)', () => {
    const upper = UUID_A.toUpperCase();
    const feat = { properties: { _id: upper } };
    expect(resolveFeatureId(feat)).toBe(upper);
  });

  it('returns null for empty string in properties._id', () => {
    const feat = { properties: { _id: '' } };
    expect(resolveFeatureId(feat)).toBeNull();
  });
});
