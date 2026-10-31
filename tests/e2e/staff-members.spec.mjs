import { readFile } from 'node:fs/promises';
import { staffSession, mockStaff, loginStaff, staffPage } from './support/staff.mjs';
import { test, expect } from '@playwright/test';

test('member import previews preserve blank values and show changes, skips and conflicts on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await mockStaff(page);
  let confirmed;
  await page.route('**/api/members/import', route => {
    const input = route.request().postDataJSON();
    const summary = { created: 1, updated: 1, skipped: 1, conflict: 0 };
    const items = [
      { studentId: '20269981', name: '新人', status: 'created', changes: [{ label: '学院', before: '', after: '软件学院' }], conflicts: [] },
      { studentId: '20269982', name: '已有人员', status: 'updated', changes: [{ label: '姓名', before: '原姓名', after: '已有人员' }], conflicts: [] },
      { studentId: '20269983', name: '不变人员', status: 'skipped', changes: [], conflicts: [] }
    ];
    if (input.confirm) confirmed = input;
    return route.fulfill({ json: { items, summary, previewToken: 'reviewed-state' } });
  });
  await loginStaff(page);
  await staffPage(page, '人员管理');
  await page.getByRole('button', { name: '批量导入', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '批量导入人员' });
  const pendingDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '下载 CSV 模板' }).click();
  const download = await pendingDownload;
  expect((await readFile(await download.path(), 'utf8')).trim()).toBe('studentId,name,college');
  await dialog.locator('summary').filter({ hasText: '高级 CSV 配置' }).click();
  await expect(dialog).toContainText('空白资料和授权均保留');
  const csv = 'studentId,name,college\n20269981,新人,软件学院\n20269982,已有人员,\n20269983,不变人员,';
  await dialog.getByLabel('名单内容').fill(csv);
  await dialog.getByRole('button', { name: '预览并核对' }).click();
  await expect(dialog).toContainText('新增 1 人 · 更新 1 人 · 跳过 1 人 · 冲突 0 人');
  await expect(dialog.locator('.member-import-preview')).toContainText('原姓名 → 已有人员');
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: '确认差异并导入' }).click();
  await expect(dialog).toContainText('导入完成');
  expect(confirmed.previewToken).toBe('reviewed-state');
  expect(confirmed.accountCampusAction).toBe('preserve');
  expect(confirmed.defaults.workProfiles).toEqual([]);
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
  await root.getByRole('button', { name: '人员管理', exact: true }).first().click();
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

test('personnel management creates a single member, edits memberships, and maintains departments in one workspace', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-15T02:00:00Z'));
  await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': '192.0.2.219' });
  await loginStaff(page, 'root001', process.env.E2E_ROOT_PASSWORD);
  await staffPage(page, '人员管理');
  await expect(page.locator('.field-sidebar').getByRole('button', { name: '账号管理', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '新增人员', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新增人员', exact: true });
  await create.getByLabel('学号', { exact: true }).fill('20987701');
  await create.getByLabel('姓名', { exact: true }).fill('人员功能验收');
  await create.getByRole('combobox', { name: '实际部门', exact: true }).selectOption('dept-hardware');
  await create.getByRole('combobox', { name: '人员类型', exact: true }).selectOption('repair');
  await create.getByRole('button', { name: '新增人员', exact: true }).click();
  await expect(create).toHaveCount(0);
  await page.getByRole('textbox', { name: '搜索成员', exact: true }).fill('20987701');
  await page.locator('.members-results .react-row').filter({ hasText: '20987701' }).getByRole('button', { name: '人员详情', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '人员功能验收', exact: true });
  await detail.getByRole('button', { name: '部门与任职', exact: true }).click();
  await expect(detail.getByRole('region', { name: '部门任职记录' })).toContainText('硬件部');
  await detail.getByRole('combobox', { name: '实际部门', exact: true }).selectOption('dept-office');
  await detail.getByRole('combobox', { name: '任职类型', exact: true }).selectOption('secondary');
  await detail.getByRole('button', { name: '新增任职', exact: true }).click();
  await expect(detail.getByRole('region', { name: '部门任职记录' })).toContainText('办公室 · 兼任');
  await detail.getByRole('button', { name: '账号与激活', exact: true }).click();
  await expect(detail).toContainText('尚未创建登录账号');
  await detail.getByRole('button', { name: '工作资格', exact: true }).click();
  await expect(detail.getByRole('region', { name: '工作资格记录' })).toContainText('维修工作人员');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await detail.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: `output/member-management/member-detail-${width}.png`, animations: 'disabled' });
  }
  await detail.getByRole('button', { name: '操作记录', exact: true }).click();
  await expect(detail.getByRole('region', { name: '人员操作记录' })).toContainText('新增人员');
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '新增人员', exact: true }).click();
  await create.getByLabel('学号', { exact: true }).fill('20987701');
  await create.getByLabel('姓名', { exact: true }).fill('重复人员');
  await create.getByRole('button', { name: '新增人员', exact: true }).click();
  await expect(create).toContainText('学号已存在');
  await create.getByRole('button', { name: '打开现有人员', exact: true }).click();
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('navigation', { name: '人员管理功能' }).getByRole('button', { name: '部门维护', exact: true }).click();
  await page.getByRole('button', { name: '新增部门', exact: true }).click();
  const department = page.getByRole('dialog', { name: '新增部门', exact: true });
  await department.getByLabel('部门名称').fill('验收美工部');
  await department.getByRole('button', { name: '保存部门', exact: true }).click();
  const row = page.locator('.department-row').filter({ hasText: '验收美工部' });
  await row.getByRole('button', { name: '编辑部门' }).click();
  const editor = page.getByRole('dialog', { name: '编辑部门' });
  await editor.getByLabel('部门名称').fill('验收推广部');
  await editor.getByLabel('部门状态').selectOption('disabled');
  await editor.getByRole('button', { name: '保存部门' }).click();
  await expect(page.locator('.department-row').filter({ hasText: '验收推广部' })).toContainText('停用');
});

