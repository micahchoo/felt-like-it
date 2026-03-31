import type { InteractionState, DrawTool } from '$lib/stores/map-editor-state.svelte.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface KeyboardShortcutsDeps {
  getEffectiveReadonly: () => boolean;
  getDesignMode: () => boolean;
  getInteractionState: () => InteractionState;
  transitionTo: (next: InteractionState) => void;
  undoStore: {
    undo: () => void;
    redo: () => void;
  };
  selectionStore: {
    setActiveTool: (tool: DrawTool) => void;
  };
  toggleDesignMode: () => void;
  toggleMeasurement?: () => void;
}

// ── Composable ──────────────────────────────────────────────────────────────

/**
 * Keyboard shortcut handler for the map editor.
 * Returns the event handler function to attach to `svelte:window onkeydown`.
 *
 * Shortcuts:
 * - Escape: cancel drawRegion/pickFeature interaction
 * - Ctrl+\: toggle design mode
 * - Ctrl+Z / Ctrl+Shift+Z: undo/redo
 * - 1/2/3: switch drawing tools (select/point/polygon)
 */
export function useKeyboardShortcuts(deps: KeyboardShortcutsDeps) {
  function handleKeydown(e: KeyboardEvent) {
    if (deps.getEffectiveReadonly()) return;

    if (e.key === 'Escape') {
      const state = deps.getInteractionState();
      if (state.type === 'drawRegion' || state.type === 'pickFeature') {
        deps.transitionTo({ type: 'idle' });
        return;
      }
    }

    // M — toggle measurement mode (skip when in text inputs)
    const tag = (e.target as HTMLElement)?.tagName;
    if (
      e.key.toLowerCase() === 'm' &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.shiftKey &&
      tag !== 'INPUT' &&
      tag !== 'TEXTAREA' &&
      tag !== 'SELECT' &&
      !(e.target as HTMLElement)?.isContentEditable
    ) {
      e.preventDefault();
      deps.toggleMeasurement?.();
      return;
    }

    // Skip when focus is inside a text input
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.target as HTMLElement)?.isContentEditable) return;

    // Ctrl+\ — toggle design mode
    if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
      e.preventDefault();
      deps.toggleDesignMode();
      return;
    }

    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        deps.undoStore.redo();
      } else {
        deps.undoStore.undo();
      }
      return;
    }

    // 1/2/3 — switch drawing tools (only in editing mode, no modifier keys, not in text inputs)
    const tag2 = (e.target as HTMLElement)?.tagName;
    if (
      !deps.getDesignMode() &&
      !mod &&
      !e.shiftKey &&
      !e.altKey &&
      tag2 !== 'INPUT' &&
      tag2 !== 'TEXTAREA' &&
      !(e.target as HTMLElement)?.isContentEditable
    ) {
      switch (e.key) {
        case '1':
          deps.selectionStore.setActiveTool('select');
          break;
        case '2':
          deps.selectionStore.setActiveTool('point');
          break;
        case '3':
          deps.selectionStore.setActiveTool('polygon');
          break;
      }
    }
  }

  return { handleKeydown };
}
