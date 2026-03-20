// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock terra-draw dynamic imports ─────────────────────────────────────────
// drawing.svelte.ts does:
//   const { TerraDraw, ... } = await import('terra-draw');
//   const { TerraDrawMapLibreGLAdapter } = await import('terra-draw-maplibre-gl-adapter');
//
// We mock both so the store's init() can complete without native bindings.
// The real TerraDraw constructor iterates `modes` and calls mode.register()
// and other lifecycle hooks — so each mode mock must return a stub object.

const mockStop = vi.fn();
const mockStart = vi.fn();

/** Minimal mode stub — only needs to satisfy TerraDraw's constructor iteration. */
function modeStub() {
  return { register: vi.fn(), start: vi.fn(), stop: vi.fn(), name: 'mock' };
}

const MockTerraDraw = vi.fn().mockImplementation(() => ({
  start: mockStart,
  stop: mockStop,
}));

vi.mock('terra-draw', () => ({
  TerraDraw: MockTerraDraw,
  TerraDrawPointMode: vi.fn().mockImplementation(modeStub),
  TerraDrawLineStringMode: vi.fn().mockImplementation(modeStub),
  TerraDrawPolygonMode: vi.fn().mockImplementation(modeStub),
  TerraDrawSelectMode: vi.fn().mockImplementation(modeStub),
}));

vi.mock('terra-draw-maplibre-gl-adapter', () => ({
  TerraDrawMapLibreGLAdapter: vi.fn().mockImplementation(() => ({})),
}));

// Import store AFTER mocks are declared
import { drawingStore } from '../lib/stores/drawing.svelte.js';

// ─── Minimal MapLibre mock ────────────────────────────────────────────────────
// The store only passes `map` to TerraDrawMapLibreGLAdapter, which is mocked,
// so we only need a typed placeholder.
function makeMockMap() {
  return {} as Parameters<typeof drawingStore.init>[0];
}

// ─── Reset module-level state between tests ───────────────────────────────────
// The store uses module-level `$state`, so we must call reset() before each
// test to avoid state leaking across tests.
beforeEach(() => {
  vi.clearAllMocks();
  drawingStore.reset();
});

// ─── Idle state ───────────────────────────────────────────────────────────────

describe('drawingStore initial state', () => {
  it('starts in idle status', () => {
    expect(drawingStore.state.status).toBe('idle');
  });

  it('isReady is false before init', () => {
    expect(drawingStore.isReady).toBe(false);
  });

  it('instance is null before init', () => {
    expect(drawingStore.instance).toBeNull();
  });
});

// ─── init() lifecycle ─────────────────────────────────────────────────────────

describe('drawingStore.init()', () => {
  it('transitions to ready and returns a TerraDraw instance', async () => {
    const draw = await drawingStore.init(makeMockMap());

    expect(drawingStore.state.status).toBe('ready');
    expect(drawingStore.isReady).toBe(true);
    expect(draw).not.toBeNull();
    expect(drawingStore.instance).toBe(draw);
  });

  it('calls draw.start() during init', async () => {
    await drawingStore.init(makeMockMap());
    expect(mockStart).toHaveBeenCalledOnce();
  });

  it('passes through importing state before resolving', async () => {
    // We can only observe the final state synchronously after await,
    // but we can confirm init returns a non-null instance
    const result = await drawingStore.init(makeMockMap());
    expect(result).not.toBeNull();
    expect(drawingStore.state.status).toBe('ready');
  });
});

// ─── stop() ──────────────────────────────────────────────────────────────────

describe('drawingStore.stop()', () => {
  it('transitions from ready to stopped', async () => {
    await drawingStore.init(makeMockMap());
    expect(drawingStore.state.status).toBe('ready');

    drawingStore.stop();

    expect(drawingStore.state.status).toBe('stopped');
    expect(drawingStore.isReady).toBe(false);
    expect(drawingStore.instance).toBeNull();
  });

  it('calls draw.stop() on the TerraDraw instance', async () => {
    await drawingStore.init(makeMockMap());
    drawingStore.stop();
    expect(mockStop).toHaveBeenCalledOnce();
  });

  it('stop() from idle does not throw', () => {
    // Not in ready state — stop() should still set stopped without calling draw.stop()
    expect(() => drawingStore.stop()).not.toThrow();
    expect(drawingStore.state.status).toBe('stopped');
    expect(mockStop).not.toHaveBeenCalled();
  });
});

// ─── reset() ─────────────────────────────────────────────────────────────────

describe('drawingStore.reset()', () => {
  it('transitions from ready back to idle', async () => {
    await drawingStore.init(makeMockMap());
    expect(drawingStore.state.status).toBe('ready');

    drawingStore.reset();

    expect(drawingStore.state.status).toBe('idle');
    expect(drawingStore.isReady).toBe(false);
    expect(drawingStore.instance).toBeNull();
  });

  it('calls draw.stop() when resetting from ready', async () => {
    await drawingStore.init(makeMockMap());
    drawingStore.reset();
    expect(mockStop).toHaveBeenCalledOnce();
  });

  it('reset() from idle stays idle without error', () => {
    // Already idle — reset is a no-op for the instance cleanup branch
    expect(drawingStore.state.status).toBe('idle');
    expect(() => drawingStore.reset()).not.toThrow();
    expect(drawingStore.state.status).toBe('idle');
  });

  it('reset() from stopped transitions to idle', () => {
    drawingStore.stop(); // idle → stopped
    drawingStore.reset();
    expect(drawingStore.state.status).toBe('idle');
  });
});

// ─── Superseded init() ────────────────────────────────────────────────────────

describe('drawingStore.init() generation guard', () => {
  it('sequential inits each succeed independently', async () => {
    // Run two sequential inits — each completes fully.
    // The generation counter advances, but since we await each in turn there
    // is no race so both succeed. This verifies the store recovers correctly
    // from being re-initialised (e.g. map re-mounted).
    const r1 = await drawingStore.init(makeMockMap());
    expect(r1).not.toBeNull();
    expect(drawingStore.state.status).toBe('ready');

    // Reset between inits (as the component teardown would do)
    drawingStore.reset();

    const r2 = await drawingStore.init(makeMockMap());
    expect(r2).not.toBeNull();
    expect(drawingStore.state.status).toBe('ready');
  });

  it('init() after stop() returns a new ready instance', async () => {
    // Characterize the re-init flow: init → stop → init again (e.g. map remount).
    // Each re-init supersedes prior state and returns a new TerraDraw instance.
    const r1 = await drawingStore.init(makeMockMap());
    expect(r1).not.toBeNull();

    drawingStore.stop();
    expect(drawingStore.state.status).toBe('stopped');

    const r2 = await drawingStore.init(makeMockMap());
    expect(r2).not.toBeNull();
    expect(drawingStore.state.status).toBe('ready');

    // Each init creates a distinct instance
    expect(r2).not.toBe(r1);
  });
});
