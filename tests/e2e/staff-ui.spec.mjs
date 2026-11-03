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
    const controls = await page.locator('.field-app button, .field-app summary').evaluateAll(nodes => nodes
      .filter(node => node.checkVisibility() && !node.closest('[inert]'))
      .map(node => ({ text: node.textContent.trim(), height: node.getBoundingClientRect().height, font: parseFloat(getComputedStyle(node).fontSize) })));
    expect(controls.filter(control => control.height < 44 || control.font < 14)).toEqual([]);
    if (width < 768) {
      const metrics = await page.locator('.field-metric-card').evaluateAll(nodes => nodes.map(node => ({ top: node.getBoundingClientRect().top, fits: node.scrollWidth <= node.clientWidth })));
      expect(new Set(metrics.map(metric => metric.top)).size).toBe(1);
      expect(metrics.every(metric => metric.fits)).toBe(true);
      await expect(order.locator('.field-order-assignee')).toBeHidden();
    }
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
  const available = metrics.getByRole('button', { name: /^可接单/ });
  await queue.click();
  await available.click();
  await expect(queue).toHaveAttribute('aria-pressed', 'false');
  await queue.click();
  await expect(queue).toHaveAttribute('aria-pressed', 'true');
  await expect(available).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('heading', { name: '排队中', exact: true })).toBeVisible();
});

for (const width of [1366, 1920]) {
  test(`desktop workspace keeps navigation and three actionable orders in the first screen at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 768 });
    const session = await mockStaff(page, { contexts: [{ id: 'desk', label: '现场工作台' }, { id: 'repair', label: '维修工作台' }] });
    Object.assign(session.profile.permissions, { 'repair.receive': true, 'repair.transfer': true, 'roster.repair.manage': true, 'roster.office.manage': true, 'leave.review': true, 'attendance.correct': true, 'attendance.export': true });
    session.home.appointments = Array.from({ length: 3 }, (_, index) => ({ id: `reserve-${index}`, status: 'booked', date: '2026-11-02', campus: '南湖', timeSlot: '19:00–19:30', deviceModel: `电脑 ${index + 1}`, faultType: '系统问题' }));
    session.home.staffPresence = [{ memberId: 'unsigned', name: '待岗成员', scheduled: true, state: 'unsigned' }];
    await loginStaff(page);
    const sidebar = page.locator('.field-sidebar');
    await expect(sidebar.locator('.workspace-group-toggle')).toHaveCount(5);
    for (const toggle of await sidebar.locator('.workspace-group-toggle').all()) await expect(toggle).toBeInViewport();
    await expect(sidebar.getByRole('button', { expanded: true })).toHaveText('现场工作−');
    await expect(page.locator('.field-order').nth(2)).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: '查看到岗', exact: true })).toBeInViewport();
    expect(await sidebar.locator('nav').evaluate(node => node.scrollHeight <= node.clientHeight)).toBe(true);
    await sidebar.getByRole('button', { name: '人员权限', exact: true }).click();
    await expect(sidebar.getByRole('button', { name: '现场工作', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await sidebar.getByRole('button', { name: '人员管理', exact: true }).click();
    await expect(page.getByRole('heading', { name: '人员管理', exact: true })).toBeVisible();
    const tops = await page.locator('.members-tools').locator('input, select, .members-list-actions > button').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width, height: 500 });
    await sidebar.getByRole('button', { name: '我的', exact: true }).click();
    await sidebar.getByRole('button', { name: '账号安全', exact: true }).focus();
    await expect(sidebar.getByRole('button', { name: '账号安全', exact: true })).toBeInViewport();
    await expect(sidebar.getByRole('button', { name: '退出登录', exact: true })).toBeInViewport();
  });
}

test('desktop function shortcut supports Enter and preserves unsaved-change protection', async ({ page }) => {
  await mockStaff(page);
  await loginStaff(page);
  await page.keyboard.press('Control+k');
  const launcher = page.getByRole('dialog', { name: '工作入口' });
  const search = launcher.getByRole('searchbox', { name: '查找功能' });
  await expect(search).toBeFocused();
  await search.fill('密码');
  await search.press('Enter');
  await expect(page.getByRole('heading', { name: '账号安全', exact: true })).toBeVisible();
  // The existing guard is also used by keyboard-triggered navigation.
  await page.evaluate(() => window.addEventListener('staff-before-navigation', event => {
    event.preventDefault();
    event.detail.editors.push({ save: async () => false, discard() {} });
  }));
  await page.keyboard.press('Meta+k');
  await search.fill('预约 查询');
  await search.press('Enter');
  await expect(launcher).toBeHidden();
  const guard = page.getByRole('dialog', { name: '有未保存的调整' });
  await expect(guard).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(launcher).toHaveCount(0);
  await guard.getByRole('button', { name: '留在当前页面', exact: true }).click();
  await expect(page.getByRole('heading', { name: '账号安全', exact: true })).toBeVisible();
});
