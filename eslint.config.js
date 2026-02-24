// Root ESLint flat config — shared rules applied to all packages.
// Each workspace package/app may extend this with package-specific rules.
import js from '@eslint/js';
import ts from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

// Node.js 18+ globals (packages run in Node via SvelteKit)
const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  global: 'readonly',
  fetch: 'readonly',
  Response: 'readonly',
  Request: 'readonly',
  Headers: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  File: 'readonly',
  FormData: 'readonly',
  Blob: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
};

export default [
  js.configs.recommended,

  // TypeScript — type-aware rules for all workspace TS files
  {
    files: ['**/*.ts'],
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.svelte-kit/**',
      '**/coverage/**',
    ],
    plugins: { '@typescript-eslint': ts },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        // Each package provides its own tsconfig.json
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...nodeGlobals },
    },
    rules: {
      ...ts.configs['recommended'].rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // Global ignores
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.svelte-kit/**',
      '**/coverage/**',
      '**/*.config.js',
      '**/*.config.ts',
    ],
  },
];
