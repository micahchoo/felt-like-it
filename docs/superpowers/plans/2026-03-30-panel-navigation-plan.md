# F12: Panel Navigation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify three parallel panel state systems into a single `EditorLayout` store with URL reflection and collapsible SidePanel.

**Architecture:** New `EditorLayout` class in `$lib/stores/editor-layout.svelte.ts` manages all panel state. MapEditor.svelte template reads from the store instead of local `$state`. URL query params sync bidirectionally. SidePanel gains a `collapsed` prop for width transitions.

**Tech Stack:** Svelte 5 runes, SvelteKit `$page.url.searchParams`, `goto({ replaceState: true })`

---

## Flow Map

**Flow:** User clicks panel icon → layout updates consistently → state survives refresh/navigation

**Observable trigger:** Click on left rail icon, SidePanel tab, or toolbar button
**Observable outcome:** Correct panels appear/disappear, icons highlight, URL updates

### Path

1. `MapEditor.svelte` — click handler calls `editorLayout.openLeftPanel('layers')` etc.
2. `editor-layout.svelte.ts` — **[CHANGE SITE]** unified state updates, URL sync
3. Template conditionals read `editorLayout.leftPanel`, `editorLayout.rightSection`, etc.
4. `SidePanel.svelte` — receives `rightSection` + `sidePanelCollapsed` props

### Flow Contracts

- Upstream: User click events on buttons across MapEditor template
- Downstream: `editorLayout.leftPanel` controls LayerPanel, `rightSection` controls SidePanel, `bottomPanel` controls DataTable, `activeDialog` controls dialogs

---

## Wave 1: EditorLayout Store + Tests

### Task 1: Create EditorLayout Store

**Flow position:** Step 1 of 3 in panel state management (user click → **EditorLayout store** → template render)
**Upstream contract:** Receives user intent (panel open/close/toggle) from click handlers
**Downstream contract:** Produces reactive panel state (`leftPanel`, `rightSection`, `bottomPanel`, `activeDialog`, `sidePanelCollapsed`, `filterPanelOpen`) for template conditionals
**Files:**

- Create: `apps/web/src/lib/stores/editor-layout.svelte.ts`
- Test: `apps/web/src/__tests__/editor-layout.test.ts`

**Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Write tests for EditorLayout store**

```typescript
// apps/web/src/__tests__/editor-layout.test.ts
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

  it('handles missing URL params gracefully', () => {
    const params = new URLSearchParams('');
    const layout = EditorLayout.fromSearchParams(params);
    expect(layout.leftPanel).toBeNull();
    expect(layout.rightSection).toBeNull();
    expect(layout.bottomPanel).toBeNull();
    expect(layout.sidePanelCollapsed).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/__tests__/editor-layout.test.ts`
Expected: FAIL with "Cannot find module '$lib/stores/editor-layout.svelte.js'"

- [ ] **Step 3: Write EditorLayout store implementation**

