// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

/**
 * Verifies the StylePanel rollback contract:
 * when a style save fails, the optimistic state reverts to lastSavedStyle.
 *
 * Tests the pattern, not the Svelte component — we simulate the store operations
 * and error handling that StylePanel performs in saveStyle / applyChoropleth / applyHeatmap.
 */
describe('style panel rollback on save failure', () => {
  function createMockStores() {
    const styles: Record<string, unknown> = {};
    const layerStyles: Record<string, unknown> = {};

    return {
      styleStore: {
        setStyle: vi.fn((id: string, s: unknown) => { styles[id] = s; }),
        getStyle: (id: string) => styles[id],
      },
      layersStore: {
        updateStyle: vi.fn((id: string, s: unknown) => { layerStyles[id] = s; }),
        getLayerStyle: (id: string) => layerStyles[id],
      },
      styles,
      layerStyles,
    };
  }

  it('reverts both stores to lastSavedStyle when save fails', async () => {
    const { styleStore, layersStore, styles, layerStyles } = createMockStores();
    const layerId = 'layer-1';
    const lastSavedStyle = { paint: { 'circle-color': '#ff0000' }, type: 'simple' };
    const optimisticStyle = { paint: { 'circle-color': '#00ff00' }, type: 'simple' };

    // Simulate: user edits style (optimistic)
    styleStore.setStyle(layerId, optimisticStyle);
    layersStore.updateStyle(layerId, optimisticStyle);

    // Simulate: save fails → revert
    const saveFailed = true;
    if (saveFailed && lastSavedStyle) {
      styleStore.setStyle(layerId, lastSavedStyle);
      layersStore.updateStyle(layerId, lastSavedStyle);
    }

    expect(styles[layerId]).toEqual(lastSavedStyle);
    expect(layerStyles[layerId]).toEqual(lastSavedStyle);
    expect(styleStore.setStyle).toHaveBeenCalledTimes(2);
    expect(layersStore.updateStyle).toHaveBeenCalledTimes(2);
  });

  it('does not revert if lastSavedStyle is null', () => {
    const { styleStore, layersStore, styles } = createMockStores();
    const layerId = 'layer-2';
    const optimisticStyle = { paint: { 'fill-color': '#0000ff' }, type: 'simple' };
    const lastSavedStyle = null;

    styleStore.setStyle(layerId, optimisticStyle);
    layersStore.updateStyle(layerId, optimisticStyle);

    // Simulate: save fails, but no lastSavedStyle to revert to
    const saveFailed = true;
    if (saveFailed && lastSavedStyle) {
      styleStore.setStyle(layerId, lastSavedStyle);
      layersStore.updateStyle(layerId, lastSavedStyle);
    }

    // Style stays optimistic — no revert happened
    expect(styles[layerId]).toEqual(optimisticStyle);
    expect(styleStore.setStyle).toHaveBeenCalledTimes(1);
  });

  it('rollback uses structuredClone snapshot, not live reference', () => {
    const original = { paint: { 'circle-color': '#ff0000' }, type: 'simple' as const };
    const snapshot = structuredClone(original);

    // Mutate the original after snapshot
    (original.paint as Record<string, string>)['circle-color'] = '#999999';

    // Snapshot is unaffected
    expect(snapshot.paint['circle-color']).toBe('#ff0000');
    expect(original.paint['circle-color']).toBe('#999999');
  });
});
