import type { Map as MapLibreMap } from 'maplibre-gl';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ViewportSaveDeps {
  mapId: string;
  getMapInstance: () => MapLibreMap | undefined;
  saveViewportLocally: (mapId: string) => void;
}

// ── Composable ──────────────────────────────────────────────────────────────

/**
 * Persists the viewport to localStorage on every `moveend` event.
 * This ensures the user returns to the same position when they navigate
 * away and back. Call once at component mount — the internal $effect
 * handles map instance lifecycle.
 */
export function useViewportSave(deps: ViewportSaveDeps) {
  $effect(() => {
    const map = deps.getMapInstance();
    if (!map) return;

    function persistViewport() {
      deps.saveViewportLocally(deps.mapId);
    }

    map.on('moveend', persistViewport);
    return () => {
      map.off('moveend', persistViewport);
    };
  });
}
