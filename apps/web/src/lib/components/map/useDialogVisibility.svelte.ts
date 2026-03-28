/**
 * Composable managing the open/close state for Import, Export, and Share dialogs.
 * Purely reactive state — no side effects.
 */
export function useDialogVisibility() {
  let showImportDialog = $state(false);
  let showExportDialog = $state(false);
  let showShareDialog = $state(false);

  return {
    get showImportDialog() { return showImportDialog; },
    set showImportDialog(v: boolean) { showImportDialog = v; },

    get showExportDialog() { return showExportDialog; },
    set showExportDialog(v: boolean) { showExportDialog = v; },

    get showShareDialog() { return showShareDialog; },
    set showShareDialog(v: boolean) { showShareDialog = v; },

    openImport() { showImportDialog = true; },
    closeImport() { showImportDialog = false; },
    openExport() { showExportDialog = true; },
    closeExport() { showExportDialog = false; },
    openShare() { showShareDialog = true; },
    closeShare() { showShareDialog = false; },
  };
}
