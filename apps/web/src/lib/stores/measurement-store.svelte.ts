import type { GeoJSON } from 'geojson';
import type { DistanceMeasurement, AreaMeasurement } from '@felt-like-it/geo-engine';

/** Unified measurement result with geometry for annotation saving and tooltip positioning.
 *  Extends geo-engine fields so MeasurementPanel can still access areaM2/perimeterKm. */
export interface MeasurementResult {
  type: 'distance' | 'area';
  value: number;
  vertexCount: number;
  distanceKm?: number;
  areaKm2?: number;
  areaM2?: number;
  perimeterKm?: number;
  geometry: GeoJSON.Geometry;
}

export interface SaveAsAnnotationPayload {
  title: string;
  content: string;
  geometry: GeoJSON.Geometry;
}

/** Convert geo-engine DistanceMeasurement/AreaMeasurement to unified MeasurementResult. */
function fromGeoEngine(result: DistanceMeasurement | AreaMeasurement): MeasurementResult {
  return {
    type: result.type,
    value: result.type === 'distance' ? result.distanceKm * 1000 : result.areaM2,
    vertexCount: result.vertexCount,
    distanceKm: result.type === 'distance' ? result.distanceKm : undefined,
    areaKm2: result.type === 'area' ? result.areaM2 / 1_000_000 : undefined,
    areaM2: result.type === 'area' ? result.areaM2 : undefined,
    perimeterKm: result.type === 'area' ? result.perimeterKm : undefined,
    geometry:
      result.type === 'distance'
        ? { type: 'LineString', coordinates: result.coordinates as [number, number][] }
        : { type: 'Polygon', coordinates: result.coordinates as [number, number][][] },
  };
}

export class MeasurementStore {
  active = $state(false);
  currentResult = $state<MeasurementResult | null>(null);
  history = $state<MeasurementResult[]>([]);

  toggle(): void {
    this.active = !this.active;
  }

  /** Accept either geo-engine types or already-converted MeasurementResult. */
  setResult(result: DistanceMeasurement | AreaMeasurement | MeasurementResult): void {
    // If it already has geometry field, it's our MeasurementResult
    const unified: MeasurementResult =
      'geometry' in result ? (result as MeasurementResult) : fromGeoEngine(result);
    this.currentResult = unified;
    this.history.push(unified);
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
      const km2 = result.areaKm2 ?? result.value / 1_000_000;
      title = km2 >= 1 ? `Area: ${km2.toFixed(2)} km²` : `Area: ${result.value.toFixed(0)} m²`;
    }

    const content = `Measurement: ${result.type === 'distance' ? 'distance' : 'area'} — ${result.vertexCount} vertices`;

    // Clear the result after saving
    this.currentResult = null;

    return { title, content, geometry: result.geometry };
  }
}