```typescript
// apps/web/src/lib/stores/editor-layout.svelte.ts

export type LeftPanel = 'layers' | 'processing' | null;
export type RightSection = 'annotations' | 'analysis' | 'activity' | null;
export type BottomPanel = 'table' | null;
export type Dialog = 'import' | 'export' | 'share' | null;

export class EditorLayout {
  leftPanel: LeftPanel = $state('layers');
  rightSection: RightSection = $state('annotations');
  bottomPanel: BottomPanel = $state(null);
  activeDialog: Dialog = $state(null);
  sidePanelCollapsed: boolean = $state(false);
  filterPanelOpen: boolean = $state(false);

  // ── Atomic methods ──────────────────────────────────────────────

  openLeftPanel(panel: LeftPanel): void {
    this.leftPanel = panel;
    // Cross-wire: opening 'processing' also opens 'analysis' section
    if (panel === 'processing') {
      this.rightSection = 'analysis';
    }
  }

  openRightSection(section: RightSection): void {
    this.rightSection = section;
  }

  toggleBottomPanel(): void {
    this.bottomPanel = this.bottomPanel === 'table' ? null : 'table';
  }

  openDialog(dialog: Dialog): void {
    this.activeDialog = dialog;
  }

  toggleSidePanelCollapse(): void {
    this.sidePanelCollapsed = !this.sidePanelCollapsed;
  }

  toggleFilterPanel(): void {
    this.filterPanelOpen = !this.filterPanelOpen;
  }

  // ── URL serialization ───────────────────────────────────────────

  toSearchParams(): URLSearchParams {
    const params = new URLSearchParams();
    if (this.leftPanel) params.set('panel', this.leftPanel);
    if (this.rightSection) params.set('section', this.rightSection);
    if (this.bottomPanel) params.set('table', 'true');
    if (this.activeDialog) params.set('dialog', this.activeDialog);
    if (this.sidePanelCollapsed) params.set('collapsed', 'true');
    if (this.filterPanelOpen) params.set('filter', 'true');
    return params;
  }

  static fromSearchParams(params: URLSearchParams): EditorLayout {
    const layout = new EditorLayout();
    const panel = params.get('panel');
    if (panel === 'layers' || panel === 'processing') layout.leftPanel = panel;
    const section = params.get('section');
    if (section === 'annotations' || section === 'analysis' || section === 'activity') {
      layout.rightSection = section;
    }
    if (params.get('table') === 'true') layout.bottomPanel = 'table';
    const dialog = params.get('dialog');
    if (dialog === 'import' || dialog === 'export' || dialog === 'share') {
      layout.activeDialog = dialog;
    }
    layout.sidePanelCollapsed = params.get('collapsed') === 'true';
    layout.filterPanelOpen = params.get('filter') === 'true';
    return layout;
  }

  /** Apply a partial state object (from URL params) to this instance. */
  applyPartial(partial: Partial<EditorLayout>): void {
    if (partial.leftPanel !== undefined) this.leftPanel = partial.leftPanel;
    if (partial.rightSection !== undefined) this.rightSection = partial.rightSection;
    if (partial.bottomPanel !== undefined) this.bottomPanel = partial.bottomPanel;
    if (partial.activeDialog !== undefined) this.activeDialog = partial.activeDialog;
    if (partial.sidePanelCollapsed !== undefined)
      this.sidePanelCollapsed = partial.sidePanelCollapsed;
    if (partial.filterPanelOpen !== undefined) this.filterPanelOpen = partial.filterPanelOpen;
  }

  /** Sync current state to URL without page navigation. Debounced via requestAnimationFrame. */
  #syncPending = false;
  syncToUrl(): void {
    if (this.#syncPending) return;
    this.#syncPending = true;
    requestAnimationFrame(() => {
      this.#syncPending = false;
      const params = this.toSearchParams();
      const queryString = params.toString();
      const newUrl = queryString
        ? `${window.location.pathname}?${queryString}`
        : window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/__tests__/editor-layout.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/stores/editor-layout.svelte.ts apps/web/src/__tests__/editor-layout.test.ts
git commit -m "feat(F12): create EditorLayout store with URL sync"
```

---

## Wave 2: Wire MapEditor to EditorLayout Store

### Task 2: Replace panel state in MapEditor.svelte

**Flow position:** Step 2 of 3 in panel state management (user click → EditorLayout store → **template render**)
**Upstream contract:** Receives `EditorLayout` instance with reactive panel state
**Downstream contract:** Template conditionals render correct panels based on store values
**Files:**

- Modify: `apps/web/src/lib/components/map/MapEditor.svelte`
- Test: `apps/web/src/__tests__/editor-layout.test.ts` (add integration tests)

**Skill:** `superpowers:test-driven-development`
**Codebooks:** `focus-management-across-boundaries` (panel focus traps)

- [ ] **Step 1: Add integration tests for MapEditor panel wiring**

Add to `apps/web/src/__tests__/editor-layout.test.ts`:

```typescript
describe('MapEditor panel wiring', () => {
  // These tests verify that the template conditionals correctly read from EditorLayout
  // Since we can't easily mount MapEditor in unit tests, we verify the
  // store API matches what the template expects.

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
```

