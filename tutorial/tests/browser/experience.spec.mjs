import { test, expect } from '@playwright/test';
import { journeysFor, tutorialProfiles } from '../../src/journeys.js';

test('entry presents real workflows for each role and fits small phones', async ({ page }) => {
  await page.goto('/');
  const dialog = page.locator('.tutorial-start-dialog');
  await expect(dialog).toBeVisible();
  expect(await page.locator('body').evaluate((element) => getComputedStyle(element).margin)).toBe(
    '0px'
  );
  expect(
    await page.locator('body').evaluate((element) => getComputedStyle(element).fontFamily)
  ).toContain('Microsoft YaHei');
  await expect(dialog.locator('fieldset').first().getByRole('button')).toHaveText([
    '部长',
    '部员',
    '维修事务'
  ]);
  await expect(page.locator('iframe')).toHaveCount(0);
  for (const profile of tutorialProfiles) {
    await dialog.getByRole('button', { name: profile.name, exact: true }).click();
    await expect(dialog.locator('fieldset').nth(1).getByRole('button')).toHaveCount(
      journeysFor(profile).length
    );
  }
  for (const width of [320, 375, 430, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await expect(dialog.getByRole('button', { name: '开始演示', exact: true })).toBeInViewport();
  }
  await page.screenshot({ path: '../output/issue151-demo/tutorial-workflow-start.png' });
  await dialog.getByRole('button', { name: '部员', exact: true }).click();
  await dialog.getByRole('button', { name: '开始演示', exact: true }).click();
  await expect(page).toHaveURL(/profile=repair&journey=duty-repair/);
  await expect(page.locator('.driver-popover-title')).toHaveText(
    journeysFor({ id: 'repair' })[0].steps[0].title
  );
});

for (const profile of tutorialProfiles) {
  for (const journey of journeysFor(profile)) {
    test(`${profile.name} / ${journey.title} runs continuously on mobile with one advance button`, async ({
      page
    }) => {
      test.setTimeout(180000);
      page.setDefaultTimeout(12000);
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/?profile=${profile.id}&journey=${journey.id}`);
      for (let index = 0; index < journey.steps.length; index++) {
        const step = journey.steps[index];
        await test.step(`${index}: ${step.title}`, async () => {
          await expect(page.locator('.driver-popover-title')).toHaveText(step.title);
          await expect(page.locator('.driver-popover-description')).toBeHidden();
          await expect(page.locator('.driver-popover button:visible')).toHaveText([
            '退出引导',
            index === journey.steps.length - 1 ? '完成' : '下一步'
          ]);
          const next = page.locator('.driver-popover-next-btn');
          await expect(next).toHaveText(index === journey.steps.length - 1 ? '完成' : '下一步');
          await expect(next).toBeEnabled();
          await expect(next).toBeInViewport();
          await expect(
            page.getByRole('button', { name: '退出引导', exact: true })
          ).toBeInViewport();
          await expect(page.locator('.driver-popover-progress-text')).toHaveText(
            `${index + 1} / ${journey.steps.length}`
          );
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
          ).toBe(true);
          if (step.target === '.field-scanner' || step.target === '.repair-intake') {
            await page.screenshot({
              path: `../output/issue151-demo/tutorial-${profile.id}-${journey.id}-${index}-mobile.png`,
              animations: 'disabled'
            });
          }
          await next.click();
        });
      }
      await expect(page.locator('.tutorial-finished')).toContainText(`${journey.title}已完成`);
      await page.getByRole('button', { name: '自由操作', exact: true }).click();
      await expect(page.locator('.driver-overlay')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '操作教程', exact: true })).toBeVisible();
    });
  }
}

test('exit frees the original page and retains confirmed attendance', async ({ page }) => {
  await page.goto('/?profile=repair&journey=duty-repair');
  const steps = journeysFor({ id: 'repair' })[0].steps;
  for (const step of steps.slice(0, 6)) {
    await expect(page.locator('.driver-popover-title')).toHaveText(step.title);
    await page.locator('.driver-popover-next-btn').click();
  }
  await expect(page.locator('.driver-popover-title')).toHaveText(steps[6].title);
  await page.getByRole('button', { name: '退出引导', exact: true }).click();
  await expect(page.locator('.driver-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => window.__tutorial.simulation.state.attendances.length)).toBe(1);
});

test('legacy links resolve to an available workflow', async ({ page }) => {
  await page.goto('/?profile=superadmin&journey=system-maintenance&mode=watch');
  await expect(page).toHaveURL(/profile=head&journey=attendance$/);
  await expect(page.locator('.driver-popover-title')).toHaveText(
    journeysFor({ id: 'head' })[0].steps[0].title
  );
});
