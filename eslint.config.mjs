import js from '@eslint/js';
import love from 'eslint-config-love';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    ignores: [
      'coverage/**',
      '.jest-cache-parallel/**',
      'dist/**',
      'node_modules/**',
      'test-utils/**',
      '*.config.js',
      '*.config.ts',
      'jest.config.parallel.js',
      '**/flowGenerator/**',
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/__tests__/**',
    ],
  },
  { files: ['**/*.{js,mjs,cjs,ts,mts,cts}'], plugins: { js }, extends: ['js/recommended'] },
  { files: ['**/*.{js,mjs,cjs,ts,mts,cts}'], languageOptions: { globals: globals.node } },
  {
    ...love,
    files: ['**/*.{ts,mts,cts}'],
  },
  tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    rules: {
      // Our custom rules (preserved)
      'max-lines-per-function': ['error', { max: 40, skipBlankLines: true, skipComments: true }],
      'max-depth': ['error', { max: 2 }],
      'max-lines': ['error', { max: 300, skipBlankLines: false, skipComments: true }],
      curly: ['error', 'multi-line'],
    },
  },
]);
