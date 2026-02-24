// Root ESLint flat config — shared rules applied to all packages.
// Each workspace package/app may extend this with package-specific rules.
import js from '@eslint/js';
import ts from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  js.configs.recommended,

  // TypeScript — strict rules for all workspace TS files
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
    },
    rules: {
      ...ts.configs['recommended'].rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
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
