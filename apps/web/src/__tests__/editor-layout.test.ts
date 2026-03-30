import { describe, it, expect } from 'vitest';
import { EditorLayout } from '$lib/stores/editor-layout.svelte.js';

describe('EditorLayout', () => {
  it('initializes with default state', () => {
    const layout = new EditorLayout();
    expect(layout.leftPanel).toBe('layers');
    expect(layout.rightSection).toBe('annotations');
    expect(layout.bottomPanel).toBeNull();
    expect(layout.activeDialog).toBeNull();
    expect(layout.sidePanelCollapsed).toBe(false);
    expect(layout.filterPanelOpen).toBe(false);
  });

  it('toggles left panel', () => {
    const layout = new EditorLayout();
    layout.openLeftPanel('layers');
    expect(layout.leftPanel).toBe('layers');
    layout.openLeftPanel(null);
    expect(layout.leftPanel).toBeNull();
  });

  it('toggles bottom panel', () => {
    const layout = new EditorLayout();
    layout.toggleBottomPanel();
    expect(layout.bottomPanel).toBe('table');
    layout.toggleBottomPanel();
    expect(layout.bottomPanel).toBeNull();
  });

  it('opens and closes dialogs', () => {
    const layout = new EditorLayout();
    layout.openDialog('import');
    expect(layout.activeDialog).toBe('import');
    layout.openDialog(null);
    expect(layout.activeDialog).toBeNull();
  });

  it('toggles side panel collapse', () => {
    const layout = new EditorLayout();
    layout.toggleSidePanelCollapse();
    expect(layout.sidePanelCollapsed).toBe(true);
    layout.toggleSidePanelCollapse();
    expect(layout.sidePanelCollapsed).toBe(false);
  });

  it('cross-wires processing to analysis section', () => {
    const layout = new EditorLayout();
    layout.openLeftPanel('processing');
    expect(layout.rightSection).toBe('analysis');
  });

  it('serializes to URL params', () => {
    const layout = new EditorLayout();
    layout.leftPanel = 'layers';
    layout.rightSection = 'annotations';
    layout.bottomPanel = 'table';
    layout.sidePanelCollapsed = true;
    const params = layout.toSearchParams();
    expect(params.get('panel')).toBe('layers');
    expect(params.get('section')).toBe('annotations');
    expect(params.get('table')).toBe('true');
    expect(params.get('collapsed')).toBe('true');
  });

  it('deserializes from URL params', () => {
    const params = new URLSearchParams('panel=layers&section=analysis&table=true&collapsed=true');
    const layout = EditorLayout.fromSearchParams(params);
    expect(layout.leftPanel).toBe('layers');
    expect(layout.rightSection).toBe('analysis');
    expect(layout.bottomPanel).toBe('table');
    expect(layout.sidePanelCollapsed).toBe(true);
  });

  it('handles missing URL params gracefully (uses defaults)', () => {
    const params = new URLSearchParams('');
    const layout = EditorLayout.fromSearchParams(params);
    // fromSearchParams creates a new instance, so defaults apply
    expect(layout.leftPanel).toBe('layers');
    expect(layout.rightSection).toBe('annotations');
    expect(layout.bottomPanel).toBeNull();
    expect(layout.sidePanelCollapsed).toBe(false);
  });
});

describe('MapEditor panel wiring', () => {
  it('supports independent left and right panels', () => {
    const layout = new EditorLayout();
    layout.openLeftPanel('layers');
    layout.openRightSection('annotations');
    expect(layout.leftPanel).toBe('layers');
    expect(layout.rightSection).toBe('annotations');
  });

  it('supports bottom panel independently of left/right', () => {
    const layout = new EditorLayout();
    layout.openLeftPanel('layers');
    layout.toggleBottomPanel();
    expect(layout.leftPanel).toBe('layers');
    expect(layout.bottomPanel).toBe('table');
  });

  it('supports dialog independently of panels', () => {
    const layout = new EditorLayout();
    layout.openDialog('export');
    layout.openLeftPanel('layers');
    expect(layout.activeDialog).toBe('export');
    expect(layout.leftPanel).toBe('layers');
  });
});
