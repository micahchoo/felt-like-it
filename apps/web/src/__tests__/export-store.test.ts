import { describe, it, expect } from 'vitest';
import {
  ExportStore,
  createExportStore,
  type ExportFormat,
} from '$lib/stores/export-store.svelte.js';

describe('ExportStore', () => {
  it('starts in idle state', () => {
    const store = new ExportStore();
    expect(store.state.status).toBe('idle');
    expect(store.state.format).toBeNull();
    expect(store.state.progress).toBe(0);
    expect(store.state.error).toBeNull();
    expect(store.state.jobId).toBeNull();
  });

  it('transitions to pending on start', () => {
    const store = new ExportStore();
    store.start('geojson', 'job-123');
    expect(store.state.status).toBe('pending');
    expect(store.state.format).toBe('geojson');
    expect(store.state.jobId).toBe('job-123');
  });

  it('transitions to processing', () => {
    const store = new ExportStore();
    store.start('gpkg');
    store.processing();
    expect(store.state.status).toBe('processing');
  });

  it('updates progress', () => {
    const store = new ExportStore();
    store.start('shp');
    store.setProgress(50);
    expect(store.state.progress).toBe(50);
  });

  it('clamps progress to 0-100', () => {
    const store = new ExportStore();
    store.start('pdf');
    store.setProgress(-10);
    expect(store.state.progress).toBe(0);
    store.setProgress(150);
    expect(store.state.progress).toBe(100);
  });

  it('transitions to complete', () => {
    const store = new ExportStore();
    store.start('geojson');
    store.processing();
    store.setProgress(100);
    store.complete();
    expect(store.state.status).toBe('complete');
    expect(store.state.progress).toBe(100);
  });

  it('transitions to error with message', () => {
    const store = new ExportStore();
    store.start('gpkg');
    store.fail('Network error');
    expect(store.state.status).toBe('error');
    expect(store.state.error).toBe('Network error');
  });

  it('resets to idle', () => {
    const store = new ExportStore();
    store.start('shp');
    store.processing();
    store.setProgress(50);
    store.reset();
    expect(store.state.status).toBe('idle');
    expect(store.state.progress).toBe(0);
    expect(store.state.format).toBeNull();
    expect(store.state.error).toBeNull();
  });

  it('derived states work correctly', () => {
    const store = new ExportStore();
    expect(store.isIdle).toBe(true);
    expect(store.isActive).toBe(false);

    store.start('pdf');
    expect(store.isPending).toBe(true);
    expect(store.isActive).toBe(true);

    store.processing();
    expect(store.isProcessing).toBe(true);
    expect(store.isPending).toBe(false);

    store.complete();
    expect(store.isComplete).toBe(true);
    expect(store.isActive).toBe(false);

    store.reset();
    store.start('geojson');
    store.fail('error');
    expect(store.isError).toBe(true);
  });

  it('getFormatLabel returns correct labels', () => {
    const store = new ExportStore();
    const formats: ExportFormat[] = ['geojson', 'gpkg', 'shp', 'pdf'];
    const expected = ['GeoJSON', 'GeoPackage', 'Shapefile', 'PDF'];
    formats.forEach((format, i) => {
      store.start(format);
      expect(store.getFormatLabel()).toBe(expected[i]);
    });
  });

  it('factory function creates store', () => {
    const store = createExportStore();
    expect(store).toBeInstanceOf(ExportStore);
    expect(store.state.status).toBe('idle');
  });
});
