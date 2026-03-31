import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import path from 'path';

// Resolve paths relative from apps/web/ (vitest CWD)
const ROOT = path.resolve(__dirname, '../..');

function resolve(...parts: string[]) {
  return path.join(ROOT, ...parts);
}

describe('Content Flows — Current Behavior Characterization', () => {
  describe('F09: Measurement state in MapEditor', () => {
    it('MapEditor uses MeasurementStore class (not local $state) for measurement', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/lib/components/map/MapEditor.svelte'), 'utf-8')
      );
      // MeasurementStore replaces local measureResult $state
      expect(content).toMatch(/import.*MeasurementStore.*from/);
      expect(content).toMatch(/const measurementStore = new MeasurementStore\(\)/);
      // No local measureResult $state
      expect(content).not.toMatch(/let measureResult = \$state/);
    });

    it('MapEditor uses measurementStore.setResult in onmeasured callback', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/lib/components/map/MapEditor.svelte'), 'utf-8')
      );
      expect(content).toMatch(/onmeasured:/);
      expect(content).toMatch(/measurementStore\.setResult/);
      // Uses measurementStore.currentResult for panel
      expect(content).toMatch(/measurementStore\.currentResult/);
    });

    it('MapEditor passes measurementStore.currentResult to MeasurementPanel', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/lib/components/map/MapEditor.svelte'), 'utf-8')
      );
      expect(content).toMatch(/measureResult=\{measurementStore\.currentResult\}/);
    });

    it('M keyboard shortcut added to useKeyboardShortcuts', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/lib/components/map/useKeyboardShortcuts.svelte.ts'), 'utf-8')
      );
      // M key handler exists with toggleMeasurement
      expect(content).toMatch(/['"]m['"]/);
      expect(content).toMatch(/toggleMeasurement/);
      // Skips text inputs
      expect(content).toMatch(/isTextInput|INPUT|TEXTAREA|contenteditable/i);
    });

    it('MeasurementTooltip imported and rendered in MapEditor', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/lib/components/map/MapEditor.svelte'), 'utf-8')
      );
      expect(content).toMatch(/import.*MeasurementTooltip.*from/);
      expect(content).toMatch(/<MeasurementTooltip/);
      expect(content).toMatch(/result=\{measurementStore\.currentResult\}/);
    });
  });

  describe('F10: AnnotationPanel TanStack Query mutations', () => {
    it('AnnotationPanel uses createMutation for annotations', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/lib/components/annotations/AnnotationPanel.svelte'), 'utf-8')
      );
      expect(content).toMatch(/createMutation/);
      expect(content).toMatch(/trpc\.annotations\.create/);
      expect(content).toMatch(/trpc\.annotations\.delete/);
      expect(content).toMatch(/trpc\.annotations\.update/);
    });

    it('AnnotationPanel uses onMutate/onSettled pattern for optimistic comment mutations', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/lib/components/annotations/AnnotationPanel.svelte'), 'utf-8')
      );
      expect(content).toMatch(/onMutate/);
      expect(content).toMatch(/onSettled/);
      expect(content).toMatch(/onError/);
    });

    it('AnnotationPanel calls onannotationsaved callback after mutations', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/lib/components/annotations/AnnotationPanel.svelte'), 'utf-8')
      );
      expect(content).toMatch(/onannotationsaved\s*\(/);
    });

    it('AnnotationPanel accepts pendingMeasurement prop for pre-filled form', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/lib/components/annotations/AnnotationPanel.svelte'), 'utf-8')
      );
      expect(content).toMatch(/pendingMeasurement\?/);
      expect(content).toMatch(/type:\s*['"]measurement['"]/);
      expect(content).toMatch(/measurementType:\s*['"]distance['"]\s*\|\s*['"]area['"]/);
    });

    it('createAnnotationGeoStore transforms annotation data into pins/regions/measurements', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/lib/stores/annotation-geo.svelte.ts'), 'utf-8')
      );
      expect(content).toMatch(/export\s+function\s+createAnnotationGeoStore/);
      // Returns pins, regions, measurements, index
      expect(content).toMatch(/pins/);
      expect(content).toMatch(/regions/);
      expect(content).toMatch(/measurements/);
    });

    it('AnnotationPanel has 6 content types: text, emoji, gif, image, link, iiif', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/lib/components/annotations/AnnotationPanel.svelte'), 'utf-8')
      );
      // Content type icons
      expect(content).toMatch(/Type/);
      expect(content).toMatch(/Smile/);
      expect(content).toMatch(/Film/);
      expect(content).toMatch(/ImageIcon/);
      expect(content).toMatch(/Link2/);
    });
  });

  describe('F11: ExportDialog 6 boolean loading states', () => {
    it('ExportDialog has 6 individual exporting* boolean states', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/lib/components/data/ExportDialog.svelte'), 'utf-8')
      );
      expect(content).toMatch(/let exportingGeoJSON = \$state\(false\)/);
      expect(content).toMatch(/let exportingGpkg = \$state\(false\)/);
      expect(content).toMatch(/let exportingShp = \$state\(false\)/);
      expect(content).toMatch(/let exportingPdf = \$state\(false\)/);
      expect(content).toMatch(/let exportingPNG = \$state\(false\)/);
      expect(content).toMatch(/let exportingAnnotations = \$state\(false\)/);
    });

    it('ExportDialog fetches exports via GET endpoints with format query param', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/lib/components/data/ExportDialog.svelte'), 'utf-8')
      );
      // Uses ?format= query param, not path segments
      expect(content).toMatch(/\/api\/export\/\$\{selectedLayerId\}\?format=/);
      expect(content).toMatch(/\/api\/export\/annotations\/\$\{mapId\}/);
    });

    it('ExportDialog has no progress tracking — only boolean loading states', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/lib/components/data/ExportDialog.svelte'), 'utf-8')
      );
      // No progress variable, no SSE, no EventSource
      expect(content).not.toMatch(/progress/);
      expect(content).not.toMatch(/EventSource/);
      expect(content).not.toMatch(/SSE/);
      // Unicode ellipsis character in "Exporting…"
      expect(content).toMatch(/Exporting/);
    });

    it('Existing export routes exist at /api/export/[layerId]/+server.ts', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/routes/api/export/[layerId]/+server.ts'), 'utf-8')
      );
      // Route handles GET requests via export const GET
      expect(content).toMatch(/export const GET/);
      // Uses ?format= query param
      expect(content).toMatch(/url\.searchParams\.get\(['"]format['"]\)/);
    });
  });
});
