<script lang="ts">
  import Modal from '$lib/components/ui/Modal.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import { formatFileSize } from '$lib/utils/format.js';

  interface Props {
    mapId: string;
    open: boolean;
    onimported?: (_layerId: string) => void;
  }

  let { mapId, open = $bindable(), onimported }: Props = $props();

  let dragOver = $state(false);
  let selectedFile = $state<File | null>(null);
  let layerName = $state('');
  let uploading = $state(false);
  let jobId = $state<string | null>(null);
  let progress = $state(0);
  let pollTimedOut = $state(false);
  let pollStartTime = 0;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let pollStartedAt: number | null = null;
  let elapsedSeconds = $state(0);
  let elapsedInterval: ReturnType<typeof setInterval> | null = null;
  let pollRetries = $state(0);
  let abortController: AbortController | null = null;
  const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  const ACCEPTED_TYPES = ['.geojson', '.json', '.csv', '.kml', '.gpx', '.gpkg', '.geojsonl', '.zip'];

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const file = e.dataTransfer?.files[0];
    if (file) setFile(file);
  }

  function handleFileInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) setFile(file);
  }

  function setFile(file: File) {
    const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase();
    if (!ACCEPTED_TYPES.includes(ext)) {
      toastStore.error(`Unsupported file type: ${ext}. Accepted: ${ACCEPTED_TYPES.join(', ')}`);
      return;
    }
    selectedFile = file;
    layerName = file.name.replace(/\.[^.]+$/, '');
  }

  async function startUpload() {
    if (!selectedFile) return;
    uploading = true;
    progress = 0;
    abortController = new AbortController();

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('mapId', mapId);
      formData.append('layerName', layerName.trim() || selectedFile.name);

      const res = await fetch('/api/upload', { method: 'POST', body: formData, signal: abortController.signal });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Upload failed' }));
        throw new Error((err as { message?: string }).message ?? 'Upload failed');
      }

      const data = await res.json() as { jobId: string };
      jobId = data.jobId;

      // Poll for progress
      pollStartTime = Date.now();
      pollRetries = 0;
      pollInterval = setInterval(pollJob, 1500);
      pollStartedAt = Date.now();
      elapsedSeconds = 0;
      elapsedInterval = setInterval(() => {
        elapsedSeconds = Math.floor((Date.now() - (pollStartedAt ?? Date.now())) / 1000);
      }, 1000);
    } catch (err) {
      toastStore.error(String(err instanceof Error ? err.message : 'Upload failed'));
      uploading = false;
    }
  }

  async function pollJob() {
    if (!jobId) return;

    if (pollStartedAt && Date.now() - pollStartedAt > POLL_TIMEOUT_MS) {
      clearInterval(pollInterval!);
      pollInterval = null;
      uploading = false;
      toastStore.error('Import is taking longer than expected. Check back later or try a smaller file.');
      return;
    }

    try {
      const res = await fetch(`/api/job/${jobId}`);
      const job = await res.json() as { status: string; progress: number; layerId?: string; errorMessage?: string };

      progress = job.progress ?? 0;

      if (job.status === 'done') {
        clearInterval(pollInterval!);
        pollInterval = null;
        uploading = false;
        progress = 100;
        toastStore.success(`Import complete!`);
        if (job.layerId) onimported?.(job.layerId);
        reset();
        open = false;
      } else if (job.status === 'failed') {
        clearInterval(pollInterval!);
        pollInterval = null;
        uploading = false;
        toastStore.error(job.errorMessage ?? 'Import failed.');
      }
    } catch {
      pollRetries += 1;
      if (pollRetries < 3) {
        // Transient network error — retry with backoff instead of giving up
        clearInterval(pollInterval!);
        pollInterval = null;
        setTimeout(() => {
          pollInterval = setInterval(pollJob, 1500);
        }, 3000);
      } else {
        clearInterval(pollInterval!);
        pollInterval = null;
        uploading = false;
        toastStore.error('Lost connection while checking import progress.');
      }
    }
  }

  function reset() {
    selectedFile = null;
    layerName = '';
    jobId = null;
    progress = 0;
    uploading = false;
    pollStartedAt = null;
    pollRetries = 0;
    elapsedSeconds = 0;
    abortController = null;
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    if (elapsedInterval) {
      clearInterval(elapsedInterval);
      elapsedInterval = null;
    }
  }

  $effect(() => {
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  });
</script>

