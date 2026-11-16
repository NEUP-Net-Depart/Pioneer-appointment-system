import { defineConfig } from '@playwright/test';

const basePath = process.env.TUTORIAL_BASE_PATH || '/Pioneer-appointment-system/';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/pages.spec.mjs',
  timeout: 120000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  workers: 3,
  reporter: 'list',
  outputDir: 'test-results/pages',
  use: {
    baseURL: `http://127.0.0.1:15171${basePath}`,
    viewport: { width: 375, height: 812 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 15171 --strictPort',
    url: `http://127.0.0.1:15171${basePath}`,
    reuseExistingServer: false
  }
});
