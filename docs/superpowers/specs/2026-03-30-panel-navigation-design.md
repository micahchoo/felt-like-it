# F12: Panel Navigation — Unified EditorLayout Store

**Date:** 2026-03-30
**Status:** Draft
**Author:** AI Assistant
**Type:** Simplify + Enhance

## Intent

Unify three parallel panel state systems (`activePanelIcon`, `activeSection`, `showDataTable`+`dialogs`) into a single `EditorLayout` store with URL reflection, collapsible SidePanel, and no silent interaction-mode cancellation.

## Constraints

- Svelte 5 runes (`$state`, `$derived`, `$effect`)
- SvelteKit — query params via `$page.url.searchParams`
- Must preserve current behavior: left panel and right section are independently openable
- Must not break existing component APIs (SidePanel, LayerPanel, DataTable)
- `embed` mode must continue suppressing all panels

## Flow Map

**Flow:** User clicks panel icon → layout updates consistently → state survives refresh/navigation

**Observable trigger:** Click on left rail icon, SidePanel tab, or toolbar button
**Observable outcome:** Correct panels appear/disappear, icons highlight, URL updates

### Path

1. `MapEditor.svelte` — click handler calls `editorLayout.openLeftPanel('layers')` etc.
2. `editor-layout.svelte.ts` — **[CHANGE SITE]** unified state updates, URL sync
3. Template conditionals read `editorLayout.leftPanel`, `editorLayout.rightSection`, etc.
4. `SidePanel.svelte` — receives `rightSection` + `sidePanelCollapsed` props

### Upstream contract

- User click events on buttons across MapEditor template
- Browser back/forward (popstate) for URL reflection

### Downstream contract

- `editorLayout.leftPanel` controls LayerPanel flyout visibility
- `editorLayout.rightSection` controls SidePanel content
- `editorLayout.bottomPanel` controls DataTable visibility
- `editorLayout.activeDialog` replaces `dialogs.showXDialog` booleans
- `editorLayout.sidePanelCollapsed` controls SidePanel width

### Depth justification

**Standard tier** — ≤2 subsystems (panel layout + URL sync), architecture docs exist.

## Design

### 1. EditorLayout Store

New file: `apps/web/src/lib/stores/editor-layout.svelte.ts`

```typescript
class EditorLayout {
  // Panel state
  leftPanel: 'layers' | 'processing' | null = 'layers';
  rightSection: 'annotations' | 'analysis' | 'activity' | null = 'annotations';
  bottomPanel: 'table' | null = null;
  activeDialog: 'import' | 'export' | 'share' | null = null;
  sidePanelCollapsed: boolean = false;
  filterPanelOpen: boolean = false;

  // Atomic methods
  openLeftPanel(panel: 'layers' | 'processing' | null) { this.leftPanel = panel; }
  openRightSection(section: 'annotations' | 'analysis' | 'activity' | null) { this.rightSection = section; }
  toggleBottomPanel() { this.bottomPanel = this.bottomPanel === 'table' ? null : 'table'; }
  openDialog(dialog: 'import' | 'export' | 'share' | null) { this.activeDialog = dialog; }
  toggleSidePanelCollapse() { this.sidePanelCollapsed = !this.sidePanelCollapsed; }
  toggleFilterPanel() { this.filterPanelOpen = !this.filterPanelOpen; }

  // URL serialization/deserialization
  toSearchParams(): URLSearchParams { ... }
  static fromSearchParams(params: URLSearchParams): Partial<EditorLayout> { ... }
}
```

### 2. URL Reflection

- On mount: read `?panel=&section=&table=&dialog=&collapsed=` → initialize store
- On state change: update query params via `goto('?...', { replaceState: true })`
- Debounced: batch multiple rapid changes into single URL update
- Back/forward navigation restores panel state automatically

### 3. Component Wiring

MapEditor.svelte template changes:

- Icon rail buttons call `editorLayout.openLeftPanel()` / `editorLayout.toggleBottomPanel()` etc.
- `{#if activePanelIcon === 'layers'}` → `{#if editorLayout.leftPanel === 'layers'}`
- `{#if showDataTable}` → `{#if editorLayout.bottomPanel === 'table'}`
- `dialogs.showImportDialog` → `editorLayout.activeDialog === 'import'`
- SidePanel receives `rightSection`, `sidePanelCollapsed`, and collapse toggle callback

### 4. Collapsible SidePanel

SidePanel.svelte changes:

- Accept `collapsed` prop — when true, render icon-only header row (no content)
- Width transitions: 320px → 48px (icon rail width) with CSS transition
- Collapse toggle button in SidePanel header
- Map area expands to fill freed space

### 5. Remove Silent Mode Cancellation

**Breaking change:** Remove the `$effect(() => { editorState.handleSectionChange(activeSection); })` line from MapEditor.svelte. Panel changes no longer silently cancel measurement/drawing modes. Users must explicitly cancel via the draw region banner or Esc key.

This eliminates a hidden coupling between UI layout and interaction state that caused confusing behavior (measurements disappearing when switching panels).

## Locked Decisions

| Decision                                                          | Rationale                                                                                         | Rules Out                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Independent left/right panels                                     | Users can have LayerPanel + SidePanel open simultaneously for cross-reference                     | Mutually exclusive panel toggling       |
| Don't cancel on panel change                                      | Removed `handleSectionChange` hook — panel layout is orthogonal to interaction modes              | Confirmation dialogs on panel switch    |
| Query params over hash fragments                                  | Hash reserved for future viewport state (`#zoom/lat/lng`), query params are standard for UI state | Route-per-view, hash-based state        |
| Unified `activeDialog` replaces boolean set                       | Single source of truth for dialogs, eliminates `useDialogVisibility` helper                       | Per-dialog boolean state                |
| `EditorLayout` as separate class (not merged into MapEditorState) | Panel layout is UI chrome, not editor interaction state — different lifecycle and concerns        | Merging panel state into MapEditorState |

## Open Questions

| Question                                                           | Impact                                                         | Resolution needed by                                              |
| ------------------------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| Should URL params be debounced or synchronous?                     | Debounce reduces URL thrashing but delays back/forward history | Implementation                                                    |
| Should `processing` left panel auto-open `analysis` right section? | Current code cross-wires these; keeping this would preserve UX | Implementation (recommend: yes, keep cross-wire for 'processing') |
| What's the SidePanel collapsed width?                              | 48px allows showing section icons for quick navigation         | Design (recommend: 48px)                                          |

## Referenced Documents

- `docs/research/e2e-flow-problems.md` (line 65-68) — Original F12 problem statement
- `.seeds/issues.jsonl` (id: `felt-like-it-2eaa`) — Seeds issue
- `docs/superpowers/specs/2026-03-30-reference-driven-enhancement-design.md` — Parent design doc
- `docs/research/e2e-flow-audit-consolidated.md` (line 25, 100, 127, 189) — Audit findings
- `docs/research/flow-audit-9-12.md` (line 181) — Detailed panel systems analysis
