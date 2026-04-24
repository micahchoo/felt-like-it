import type { MeasurementStore } from '$lib/stores/measurement-store.svelte.js';
import type { Map as MaplibreMap } from 'maplibre-gl';

export function useMeasurementTooltip(deps: {
  getMeasurementStore: () => MeasurementStore;
  getMap: () => MaplibreMap | null | undefined;
  getDesignMode: () => boolean;
}) {
  let tooltipPos = $state<{ x: number; y: number }>({ x: 50, y: 50 });

  const measureActive = $derived(deps.getMeasurementStore().active && !deps.getDesignMode());

  $effect(() => {
    const result = deps.getMeasurementStore().currentResult;
    const map = deps.getMap();
    if (!result || !map) {
      tooltipPos = { x: 50, y: 50 };
      return;
    }

    const geom = result.geometry;
    let centroid: [number, number];

    if (geom.type === 'LineString') {
      const coords = geom.coordinates as [number, number][];
      const mid = Math.floor(coords.length / 2);
      centroid = coords[mid] ?? [0, 0];
    } else if (geom.type === 'Polygon') {
      const ring = geom.coordinates[0] as [number, number][];
      const avg = ring.reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1]], [0, 0] as [
        number,
        number,
      ]);
      centroid = [avg[0] / ring.length, avg[1] / ring.length];
    } else {
      centroid = [0, 0];
    }

    try {
      const point = map.project(centroid);
      tooltipPos = { x: point.x, y: point.y };
    } catch {
      tooltipPos = { x: 50, y: 50 };
    }
  });

  $effect(() => {
    if (!measureActive) deps.getMeasurementStore().clear();
  });

  return {
    get tooltipPos() {
      return tooltipPos;
    },
    get measureActive() {
      return measureActive;
    },
  };
}
