import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: { globals: globals.browser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { 'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z]' }] }
  },
  { files: ['*.{js,mjs}', 'tests/**/*.mjs'], languageOptions: { globals: globals.node } },
  { files: ['tests/browser/**/*.mjs'], languageOptions: { globals: globals.browser } }
];
