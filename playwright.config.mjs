import { defineConfig } from '@playwright/test';
const diagnostics = process.env.E2E_DIAGNOSTICS === 'true';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: diagnostics ? '**/diagnostics/*.spec.mjs' : '**/*.spec.mjs',
  testIgnore: diagnostics ? [] : ['**/diagnostics/**'],
  timeout: 60000,
  globalTimeout: process.env.CI ? 600000 : undefined,
  expect: { timeout: 10000 },
  // Each test owns its Worker and D1/R2 state; bound concurrency for CI runners.
  workers: 2,
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  outputDir: process.env.E2E_OUTPUT_DIR || 'output/playwright/results',
  use: {
    baseURL: process.env.E2E_BASE_URL,
    headless: true,
    actionTimeout: 15000,
    navigationTimeout: 20000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  // Separate simulated clients keep the shared local Worker's production IP
  // limits meaningful without accumulating every browser project's logins.
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1440, height: 1000 },
        extraHTTPHeaders: { 'CF-Connecting-IP': '192.0.2.1' }
      }
    },
    {
      name: 'chromium-touch',
      testMatch: diagnostics ? [] : '**/signature.spec.mjs',
      use: {
        browserName: 'chromium',
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
        extraHTTPHeaders: { 'CF-Connecting-IP': '192.0.2.3' }
      }
    },
    {
      name: 'webkit-mobile',
      testMatch: diagnostics ? [
        '**/diagnostics/photo-compress.spec.mjs',
        '**/diagnostics/telemetry.spec.mjs'
      ] : [
        '**/core-workflow.spec.mjs',
        '**/signature.spec.mjs',
        '**/photo-upload.spec.mjs'
      ],
      use: {
        browserName: 'webkit',
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
        extraHTTPHeaders: { 'CF-Connecting-IP': '192.0.2.2' }
      }
    }
  ]
});
