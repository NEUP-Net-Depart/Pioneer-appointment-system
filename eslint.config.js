import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', '.wrangler/**', 'node_modules/**','output/**'] },
  js.configs.recommended,
  { files: ['frontend/**/*.js', 'shared/**/*.js'], languageOptions: { globals: globals.browser } },
  { files: ['src/**/*.js', 'functions/**/*.js'], languageOptions: { globals: globals.worker } },
  { files: ['scripts/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.js','playwright.config.mjs'], languageOptions: { globals: globals.node } },
  { files: ['tests/e2e/**/*.mjs'],languageOptions:{globals:globals.browser} }
];
