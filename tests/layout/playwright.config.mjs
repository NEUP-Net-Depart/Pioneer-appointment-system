import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: '.', testMatch: '*.spec.mjs', timeout: 60000,
  globalTimeout: process.env.CI ? 600000 : undefined,
  expect: { timeout: 10000 }, workers: 1, retries: 0,
  reporter: [['list'], ['json', { outputFile: fileURLToPath(new URL(`../../output/first-layout/${process.env.LAYOUT_PHASE || 'regression'}/results.json`, import.meta.url)) }]],
  outputDir: process.env.E2E_OUTPUT_DIR || '../../output/playwright/first-layout',
  use: {
    baseURL: process.env.E2E_BASE_URL, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
    headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
  projects: ['chromium', 'firefox', 'webkit'].flatMap(browserName => [393, 1440].map(width => ({
    name: `${browserName}-${width}`, use: { browserName, viewport: { width, height: 900 } },
  }))).concat([393, 1440].map(width => ({
    name: `chromium-classic-${width}`, metadata: { classicScrollbars: true },
    use: { browserName: 'chromium', viewport: { width, height: 900 },
      launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--disable-features=OverlayScrollbar'] },
    },
  }))),
});