- [ ] **Step 2: Replace local state with EditorLayout in MapEditor.svelte**

In `apps/web/src/lib/components/map/MapEditor.svelte`:

**Remove these lines (134-140, 158):**

```typescript
let showDataTable = $state(false);
let activePanelIcon = $state<'layers' | 'processing' | 'tables' | 'export' | null>('layers');
let showFilterPanel = $state(false);
let activeSection = $state<SectionId | null>('annotations');
const dialogs = useDialogVisibility();
```

**Add after line 54 (`const editorState = setMapEditorState();`):**

```typescript
import { EditorLayout } from '$lib/stores/editor-layout.svelte.js';

// Initialize EditorLayout from URL params
const editorLayout = new EditorLayout();
const urlState = EditorLayout.fromSearchParams(new URLSearchParams(window.location.search));
editorLayout.leftPanel = urlState.leftPanel ?? 'layers';
editorLayout.rightSection = urlState.rightSection ?? 'annotations';
editorLayout.bottomPanel = urlState.bottomPanel;
editorLayout.activeDialog = urlState.activeDialog;
editorLayout.sidePanelCollapsed = urlState.sidePanelCollapsed;
editorLayout.filterPanelOpen = urlState.filterPanelOpen;

// Sync to URL on state changes (debounced via requestAnimationFrame in syncToUrl)
$effect(() => {
  editorLayout.syncToUrl();
});
```

**Remove the `$effect` that calls `handleSectionChange` (line 183):**

```typescript
// REMOVE: $effect(() => { editorState.handleSectionChange(activeSection); });
```

**Remove import:** `import { useDialogVisibility } from './useDialogVisibility.svelte.js';`

- [ ] **Step 3: Update template conditionals in MapEditor.svelte**

Replace all occurrences in the template:

| Old                                                                                                                         | New                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `activePanelIcon === 'layers'`                                                                                              | `editorLayout.leftPanel === 'layers'`                                                                            |
| `activePanelIcon === 'processing'`                                                                                          | `editorLayout.leftPanel === 'processing'`                                                                        |
| `{#if activePanelIcon === 'layers'}`                                                                                        | `{#if editorLayout.leftPanel === 'layers'}`                                                                      |
| `onclick={() => { activePanelIcon = activePanelIcon === 'layers' ? null : 'layers'; }}`                                     | `onclick={() => { editorLayout.openLeftPanel(editorLayout.leftPanel === 'layers' ? null : 'layers'); }}`         |
| `onclick={() => { activePanelIcon = activePanelIcon === 'processing' ? null : 'processing'; activeSection = 'analysis'; }}` | `onclick={() => { editorLayout.openLeftPanel(editorLayout.leftPanel === 'processing' ? null : 'processing'); }}` |
| `showDataTable`                                                                                                             | `editorLayout.bottomPanel === 'table'`                                                                           |
| `onclick={() => { showDataTable = !showDataTable; }}`                                                                       | `onclick={() => { editorLayout.toggleBottomPanel(); }}`                                                          |
| `onclick={() => (showDataTable = !showDataTable)}`                                                                          | `onclick={() => { editorLayout.toggleBottomPanel(); }}`                                                          |
| `onclick={() => { showDataTable = true; showFilterPanel = !showFilterPanel; }}`                                             | `onclick={() => { editorLayout.toggleBottomPanel(); editorLayout.toggleFilterPanel(); }}`                        |
| `showFilterPanel`                                                                                                           | `editorLayout.filterPanelOpen`                                                                                   |
| `dialogs.showImportDialog`                                                                                                  | `editorLayout.activeDialog === 'import'`                                                                         |
| `dialogs.showExportDialog`                                                                                                  | `editorLayout.activeDialog === 'export'`                                                                         |
| `dialogs.showShareDialog`                                                                                                   | `editorLayout.activeDialog === 'share'`                                                                          |
| `onclick={() => (dialogs.showImportDialog = true)}`                                                                         | `onclick={() => { editorLayout.openDialog('import'); }}`                                                         |
| `onclick={() => (dialogs.showExportDialog = true)}`                                                                         | `onclick={() => { editorLayout.openDialog('export'); }}`                                                         |
| `onclick={() => (dialogs.showShareDialog = true)}`                                                                          | `onclick={() => { editorLayout.openDialog('share'); }}`                                                          |
| `bind:open={dialogs.showImportDialog}`                                                                                      | `onclose={() => { editorLayout.openDialog(null); }}`                                                             |
| `bind:open={dialogs.showExportDialog}`                                                                                      | `onclose={() => { editorLayout.openDialog(null); }}`                                                             |
| `bind:open={dialogs.showShareDialog}` + `onclose={() => (dialogs.showShareDialog = false)}`                                 | `onclose={() => { editorLayout.openDialog(null); }}`                                                             |
| `activeSection` (SidePanel prop)                                                                                            | `editorLayout.rightSection`                                                                                      |
| `onchange={(s) => { activeSection = s; }}`                                                                                  | `onchange={(s) => { editorLayout.openRightSection(s); }}`                                                        |
| `activeSection === 'analysis'`                                                                                              | `editorLayout.rightSection === 'analysis'`                                                                       |
| `activeSection = 'annotations'`                                                                                             | `editorLayout.openRightSection('annotations')`                                                                   |
| `activeSection = 'analysis'`                                                                                                | `editorLayout.openRightSection('analysis')`                                                                      |
| `analysisTab = 'measure'`                                                                                                   | Keep as-is (sub-tab within analysis section, not part of layout)                                                 |

