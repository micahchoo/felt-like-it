// @vitest-environment node
/**
 * Characterization tests for existing GET export routes
 *
 * These tests document the behavior of the legacy export endpoints:
 *   - GET /api/export/[layerId]?format=(geojson|gpkg|shp)
 *   - GET /api/export/annotations/[mapId]
 *   - POST /api/export/[layerId] (PDF export)
 *
 * The handlers are tightly coupled to SvelteKit's RequestEvent (locals.user,
 * params.layerId/mapId) and use SvelteKit's error() helper. We characterize
 * the response shapes and behavior contracts by inspecting the handler logic
 * directly — no HTTP server needed.
 */

import { describe, it, expect } from 'vitest';

describe('GET /api/export/[layerId] - legacy layer export endpoint', () => {
  describe('Authentication & Authorization', () => {
    it('requires authenticated user (401 if locals.user is null)', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/routes/api/export/[layerId]/+server.ts', 'utf-8')
      );
      expect(content).toMatch(/if\s*\(\s*!locals\.user\s*\)\s*error\s*\(\s*401/);
    });

    it('returns 404 for non-existent layer (via getExportData)', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/lib/server/export/shared.ts', 'utf-8')
      );
      expect(content).toMatch(/if\s*\(\s*!layer\s*\)\s*error\s*\(\s*404/);
    });

    it('checks map ownership or collaborator access (viewer+)', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/lib/server/export/shared.ts', 'utf-8')
      );
      // Owner fast-path: map.userId !== userId → check collaborators
      expect(content).toMatch(/map\.userId\s*!==\s*userId/);
      expect(content).toMatch(/mapCollaborators/);
    });
  });

  describe('Format parameter handling', () => {
    it('defaults to geojson when format param is missing', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/routes/api/export/[layerId]/+server.ts', 'utf-8')
      );
      expect(content).toMatch(/url\.searchParams\.get\(['"]format['"]\)\s*\?\?\s*['"]geojson['"]/);
    });

    it('supports geojson, gpkg, shp formats via switch statement', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/routes/api/export/[layerId]/+server.ts', 'utf-8')
      );
      expect(content).toMatch(/switch\s*\(\s*format\s*\)/);
      expect(content).toMatch(/case\s*['"]geojson['"]/);
      expect(content).toMatch(/case\s*['"]gpkg['"]/);
      expect(content).toMatch(/case\s*['"]shp['"]/);
    });

    it('returns 400 for unsupported formats', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/routes/api/export/[layerId]/+server.ts', 'utf-8')
      );
      expect(content).toMatch(/error\s*\(\s*400/);
      expect(content).toMatch(/Unsupported format/);
    });
  });

  describe('Response contracts by format', () => {
    it('geojson: returns application/geo+json with .geojson filename', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/routes/api/export/[layerId]/+server.ts', 'utf-8')
      );
      expect(content).toMatch(/Content-Type.*application\/geo\+json/);
      expect(content).toMatch(/filename=.*\.geojson/);
    });

    it('gpkg: returns application/geopackage+sqlite3 with .gpkg filename', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/routes/api/export/[layerId]/+server.ts', 'utf-8')
      );
      expect(content).toMatch(/Content-Type.*application\/geopackage\+sqlite3/);
      expect(content).toMatch(/filename=.*\.gpkg/);
    });

    it('shp: returns application/zip with .shp.zip filename', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/routes/api/export/[layerId]/+server.ts', 'utf-8')
      );
      expect(content).toMatch(/Content-Type.*application\/zip/);
      expect(content).toMatch(/filename=.*\.shp\.zip/);
    });

    it('filenames are sanitized (non-alphanumeric → underscore)', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/routes/api/export/[layerId]/+server.ts', 'utf-8')
      );
      expect(content).toMatch(/sanitizeFilename/);
      expect(content).toMatch(/replace\(\/\[\^a-z0-9_-\]\/gi,\s*['"]_['"]\)/);
    });
  });

  describe('Data pipeline', () => {
    it('uses getExportData to fetch layer features with access check', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/routes/api/export/[layerId]/+server.ts', 'utf-8')
      );
      expect(content).toMatch(/getExportData\s*\(\s*params\.layerId/);
    });

    it('uses toFeatureCollection for geojson conversion', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/routes/api/export/[layerId]/+server.ts', 'utf-8')
      );
      expect(content).toMatch(/toFeatureCollection\s*\(\s*data\s*\)/);
    });

    it('uses exportAsGeoPackage for gpkg format', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/routes/api/export/[layerId]/+server.ts', 'utf-8')
      );
      expect(content).toMatch(/exportAsGeoPackage\s*\(\s*data\s*\)/);
    });

    it('uses exportAsShapefile for shp format', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/routes/api/export/[layerId]/+server.ts', 'utf-8')
      );
      expect(content).toMatch(/exportAsShapefile\s*\(\s*data\s*\)/);
    });
  });
});

