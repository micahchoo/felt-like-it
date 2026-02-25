// Root ESLint flat config — lints packages and services only.
// apps/web has its own eslint.config.js with Svelte + browser globals.
// scripts/ has no tsconfig and runs via tsx — excluded here.
import js from '@eslint/js';
import ts from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

// Node.js 18+ globals (all root-linted files run in Node)
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
  // Global ignores — must be first, standalone object with only `ignores` key
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.svelte-kit/**',
      '**/coverage/**',
      '**/*.config.js',
      '**/*.config.ts',
      // apps/web has its own ESLint config — don't double-lint
      'apps/web/**',
      // scripts/ has no tsconfig — run via tsx, not type-checked by ESLint
      'scripts/**',
    ],
  },

  js.configs.recommended,

  // TypeScript — type-aware rules for packages + services
  {
    files: ['**/*.ts'],
    plugins: { '@typescript-eslint': ts },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
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
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      'no-await-in-loop': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
];
