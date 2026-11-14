import { test, expect } from './support/fixtures.mjs';
import { loginStaff, staffPage } from './support/staff.mjs';
test.use({ workflowTime: '2026-10-15T11:10:00Z' });

test('ordinary single-campus staff have a complete compact workspace and warranty lookup', async ({ page }) => {
  await loginStaff(page, '20261004');
  await staffPage(page, '今日工作');
  const window = page.getByRole('region', { name: '工作视窗', exact: true });
  await expect(window.locator('.work-window-campus-single')).toHaveText('浑南');
  await expect(window.getByRole('button', { name: /切换校区/ })).toHaveCount(0);
  await expect(window.locator('.work-window-counts')).toHaveCount(0);
  await expect(window.getByText('还未签到', { exact: true })).toBeVisible();
  await expect(window.getByRole('button', { name: '扫码', exact: true })).toBeVisible();
  await expect(window.getByRole('button', { name: '刷新工作台', exact: true })).toBeVisible();
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 950 });
    const shortcuts = page.locator('.today-work-shortcuts');
    await expect(shortcuts.getByRole('button')).toHaveCount(2);
    const bounds = await shortcuts.boundingBox();
    const warranty = await shortcuts.getByRole('button', { name: '查询保修', exact: true }).boundingBox();
    expect(Math.abs(warranty.width * 2 - bounds.width)).toBeLessThan(3);
    expect(await window.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  const providers = page.waitForResponse(response => response.url().endsWith('/api/warranty/providers'));
  await page.getByRole('button', { name: '查询保修', exact: true }).click();
  expect((await providers).status()).toBe(200);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('work window changes campus and opens the matching read-only staffing section', async ({ page }) => {
  await loginStaff(page);
  await staffPage(page, '今日工作');
  const window = page.getByRole('region', { name: '工作视窗', exact: true });
  await expect(window.getByRole('heading', { name: /欢迎您/ })).toBeVisible();
  await expect(window.getByText('系统管理员', { exact: true })).toBeVisible();
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const campus = window.getByRole('group', { name: '接待校区' });
    const switcher = campus.getByRole('button', { name: /切换校区/ });
    if (!(await switcher.getAttribute('aria-label')).includes('当前南湖')) await switcher.click();
    await expect(switcher).toHaveAccessibleName('切换校区，当前南湖');
    await switcher.click();
    await expect(switcher).toHaveAccessibleName('切换校区，当前浑南');
    await expect(window.getByRole('button', { name: /空闲维修人员/ })).toBeEnabled();
    const searchTrigger = page.getByRole('button', { name: '查询工单', exact: true });
    await searchTrigger.click();
    const search = page.getByRole('combobox', { name: '查找工单', exact: true });
    await expect(search).toBeFocused();
    await search.fill('12');
    await page.keyboard.press('Escape');
    await expect(search).not.toBeVisible();
    await expect(searchTrigger).toBeFocused();
    await searchTrigger.click();
    await window.getByRole('heading', { name: '欢迎您！', exact: true }).click();
    await expect(search).not.toBeVisible();
    await expect(async () => {
      const bounds = await window.boundingBox();
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(await window.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    }).toPass();
    await page.screenshot({ path: `output/today-window-${width}.png` });
  }
  await expect(window.getByRole('button', { name: '展示签到码', exact: true })).toHaveCount(0);
  await window.getByRole('button', { name: '到岗签到', exact: true }).click();
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await expect(window.getByText('已签到', { exact: true })).toBeVisible();
  await window.getByRole('button', { name: '展示签到码', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '展示签到码' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await window.getByRole('button', { name: /空闲维修人员/ }).click();
  const staffing = page.getByRole('region', { name: '值班人员', exact: true });
  await expect(staffing).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('region', { name: '今日人员状态' })).toHaveCount(0);
  const idle = staffing.locator('[data-staffing="idle"]').first();
  if (await idle.count()) await expect(idle).toBeFocused();
  else await expect(staffing).toBeFocused();
  await expect(page.getByRole('group', { name: '考勤校区' }).getByRole('button', { name: '浑南', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
