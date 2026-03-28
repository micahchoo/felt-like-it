import { untrack } from 'svelte';
import { effectEnter, effectExit } from '$lib/debug/effect-tracker.js';
import { resolveFeatureId } from '$lib/utils/resolve-feature-id.js';
import type { Geometry } from 'geojson';
import type { InteractionState } from '$lib/stores/interaction-modes.svelte.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface InteractionBridgeDeps {
  interactionModes: {
    readonly state: InteractionState;
    transitionTo: (next: InteractionState) => void;
  };
  selectionStore: {
    readonly selectedFeature: { id?: string | number; geometry?: unknown; properties?: Record<string, unknown> | null } | null;
    readonly selectedLayerId: string | null;
    readonly activeTool: string | null;
    clearSelection: () => void;
    setActiveTool: (tool: string) => void;
  };
  getActiveSection: () => string | null;
  getDesignMode: () => boolean;
}

// ── Composable ──────────────────────────────────────────────────────────────

/**
 * Bridges interaction mode state machine with selection/tool stores.
 * Contains 5 effects that orchestrate the interaction lifecycle.
 *
 * CRITICAL: Preserves exact untrack() cycle guards to prevent infinite loops.
 * Each effect tracks only the specific reactive dependencies it needs.
 */
export function useInteractionBridge(deps: InteractionBridgeDeps) {
  const { interactionModes, selectionStore } = deps;
  const { transitionTo } = interactionModes;

  // Clean up stale modes when sidebar section changes
  $effect(() => {
    const section = deps.getActiveSection(); // track
    effectEnter('ME:sectionCleanup', { section });
    if (section !== 'annotations') {
      const currentType = untrack(() => interactionModes.state.type);
      if (
        currentType === 'drawRegion' ||
        currentType === 'pickFeature' ||
        currentType === 'pendingMeasurement'
      ) {
        transitionTo({ type: 'idle' });
      }
    }
    effectExit('ME:sectionCleanup');
  });

  // Clean up when design mode toggles
  $effect(() => {
    const designMode = deps.getDesignMode(); // track
    effectEnter('ME:designModeCleanup', { designMode });
    if (designMode) {
      transitionTo({ type: 'idle' });
      selectionStore.clearSelection();
      selectionStore.setActiveTool('select');
    }
    effectExit('ME:designModeCleanup');
  });

  // Track selection -> featureSelected
  $effect(() => {
    const feat = selectionStore.selectedFeature;
    const lid = selectionStore.selectedLayerId;
    effectEnter('ME:selectionToFeature', { featId: feat?.id, lid });
    if (feat && lid) {
      const geom = feat.geometry as Geometry | undefined;
      const fid = resolveFeatureId(feat as any);
      const currentType = untrack(() => interactionModes.state.type);
      if (geom && fid && (currentType === 'idle' || currentType === 'featureSelected')) {
        transitionTo({ type: 'featureSelected', feature: { featureId: fid, layerId: lid, geometry: geom } });
      }
    } else {
      const currentType = untrack(() => interactionModes.state.type);
      if (currentType === 'featureSelected') {
        transitionTo({ type: 'idle' });
      }
    }
    effectExit('ME:selectionToFeature');
  });

  // Dismiss featureSelected on drawing tool switch
  $effect(() => {
    const tool = selectionStore.activeTool;
    effectEnter('ME:toolDismissFeature', { tool });
    if (tool && tool !== 'select') {
      const currentType = untrack(() => interactionModes.state.type);
      if (currentType === 'featureSelected') {
        transitionTo({ type: 'idle' });
      }
      if (currentType === 'drawRegion' && tool !== 'polygon') {
        transitionTo({ type: 'idle' });
      }
    }
    effectExit('ME:toolDismissFeature');
  });

  // Feature pick capture
  $effect(() => {
    const feat = selectionStore.selectedFeature;
    const lid = selectionStore.selectedLayerId;
    effectEnter('ME:featurePickCapture', { featId: feat?.id, lid });
    if (feat && lid) {
      const current = untrack(() => interactionModes.state);
      if (current.type === 'pickFeature' && !current.picked) {
        const fid = resolveFeatureId(feat as any);
        if (fid) {
          transitionTo({
            type: 'pickFeature',
            picked: { featureId: fid, layerId: lid },
          });
        }
      }
    }
    effectExit('ME:featurePickCapture');
  });
}