- [ ] **Step 4: Update SidePanel props in MapEditor.svelte**

Change the SidePanel invocation (around line 703-711):

```svelte
<SidePanel
  sections={[...]}
  activeSection={editorLayout.rightSection}
  collapsed={editorLayout.sidePanelCollapsed}
  onchange={(s) => { editorLayout.openRightSection(s); }}
  oncollapse={() => { editorLayout.toggleSidePanelCollapse(); }}
/>
```

- [ ] **Step 5: Run tests to verify wiring**

Run: `cd apps/web && npx vitest run src/__tests__/editor-layout.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Run type check**

Run: `cd apps/web && npx svelte-check`
Expected: No errors related to EditorLayout

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/components/map/MapEditor.svelte apps/web/src/__tests__/editor-layout.test.ts
git commit -m "feat(F12): wire MapEditor to EditorLayout store, remove useDialogVisibility"
```

---

## Wave 3: Collapsible SidePanel

### Task 3: Add collapse support to SidePanel.svelte

**Flow position:** Step 3 of 3 in panel state management (user click → EditorLayout store → **SidePanel render**)
**Upstream contract:** Receives `rightSection`, `collapsed`, `onchange`, `oncollapse` props
**Downstream contract:** Renders collapsed (48px icon rail) or expanded (320px content) based on `collapsed` prop
**Files:**

- Modify: `apps/web/src/lib/components/map/SidePanel.svelte`

**Skill:** `frontend-design:frontend-design`

- [ ] **Step 1: Read current SidePanel.svelte**

Current file is 91 lines. It accepts `sections`, `activeSection`, `onchange` props.

- [ ] **Step 2: Add collapsed prop and collapse toggle**

Modify `apps/web/src/lib/components/map/SidePanel.svelte`:

