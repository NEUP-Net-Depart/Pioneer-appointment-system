import { test, expect } from './support/fixtures.mjs';
import { loginStaff, staffPage } from './support/staff.mjs';

test('status overflow follows available width instead of device type', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await loginStaff(page);
  await staffPage(page, '预约记录');
  const navigation = page.getByRole('navigation', { name: '预约处理状态' });
  await expect(navigation.getByRole('button', { name: '已逾期', exact: true })).toBeVisible();
  await expect(navigation.getByRole('button', { name: '更多预约状态' })).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 812 });
  await navigation.getByRole('button', { name: '更多预约状态' }).click();
  await page
    .getByRole('dialog', { name: '状态筛选' })
    .getByRole('button', { name: /已逾期：/ })
    .click();
  await expect(navigation.getByRole('button', { name: '更多预约状态' })).toContainText('已逾期');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(navigation.getByRole('button', { name: '已逾期', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(navigation.getByRole('button', { name: '更多预约状态' })).toHaveCount(0);
});

test('cold filters preserve the viewport while loading and after an empty result', async ({
  page
}) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/appointments?*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('status') !== 'cancelled')
      return route.continue();
    await gate;
    await route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await loginStaff(page);
  await staffPage(page, '预约记录');
  const panel = page.getByRole('region', { name: '预约查询', exact: true });
  await panel.getByRole('button', { name: /当期 ·/ }).waitFor();
  await expect(page.locator('.records-results')).toHaveAttribute('aria-busy', 'false');
  await panel.evaluate((node) => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
  const initialScroll = await page.evaluate(() => scrollY);
  const initialTop = await panel.evaluate((node) => node.getBoundingClientRect().top);
  try {
    const more = panel.getByRole('button', { name: '更多预约状态' });
    if (await more.isVisible()) {
      await more.click();
      await page
        .getByRole('dialog', { name: '状态筛选' })
        .getByRole('button', { name: /已取消/ })
        .click();
    } else await panel.getByRole('button', { name: '已取消', exact: true }).click();
    await expect(page.locator('.records-results')).toHaveAttribute('aria-busy', 'true');
    expect(Math.abs((await page.evaluate(() => scrollY)) - initialScroll)).toBeLessThan(2);
    expect(
      Math.abs((await panel.evaluate((node) => node.getBoundingClientRect().top)) - initialTop)
    ).toBeLessThan(2);
  } finally {
    release();
  }
  await expect(page.locator('.records-results')).toHaveAttribute('aria-busy', 'false');
  await expect(panel.getByText('没有符合条件的预约', { exact: true })).toBeVisible();
  expect(Math.abs((await page.evaluate(() => scrollY)) - initialScroll)).toBeLessThan(2);
});

