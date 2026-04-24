import type { DistanceMeasurement, AreaMeasurement } from '@felt-like-it/geo-engine';

export type MeasurementLineString = { type: 'LineString'; coordinates: [number, number][] };
export type MeasurementPolygon = { type: 'Polygon'; coordinates: [number, number][][] };

/** Unified measurement result — discriminated union so TS narrows
 *  distance-only vs area-only fields and geometry shape by `type`. */
export type MeasurementResult =
  | {
      type: 'distance';
      value: number;
      vertexCount: number;
      distanceKm: number;
      geometry: MeasurementLineString;
    }
  | {
      type: 'area';
      value: number;
      vertexCount: number;
      areaM2: number;
      areaKm2: number;
      perimeterKm: number;
      geometry: MeasurementPolygon;
    };

export interface SaveAsAnnotationPayload {
  title: string;
  content: string;
  geometry: MeasurementLineString | MeasurementPolygon;
}

/** Convert geo-engine DistanceMeasurement/AreaMeasurement to unified MeasurementResult. */
function fromGeoEngine(result: DistanceMeasurement | AreaMeasurement): MeasurementResult {
  if (result.type === 'distance') {
    return {
      type: 'distance',
      value: result.distanceKm * 1000,
      vertexCount: result.vertexCount,
      distanceKm: result.distanceKm,
      geometry: { type: 'LineString', coordinates: result.coordinates as [number, number][] },
    };
  }
  return {
    type: 'area',
    value: result.areaM2,
    vertexCount: result.vertexCount,
    areaM2: result.areaM2,
    areaKm2: result.areaM2 / 1_000_000,
    perimeterKm: result.perimeterKm,
    geometry: { type: 'Polygon', coordinates: result.coordinates as [number, number][][] },
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
