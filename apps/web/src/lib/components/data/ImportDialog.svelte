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

  const POLL_TIMEOUT_MS = 5 * 60 * 1000;

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

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('mapId', mapId);
      formData.append('layerName', layerName.trim() || selectedFile.name);

      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Upload failed' }));
        throw new Error((err as { message?: string }).message ?? 'Upload failed');
      }

      const data = await res.json() as { jobId: string };
      jobId = data.jobId;

      // Poll for progress
      pollStartTime = Date.now();
      pollInterval = setInterval(pollJob, 1500);
    } catch (err) {
      toastStore.error(String(err instanceof Error ? err.message : 'Upload failed'));
      uploading = false;
    }
  }

  async function pollJob() {
    if (!jobId) return;

    if (Date.now() - pollStartTime > POLL_TIMEOUT_MS) {
      clearInterval(pollInterval!);
      pollInterval = null;
      pollTimedOut = true;
      uploading = false;
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
      clearInterval(pollInterval!);
      uploading = false;
      toastStore.error('Lost connection while checking import progress.');
    }
  }

  function reset() {
    selectedFile = null;
    layerName = '';
    jobId = null;
    progress = 0;
    uploading = false;
    pollTimedOut = false;
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  $effect(() => {
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  });
</script>

<Modal bind:open title="Import Data" dismissible={!uploading || pollTimedOut} onclose={reset}>
  {#if pollTimedOut}
    <!-- Timeout view -->
    <div class="flex flex-col items-center gap-4 py-6">
      <p class="text-sm text-amber-400">Import is taking longer than expected. Check back later.</p>
    </div>
  {:else if uploading}
    <!-- Progress view -->
    <div class="flex flex-col items-center gap-4 py-6">
      <Spinner size="lg" />
      <div class="w-full">
        <div class="flex justify-between text-xs text-slate-400 mb-1">
          <span>Importing {selectedFile?.name}</span>
          <span>{progress}%</span>
        </div>
        <div class="w-full bg-slate-700 rounded-full h-1.5">
          <div
            class="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
            style="width: {progress}%"
          ></div>
        </div>
      </div>
      <p class="text-xs text-slate-400">Processing your data…</p>
    </div>
  {:else if !selectedFile}
    <!-- Drop zone -->
    <div
      class="border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer
             {dragOver ? 'border-blue-500 bg-blue-500/10' : 'border-slate-600 hover:border-slate-500'}"
      role="button"
      tabindex="0"
      aria-label="Drop files here or click to browse"
      ondragover={(e) => { e.preventDefault(); dragOver = true; }}
      ondragleave={() => (dragOver = false)}
      ondrop={handleDrop}
      onclick={() => document.getElementById('file-input')?.click()}
      onkeydown={(e) => e.key === 'Enter' && document.getElementById('file-input')?.click()}
    >
      <div class="text-3xl mb-2">📁</div>
      <p class="text-sm font-medium text-white mb-1">Drop a file here</p>
      <p class="text-xs text-slate-400">or click to browse</p>
      <p class="text-xs text-slate-500 mt-2">{ACCEPTED_TYPES.join(', ')}</p>
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
      <div class="flex items-center gap-3 bg-slate-700/50 rounded-lg p-3">
        <span class="text-2xl">📄</span>
        <div class="flex-1 min-w-0">
          <p class="text-sm text-white truncate">{selectedFile.name}</p>
          <p class="text-xs text-slate-400">{formatFileSize(selectedFile.size)}</p>
        </div>
        <button
          onclick={reset}
          class="text-slate-400 hover:text-white transition-colors"
          aria-label="Remove file"
        >✕</button>
      </div>

      <div class="flex flex-col gap-1">
        <label for="import-layer-name" class="text-sm font-medium text-slate-300">
          Layer name
        </label>
        <input
          id="import-layer-name"
          type="text"
          bind:value={layerName}
          placeholder="Layer name…"
          class="rounded-lg bg-slate-700 border border-slate-600 px-3 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </div>
  {/if}

  {#snippet footer()}
    {#if pollTimedOut}
      <Button variant="secondary" onclick={() => { reset(); open = false; }}>Dismiss</Button>
    {:else if !uploading && selectedFile}
      <Button variant="secondary" onclick={reset}>Cancel</Button>
      <Button variant="primary" onclick={startUpload}>
        Import
      </Button>
    {/if}
  {/snippet}
</Modal>
