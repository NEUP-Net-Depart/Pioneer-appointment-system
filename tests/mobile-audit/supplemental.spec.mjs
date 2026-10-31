import { test, expect, login, navigate } from './support.mjs';
test.skip(process.env.E2E_FIELD !== 'true', 'Requires the disposable field fixture');

test('supplemental-permission-categories-loading-and-failure', async ({ page, audit }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/members?*', async route => { await gate; const response = await route.fetch(); await route.fulfill({ response }); });
  await login(page);
  await navigate(page, '人员管理');
  await expect(page.locator('.workspace-skeleton:visible')).toHaveCount(1);
  await expect(page.getByRole('status').filter({ hasText: '正在更新筛选结果' })).toHaveCount(1);
  await expect(page.locator('.workspace-skeleton:visible')).toHaveAttribute('aria-hidden', 'true');
  await audit.capture('members-loading-feedback', { axe: true });
  release();
  await expect(page.locator('.members-results .react-row:not(.react-row-head)')).not.toHaveCount(0);
  await page.route('**/api/members?*', route => route.fulfill({ status: 503, json: { error: '本地审查模拟成员列表读取失败' } }));
  await page.getByRole('textbox', { name: '搜索成员', exact: true }).fill('network-audit');
  await expect(page.getByRole('alert')).toContainText('本地审查模拟成员列表读取失败');
  await audit.capture('members-network-error-feedback');
  await navigate(page, '角色与权限');
  const categories = page.getByRole('navigation', { name: '权限功能分类', exact: true });
  await expect(categories).toBeVisible();
  for (const label of ['接待与维修', '排班与申请', '签到与在岗', '管理与数据', '全部功能']) {
    await categories.getByRole('button', { name: label, exact: true }).click();
    const sample = await audit.capture(`permission-category-${label}`, { axe: label === '排班与申请' });
    expect.soft(sample.documentWidth).toBeLessThanOrEqual(sample.viewport.width + 1);
  }
});
