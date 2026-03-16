import { describe, expect, it } from 'vitest';
import { isFeatureUUID, toFeatureUUID } from '../branded.js';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('toFeatureUUID', () => {
  it('accepts a valid UUID v4', () => {
    const result = toFeatureUUID(VALID_UUID);
    expect(result).toBe(VALID_UUID);
  });

  it('accepts UUID with uppercase hex digits', () => {
    const result = toFeatureUUID('550E8400-E29B-41D4-A716-446655440000');
    expect(result).toBe('550E8400-E29B-41D4-A716-446655440000');
  });

  it('returns null for integer feature IDs from vector tiles (string "123")', () => {
    expect(toFeatureUUID('123')).toBeNull();
  });

  it('returns null for integer feature IDs from vector tiles (string "0")', () => {
    expect(toFeatureUUID('0')).toBeNull();
  });

  it('returns null for non-UUID string "42"', () => {
    expect(toFeatureUUID('42')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(toFeatureUUID('')).toBeNull();
  });

  it('returns null for "not-a-uuid"', () => {
    expect(toFeatureUUID('not-a-uuid')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(toFeatureUUID(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(toFeatureUUID(undefined)).toBeNull();
  });

  it('returns null for a numeric (number) input', () => {
    expect(toFeatureUUID(123)).toBeNull();
  });

  it('returns null for UUID missing a segment', () => {
    expect(toFeatureUUID('550e8400-e29b-41d4-a716')).toBeNull();
  });

  it('returns null for UUID with extra characters', () => {
    expect(toFeatureUUID(VALID_UUID + 'x')).toBeNull();
  });
});

describe('isFeatureUUID', () => {
  it('returns true for a valid FeatureUUID', () => {
    const uuid = toFeatureUUID(VALID_UUID);
    expect(isFeatureUUID(uuid)).toBe(true);
  });

  it('returns true for a plain valid UUID string', () => {
    expect(isFeatureUUID(VALID_UUID)).toBe(true);
  });

  it('returns false for a non-UUID string', () => {
    expect(isFeatureUUID('not-a-uuid')).toBe(false);
  });

  it('returns false for integer-like strings from vector tiles', () => {
    expect(isFeatureUUID('123')).toBe(false);
    expect(isFeatureUUID('0')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isFeatureUUID(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isFeatureUUID(undefined)).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isFeatureUUID(42)).toBe(false);
  });

  it('returns false for an object', () => {
    expect(isFeatureUUID({})).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isFeatureUUID('')).toBe(false);
  });
});
