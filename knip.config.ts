import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  workspaces: {
    '.': {
      entry: ['scripts/*.ts'],
      project: ['scripts/**/*.ts'],
    },
    'packages/shared-types': {
      entry: ['src/index.ts'],
      project: ['src/**/*.ts'],
    },
    'packages/geo-engine': {
      entry: ['src/index.ts'],
      project: ['src/**/*.ts'],
      ignore: ['src/__tests__/**'],
    },
    'apps/web': {
      entry: [
        'src/routes/**/*.{ts,svelte}',
        'src/hooks.server.ts',
        'src/app.d.ts',
        'vite.config.ts',
        'svelte.config.js',
        'drizzle.config.ts',
      ],
      project: ['src/**/*.{ts,svelte}', '*.config.{ts,js}'],
      ignore: ['src/__tests__/**', '.svelte-kit/**'],
    },
    'services/worker': {
      entry: ['src/index.ts'],
      project: ['src/**/*.ts'],
    },
  },
  // Ignore generated / config files
  ignore: [
    '**/.svelte-kit/**',
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    'apps/web/src/lib/server/db/migrations/**',
  ],
  ignoreDependencies: [
    // Peer deps not directly imported
    '@sveltejs/adapter-node',
    '@types/node',
  ],
};

export default config;
