import type { Layer } from '@felt-like-it/shared-types';

export type ExportFormat = 'geojson' | 'gpkg' | 'shp' | 'pdf';
export type ExportStatus = 'idle' | 'pending' | 'processing' | 'complete' | 'error';

export interface ExportState {
  format: ExportFormat | null;
  status: ExportStatus;
  progress: number; // 0-100
  error: string | null;
  jobId: string | null;
}

export interface ExportOptions {
  layerId?: string;
  layerIds?: string[];
  format: ExportFormat;
  includeAnnotations?: boolean;
}

/**
 * Reactive store for export state management.
 * Replaces the 6 individual boolean states (exportingGeoJSON, etc.)
 * with a unified state machine.
 */
export class ExportStore {
  // Reactive state
  state = $state<ExportState>({
    format: null,
    status: 'idle',
    progress: 0,
    error: null,
    jobId: null,
  });

  // Derived states for convenience
  isIdle = $derived(this.state.status === 'idle');
  isPending = $derived(this.state.status === 'pending');
  isProcessing = $derived(this.state.status === 'processing');
  isComplete = $derived(this.state.status === 'complete');
  isError = $derived(this.state.status === 'error');
  isActive = $derived(this.state.status === 'pending' || this.state.status === 'processing');

  /**
   * Start a new export operation.
   * Resets any previous state.
   */
  start(format: ExportFormat, jobId?: string): void {
    this.state = {
      format,
      status: 'pending',
      progress: 0,
      error: null,
      jobId: jobId ?? null,
    };
  }

  /**
   * Mark export as processing (server-side work started).
   */
  processing(): void {
    if (this.state.status === 'pending') {
      this.state.status = 'processing';
    }
  }

  /**
   * Update progress (0-100).
   */
  setProgress(progress: number): void {
    this.state.progress = Math.max(0, Math.min(100, progress));
  }

  /**
   * Mark export as complete.
   */
  complete(): void {
    this.state.status = 'complete';
    this.state.progress = 100;
  }

  /**
   * Mark export as failed with error message.
   */
  fail(error: string): void {
    this.state.status = 'error';
    this.state.error = error;
  }

  /**
   * Reset to idle state.
   */
  reset(): void {
    this.state = {
      format: null,
      status: 'idle',
      progress: 0,
      error: null,
      jobId: null,
    };
  }

  /**
   * Get display label for current format.
   */
  getFormatLabel(): string {
    const labels: Record<ExportFormat, string> = {
      geojson: 'GeoJSON',
      gpkg: 'GeoPackage',
      shp: 'Shapefile',
      pdf: 'PDF',
    };
    return this.state.format ? labels[this.state.format] : '';
  }
}

/**
 * Factory function to create a reactive ExportStore instance.
 * Use this in components: `const exportStore = createExportStore();`
 */
export function createExportStore(): ExportStore {
  return new ExportStore();
}
