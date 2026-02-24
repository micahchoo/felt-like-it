/// <reference types="vitest" />
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  build: {
    // Target ES2022 so esbuild emits native class-field syntax rather than generating
    // per-chunk polyfill helpers (ht, et, br, etc.). MapLibre GL 5 compiles its internal
    // Web Worker as a separate Vite bundle with its own helper names; those helpers are
    // undefined when worker code runs in the main-thread context, causing "et is not
    // defined" errors during tile rendering. Native class fields eliminate the helpers.
    target: 'es2022',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('maplibre-gl') || id.includes('@maplibre/')) {
            return 'maplibre-gl';
          }
          return undefined;
        },
      },
    },
  },
  // @ts-expect-error vitest@2 augments vite@5 UserConfig; project uses vite@6 — suppress type mismatch
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/server/**', 'src/lib/stores/**'],
      exclude: [
        'src/routes/**',
        'src/app.d.ts',
        '*.config.*',
        '.svelte-kit/**',
        // Browser-only stores — require MapLibre/DOM; tested via E2E not unit
        'src/lib/stores/map.svelte.ts',
        'src/lib/stores/selection.svelte.ts',
        'src/lib/stores/style.svelte.ts',
        // Infrastructure setup — not meaningfully unit-testable
        'src/lib/server/jobs/**',
        'src/lib/server/trpc/router.ts',
        'src/lib/server/trpc/context.ts',
        'src/lib/server/import/shapefile.ts',
      ],
      thresholds: {
        lines: 75,
        functions: 85,
        branches: 84,
        statements: 75,
      },
    },
  },
  optimizeDeps: {
    include: ['maplibre-gl'],
  },
});
