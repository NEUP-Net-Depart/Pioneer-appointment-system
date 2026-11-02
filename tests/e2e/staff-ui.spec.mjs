import { test, expect } from '@playwright/test';
import { mockStaff, loginStaff, staffPage } from './support/staff.mjs';

for (const width of [320, 768, 1440]) {
  test(`reception exposes the next action beside each order at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const session = await mockStaff(page, { contexts: [{ id: 'desk', label: '现场工作台' }] });
    session.home.capability['repair.receive'] = true;
    session.home.appointments = [{ id: 'reserve020261102-01', status: 'booked', date: '2026-11-02', campus: '南湖', timeSlot: '19:00–19:30', deviceModel: 'ThinkPad T14', faultType: '系统问题' }];
    await loginStaff(page);
    const order = page.getByRole('button', { name: /ThinkPad T14.*核验到场/ });
    await expect(order).toBeVisible();
    await expect(order.getByText('核验到场', { exact: false })).toBeVisible();
    expect(await order.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`quick record filters compose with search and campus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.setFixedTime(new Date('2026-11-02T08:00:00+08:00'));
    await mockStaff(page);
    const reads = [];
    await page.route('**/api/appointments?*', route => {
      reads.push(Object.fromEntries(new URL(route.request().url()).searchParams));
      return route.fulfill({ json: { items: [], counts: {} } });
    });
    await loginStaff(page);
    await staffPage(page, '预约记录');
    await page.getByRole('searchbox', { name: '查找预约' }).fill('ThinkPad');
    await expect.poll(() => reads.at(-1)?.q).toBe('ThinkPad');
    await page.getByRole('button', { name: '全部校区', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '浑南校区', exact: true }).click();
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await page.getByRole('navigation', { name: '预约处理状态' }).getByRole('button', { name: '待处理', exact: true }).click();
    await page.getByRole('button', { name: '今日预约', exact: true }).click();
    await expect.poll(() => reads.at(-1)).toMatchObject({ q: 'ThinkPad', campus: '浑南', status: 'pending', date: '2026-11-02', dateFrom: '', dateTo: '' });
    await page.getByRole('button', { name: '本周预约', exact: true }).click();
    await expect.poll(() => reads.at(-1)).toMatchObject({ q: 'ThinkPad', campus: '浑南', status: 'pending', date: '', dateFrom: '2026-11-02', dateTo: '2026-11-08' });
    await staffPage(page, '账号安全');
    await staffPage(page, '预约记录');
    await expect(page.getByRole('button', { name: '本周预约', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('searchbox', { name: '查找预约' })).toHaveValue('ThinkPad');
    await page.getByRole('button', { name: '不限日期', exact: true }).click();
    await expect.poll(() => reads.at(-1)).toMatchObject({ q: 'ThinkPad', campus: '浑南', status: 'pending', date: '', dateFrom: '', dateTo: '' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`function search finds operations without exposing unauthorized pages at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockStaff(page, { role: 'technician', contexts: [{ id: 'repair', label: '维修工作台' }], permissions: { 'repair.start': true, 'attendance.self': true, 'roster.read': true } });
    await loginStaff(page);
    const launcherButton = width < 768
      ? page.getByRole('navigation', { name: '手机岗位导航' }).getByRole('button', { name: '更多', exact: true })
      : page.locator('.field-sidebar').getByRole('button', { name: '查找功能', exact: true });
    await launcherButton.click();
    const dialog = page.getByRole('dialog', { name: '工作入口' });
    const search = dialog.getByRole('searchbox', { name: '查找功能' });
    await expect(search).toBeFocused();
    await search.fill('换班');
    await expect(dialog.getByRole('navigation').getByRole('button')).toHaveText(['班次与排班']);
    await search.fill('激活');
    await expect(dialog.getByText('没有匹配的功能', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '清空搜索' }).click();
    await expect(dialog.getByRole('button', { name: '人员管理', exact: true })).toHaveCount(0);
    await search.fill('密码');
    await dialog.getByRole('button', { name: '账号安全', exact: true }).click();
    await expect(page.getByRole('heading', { name: '账号安全', exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('returning from people to the same queue keeps the requested filter selected', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await mockStaff(page, { contexts: [{ id: 'desk', label: '现场工作台' }] });
  await loginStaff(page);
  const metrics = page.getByRole('group', { name: '现场概览' });
  const queue = metrics.getByRole('button', { name: /^排队中/ });
  const available = metrics.getByRole('button', { name: /^空闲中/ });
  await queue.click();
  await available.click();
  await expect(queue).toHaveAttribute('aria-pressed', 'false');
  await queue.click();
  await expect(queue).toHaveAttribute('aria-pressed', 'true');
  await expect(available).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('heading', { name: '排队中', exact: true })).toBeVisible();
});
