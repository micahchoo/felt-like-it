import type { Map as MapLibreMap } from 'maplibre-gl';
import { parseViewportHash, serializeViewportHash } from './viewport-hash.js';

/**
 * F13.1 — bidirectional sync between `location.hash` and a MapLibre map.
 *
 * Wire from a Svelte 5 component:
 *
 *   const stop = startShareViewportHashSync(mapInstance, mapStore);
 *   onDestroy(stop);
 *
 * Behaviours:
 *  - On start, if `location.hash` parses to a valid viewport, the map jumps
 *    there (overriding any owner-saved viewport).
 *  - As the user pans/zooms (`moveend`), the hash is updated via
 *    `history.replaceState` — no history pollution, no scroll jump.
 *  - Writes are debounced (250ms) so a rapid pan emits one hash update.
 *  - Listens for `hashchange` so manual URL-bar edits re-apply.
 *
 * Returns a cleanup function. Calling it removes listeners + clears any
 * pending debounce.
 */

const HASH_WRITE_DEBOUNCE_MS = 250;

export interface MapStoreLike {
  loadViewport(viewport: {
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
  }): void;
}

export function startShareViewportHashSync(
  map: MapLibreMap,
  mapStore: MapStoreLike,
): () => void {
  // Apply any hash present at start. If invalid/missing, the map keeps the
  // owner-saved viewport that was loaded just before this composable was
  // wired in (ShareViewerScreen calls mapStore.loadViewport in onMount).
  applyHashToMap(window.location.hash, mapStore);

  let writeTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleHashWrite() {
    if (writeTimer !== null) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      writeTimer = null;
      const c = map.getCenter();
      const next = serializeViewportHash({
        zoom: map.getZoom(),
        lat: c.lat,
        lng: c.lng,
      });
      // Only write if the hash actually changed — avoids feedback loops with
      // the hashchange listener and reduces history-state churn.
      if (next !== window.location.hash) {
        history.replaceState(history.state, '', next);
      }
    }, HASH_WRITE_DEBOUNCE_MS);
  }

  function onHashChange() {
    applyHashToMap(window.location.hash, mapStore);
  }

  map.on('moveend', scheduleHashWrite);
  window.addEventListener('hashchange', onHashChange);

  return () => {
    map.off('moveend', scheduleHashWrite);
    window.removeEventListener('hashchange', onHashChange);
    if (writeTimer !== null) clearTimeout(writeTimer);
  };
}

function applyHashToMap(hash: string, mapStore: MapStoreLike): void {
  const parsed = parseViewportHash(hash);
  if (!parsed) return;
  // bearing + pitch default to 0 — F13.1 keeps the share-viewport state to
  // 2D pan/zoom only. If a future iteration wants to share a 3D camera,
  // extend the hash format and the codec atomically.
  mapStore.loadViewport({
    center: [parsed.lng, parsed.lat],
    zoom: parsed.zoom,
    bearing: 0,
    pitch: 0,
  });
}
