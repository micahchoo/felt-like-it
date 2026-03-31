import type { GeoJSON } from 'geojson';

export interface MeasurementResult {
  type: 'distance' | 'area';
  value: number;
  vertexCount: number;
  distanceKm?: number;
  areaKm2?: number;
  geometry: GeoJSON.Geometry;
}

export interface SaveAsAnnotationPayload {
  title: string;
  content: string;
  geometry: GeoJSON.Geometry;
}

export class MeasurementStore {
  active = $state(false);
  currentResult = $state<MeasurementResult | null>(null);
  history = $state<MeasurementResult[]>([]);

  toggle(): void {
    this.active = !this.active;
  }

  setResult(result: MeasurementResult): void {
    this.currentResult = result;
    this.history.push(result);
  }

  clear(): void {
    this.currentResult = null;
  }

  saveAsAnnotation(): SaveAsAnnotationPayload | null {
    if (!this.currentResult) return null;

    const result = this.currentResult;
    let title: string;

    if (result.type === 'distance') {
      const km = result.distanceKm ?? result.value / 1000;
      title = km >= 1 ? `Distance: ${km.toFixed(2)} km` : `Distance: ${result.value.toFixed(0)} m`;
    } else {
      const km2 = result.areaKm2 ?? result.value / 1000000;
      title = km2 >= 1 ? `Area: ${km2.toFixed(2)} km²` : `Area: ${result.value.toFixed(0)} m²`;
    }

    const content = `Measurement: ${result.type === 'distance' ? 'distance' : 'area'} — ${result.vertexCount} vertices`;

    // Clear the result after saving
    this.currentResult = null;

    return { title, content, geometry: result.geometry };
  }
}
