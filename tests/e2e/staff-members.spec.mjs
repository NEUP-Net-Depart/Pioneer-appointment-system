import { readFile } from 'node:fs/promises';
import { staffSession, mockStaff, loginStaff, staffPage } from './support/staff.mjs';
import { test, expect } from '@playwright/test';

test('member import templates explain account selection and previews show each login scope change', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await mockStaff(page);
  const cases = [
    { csv: 'studentId,name,homeCampusId\n20269982,保留校区,campus-nanhu', updateAccountCampuses: false, accountTargets: [], authorizedCampuses: [], expected: '登录账号校区：保持不变' },
    { csv: 'studentId,name,homeCampusId,authorizedCampuses\n20269982,清空校区,campus-nanhu,', updateAccountCampuses: true, accountTargets: ['20269982'], authorizedCampuses: [], expected: '20269982 → 清空全部校区授权' },
    { csv: 'studentId,name,homeCampusId,authorizedCampuses,accountTargets\n20269982,替换全部校区,campus-nanhu,南湖|浑南,*', updateAccountCampuses: true, accountTargets: ['20269982', '20269983'], authorizedCampuses: ['南湖', '浑南'], expected: '20269982、20269983 → 南湖、浑南' }
  ];
  await page.route('**/api/members/import', route => {
    const input = route.request().postDataJSON();
    const item = cases.find(item => item.csv === input.csv);
    return route.fulfill({ json: input.confirm ? { count: 1 } : { items: [{ ...item, studentId: '20269982', name: '测试成员', homeCampusId: 'campus-nanhu', workProfiles: [], roleCodes: [] }], warnings: [] } });
  });
  await loginStaff(page);
  await staffPage(page, '成员管理');
  await page.getByRole('button', { name: '导入名单', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入成员与激活资格' });
  await expect(dialog).toContainText('空值会清空授权');
  await expect(dialog).toContainText('多账号成员须用 accountTargets');
  const pendingDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '下载 CSV 模板' }).click();
  const download = await pendingDownload;
  expect((await readFile(await download.path(), 'utf8')).trim().split(',')).toContain('accountTargets');
  for (const item of cases) {
    await dialog.getByLabel('名单内容').fill(item.csv);
    await dialog.getByRole('button', { name: '预览并核对' }).click();
    await expect(dialog.locator('.member-import-preview')).toContainText(item.expected);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await dialog.getByRole('button', { name: '返回修改' }).click();
  }
});

test('member pages append without duplicates and an obsolete page cannot replace a new search', async ({ page }) => {
  const session = staffSession({ permissions: { 'members.manage': true } });
  let releasePage;
  const pendingPage = new Promise(resolve => { releasePage = resolve; });
  let pageRequested;
  const pageStarted = new Promise(resolve => { pageRequested = resolve; });
  const member = (memberId, name) => ({ memberId, name, homeCampusId: 'campus-nanhu', status: 'active', revision: 0 });
  let delayNextPage = false;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    let json = {};
    if (url.pathname === '/api/auth/login') json = { token: 'test-token', account: 'root001', role: 'superadmin', authorizedCampuses: ['南湖'] };
    if (url.pathname === '/api/auth/me') json = { name: '测试管理员', role: 'superadmin', account: 'root001', authorizedCampuses: ['南湖'], grants: [{ permissionCode: 'members.manage' }]  };
    if (url.pathname === '/api/auth/me') json = session.profile;
    if (url.pathname.startsWith('/api/field/')) json = session.home;
    if (url.pathname === '/api/members') {
      const q = url.searchParams.get('q'), cursor = url.searchParams.get('cursor');
      if (q === '新检索') json = { items: [member('new', '新检索结果')], nextCursor: null };
      else if (cursor) {
        if (delayNextPage) { pageRequested(); await pendingPage; }
        json = { items: [member('second', '第二位更新'), member('third', '第三位成员')], nextCursor: null };
      } else json = { items: [member('first', '第一位成员'), member('second', '第二位成员')], nextCursor: 'next-page' };
    }
    await route.fulfill({ json }).catch(() => {});
  });
  await page.goto('/staff/');
  const root = page.locator('#staff-react-root');
  await root.locator('#login-view').getByLabel('学号', { exact: true }).fill('root001');
  await root.locator('#login-view').getByLabel('密码', { exact: true }).fill('test-password');
  await root.getByRole('button', { name: '进入系统' }).click();
  await root.getByRole('button', { name: '成员管理', exact: true }).first().click();
  await expect(root.getByText('第一位成员', { exact: true })).toBeVisible();
  await root.getByRole('button', { name: '加载更多成员' }).click();
  await expect(root.locator('.react-toolbar').getByRole('status')).toHaveText('已显示 3 名成员');
  await expect(root.getByText('第二位更新', { exact: true })).toHaveCount(1);
  await expect(root.getByRole('button', { name: '加载更多成员' })).toHaveCount(0);

  await root.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(root.locator('.react-toolbar').getByRole('status')).toHaveText('已显示 2 名成员');
  delayNextPage = true;
  await root.getByRole('button', { name: '加载更多成员' }).click();
  await pageStarted;
  await root.getByRole('textbox', { name: '搜索成员' }).fill('新检索');
  await expect(root.getByText('新检索结果', { exact: true })).toBeVisible();
  releasePage();
  // Drain the released fixture and a render frame before asserting stable state.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(root.locator('.react-toolbar').getByRole('status')).toHaveText('已显示 1 名成员');
  await expect(root.getByText('第三位成员', { exact: true })).toHaveCount(0);
  await expect(root.getByRole('button', { name: '加载更多成员' })).toHaveCount(0);
});
