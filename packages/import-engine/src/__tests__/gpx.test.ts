import { describe, it, expect, afterEach } from 'vitest';
import { writeFile, mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseGPX } from '../gpx.js';

describe('parseGPX', () => {
  let tmpDir: string;

  async function setup() {
    tmpDir = await mkdtemp(join(tmpdir(), 'gpx-test-'));
  }

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('parses waypoints as Points', async () => {
    await setup();
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="47.644548" lon="-122.326897">
    <ele>4.46</ele>
    <name>Seattle</name>
  </wpt>
  <wpt lat="45.512794" lon="-122.679565">
    <name>Portland</name>
  </wpt>
</gpx>`;
    const filePath = join(tmpDir, 'waypoints.gpx');
    await writeFile(filePath, gpx);

    const result = await parseGPX(filePath);
    expect(result).toHaveLength(2);

    expect(result[0]?.geometry.type).toBe('Point');
    expect(result[0]?.geometry.coordinates).toEqual([-122.326897, 47.644548, 4.46]);
    expect(result[0]?.properties['name']).toBe('Seattle');

    expect(result[1]?.geometry.type).toBe('Point');
    expect(result[1]?.geometry.coordinates).toEqual([-122.679565, 45.512794]);
    expect(result[1]?.properties['name']).toBe('Portland');
  });

  it('parses tracks as LineStrings', async () => {
    await setup();
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Morning Run</name>
    <trkseg>
      <trkpt lat="47.644548" lon="-122.326897">
        <ele>10</ele>
      </trkpt>
      <trkpt lat="47.645000" lon="-122.327000">
        <ele>12</ele>
      </trkpt>
      <trkpt lat="47.646000" lon="-122.328000">
        <ele>15</ele>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;
    const filePath = join(tmpDir, 'track.gpx');
    await writeFile(filePath, gpx);

    const result = await parseGPX(filePath);
    expect(result).toHaveLength(1);
    expect(result[0]?.geometry.type).toBe('LineString');
    expect(result[0]?.geometry.coordinates).toHaveLength(3);
    expect(result[0]?.properties['name']).toBe('Morning Run');
  });

  it('parses routes as LineStrings', async () => {
    await setup();
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <rte>
    <name>Scenic Route</name>
    <rtept lat="47.644" lon="-122.326">
      <name>Start</name>
    </rtept>
    <rtept lat="47.650" lon="-122.330">
      <name>End</name>
    </rtept>
  </rte>
</gpx>`;
    const filePath = join(tmpDir, 'route.gpx');
    await writeFile(filePath, gpx);

    const result = await parseGPX(filePath);
    expect(result).toHaveLength(1);
    expect(result[0]?.geometry.type).toBe('LineString');
    expect(result[0]?.geometry.coordinates).toHaveLength(2);
    expect(result[0]?.properties['name']).toBe('Scenic Route');
  });

  it('skips tracks with fewer than 2 points', async () => {
    await setup();
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>One Point</name>
    <trkseg>
      <trkpt lat="47.644" lon="-122.326"></trkpt>
    </trkseg>
  </trk>
</gpx>`;
    const filePath = join(tmpDir, 'short.gpx');
    await writeFile(filePath, gpx);

    const result = await parseGPX(filePath);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for GPX with no features', async () => {
    await setup();
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Empty</name></metadata>
</gpx>`;
    const filePath = join(tmpDir, 'empty.gpx');
    await writeFile(filePath, gpx);

    const result = await parseGPX(filePath);
    expect(result).toHaveLength(0);
  });

  it('throws on invalid GPX (missing root element)', async () => {
    await setup();
    const filePath = join(tmpDir, 'invalid.gpx');
    await writeFile(filePath, '<html><body>Not GPX</body></html>');

    await expect(parseGPX(filePath)).rejects.toThrow(
      'Invalid GPX: missing <gpx> root element'
    );
  });

  it('handles mixed waypoints, tracks, and routes', async () => {
    await setup();
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="47.0" lon="-122.0"><name>WP</name></wpt>
  <trk>
    <name>Track</name>
    <trkseg>
      <trkpt lat="47.1" lon="-122.1"></trkpt>
      <trkpt lat="47.2" lon="-122.2"></trkpt>
    </trkseg>
  </trk>
  <rte>
    <name>Route</name>
    <rtept lat="47.3" lon="-122.3"></rtept>
    <rtept lat="47.4" lon="-122.4"></rtept>
  </rte>
</gpx>`;
    const filePath = join(tmpDir, 'mixed.gpx');
    await writeFile(filePath, gpx);

    const result = await parseGPX(filePath);
    expect(result).toHaveLength(3);
    expect(result[0]?.geometry.type).toBe('Point');
    expect(result[1]?.geometry.type).toBe('LineString');
    expect(result[2]?.geometry.type).toBe('LineString');
  });
});
