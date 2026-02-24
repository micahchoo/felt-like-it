/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  measureLine,
  measurePolygon,
  formatDistance,
  formatArea,
  DISTANCE_UNITS,
  AREA_UNITS,
} from '../measurement.js';

// ── measureLine ───────────────────────────────────────────────────────────────

describe('measureLine', () => {
  it('returns zero distance for a single point', () => {
    const result = measureLine([[-122.4, 37.8]]);
    expect(result.type).toBe('distance');
    expect(result.distanceKm).toBe(0);
    expect(result.vertexCount).toBe(1);
  });

  it('measures roughly 1 degree of longitude at the equator as ~111 km', () => {
    // 1° longitude at equator ≈ 111.32 km
    const result = measureLine([[0, 0], [1, 0]]);
    expect(result.distanceKm).toBeCloseTo(111.32, 0);
    expect(result.vertexCount).toBe(2);
  });

  it('measures multi-segment line (3 points)', () => {
    const result = measureLine([[0, 0], [1, 0], [2, 0]]);
    expect(result.distanceKm).toBeGreaterThan(200);
    expect(result.vertexCount).toBe(3);
  });

  it('measures roughly 1 degree of latitude as ~111 km', () => {
    const result = measureLine([[0, 0], [0, 1]]);
    expect(result.distanceKm).toBeCloseTo(111.19, 0);
  });

  it('returns type: distance', () => {
    const result = measureLine([[0, 0], [1, 0]]);
    expect(result.type).toBe('distance');
  });
});

// ── measurePolygon ────────────────────────────────────────────────────────────

describe('measurePolygon', () => {
  // ~1° x 1° square at the equator
  const equatorSquare: [number, number][][] = [
    [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
  ];

  it('returns type: area', () => {
    const result = measurePolygon(equatorSquare);
    expect(result.type).toBe('area');
  });

  it('area of ~1° x 1° equatorial square is roughly 12,000 km²', () => {
    const result = measurePolygon(equatorSquare);
    // 1° lat × 1° lon at equator ≈ 111.19 km × 111.32 km ≈ 12,382 km²
    const km2 = result.areaM2 / 1_000_000;
    expect(km2).toBeGreaterThan(12_000);
    expect(km2).toBeLessThan(13_000);
  });

  it('perimeter of equatorial square is roughly 4 × 111 km ≈ 444 km', () => {
    const result = measurePolygon(equatorSquare);
    expect(result.perimeterKm).toBeGreaterThan(430);
    expect(result.perimeterKm).toBeLessThan(460);
  });

  it('vertexCount excludes the closing duplicate vertex', () => {
    // ring has 5 points but the last = first, so 4 real vertices
    const result = measurePolygon(equatorSquare);
    expect(result.vertexCount).toBe(4);
  });

  it('returns zeros for degenerate polygon (< 4 ring points)', () => {
    const result = measurePolygon([[[0, 0], [1, 0], [0, 0]]]);
    expect(result.areaM2).toBe(0);
    expect(result.perimeterKm).toBe(0);
  });

  it('returns zeros for empty coordinates', () => {
    const result = measurePolygon([[]]);
    expect(result.areaM2).toBe(0);
    expect(result.perimeterKm).toBe(0);
  });
});

// ── formatDistance ────────────────────────────────────────────────────────────

describe('formatDistance', () => {
  it('formats km', () => {
    expect(formatDistance(12.345, 'km')).toContain('km');
    expect(formatDistance(12.345, 'km')).toContain('12.345');
  });

  it('formats mi', () => {
    const result = formatDistance(1.609344, 'mi');
    // 1.609344 km ≈ 1 mile; adaptiveFormat may omit trailing zeros
    expect(result).toContain('mi');
    expect(result).toMatch(/^1/);
  });

  it('formats m', () => {
    const result = formatDistance(0.5, 'm');
    expect(result).toContain('m');
    expect(result).toContain('500');
  });

  it('formats ft', () => {
    const result = formatDistance(0.3048 / 1000, 'ft');
    // 0.3048 m = 1 ft
    expect(result).toContain('ft');
    expect(result).toMatch(/^1/);
  });

  it('uses comma separator for large numbers', () => {
    const result = formatDistance(1234, 'm');
    // 1234 km = 1,234,000 m — should have comma formatting
    expect(result).toContain(',');
  });
});

// ── formatArea ────────────────────────────────────────────────────────────────

describe('formatArea', () => {
  it('formats m2', () => {
    const result = formatArea(1000, 'm2');
    expect(result).toContain('m2');
    expect(result).toContain('1,000');
  });

  it('formats km2', () => {
    const result = formatArea(2_000_000, 'km2');
    expect(result).toContain('km2');
    expect(result).toBe('2 km2');
  });

  it('formats ha', () => {
    const result = formatArea(10_000, 'ha');
    expect(result).toContain('ha');
    expect(result).toBe('1 ha');
  });

  it('formats ac', () => {
    const result = formatArea(4046.86, 'ac');
    // 1 acre ≈ 4046.86 m²
    expect(result).toContain('ac');
    expect(result).toMatch(/^1/);
  });

  it('formats mi2', () => {
    // 2 sq miles exactly; avoids precision drift from approximate 1-mile constant
    const result = formatArea(2 * 2_589_988.11, 'mi2');
    expect(result).toContain('mi2');
    // Should be approximately "2 mi2"
    const num = parseFloat(result);
    expect(num).toBeCloseTo(2, 0);
  });
});

// ── Unit lists ────────────────────────────────────────────────────────────────

describe('DISTANCE_UNITS', () => {
  it('contains km, mi, m, ft', () => {
    const values = DISTANCE_UNITS.map((u) => u.value);
    expect(values).toContain('km');
    expect(values).toContain('mi');
    expect(values).toContain('m');
    expect(values).toContain('ft');
  });
});

describe('AREA_UNITS', () => {
  it('contains km2, mi2, ha, ac, m2', () => {
    const values = AREA_UNITS.map((u) => u.value);
    expect(values).toContain('km2');
    expect(values).toContain('mi2');
    expect(values).toContain('ha');
    expect(values).toContain('ac');
    expect(values).toContain('m2');
  });
});