<Modal bind:open title="Import Data" dismissible={!uploading || pollTimedOut} onclose={reset}>
  <div class="mb-3">
    <span class="text-[10px] font-bold text-primary uppercase tracking-widest">Import Data</span>
  </div>

  {#if pollTimedOut}
    <!-- Timeout view -->
    <div class="flex flex-col items-center gap-4 py-6 bg-surface-container rounded-xl border border-white/5">
      <p class="text-xs text-primary font-bold uppercase tracking-widest">Import Stalled</p>
      <p class="text-xs text-on-surface-variant text-center">Import is taking longer than expected. Check back later.</p>
    </div>
  {:else if uploading}
    <!-- Progress view -->
    <div class="flex flex-col gap-4">
      <!-- Section header -->
      <div class="flex items-center justify-between">
        <span class="text-[10px] font-bold text-primary uppercase tracking-widest">Importing your data…</span>
      </div>

      <!-- Active job card -->
      <div class="bg-surface-container-low rounded-lg border border-white/5 p-3 flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-semibold text-on-surface truncate flex-1">{selectedFile?.name}</span>
          <span class="text-[9px] font-bold uppercase tracking-wider text-primary bg-primary/10 border border-primary/20 rounded px-2 py-0.5">
            {progress < 100 ? 'Importing' : 'Complete'}
          </span>
        </div>

        <div class="flex flex-col gap-1">
          <div class="flex justify-between items-center">
            <span class="text-[9px] text-on-surface-variant/60">
              {elapsedSeconds}s elapsed
            </span>
            <span class="text-[10px] font-bold text-primary">{progress}%</span>
          </div>
          <div class="h-1.5 bg-surface-container rounded-full overflow-hidden">
            <div
              class="h-full bg-primary rounded-full transition-all duration-300"
              style="width: {progress}%"
            ></div>
          </div>
        </div>

        <div class="flex items-center gap-1.5">
          <Spinner size="sm" />
          <p class="text-xs text-on-surface-variant">Importing your data…</p>
        </div>
      </div>
    </div>
  {:else if !selectedFile}
    <!-- Drop zone -->
    <div
      class="border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer
             {dragOver ? 'border-primary/60 bg-primary/5' : 'border-white/5 hover:border-primary/30'}"
      role="button"
      tabindex="0"
      aria-label="Drop files here or click to browse"
      ondragover={(e) => { e.preventDefault(); dragOver = true; }}
      ondragleave={() => (dragOver = false)}
      ondrop={handleDrop}
      onclick={() => document.getElementById('file-input')?.click()}
      onkeydown={(e) => e.key === 'Enter' && document.getElementById('file-input')?.click()}
    >
      <!-- Amber upload icon -->
      <div class="flex justify-center mb-3">
        <svg class="w-8 h-8 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
      </div>
      <p class="text-xs font-semibold text-on-surface mb-1">Drop your file here or click to browse</p>
      <p class="text-xs text-on-surface-variant">GeoJSON, CSV, KML, GPX, GeoPackage, and Shapefiles (zipped)</p>
      <p class="text-[10px] text-on-surface-variant mt-2">Imported files become new layers on your map.</p>
    </div>
    <input
      id="file-input"
      type="file"
      class="hidden"
      accept={ACCEPTED_TYPES.join(',')}
      onchange={handleFileInput}
    />
  {:else}
    <!-- File selected -->
    <div class="flex flex-col gap-4">
      <!-- Selected file card -->
      <div class="flex items-center gap-3 bg-surface-container-low rounded-lg border border-white/5 p-3">
        <div class="flex items-center justify-center w-8 h-8 rounded bg-primary/10 border border-primary/20 flex-shrink-0">
          <svg class="w-4 h-4 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-xs font-semibold text-on-surface truncate">{selectedFile.name}</p>
          <p class="text-[9px] font-mono text-on-surface-variant uppercase tracking-wider">{formatFileSize(selectedFile.size)}</p>
        </div>
        <button
          onclick={reset}
          class="text-on-surface-variant hover:text-on-surface transition-colors text-xs"
          aria-label="Remove file"
        >✕</button>
      </div>

      <!-- Layer name input -->
      <div class="flex flex-col gap-1.5">
        <label for="import-layer-name" class="text-[10px] font-bold text-primary uppercase tracking-widest">
          Layer Name
        </label>
        <input
          id="import-layer-name"
          type="text"
          bind:value={layerName}
          placeholder="Layer name…"
          class="rounded-lg bg-surface-container-low border border-white/5 px-3 py-2 text-xs text-on-surface placeholder-on-surface-variant/40 focus:outline-none focus:ring-1 focus:ring-primary/50 font-mono"
        />
      </div>
    </div>
  {/if}

  {#snippet footer()}
    {#if pollTimedOut}
      <Button variant="secondary" onclick={() => { reset(); open = false; }}>Dismiss</Button>
    {:else if uploading && !pollTimedOut}
      <Button variant="secondary" onclick={() => { abortController?.abort(); reset(); }}>Cancel Import</Button>
    {:else if !uploading && selectedFile}
      <Button variant="secondary" onclick={reset}>Cancel</Button>
      <Button variant="primary" onclick={startUpload}>
        Import
      </Button>
    {/if}
  {/snippet}
</Modal>