```svelte
<script lang="ts">
  export type SectionId = 'annotations' | 'analysis' | 'activity';
  export type SectionDef = {
    id: SectionId;
    label: string;
    icon: string;
    count?: number;
    helpText?: string;
    content: Snippet;
  };

  interface Props {
    sections: SectionDef[];
    activeSection: SectionId | null;
    collapsed?: boolean;
    onchange: (section: SectionId | null) => void;
    oncollapse?: () => void;
  }

  let { sections, activeSection, collapsed = false, onchange, oncollapse }: Props = $props();

  function toggle(id: SectionId) {
    onchange(activeSection === id ? null : id);
  }
</script>

<div
  class="{collapsed
    ? 'w-12'
    : 'w-80'} shrink-0 flex flex-col h-full glass-panel border-l border-white/5 transition-all duration-200"
  aria-label="Side panel"
>
  <!-- Header row with collapse toggle -->
  <div class="flex items-center justify-between px-2 py-1.5 border-b border-white/5">
    {#if !collapsed}
      <span class="text-xs font-display uppercase tracking-wide text-on-surface-variant">Panel</span
      >
    {/if}
    {#if oncollapse}
      <button
        class="p-1 rounded hover:bg-white/10 transition-colors"
        onclick={() => oncollapse()}
        title={collapsed ? 'Expand panel' : 'Collapse panel'}
        aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
      >
        <svg
          class="h-4 w-4 text-on-surface-variant {collapsed ? 'rotate-180' : ''}"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path
            d="M11.354 1.646a.5.5 0 010 .708L6.707 7l4.647 4.646a.5.5 0 01-.708.708l-5-5a.5.5 0 010-.708l5-5a.5.5 0 01.708 0z"
          />
        </svg>
      </button>
    {/if}
  </div>

  {#if collapsed}
    <!-- Collapsed: show section icons only -->
    <div class="flex flex-col items-center gap-1 py-2">
      {#each sections as section (section.id)}
        <button
          class="p-2 rounded-lg transition-colors {activeSection === section.id
            ? 'bg-surface-high text-primary'
            : 'text-on-surface-variant hover:bg-surface-high'}"
          onclick={() => {
            oncollapse?.();
            toggle(section.id);
          }}
          title={section.label}
          aria-label={section.label}
        >
          <svg class="h-5 w-5" viewBox="0 0 16 16" fill="currentColor">
            <path d={section.icon} />
          </svg>
        </button>
      {/each}
    </div>
  {:else}
    <!-- Expanded: full section list with content -->
    {#each sections as section (section.id)}
      <div class="border-b border-white/5 last:border-b-0">
        <button
          class="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/5"
          class:text-primary={activeSection === section.id}
          onclick={() => toggle(section.id)}
          aria-expanded={activeSection === section.id}
          aria-controls="sidepanel-{section.id}"
        >
          <!-- Chevron -->
          <svg
            class="h-3 w-3 shrink-0 transition-transform {activeSection === section.id
              ? 'rotate-90'
              : ''} text-on-surface-variant"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path
              d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z"
            />
          </svg>
          <!-- Icon -->
          <svg
            class="h-4 w-4 shrink-0 {activeSection === section.id
              ? 'text-primary'
              : 'text-on-surface-variant'}"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d={section.icon} />
          </svg>
          <!-- Label -->
          <span class="font-semibold flex-1 {activeSection === section.id ? 'text-on-surface' : ''}"
            >{section.label}</span
          >
          <!-- Count badge -->
          {#if section.count !== undefined && section.count > 0}
            <span
              class="text-[10px] px-1.5 py-0.5 rounded-full {activeSection === section.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-surface-high text-on-surface-variant'}"
            >
              {section.count}
            </span>
          {/if}
        </button>

        {#if activeSection === section.id}
          <div class="overflow-y-auto flex-1 min-h-0" id="sidepanel-{section.id}" role="region">
            {#if section.helpText}
              <div class="px-3 py-2 text-xs text-on-surface-variant/80 border-b border-white/5">
                {section.helpText}
              </div>
            {/if}
            {@render section.content()}
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>
```

- [ ] **Step 3: Verify type check passes**

Run: `cd apps/web && npx svelte-check`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/components/map/SidePanel.svelte
git commit -m "feat(F12): add collapsible SidePanel with icon-only mode"
```

---

## Wave 4: Cleanup + Verification

### Task 4: Remove useDialogVisibility and verify

**Flow position:** Final cleanup after panel state unification
**Upstream contract:** No upstream — this is dead code removal
**Downstream contract:** No downstream — file is no longer imported
**Files:**

- Delete: `apps/web/src/lib/components/map/useDialogVisibility.svelte.ts`
- Modify: `apps/web/src/lib/components/map/MapEditor.svelte` (remove import)

**Skill:** `none`

- [ ] **Step 1: Verify useDialogVisibility is no longer imported**

Run: `grep -r 'useDialogVisibility' apps/web/src/`
Expected: No matches (only the file itself if not yet deleted)

- [ ] **Step 2: Delete the file**

```bash
rm apps/web/src/lib/components/map/useDialogVisibility.svelte.ts
```

- [ ] **Step 3: Run full test suite**

Run: `cd apps/web && npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Run type check**

