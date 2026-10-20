import { staffSession } from './support/staff.mjs';
import { test, expect } from '@playwright/test';

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
