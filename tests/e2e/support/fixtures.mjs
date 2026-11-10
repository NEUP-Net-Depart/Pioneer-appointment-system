import { test as base, expect } from '@playwright/test';
import { startPreview } from '../../../scripts/e2e-preview.mjs';
import { WORKFLOW_TIME } from '../../fixtures/workflow-seed.mjs';

export { expect };
export const test = base.extend({
  preview: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires destructured fixture dependencies.
    async ({}, use) => {
      if (!process.env.E2E_TEMPLATE_DIR)
        throw new Error('Run browser tests with npm run test:e2e.');
      const preview = await startPreview(process.env.E2E_TEMPLATE_DIR);
      try {
        await use(preview);
      } finally {
        await preview.close();
      }
    },
    { timeout: 60000 }
  ],
  baseURL: async ({ preview }, use) => {
    await use(preview.baseURL);
  },
  context: async ({ context }, use) => {
    // The context clock also covers new staff tabs and popups.
    await context.clock.install({ time: new Date(WORKFLOW_TIME) });
    await use(context);
  }
});
