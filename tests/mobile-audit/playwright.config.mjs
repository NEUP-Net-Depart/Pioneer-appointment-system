import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const viewports = [[360, 800], [393, 873], [430, 932], [768, 1024], [1440, 900]];
export default defineConfig({
  testDir: '.', testMatch: '**/*.spec.mjs', timeout: 150000,
  expect: { timeout: 10000 }, workers: 1, fullyParallel: false, retries: 0,
  reporter: [['list'], ['json', { outputFile: fileURLToPath(new URL('../../output/mobile-audit/results.json', import.meta.url)) }]],
  outputDir: process.env.E2E_OUTPUT_DIR || '../../output/playwright/mobile-audit',
  use: {
    baseURL: process.env.E2E_BASE_URL, headless: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
    actionTimeout: 12000, navigationTimeout: 20000, reducedMotion: 'reduce',
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
  projects: ['chromium', 'webkit', 'firefox'].flatMap(browserName => viewports.map(([width, height]) => ({
    name: `${browserName}-${width}`, use: { browserName, viewport: { width, height },
      ...(browserName !== 'firefox' ? { isMobile: width < 768, hasTouch: width < 768 } : {}),
    },
  }))),
});
