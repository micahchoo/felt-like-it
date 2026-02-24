import js from '@eslint/js';
import ts from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import sveltePlugin from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';

// Browser environment globals needed for Svelte component scripts
const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  history: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  FormData: 'readonly',
  File: 'readonly',
  Blob: 'readonly',
  FileReader: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  DragEvent: 'readonly',
  KeyboardEvent: 'readonly',
  MouseEvent: 'readonly',
  PointerEvent: 'readonly',
  HTMLElement: 'readonly',
  HTMLDivElement: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLButtonElement: 'readonly',
  HTMLSelectElement: 'readonly',
  HTMLTextAreaElement: 'readonly',
  HTMLCanvasElement: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  performance: 'readonly',
  crypto: 'readonly',
  alert: 'readonly',
  confirm: 'readonly',
  ErrorEvent: 'readonly',
  PromiseRejectionEvent: 'readonly',
  MessageEvent: 'readonly',
};

// Node.js runtime globals (server-side TypeScript files, API routes)
const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  global: 'readonly',
  // Node.js 18+ web platform globals (also available in browsers)
  fetch: 'readonly',
  Response: 'readonly',
  Request: 'readonly',
  Headers: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  File: 'readonly',
  FormData: 'readonly',
  Blob: 'readonly',
  // Timers
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
};

// Svelte 5 rune globals — available in .svelte and .svelte.ts files
const svelteRunes = {
  $state: 'readonly',
  $derived: 'readonly',
  $effect: 'readonly',
  $props: 'readonly',
  $bindable: 'readonly',
  $inspect: 'readonly',
  $host: 'readonly',
};

export default [
  // Global ignores — must be first, standalone object with only `ignores` key
  {
    ignores: [
      '.svelte-kit/**',
      'build/**',
      'node_modules/**',
      '**/*.config.js',
      '**/*.config.ts',
    ],
  },
  js.configs.recommended,
  // TypeScript files — syntax-only rules (no project needed, avoids .svelte-kit OOM)
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { '@typescript-eslint': ts },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        // No `project` here — all rules below are syntax-only and don't need
        // the full TypeScript compiler. Avoids OOM from loading .svelte-kit types.
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: { ...nodeGlobals },
    },
    rules: {
      ...ts.configs['recommended'].rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  // Svelte 5 universal stores (.svelte.ts) — TypeScript files that use Svelte runes.
  // These run in the browser so they may reference DOM globals (e.g. HTMLElement for
  // mapContainerEl in map.svelte.ts).
  {
    files: ['**/*.svelte.ts'],
    plugins: { '@typescript-eslint': ts },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: { ...browserGlobals, ...svelteRunes },
    },
    rules: {
      ...ts.configs['recommended'].rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  // Svelte files
  {
    files: ['**/*.svelte'],
    plugins: {
      '@typescript-eslint': ts,
      svelte: sveltePlugin,
    },
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tsParser,
        extraFileExtensions: ['.svelte'],
      },
      globals: { ...browserGlobals, ...svelteRunes },
    },
    rules: {
      ...sveltePlugin.configs.recommended.rules,
      'svelte/require-each-key': 'error',
      // ignoreWarnings: true — suppresses Svelte compiler warnings (e.g. $props() rest element
      // in non-custom-element components). Only Svelte compiler errors are still reported.
      'svelte/valid-compile': ['error', { ignoreWarnings: true }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Allow _-prefixed unused vars/args (intentionally unused params in callbacks/props)
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  // Import boundary rules
  {
    files: ['src/lib/components/**/*.{ts,svelte}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['$lib/server/**', '../server/**', '../../server/**'],
              message: 'Components must not import server modules. Use load functions or tRPC.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/lib/stores/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['$lib/server/**', '../server/**'],
              message: 'Stores must not import server modules.',
            },
            {
              group: ['$lib/components/**', '../components/**'],
              message: 'Stores must not depend on components.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/lib/server/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['$lib/components/**', '../components/**'],
              message: 'Server code must not import client components.',
            },
            {
              group: ['$lib/stores/**', '../stores/**'],
              message: 'Server code must not import client stores.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/routes/(public)/**/*.{ts,svelte}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['$lib/server/auth/**', '../../../lib/server/auth/**'],
              message: 'Public routes must not use auth utilities directly.',
            },
          ],
        },
      ],
    },
  },
];
