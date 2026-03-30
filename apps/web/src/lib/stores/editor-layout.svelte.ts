import type { Snippet } from 'svelte';

// ── Types ──────────────────────────────────────────────────────────────────

export type LeftPanel = 'layers' | 'processing' | null;
export type RightSection = 'annotations' | 'analysis' | 'activity' | null;
export type BottomPanel = 'table' | null;
export type Dialog = 'import' | 'export' | 'share' | null;

export type SectionId = RightSection;
export type SectionDef = {
  id: SectionId;
  label: string;
  icon: string;
  count?: number;
  helpText?: string;
  content: Snippet;
};

// ── Class ──────────────────────────────────────────────────────────────────

export class EditorLayout {
  leftPanel: LeftPanel = $state('layers');
  rightSection: RightSection = $state('annotations');
  bottomPanel: BottomPanel = $state(null);
  activeDialog: Dialog = $state(null);
  sidePanelCollapsed: boolean = $state(false);
  filterPanelOpen: boolean = $state(false);

  // ── Atomic methods ─────────────────────────────────────────────────────

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

  // ── URL serialization ──────────────────────────────────────────────────

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

  // ── URL sync (debounced via requestAnimationFrame) ─────────────────────

  #syncPending = false;

  /** Sync current state to URL without page navigation. Debounced via rAF. */
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