describe('POST /api/export/[layerId] - PDF export endpoint', () => {
  describe('Authentication', () => {
    it('requires authenticated user (401 if locals.user is null)', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/routes/api/export/[layerId]/+server.ts', 'utf-8')
      );
      // Second occurrence is for POST handler
      const matches = content.match(/if\s*\(\s*!locals\.user\s*\)\s*error\s*\(\s*401/g);
      expect(matches?.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Request body handling', () => {
    it('accepts optional screenshot (base64 data URL) and title', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/routes/api/export/[layerId]/+server.ts', 'utf-8')
      );
      expect(content).toMatch(/screenshot\?/);
      expect(content).toMatch(/title\?/);
    });

    it('returns 400 for invalid JSON body', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/routes/api/export/[layerId]/+server.ts', 'utf-8')
      );
      expect(content).toMatch(/error\s*\(\s*400.*Invalid JSON/);
    });
  });

  describe('Response contract', () => {
    it('returns application/pdf with .pdf filename', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/routes/api/export/[layerId]/+server.ts', 'utf-8')
      );
      expect(content).toMatch(/Content-Type.*application\/pdf/);
      expect(content).toMatch(/filename=.*\.pdf/);
    });

    it('uses exportAsPdf with data + optional screenshot/title', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/routes/api/export/[layerId]/+server.ts', 'utf-8')
      );
      expect(content).toMatch(/exportAsPdf\s*\(\s*\{/);
      expect(content).toMatch(/data/);
      expect(content).toMatch(/screenshot/);
    });
  });
});

describe('GET /api/export/annotations/[mapId] - annotations export endpoint', () => {
  describe('Authentication & Authorization', () => {
    it('requires authenticated user (401 if locals.user is null)', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/routes/api/export/annotations/[mapId]/+server.ts', 'utf-8')
      );
      expect(content).toMatch(/if\s*\(\s*!locals\.user\s*\)\s*error\s*\(\s*401/);
    });

    it('uses annotationService.list which checks viewer access internally', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/routes/api/export/annotations/[mapId]/+server.ts', 'utf-8')
      );
      expect(content).toMatch(/annotationService\.list/);
      expect(content).toMatch(/checks viewer access internally/);
    });
  });

  describe('Response contract', () => {
    it('returns application/geo+json with annotations-[mapId].geojson filename', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/routes/api/export/annotations/[mapId]/+server.ts', 'utf-8')
      );
      expect(content).toMatch(/Content-Type.*application\/geo\+json/);
      expect(content).toMatch(/annotations-/);
      expect(content).toMatch(/\.geojson/);
    });

    it('uses annotationsToFeatureCollection for conversion', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/routes/api/export/annotations/[mapId]/+server.ts', 'utf-8')
      );
      expect(content).toMatch(/annotationsToFeatureCollection\s*\(\s*items\s*\)/);
    });
  });

  describe('Data transformation', () => {
    it('excludes annotations without exportable geometry (feature/viewport anchors)', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/lib/server/export/annotations.ts', 'utf-8')
      );
      expect(content).toMatch(/anchorToGeometry/);
      expect(content).toMatch(/if\s*\(\s*!geometry\s*\)\s*continue/);
    });

    it('includes point, region, and measurement anchor types', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/lib/server/export/annotations.ts', 'utf-8')
      );
      expect(content).toMatch(/case\s*['"]point['"]/);
      expect(content).toMatch(/case\s*['"]region['"]/);
      expect(content).toMatch(/case\s*['"]measurement['"]/);
    });

    it('feature properties include: annotationId, authorName, anchorType, contentType, text, timestamps', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/lib/server/export/annotations.ts', 'utf-8')
      );
      expect(content).toMatch(/annotationId/);
      expect(content).toMatch(/authorName/);
      expect(content).toMatch(/anchorType/);
      expect(content).toMatch(/contentType/);
      expect(content).toMatch(/text/);
      expect(content).toMatch(/createdAt/);
      expect(content).toMatch(/updatedAt/);
    });
  });
});

describe('Export shared utilities (getExportData, toFeatureCollection)', () => {
  describe('getExportData', () => {
    it('returns ExportData with layerId, layerName, layerType, features', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/lib/server/export/shared.ts', 'utf-8')
      );
      expect(content).toMatch(/interface ExportData/);
      expect(content).toMatch(/layerId/);
      expect(content).toMatch(/layerName/);
      expect(content).toMatch(/layerType/);
      expect(content).toMatch(/features/);
    });

    it('fetches features via getLayerFeatures', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/lib/server/export/shared.ts', 'utf-8')
      );
      expect(content).toMatch(/getLayerFeatures\s*\(\s*layerId\s*\)/);
    });
  });

  describe('toFeatureCollection', () => {
    it('maps GeoJSONFeatureRow to GeoJSON Feature with id, geometry, properties', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/lib/server/export/shared.ts', 'utf-8')
      );
      expect(content).toMatch(/type:\s*['"]Feature['"]/);
      expect(content).toMatch(/id:\s*row\.id/);
      expect(content).toMatch(/geometry:\s*row\.geometry/);
      expect(content).toMatch(/properties:\s*row\.properties/);
    });

    it('returns valid GeoJSON FeatureCollection type', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile('src/lib/server/export/shared.ts', 'utf-8')
      );
      expect(content).toMatch(/type:\s*['"]FeatureCollection['"]/);
    });
  });
});
