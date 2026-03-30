import { describe, it, expect } from 'vitest';
import { parseGpkgBlob, gpkgGeomTypeToLayerType } from '../geopackage.js';

describe('parseGpkgBlob', () => {
  /** Build a minimal GeoPackage Binary Header with embedded WKB. */
  function makeGpkgBlob(opts: {
    srid?: number;
    littleEndian?: boolean;
    envelopeIndicator?: number;
    emptyFlag?: boolean;
    wkb?: number[];
  }): Uint8Array {
    const {
      srid = 4326,
      littleEndian = true,
      envelopeIndicator = 0,
      emptyFlag = false,
      wkb = [0x01, 0x01, 0x00, 0x00, 0x00], // WKB Point header (LE)
    } = opts;

    // flags byte: bit 0 = endianness, bits 1-3 = envelope indicator, bit 4 = empty
    let flags = littleEndian ? 1 : 0;
    flags |= (envelopeIndicator & 0x7) << 1;
    if (emptyFlag) flags |= 1 << 4;

    const envelopeSizes = [0, 32, 48, 48, 64];
    const envSize = envelopeIndicator <= 4 ? (envelopeSizes[envelopeIndicator] ?? 0) : 0;

    const headerSize = 8 + envSize;
    const buf = new ArrayBuffer(headerSize + wkb.length);
    const view = new DataView(buf);
    const arr = new Uint8Array(buf);

    // Magic bytes
    arr[0] = 0x47; // 'G'
    arr[1] = 0x50; // 'P'
    // Version
    arr[2] = 0x00;
    // Flags
    arr[3] = flags;
    // SRID (4 bytes)
    view.setInt32(4, srid, littleEndian);
    // Envelope (fill with zeros)
    // WKB payload
    for (let i = 0; i < wkb.length; i++) {
      arr[headerSize + i] = wkb[i]!;
    }

    return arr;
  }

  it('parses a valid blob with no envelope', () => {
    const blob = makeGpkgBlob({ srid: 4326, envelopeIndicator: 0 });
    const result = parseGpkgBlob(blob);
    expect(result).not.toBeNull();
    expect(result!.srid).toBe(4326);
    expect(result!.wkbBytes).toHaveLength(5);
    expect(result!.wkbBytes[0]).toBe(0x01);
  });

  it('parses a blob with envelope indicator 1 (32-byte xy envelope)', () => {
    const blob = makeGpkgBlob({ srid: 3857, envelopeIndicator: 1 });
    const result = parseGpkgBlob(blob);
    expect(result).not.toBeNull();
    expect(result!.srid).toBe(3857);
  });

  it('parses big-endian header', () => {
    const blob = makeGpkgBlob({ srid: 4326, littleEndian: false });
    const result = parseGpkgBlob(blob);
    expect(result).not.toBeNull();
    expect(result!.srid).toBe(4326);
  });

  it('returns null for too-short blob', () => {
    expect(parseGpkgBlob(new Uint8Array([0x47, 0x50]))).toBeNull();
  });

  it('returns null for wrong magic bytes', () => {
    const blob = makeGpkgBlob({});
    blob[0] = 0x00;
    expect(parseGpkgBlob(blob)).toBeNull();
  });

  it('returns null for empty-geometry flag', () => {
    const blob = makeGpkgBlob({ emptyFlag: true });
    expect(parseGpkgBlob(blob)).toBeNull();
  });

  it('returns null when WKB offset exceeds blob length', () => {
    // Envelope indicator 4 = 64 bytes, but blob only has 8+0 bytes total
    const blob = makeGpkgBlob({ envelopeIndicator: 4, wkb: [] });
    // The blob will be exactly headerSize (8+64=72) with 0 wkb bytes
    // so blob.length <= wkbOffset should trigger null
    expect(parseGpkgBlob(blob)).toBeNull();
  });
});

describe('gpkgGeomTypeToLayerType', () => {
  it('maps point types', () => {
    expect(gpkgGeomTypeToLayerType('POINT')).toBe('point');
    expect(gpkgGeomTypeToLayerType('MULTIPOINT')).toBe('point');
    expect(gpkgGeomTypeToLayerType('POINTZ')).toBe('point');
    expect(gpkgGeomTypeToLayerType('POINTM')).toBe('point');
    expect(gpkgGeomTypeToLayerType('POINTZM')).toBe('point');
  });

  it('maps line types', () => {
    expect(gpkgGeomTypeToLayerType('LINESTRING')).toBe('line');
    expect(gpkgGeomTypeToLayerType('MULTILINESTRING')).toBe('line');
    expect(gpkgGeomTypeToLayerType('LINESTRINGZ')).toBe('line');
    expect(gpkgGeomTypeToLayerType('CIRCULARSTRING')).toBe('line');
    expect(gpkgGeomTypeToLayerType('COMPOUNDCURVE')).toBe('line');
    expect(gpkgGeomTypeToLayerType('MULTICURVE')).toBe('line');
  });

  it('maps polygon types', () => {
    expect(gpkgGeomTypeToLayerType('POLYGON')).toBe('polygon');
    expect(gpkgGeomTypeToLayerType('MULTIPOLYGON')).toBe('polygon');
    expect(gpkgGeomTypeToLayerType('POLYGONZ')).toBe('polygon');
    expect(gpkgGeomTypeToLayerType('CURVEPOLYGON')).toBe('polygon');
    expect(gpkgGeomTypeToLayerType('MULTISURFACE')).toBe('polygon');
  });

  it('returns mixed for unknown types', () => {
    expect(gpkgGeomTypeToLayerType('GEOMETRY')).toBe('mixed');
    expect(gpkgGeomTypeToLayerType('GEOMETRYCOLLECTION')).toBe('mixed');
  });

  it('handles case insensitivity', () => {
    expect(gpkgGeomTypeToLayerType('point')).toBe('point');
    expect(gpkgGeomTypeToLayerType('LineString')).toBe('line');
    expect(gpkgGeomTypeToLayerType('Polygon')).toBe('polygon');
  });
});
