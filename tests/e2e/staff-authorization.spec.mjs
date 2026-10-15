import { test, expect } from '@playwright/test';

const grants = [{ id: 'custom-start', permissionCode: 'repair.start', scope: { campusIds: ['campus-hunnan'], departmentIds: ['hardware'] },
  conditions: [{ code: 'activeDutyRole', parameters: { kind: 'repair_lead' } }], validity: { effectiveFrom: '2026-10-20', effectiveTo: '2026-11-01' } }];
const definitions = [
  { code: 'repair.start', name: '开始维修', scopeKinds: ['campus'], conditionKinds: ['activeDutyRole'] },
  { code: 'attendance.self', name: '本人签到', scopeKinds: ['self'], conditionKinds: [] }
];

async function fixture(page, { manageRoles = true } = {}) {
  const writes = [];
  let revision = 4;
  let bindings = [{ id: 'binding-custom', roleId: 'custom-role', scope: { campusIds: ['campus-hunnan'], departmentIds: ['hardware'] }, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' }];
  let member = { memberId: 'member-example', name: '测试成员', homeCampusId: 'campus-nanhu', status: 'active', revision };
  const role = { id: 'custom-role', name: '范围测试角色', code: 'custom', enabled: true, revision: 2, grants };
  await page.route('**/api/**', async route => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    let body = {};
    if (req.method() !== 'GET') writes.push({ path, method: req.method(), body: req.postDataJSON() });
    if (path === '/api/auth/login') body = { token: 'test-token', account: 'root001' };
    if (path === '/api/auth/me') body = { name: '平台测试管理员', account: 'root001', role: 'superadmin', actor: { memberId: 'root' },
      grants: [{ permissionCode: 'members.manage' }, ...(manageRoles ? [{ permissionCode: 'roles.manage' }] : [])] };
    if (path === '/api/members') body = { items: [member] };
    if (path === '/api/members/member-example') {
      if (req.method() === 'PATCH') member = { ...member, ...req.postDataJSON(), revision: ++revision };
      body = req.method() === 'PATCH' ? { member, revision } : { member, bindings };
    }
    if (path === '/api/members/member-example/roles' && req.method() === 'PUT') {
      bindings = req.postDataJSON().bindings; member = { ...member, revision: ++revision };
      body = { memberId: member.memberId, bindings, authVersionInvalidated: true };
    }
    if (path === '/api/roles') {
      if (!manageRoles) return route.fulfill({ status: 403, json: { error: '缺少角色权限' } });
      body = { items: [role] };
    }
    if (path === '/api/permissions') body = { items: definitions };
    if (path === '/api/roles/custom-role' && req.method() === 'PATCH') body = { ...role, ...req.postDataJSON(), revision: 3 };
    return route.fulfill({ json: body });
  });
  await page.goto('/staff/');
  const root = page.locator('#staff-react-root');
  await root.getByLabel('学号', { exact: true }).fill('root001');
  await root.getByLabel('密码', { exact: true }).fill('test-password');
  await root.getByRole('button', { name: '进入系统' }).click();
  await expect(root.getByRole('button', { name: '成员管理', exact: true })).toBeVisible();
  return { root, writes, bindings };
}

for (const width of [375, 1280]) test(`member profile saves independently from role bindings at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const { root, writes } = await fixture(page);
  await root.getByRole('button', { name: '成员管理', exact: true }).click();
  await root.getByRole('button', { name: '编辑成员与权限' }).click();
  const dialog = root.getByRole('dialog');
  await dialog.getByLabel('姓名', { exact: true }).fill('修改后的名字');
  await dialog.getByRole('combobox', { name: '所属校区', exact: true }).selectOption('campus-hunnan');
  await dialog.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('成员资料已保存');
  expect(writes.filter(write => write.path.includes('/members/'))).toEqual([{ path: '/api/members/member-example', method: 'PATCH',
    body: { name: '修改后的名字', homeCampusId: 'campus-hunnan', status: 'active', revision: 4 } }]);
  await expect(dialog.getByLabel('浑南', { exact: true })).toBeChecked();
  await expect(dialog.getByLabel('生效日期', { exact: true })).toHaveValue('2026-01-01');
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test('member editors without roles.manage can save profiles without fetching the roles endpoint', async ({ page }) => {
  const roleRequests = [];
  page.on('request', req => { if (new URL(req.url()).pathname === '/api/roles') roleRequests.push(req.url()); });
  const { root } = await fixture(page, { manageRoles: false });
  await root.getByRole('button', { name: '成员管理', exact: true }).click();
  await root.getByRole('button', { name: '编辑成员与权限' }).click();
  const dialog = root.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: '保存资料' })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: '保存角色授权' })).toHaveCount(0);
  expect(roleRequests).toEqual([]);
});

test('saving bindings uses the latest profile revision and preserves independent scopes and dates', async ({ page }) => {
  const { root, writes, bindings } = await fixture(page);
  await root.getByRole('button', { name: '成员管理', exact: true }).click();
  const edit = root.getByRole('button', { name: '编辑成员与权限' });
  await edit.click();
  const dialog = root.getByRole('dialog');
  await dialog.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('成员资料已保存');
  await dialog.getByRole('button', { name: '保存角色授权', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('角色授权已保存');
  expect(writes.filter(write => write.method === 'PUT')).toEqual([{ path: '/api/members/member-example/roles', method: 'PUT', body: { revision: 5, bindings } }]);
  await dialog.getByRole('button', { name: '关闭', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: '保存角色授权', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(edit).toBeFocused();
});

test('permission changes save once and preserve complete unrelated grants', async ({ page }) => {
  const { root, writes } = await fixture(page);
  await root.getByRole('button', { name: '权限编辑器', exact: true }).click();
  await root.getByRole('checkbox', { name: '本人签到' }).check();
  expect(writes.filter(write => write.path.startsWith('/api/roles/'))).toEqual([]);
  await root.getByRole('checkbox', { name: '开始维修' }).uncheck();
  await root.getByRole('checkbox', { name: '开始维修' }).check();
  await root.getByRole('button', { name: '保存权限', exact: true }).click();
  await expect(root.getByRole('status')).toHaveText('权限已保存，受影响的账号需要重新登录');
  const saved = writes.filter(write => write.path.startsWith('/api/roles/'));
  expect(saved).toHaveLength(1);
  expect(saved[0].body.grants.find(grant => grant.permissionCode === 'repair.start')).toEqual(grants[0]);
  expect(saved[0].body.grants.find(grant => grant.permissionCode === 'attendance.self').scope).toEqual({ self: true });
});