Run: `cd apps/web && npx svelte-check`
Expected: No errors

- [ ] **Step 5: Run lint**

Run: `cd apps/web && npx eslint src/lib/components/map/MapEditor.svelte src/lib/components/map/SidePanel.svelte src/lib/stores/editor-layout.svelte.ts`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore(F12): remove useDialogVisibility, final cleanup"
```

---

## Wave 5: Integration Test

### Task 5: Manual flow verification

**Flow position:** End-to-end verification of the complete flow
**Upstream contract:** All previous waves complete
**Downstream contract:** User can navigate panels, state persists across refresh
**Files:**

- Test: Manual verification

**Skill:** `none`

- [ ] **Step 1: Verify panel independence**
  - Open Layers panel (left) — verify LayerPanel appears
  - Open Annotations section (right) — verify SidePanel appears
  - Both should be visible simultaneously
  - Close Layers — SidePanel should remain open

- [ ] **Step 2: Verify URL reflection**
  - Open Layers + Annotations — URL should show `?panel=layers&section=annotations`
  - Refresh page — both panels should remain open
  - Use browser back button — panel state should revert

- [ ] **Step 3: Verify SidePanel collapse**
  - Click collapse arrow — SidePanel should shrink to 48px icon rail
  - Click an icon — SidePanel should expand and show that section
  - Map area should expand to fill freed space

- [ ] **Step 4: Verify no silent mode cancellation**
  - Start a measurement (draw line/polygon)
  - Switch to a different panel section
  - Measurement result should NOT disappear

- [ ] **Step 5: Verify dialogs work**
  - Click Import — import dialog should open
  - Click Export — export dialog should open
  - Close dialog — should return to previous state

- [ ] **Step 6: Verify embed mode**
  - Load MapEditor with `embed=true` prop
  - No panels, no toolbar, no SidePanel should render

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "test(F12): verify panel navigation flow"
```

---

## Execution Waves

| Wave   | Tasks                          | Dependencies |
| ------ | ------------------------------ | ------------ |
| Wave 1 | Task 1 (EditorLayout store)    | None         |
| Wave 2 | Task 2 (Wire MapEditor)        | Wave 1       |
| Wave 3 | Task 3 (Collapsible SidePanel) | Wave 2       |
| Wave 4 | Task 4 (Cleanup)               | Wave 2       |
| Wave 5 | Task 5 (Integration test)      | Waves 1-4    |

---

## Open Questions

### Wave 1

- **Task 1:** (none — fully specified)

### Wave 2

- **Task 2:**
  - Q: Does `goto({ replaceState: true })` work correctly during SSR? (Answered: added fallback to `window.history.replaceState`)
  - Q: Does the `analysisTab` state need to be in EditorLayout? (Answered: no — it's a sub-tab within analysis, not layout state)

### Wave 3

- **Task 3:** (none — fully specified)

### Wave 4

- **Task 4:** (none — fully specified)

### Wave 5

- **Task 5:** (none — manual verification checklist)

---

## Artifact Manifest

<!-- PLAN_MANIFEST_START -->

| File                                                            | Action | Marker                       |
| --------------------------------------------------------------- | ------ | ---------------------------- |
| `apps/web/src/lib/stores/editor-layout.svelte.ts`               | create | `export class EditorLayout`  |
| `apps/web/src/__tests__/editor-layout.test.ts`                  | create | `describe('EditorLayout'`    |
| `apps/web/src/lib/components/map/MapEditor.svelte`              | patch  | `editorLayout.openLeftPanel` |
| `apps/web/src/lib/components/map/SidePanel.svelte`              | patch  | `collapsed = false`          |
| `apps/web/src/lib/components/map/useDialogVisibility.svelte.ts` | delete | file must not exist          |

<!-- PLAN_MANIFEST_END -->