test('personnel navigation preserves separate member and account permissions', async ({ page }) => {
  await mockStaff(page, { role: 'technician', permissions: { 'members.manage': true } });
  await loginStaff(page);
  await staffPage(page, '人员管理');
  await expect(page.getByRole('navigation', { name: '人员管理功能' }).getByRole('button', { name: '激活与账号', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新增人员', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新增人员', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增人员', exact: true });
  await dialog.getByRole('combobox', { name: '人员类型', exact: true }).selectOption('repair');
  await expect(dialog.getByLabel('同时配置工作角色与激活资格')).toHaveCount(0);
});

test('a person detail edits its login through the account API and retains unsaved account changes across tabs', async ({ page }) => {
  await mockStaff(page);
  const member = { memberId: 'member-login-test', studentId: '20987702', name: '账号整合验收', homeCampusId: 'campus-nanhu', college: '', major: '', status: 'active', revision: 0, memberships: [], workProfiles: [] };
  let account = { account: member.studentId, name: member.name, role: 'technician', homeCampus: '南湖', authorizedCampuses: ['南湖'], status: 'enabled', authVersion: 0, actions: { edit: true, changeStatus: true, resetPassword: true } };
  let written;
  await page.route('**/api/members?*', (route) => route.fulfill({ json: { items: [member] } }));
  await page.route('**/api/members/member-login-test', (route) => route.fulfill({ json: { member, account, bindings: [], actions: { edit: true } } }));
  await page.route('**/api/users/20987702', (route) => {
    if (route.request().method() === 'PATCH') { written = route.request().postDataJSON(); account = { ...account, ...written, authVersion: account.authVersion + 1 }; }
    return route.fulfill({ json: account });
  });
  await loginStaff(page);
  await staffPage(page, '人员管理');
  await page.getByRole('button', { name: '人员详情', exact: true }).click();
  const detail = page.getByRole('dialog', { name: member.name, exact: true });
  await detail.getByRole('button', { name: '账号与激活', exact: true }).click();
  await detail.getByLabel('账号状态').selectOption('disabled');
  await detail.getByRole('button', { name: '部门与任职', exact: true }).click();
  await detail.getByRole('button', { name: '账号与激活', exact: true }).click();
  await expect(detail.getByLabel('账号状态')).toHaveValue('disabled');
  await detail.getByRole('button', { name: '保存账号', exact: true }).click();
  await expect(detail.getByLabel('账号状态')).toHaveValue('disabled');
  expect(written.status).toBe('disabled');
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(detail).toHaveCount(0);
});

test('settings managers reach department maintenance without reading personnel or accounts', async ({ page }) => {
  await mockStaff(page, { role: 'technician', permissions: { 'settings.manage': true } });
  const privateReads = [];
  page.on('request', request => {
    if (/^\/api\/(members|users)(\/|$)/.test(new URL(request.url()).pathname)) privateReads.push(request.url());
  });
  await page.route('**/api/organization/departments?*', route => route.fulfill({ json: {
    items: [{ id: 'dept-office', name: '办公室', enabled: true, revision: 0 }], actions: { manage: true }
  } }));
  await loginStaff(page);
  await staffPage(page, '人员管理');
  await expect(page.getByRole('navigation', { name: '人员管理功能' }).getByRole('button')).toHaveText(['部门维护']);
  await expect(page.getByRole('button', { name: '新增部门', exact: true })).toBeVisible();
  expect(privateReads).toEqual([]);
});
