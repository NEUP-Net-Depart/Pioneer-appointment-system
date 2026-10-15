import { test, expect } from '@playwright/test';

test('repair desk uses five-state labels and separates manual identifiers from signed QR codes', async ({ page }) => {
  const lookups = [];
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let json = {};
    if (path === '/api/auth/login') json = { token: 'test-token', account: 'root001', role: 'superadmin', authorizedCampuses: ['南湖', '浑南'] };
    if (path === '/api/auth/me') json = { account: 'root001', name: '测试负责人', role: 'superadmin', authorizedCampuses: ['南湖', '浑南'], grants: [{ permissionCode: 'repair.summary.read' }] };
    if (path === '/api/appointments') json = { counts: {}, filteredCounts: {}, items: [
      { date: '2026-10-15', timeSlot: '19:00–19:30', id: 'reserve020261015-01', status: 'cancelled', campus: '南湖' },
      { date: '2026-10-15', timeSlot: '19:00–19:30', id: 'reserve020261015-02', status: 'expired', campus: '南湖' },
      { date: '2026-10-15', timeSlot: '19:00–19:30', id: 'reserve020261015-03', status: 'completed', campus: '南湖' }
    ] };
    if (path === '/api/scan/resolve') { lookups.push(request.postDataJSON()); json = { date: '2026-10-15', timeSlot: '19:00–19:30', id: 'reserve020261015-01', campus: '南湖', status: 'booked' }; }
    await route.fulfill({ json });
  });
  await page.goto('/staff/');
  const root = page.locator('#staff-react-root');
  await root.locator('#login-view').getByLabel('学号', { exact: true }).fill('root001');
  await root.locator('#login-view').getByLabel('密码', { exact: true }).fill('test-password');
  await root.getByRole('button', { name: '进入系统' }).click();
  await root.getByRole('button', { name: '工作台', exact: true }).click();
  const input = root.getByPlaceholder('扫描或输入预约编号');
  await input.fill(' reserve020261015-01 ');
  await root.getByRole('button', { name: '查询工单' }).click();
  await expect.poll(() => lookups).toEqual([{ id: 'reserve020261015-01' }]);
  await input.fill('reserve020261015-01.abcdef012345');
  await root.getByRole('button', { name: '查询工单' }).click();
  await expect.poll(() => lookups.length).toBe(2);
  expect(lookups[1]).toEqual({ code: 'reserve020261015-01.abcdef012345' });
  await root.getByRole('button', { name: '维修后台', exact: true }).click();
  for (const label of ['已取消', '已逾期', '已完成']) await expect(root.locator('#appointments-table').getByText(label, { exact: true })).toBeVisible();
});
