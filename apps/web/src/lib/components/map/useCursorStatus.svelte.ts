import type { Map as MaplibreMap } from 'maplibre-gl';

export function useCursorStatus(deps: { getMap: () => MaplibreMap | null | undefined }) {
  let cursorLat = $state<number | null>(null);
  let cursorLng = $state<number | null>(null);
  let currentZoom = $state(0);

  $effect(() => {
    const map = deps.getMap();
    if (!map) return;

    const onMouseMove = (e: { lngLat: { lat: number; lng: number } }) => {
      cursorLat = e.lngLat.lat;
      cursorLng = e.lngLat.lng;
    };
    const onZoom = () => {
      currentZoom = map.getZoom();
    };

    currentZoom = map.getZoom();
    map.on('mousemove', onMouseMove);
    map.on('zoom', onZoom);

    return () => {
      map.off('mousemove', onMouseMove);
      map.off('zoom', onZoom);
    };
  });

  return {
    get cursorLat() {
      return cursorLat;
    },
    get cursorLng() {
      return cursorLng;
    },
    get currentZoom() {
      return currentZoom;
    },
  };
}
