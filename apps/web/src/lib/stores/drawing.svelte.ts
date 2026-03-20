import type { Map as MapLibreMap } from 'maplibre-gl';
import type { TerraDraw } from 'terra-draw';

type DrawingState =
  | { status: 'idle' }
  | { status: 'importing'; generation: number }
  | { status: 'ready'; instance: TerraDraw; generation: number }
  | { status: 'stopped' };

let _state = $state<DrawingState>({ status: 'idle' });
let _generation = 0;

export const drawingStore = {
  get state() { return _state; },
  get isReady() { return _state.status === 'ready'; },
  get instance() { return _state.status === 'ready' ? _state.instance : null; },

  async init(map: MapLibreMap): Promise<TerraDraw | null> {
    const gen = ++_generation;
    _state = { status: 'importing', generation: gen };

    const { TerraDraw, TerraDrawPointMode, TerraDrawLineStringMode, TerraDrawPolygonMode, TerraDrawSelectMode } = await import('terra-draw');
    const { TerraDrawMapLibreGLAdapter } = await import('terra-draw-maplibre-gl-adapter');

    // Abort if a newer init started while we were importing
    if (gen !== _generation) return null;

    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawPointMode(),
        new TerraDrawLineStringMode(),
        new TerraDrawPolygonMode({ snapping: { toLine: true, toCoordinate: true } }),
        new TerraDrawSelectMode(),
      ],
    });

    draw.start();
    _state = { status: 'ready', instance: draw, generation: gen };
    return draw;
  },

  stop() {
    if (_state.status !== 'ready') {
      _state = { status: 'stopped' };
      return;
    }
    try {
      _state.instance.stop();
    } catch (err) {
      console.error('Drawing store stop() failed:', err);
    }
    _state = { status: 'stopped' };
  },

  reset() {
    if (_state.status === 'idle') return; // no-op guard — prevents reactive churn
    if (_state.status === 'ready') {
      _state.instance.stop();
    }
    _state = { status: 'idle' };
  },
};
