import js from '@eslint/js';
import globals from 'globals';
import * as parser from '@babel/eslint-parser';
import type { Linter } from 'eslint';

const sourceFiles = ['**/*.ts', '**/*.tsx'];
const config: Linter.Config[] = [
  { ignores: ['dist/**', '.wrangler/**', 'node_modules/**', 'output/**'] },
  js.configs.recommended,
  {
    files: sourceFiles,
    // TypeScript resolves both type and JSX references in these files.
    rules: { 'no-undef': 'off', 'no-unused-vars': 'off' },
    languageOptions: {
      parser,
      parserOptions: { requireConfigFile: false, babelOptions: { parserOpts: { plugins: ['typescript'] } } }
    }
  },
  {
    files: ['**/*.tsx'],
    languageOptions: {
      parserOptions: { babelOptions: { parserOpts: { plugins: ['typescript', 'jsx'] } } }
    }
  },
  { files: ['frontend/**/*.ts', 'frontend/**/*.tsx', 'shared/**/*.ts', 'warranty-verifier/**/*.ts'], languageOptions: { globals: globals.browser } },
  { files: ['src/**/*.ts', 'functions/**/*.ts'], languageOptions: { globals: globals.worker } },
  { files: ['scripts/**/*.ts', 'tests/**/*.ts', '*.config.ts'], languageOptions: { globals: globals.node } },
  { files: ['tests/e2e/**/*.ts'], languageOptions: { globals: globals.browser } }
];

export default config;
