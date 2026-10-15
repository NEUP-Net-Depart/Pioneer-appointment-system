import { test, expect } from '@playwright/test';

test.skip(process.env.E2E_FIELD !== 'true', 'Uses the isolated staff fixture');

test('member reaches roster from My, chooses named shifts and can use narrow screens', async ({ page }) => {
  await page.goto('/staff/');
  await page.locator('#login-form').getByLabel('学号', { exact: true }).fill('20261002');
  await page.locator('#login-form').getByLabel('密码', { exact: true }).fill('StaffTest!2026');
  await page.getByRole('button', { name: '进入系统' }).click();
  await expect(page.locator('.field-app')).toBeVisible();
  await page.locator('.field-sidebar').getByRole('button', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '我的班次与申请' }).click();
  await expect(page.getByRole('heading', { name: '我的值班安排' })).toBeVisible();
  await page.getByRole('button', { name: '发起换班', exact: true }).first().click();
  await expect(page.getByLabel('希望调换到')).toBeEnabled();
  await expect(page.getByLabel('希望调换到').locator('option')).not.toHaveCount(1);
  await expect(page.getByLabel('希望调换到')).toContainText('周宁');
  await expect(page.getByLabel('对方成员 ID')).toHaveCount(0);
  await expect(page.getByLabel('对方班次版本')).toHaveCount(0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByLabel('希望调换到')).toBeVisible();
  }
});
