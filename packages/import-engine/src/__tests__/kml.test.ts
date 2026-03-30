import { describe, it, expect, afterEach } from 'vitest';
import { writeFile, mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseKML } from '../kml.js';

describe('parseKML', () => {
  let tmpDir: string;

  async function setup() {
    tmpDir = await mkdtemp(join(tmpdir(), 'kml-test-'));
  }

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('parses Point Placemarks', async () => {
    await setup();
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Test Point</name>
      <description>A test point</description>
      <Point>
        <coordinates>-122.0822035,37.4220033612,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`;
    const filePath = join(tmpDir, 'point.kml');
    await writeFile(filePath, kml);

    const result = await parseKML(filePath);
    expect(result).toHaveLength(1);
    expect(result[0]?.geometry.type).toBe('Point');
    expect(result[0]?.geometry.coordinates).toEqual([-122.0822035, 37.4220033612, 0]);
    expect(result[0]?.properties).toEqual({
      name: 'Test Point',
      description: 'A test point',
    });
  });

  it('parses LineString Placemarks', async () => {
    await setup();
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Test Line</name>
      <LineString>
        <coordinates>-122.084075,37.4220033612,0 -122.085071,37.4226,0</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;
    const filePath = join(tmpDir, 'line.kml');
    await writeFile(filePath, kml);

    const result = await parseKML(filePath);
    expect(result).toHaveLength(1);
    expect(result[0]?.geometry.type).toBe('LineString');
    expect(result[0]?.geometry.coordinates).toHaveLength(2);
  });

  it('parses Polygon Placemarks', async () => {
    await setup();
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Test Polygon</name>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
              -122.084893,37.422571,0
              -122.084904,37.422119,0
              -122.085419,37.422119,0
              -122.085419,37.422571,0
              -122.084893,37.422571,0
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;
    const filePath = join(tmpDir, 'polygon.kml');
    await writeFile(filePath, kml);

    const result = await parseKML(filePath);
    expect(result).toHaveLength(1);
    expect(result[0]?.geometry.type).toBe('Polygon');
    expect(result[0]?.geometry.coordinates).toHaveLength(1); // One ring
    const ring = result[0]?.geometry.coordinates[0] as number[][];
    expect(ring).toHaveLength(5); // Closed ring
  });

  it('handles nested Folders', async () => {
    await setup();
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Folder>
      <name>Outer</name>
      <Folder>
        <name>Inner</name>
        <Placemark>
          <name>Nested</name>
          <Point><coordinates>1,2,0</coordinates></Point>
        </Placemark>
      </Folder>
    </Folder>
  </Document>
</kml>`;
    const filePath = join(tmpDir, 'nested.kml');
    await writeFile(filePath, kml);

    const result = await parseKML(filePath);
    expect(result).toHaveLength(1);
    expect(result[0]?.properties).toEqual({ name: 'Nested' });
  });

  it('skips Placemarks without supported geometry', async () => {
    await setup();
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>No Geom</name>
    </Placemark>
    <Placemark>
      <name>With Point</name>
      <Point><coordinates>10,20</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;
    const filePath = join(tmpDir, 'mixed.kml');
    await writeFile(filePath, kml);

    const result = await parseKML(filePath);
    expect(result).toHaveLength(1);
    expect(result[0]?.properties).toEqual({ name: 'With Point' });
  });

  it('returns empty array for KML with no Placemarks', async () => {
    await setup();
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Empty</name>
  </Document>
</kml>`;
    const filePath = join(tmpDir, 'empty.kml');
    await writeFile(filePath, kml);

    const result = await parseKML(filePath);
    expect(result).toHaveLength(0);
  });

  it('throws on invalid KML (missing root element)', async () => {
    await setup();
    const filePath = join(tmpDir, 'invalid.kml');
    await writeFile(filePath, '<html><body>Not KML</body></html>');

    await expect(parseKML(filePath)).rejects.toThrow(
      'Invalid KML: missing <kml> root element'
    );
  });

  it('extracts ExtendedData properties', async () => {
    await setup();
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Extended</name>
      <ExtendedData>
        <Data name="population">
          <value>12345</value>
        </Data>
      </ExtendedData>
      <Point><coordinates>5,10</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;
    const filePath = join(tmpDir, 'extended.kml');
    await writeFile(filePath, kml);

    const result = await parseKML(filePath);
    expect(result).toHaveLength(1);
    expect(result[0]?.properties['name']).toBe('Extended');
    // fast-xml-parser coerces numeric strings to numbers
    expect(result[0]?.properties['population']).toBe(12345);
  });
});
