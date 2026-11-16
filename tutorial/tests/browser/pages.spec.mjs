import { test, expect } from '@playwright/test';
import { tutorialProfiles, journeysFor } from '../../src/journeys.js';

test('Pages entry preserves its project path and loads production styles and images', async ({
  page,
  baseURL
}) => {
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('./');
  await expect(page.locator('.tutorial-start-dialog')).toBeVisible();
  const logo = page.locator('.field-brand img');
  await expect
    .poll(() => logo.evaluate((image) => image.complete && image.naturalWidth > 0))
    .toBe(true);
  expect(await page.locator('body').evaluate((element) => getComputedStyle(element).margin)).toBe(
    '0px'
  );
  await page.getByRole('button', { name: '开始演示', exact: true }).click();
  expect(page.url()).toBe(`${baseURL}?profile=head&journey=attendance`);
  await expect(page.locator('.driver-popover-title')).toHaveText(
    journeysFor({ id: 'head' })[0].steps[0].title
  );
  expect(failures).toEqual([]);
});

for (const profile of tutorialProfiles)
  for (const journey of journeysFor(profile)) {
    test(`${profile.name} / ${journey.title} works at the Pages project path`, async ({ page }) => {
      const failures = [];
      page.on('pageerror', (error) => failures.push(error.message));
      page.on('response', (response) => {
        if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
      });
      await page.goto(`./?profile=${profile.id}&journey=${journey.id}&harness=1`);
      await expect.poll(() => page.evaluate(() => !!window.__tutorial)).toBe(true);
      await page.evaluate(() => window.__tutorial.initialize());
      for (let index = 0; index < journey.steps.length; index++)
        await test.step(journey.steps[index].title, async () => {
          await page.evaluate(async (position) => {
            await window.__tutorial.highlight(position);
            await window.__tutorial.perform(position, true);
          }, index);
        });
      expect(failures).toEqual([]);
    });
  }
