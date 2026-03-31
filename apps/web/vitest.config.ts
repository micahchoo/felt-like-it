/// <reference types="vitest" />
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    svelte({
      compilerOptions: {
        dev: false,
        css: 'injected',
      },
      // Provide a no-op style preprocessor to bypass Vite's preprocessCSS
      // which creates PartialEnvironment that fails in jsdom
      preprocess: {
        style: async ({ content }: { content: string }) => ({ code: content }),
      },
    }),
  ],
  resolve: {
    alias: {
      $lib: '/mnt/Ghar/2TA/DevStuff/felt-like-it/apps/web/src/lib',
    },
    // Force browser conditions - Svelte's default is server
    conditions: ['browser', 'svelte', 'module', 'import'],
  },
  // @ts-expect-error vitest@2 augments vite@5 UserConfig
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    resolve: {
      // Force browser conditions in test resolution too
      conditions: ['browser', 'svelte', 'module', 'import'],
    },
    // Inline Svelte to force browser resolution
    server: {
      deps: {
        inline: [/svelte/, /@testing-library\/svelte/, /@testing-library\/svelte-core/],
      },
    },
  },
});
