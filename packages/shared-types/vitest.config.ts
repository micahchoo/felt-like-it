import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 90,
        statements: 100,
      },
    },
  },
});