test('record search restores browsing filters and exposes one date preset entry', async ({
  page
}) => {
  await loginStaff(page);
  await staffPage(page, '预约记录');
  const panel = page.getByRole('region', { name: '预约查询', exact: true });
  await panel.getByRole('button', { name: /当期 ·/ }).click();
  await page.getByRole('button', { name: '不限日期', exact: true }).click();
  await expect(panel.getByRole('button', { name: '全部日期', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: '本周预约', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: '维修中', exact: true }).click();
  const search = panel.getByRole('searchbox', { name: '查找预约' });
  await search.fill('202610');
  await expect(panel.getByRole('button', { name: '全部', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(search).toHaveValue('202610');
  await search.fill('');
  await expect(panel.getByRole('button', { name: '维修中', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  const more = panel.getByRole('button', { name: '更多预约状态', exact: true });
  if (await more.isVisible()) {
    await more.click();
    await page
      .getByRole('dialog', { name: '状态筛选' })
      .getByRole('button', { name: /已取消/ })
      .click();
    await expect(page.getByRole('dialog', { name: '状态筛选' })).toHaveCount(0);
    await expect(more).toHaveAttribute('aria-pressed', 'true');
  } else {
    await panel.getByRole('button', { name: '已取消', exact: true }).click();
    await expect(panel.getByRole('button', { name: '已取消', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  }
  await expect(panel.getByRole('button', { name: '移除状态筛选' })).toContainText('已取消');
  await panel.getByRole('button', { name: '筛选预约时段' }).click();
  const slots = page.getByRole('dialog', { name: '预约时段筛选' });
  await slots.getByRole('button').nth(1).click();
  await expect(slots).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '移除时段筛选' })).toBeVisible();
  await expect(panel.getByRole('button', { name: '移除状态筛选' })).toContainText('已取消');
  await panel.getByRole('button', { name: '全部日期', exact: true }).click();
  await page.getByRole('button', { name: '本周预约', exact: true }).click();
  await expect(panel.getByRole('button', { name: '移除时段筛选' })).toBeVisible();
  await expect(panel.getByRole('button', { name: '移除状态筛选' })).toContainText('已取消');
  await panel.getByRole('button', { name: '筛选预约时段' }).click();
  await search.click();
  await expect(slots).toHaveCount(0);
  await panel.getByRole('button', { name: '重置', exact: true }).click();
  await expect(panel.getByRole('button', { name: /当期 ·/ })).toBeVisible();
  await expect(panel.getByRole('button', { name: '全部', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('desktop sorting replaces the previous field and mobile has no sorting controls', async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginStaff(page);
  await staffPage(page, '预约记录');
  const panel = page.getByRole('region', { name: '预约查询', exact: true });
  await panel.getByRole('button', { name: /预约时间，未排序/ }).click();
  await panel.getByRole('button', { name: /校区，未排序/ }).click();
  await expect(panel.locator('th[aria-sort="ascending"]')).toHaveCount(1);
  await expect(panel.getByRole('button', { name: /预约时间，未排序/ })).toBeVisible();
  await panel.getByRole('button', { name: /校区.*点击降序/ }).click();
  await expect(panel.locator('th[aria-sort="descending"]')).toHaveCount(1);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(panel.locator('.record-sort:visible')).toHaveCount(0);
  await expect(page.getByLabel('排序与优先级', { exact: true })).toHaveCount(0);
});

test('choosing an overview parent clears its child filters', async ({ page }) => {
  await loginStaff(page);
  await staffPage(page, '预约记录');
  const panel = page.getByRole('region', { name: '预约查询', exact: true });
  await panel.getByRole('button', { name: /当期 ·/ }).waitFor();
  const campus = page.locator('.records-campus').first();
  const slot = campus.locator('.records-slot').first();
  await slot.getByRole('button', { name: /待接收/ }).click();
  await expect(panel.getByRole('button', { name: '移除时段筛选' })).toBeVisible();
  await expect(panel.getByRole('button', { name: '移除状态筛选' })).toBeVisible();
  await panel.getByRole('button', { name: '移除校区筛选' }).click();
  await expect(panel.getByRole('button', { name: '移除时段筛选' })).toBeVisible();
  await expect(panel.getByRole('button', { name: '移除状态筛选' })).toBeVisible();
  const reset = panel.getByLabel('当前筛选条件').getByRole('button', { name: '重置' });
  await expect(reset).toBeVisible();
  expect(
    await reset.evaluate((element) => element === element.parentElement.firstElementChild)
  ).toBe(true);
  await campus.locator('h3 button').click();
  await expect(panel.getByRole('button', { name: '移除校区筛选' })).toBeVisible();
  await expect(panel.getByRole('button', { name: '移除时段筛选' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '移除状态筛选' })).toHaveCount(0);
  await slot.getByRole('button', { name: /待接收/ }).click();
  await slot.locator('.records-slot-main').click();
  await expect(panel.getByRole('button', { name: '移除时段筛选' })).toBeVisible();
  await expect(panel.getByRole('button', { name: '移除状态筛选' })).toHaveCount(0);
  const tags = panel.getByLabel('当前筛选条件');
  const heights = await tags
    .locator(':scope > *')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  expect(new Set(heights).size).toBe(1);
  await page.locator('.records-periods button').first().click();
  await expect(panel.getByRole('button', { name: '移除校区筛选' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '移除时段筛选' })).toHaveCount(0);
});
