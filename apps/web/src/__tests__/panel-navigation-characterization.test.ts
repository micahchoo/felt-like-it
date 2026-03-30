import { describe, it, expect } from 'vitest';

/**
 * Characterization tests for F12: Panel Navigation
 * These document CURRENT behavior before changes are made.
 * They verify the existing state systems and their interactions.
 */

describe('Characterization: MapEditorState.handleSectionChange', () => {
  it('cancels drawRegion when section changes away from annotations', async () => {
    const { MapEditorState } = await import('$lib/stores/map-editor-state.svelte.js');
    const state = new MapEditorState();
    state.transitionTo({ type: 'drawRegion' });
    expect(state.interactionState.type).toBe('drawRegion');
    state.handleSectionChange('analysis');
    expect(state.interactionState.type).toBe('idle');
  });

  it('cancels pickFeature when section changes away from annotations', async () => {
    const { MapEditorState } = await import('$lib/stores/map-editor-state.svelte.js');
    const state = new MapEditorState();
    state.transitionTo({ type: 'pickFeature' });
    expect(state.interactionState.type).toBe('pickFeature');
    state.handleSectionChange('activity');
    expect(state.interactionState.type).toBe('idle');
  });

  it('cancels pendingMeasurement when section changes away from annotations', async () => {
    const { MapEditorState } = await import('$lib/stores/map-editor-state.svelte.js');
    const state = new MapEditorState();
    state.transitionTo({
      type: 'pendingMeasurement',
      anchor: {
        type: 'measurement',
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
      },
      content: {
        type: 'measurement',
        measurementType: 'distance',
        value: 100,
        unit: 'm',
        displayValue: '100m',
      },
    });
    expect(state.interactionState.type).toBe('pendingMeasurement');
    state.handleSectionChange('analysis');
    expect(state.interactionState.type).toBe('idle');
  });

  it('does NOT cancel when section stays annotations', async () => {
    const { MapEditorState } = await import('$lib/stores/map-editor-state.svelte.js');
    const state = new MapEditorState();
    state.transitionTo({ type: 'drawRegion' });
    state.handleSectionChange('annotations');
    expect(state.interactionState.type).toBe('drawRegion');
  });

  it('does NOT cancel idle state', async () => {
    const { MapEditorState } = await import('$lib/stores/map-editor-state.svelte.js');
    const state = new MapEditorState();
    expect(state.interactionState.type).toBe('idle');
    state.handleSectionChange('analysis');
    expect(state.interactionState.type).toBe('idle');
  });

  it('does NOT cancel featureSelected state', async () => {
    const { MapEditorState } = await import('$lib/stores/map-editor-state.svelte.js');
    const state = new MapEditorState();
    state.transitionTo({
      type: 'featureSelected',
      feature: {
        featureId: '1',
        layerId: 'test',
        geometry: { type: 'Point', coordinates: [0, 0] },
      },
    });
    state.handleSectionChange('analysis');
    expect(state.interactionState.type).toBe('featureSelected');
  });
});

describe('Characterization: SidePanel props', () => {
  it('accepts activeSection prop', async () => {
    // SidePanel.svelte currently uses `activeSection` prop
    // This test verifies the prop name by checking the source
    const fs = await import('fs');
    const content = fs.readFileSync('src/lib/components/map/SidePanel.svelte', 'utf-8');
    expect(content).toContain('activeSection');
    expect(content).not.toContain('rightSection');
  });

  it('has collapsed and oncollapse props for SidePanel collapse support', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('src/lib/components/map/SidePanel.svelte', 'utf-8');
    expect(content).toContain('collapsed');
    expect(content).toContain('oncollapse');
    // activeSection prop name preserved for API stability
    expect(content).toContain('activeSection');
    expect(content).not.toContain('rightSection');
  });
});

describe('Characterization: MapEditor panel state variables', () => {
  it('uses editorLayout.leftPanel for left rail (was activePanelIcon)', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('src/lib/components/map/MapEditor.svelte', 'utf-8');
    // activePanelIcon should not be used as a state variable (may appear in comments)
    const lines = content.split('\n').filter((l) => !l.trim().startsWith('//'));
    const codeOnly = lines.join('\n');
    expect(codeOnly).not.toContain('activePanelIcon');
    expect(content).toContain('editorLayout.leftPanel');
    expect(content).toContain("'layers'");
    expect(content).toContain("'processing'");
  });

  it('uses editorLayout.rightSection for right panel (was activeSection)', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('src/lib/components/map/MapEditor.svelte', 'utf-8');
    // activeSection should not be used as local state (SidePanel prop name is still activeSection)
    expect(content).not.toMatch(/\$state.*activeSection|let activeSection/);
    expect(content).toContain('editorLayout.rightSection');
  });

  it('uses editorLayout.bottomPanel for bottom panel (was showDataTable)', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('src/lib/components/map/MapEditor.svelte', 'utf-8');
    expect(content).not.toContain('showDataTable');
    expect(content).toContain('editorLayout.bottomPanel');
  });

  it('uses EditorLayout store instead of useDialogVisibility', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('src/lib/components/map/MapEditor.svelte', 'utf-8');
    expect(content).not.toContain('useDialogVisibility');
    expect(content).toContain('editor-layout.svelte');
    expect(content).toContain('editorLayout.activeDialog');
    expect(content).toContain('editorLayout.leftPanel');
    expect(content).toContain('editorLayout.rightSection');
  });

  it('processing button toggles leftPanel independently (no cross-wiring to rightSection)', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('src/lib/components/map/MapEditor.svelte', 'utf-8');
    // Processing button only toggles leftPanel — no cross-wiring to rightSection
    expect(content).toContain("editorLayout.openLeftPanel(editorLayout.leftPanel === 'processing'");
    // Should NOT have the old cross-wiring pattern
    expect(content).not.toMatch(
      /activeSection.*=.*'analysis'.*activePanelIcon|activePanelIcon.*activeSection.*'analysis'/
    );
  });

  it('no longer has handleSectionChange effect', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('src/lib/components/map/MapEditor.svelte', 'utf-8');
    expect(content).not.toContain('editorState.handleSectionChange');
  });

  it('SidePanel supports collapse with w-12 collapsed and w-80 expanded', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('src/lib/components/map/SidePanel.svelte', 'utf-8');
    expect(content).toContain('w-80');
    expect(content).toContain('w-12');
    expect(content).toContain('collapsed');
    expect(content).toContain('oncollapse');
  });
});
