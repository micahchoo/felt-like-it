import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: 'html',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:4173',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: '**/api/**',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'api',
      testMatch: '**/api/**',
      use: {
        baseURL: 'http://localhost:4173',
        extraHTTPHeaders: { accept: 'application/json' },
      },
    },
  ],
  // Run E2E against the production build via `vite preview`. Dev mode hides
  // production-only bugs in MapLibre worker chunking (see vite.config.ts:9-14).
  webServer: {
    command:
      'pnpm --filter @felt-like-it/web build && pnpm --filter @felt-like-it/web preview --host --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
