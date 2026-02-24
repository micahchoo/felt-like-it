<script lang="ts">
  /**
   * Renders deck.gl layers on top of a MapLibre map using MapboxOverlay.
   *
   * MapboxOverlay implements the MapLibre IControl interface; adding it to the map
   * mounts a separate canvas positioned above the map canvas (interleaved: false).
   * Because it is a pure side-effect component (no DOM output), this element renders
   * nothing itself — all rendering happens via the deck.gl canvas injected by
   * map.addControl().
   */
  import type { Map as MapLibreMap } from 'maplibre-gl';
  import { MapboxOverlay } from '@deck.gl/mapbox';
  import { HeatmapLayer } from 'deck.gl';

  /** A single point feature used by HeatmapLayer — Point geometry only. */
  interface PointFeature {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: Record<string, unknown> | null;
  }

  export interface HeatmapLayerDef {
    /** Unique layer id — becomes the deck.gl layer id. */
    id: string;
    /** Point features to visualise — non-Point geometries are pre-filtered by the caller. */
    features: PointFeature[];
    /** Kernel radius in screen pixels (1–200). */
    radiusPixels: number;
    /** Overall intensity multiplier (0.1–5). */
    intensity: number;
    /**
     * Feature property used as a per-point weight.
     * Non-numeric values at render time fall back to 1.
     * When omitted every point has equal weight.
     */
    weightAttribute?: string;
  }

  interface Props {
    map: MapLibreMap | undefined;
    layers: HeatmapLayerDef[];
  }

  let { map, layers }: Props = $props();

  /**
   * Holds the active overlay instance so that the sync effect can call setProps.
   * $state is intentional here: the sync effect reads this value and must re-run
   * whenever the overlay is created or destroyed.
   */
  let overlay = $state<MapboxOverlay | null>(null);

  // ── Lifecycle: create / destroy overlay with the map ─────────────────────

  $effect(() => {
    if (!map) return;
    // interleaved: false → deck.gl renders on its own canvas above the MapLibre canvas.
    // This avoids shared-WebGL-context complexities and is fully compatible with MapLibre 5.
    const o = new MapboxOverlay({ interleaved: false, layers: [] });
    // MapboxOverlay satisfies the MapLibre IControl interface at runtime.
    // The type cast is necessary because @deck.gl/mapbox bundles its own IControl
    // type definition that may not perfectly match maplibre-gl 5's signature.
    map.addControl(o as unknown as Parameters<MapLibreMap['addControl']>[0]);
    overlay = o;

    return () => {
      map.removeControl(o as unknown as Parameters<MapLibreMap['removeControl']>[0]);
      overlay = null;
    };
  });

  // ── Sync: push updated HeatmapLayers to the overlay ──────────────────────

  $effect(() => {
    if (!overlay) return;

    const deckLayers = layers.map(({ id, features, radiusPixels, intensity, weightAttribute }) =>
      new HeatmapLayer<PointFeature>({
        id,
        data: features,
        getPosition: (d) => d.geometry.coordinates,
        getWeight: weightAttribute
          ? (d) => {
              const v = d.properties?.[weightAttribute];
              return typeof v === 'number' ? v : 1;
            }
          : 1,
        radiusPixels,
        intensity,
        // threshold: fraction of max weight below which pixels are hidden.
        // 0.03 keeps faint edges while avoiding hard cutoffs.
        threshold: 0.03,
      })
    );

    overlay.setProps({ layers: deckLayers });
  });
</script>
