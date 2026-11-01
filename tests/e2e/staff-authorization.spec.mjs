import { staffSession } from './support/staff.mjs';
import { test, expect } from '@playwright/test';

const grants = [{ id: 'custom-start', permissionCode: 'repair.start', scope: { campusIds: ['campus-hunnan'], departmentIds: ['hardware'] },
  conditions: [{ code: 'activeDutyRole', parameters: { kind: 'repair_lead' } }], validity: { effectiveFrom: '2026-10-20', effectiveTo: '2026-11-01' } }];
const definitions = [
  { code: 'repair.start', name: '开始维修', scopeKinds: ['campus', 'department'], conditionKinds: ['activeDutyRole'] },
  { code: 'attendance.self', name: '本人签到', scopeKinds: ['self'], conditionKinds: [] }
];

async function fixture(page, { manageRoles = true, roleName = 'superadmin', protectedFirstRole = false } = {}) {
  const session = staffSession({ role: roleName, permissions: { 'members.manage': true, 'roles.manage': manageRoles } });
  const writes = [];
  let revision = 4;
  let bindings = [{ id: 'binding-custom', roleId: 'custom-role', scope: { campusIds: ['campus-hunnan'], departmentIds: ['hardware'] }, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' }];
  let member = { memberId: 'member-example', name: '测试成员', homeCampusId: 'campus-nanhu', status: 'active', revision };
  const role = { id: 'custom-role', name: '范围测试角色', code: 'custom', enabled: true, revision: 2, grants };
  await page.route('**/api/**', async route => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    let body = {};
    if (req.method() !== 'GET') writes.push({ path, method: req.method(), body: req.postDataJSON() });
    if (path === '/api/auth/login') body = { token: 'test-token', account: 'root001', role: roleName, authorizedCampuses: ['南湖', '浑南'] };
    if (path.startsWith('/api/field/')) body = session.home;
    if (path === '/api/auth/me') body = { name: '平台测试管理员', account: 'root001', role: roleName, authorizedCampuses: ['南湖'], homeCampus: '南湖', actor: { memberId: 'root' },
      grants: [{ permissionCode: 'members.manage' }, ...(manageRoles ? [{ permissionCode: 'roles.manage' }] : [])] };
    if (path === '/api/auth/me') body = { ...body, permissions: session.profile.permissions, navigation: session.profile.navigation };
    if (path === '/api/appointments') body = { items: [], counts: {}, filteredCounts: {} };
    if (path === '/api/appointments/overview') body = { dates: [], campuses: [], items: [] };
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
      body = { items: [
        ...(protectedFirstRole ? [{ id:'role-superadmin',code:'superadmin',name:'最高管理员',enabled:true,actions:{edit:false,bind:false} }] : []),
        role
      ] };
    }
    if (path === '/api/organization/campuses') body = { items: [{ id: 'campus-nanhu', name: '南湖' }, { id: 'campus-hunnan', name: '浑南' }] };
    if (path === '/api/organization/departments') body = { items: [{ id: 'hardware', name: '硬件部' }] };
    if (path === '/api/permissions') body = { items: definitions, conditionProviders: [{ code: 'activeDutyRole', description: '当前成员在业务日期拥有有效岗位', version: 1,
      parameterSchema: { type: 'object', properties: { kind: { type: 'string' } } } }] };
    if (path === '/api/roles/custom-role' && req.method() === 'PATCH') body = { ...role, ...req.postDataJSON(), revision: 3 };
    return route.fulfill({ json: body });
  });
  await page.goto('/staff/');
  const root = page.locator('#staff-react-root');
  await root.locator('#login-view').getByLabel('学号', { exact: true }).fill('root001');
  await root.locator('#login-view').getByLabel('密码', { exact: true }).fill('test-password');
  await root.getByRole('button', { name: '进入系统' }).click();
  await expect(root.getByRole('button', { name: '人员管理', exact: true }).first()).toBeVisible();
  return { root, writes, bindings };
}

for (const width of [375, 1280]) test(`member profile saves independently from role bindings at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const { root, writes } = await fixture(page);
  await root.getByRole('button', { name: '人员管理', exact: true }).first().click();
  await root.getByRole('button', { name: '人员详情' }).click();
  const dialog = root.getByRole('dialog');
  await dialog.getByLabel('姓名', { exact: true }).fill('修改后的名字');
  await dialog.getByRole('combobox', { name: '所属校区', exact: true }).selectOption('campus-hunnan');
  await dialog.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('成员资料已保存');
  expect(writes.filter(write => write.path.includes('/members/'))).toEqual([{ path: '/api/members/member-example', method: 'PATCH',
    body: { name: '修改后的名字', homeCampusId: 'campus-hunnan', status: 'active', revision: 4 } }]);
  await dialog.getByRole('button', { name: '角色授权', exact: true }).click();
  await expect(dialog.getByLabel('浑南', { exact: true })).toBeChecked();
  await expect(dialog.getByLabel('生效日期', { exact: true })).toHaveValue('2026-01-01');
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test('member editors without roles.manage can save profiles without fetching the roles endpoint', async ({ page }) => {
  const roleRequests = [];
  page.on('request', req => { if (new URL(req.url()).pathname === '/api/roles') roleRequests.push(req.url()); });
  const { root } = await fixture(page, { manageRoles: false });
  await root.getByRole('button', { name: '人员管理', exact: true }).first().click();
  await root.getByRole('button', { name: '人员详情' }).click();
  const dialog = root.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: '保存资料' })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: '保存角色授权' })).toHaveCount(0);
  expect(roleRequests).toEqual([]);
});

test('saving bindings uses the latest profile revision and preserves independent scopes and dates', async ({ page }) => {
  const { root, writes, bindings } = await fixture(page);
  await root.getByRole('button', { name: '人员管理', exact: true }).first().click();
  const edit = root.getByRole('button', { name: '人员详情' });
  await edit.click();
  const dialog = root.getByRole('dialog');
  await dialog.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('成员资料已保存');
  await dialog.getByRole('button', { name: '角色授权', exact: true }).click();
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
  await root.locator('.field-sidebar').getByRole('button', { name: '角色与权限', exact: true }).click();
  await root.getByRole('checkbox', { name: '本人签到' }).check();
  expect(writes.filter(write => write.path.startsWith('/api/roles/'))).toEqual([]);
  await root.getByRole('checkbox', { name: '开始维修' }).uncheck();
  await root.getByRole('checkbox', { name: '开始维修' }).check();
  await root.getByRole('button', { name: '保存权限', exact: true }).click();
  await expect(root.locator('.permissions-workspace').getByRole('status')).toHaveText('权限已保存，受影响的账号需要重新登录');
  const saved = writes.filter(write => write.path.startsWith('/api/roles/'));
  expect(saved).toHaveLength(1);
  expect(saved[0].body.grants.find(grant => grant.permissionCode === 'repair.start')).toEqual(grants[0]);
  expect(saved[0].body.grants.find(grant => grant.permissionCode === 'attendance.self').scope).toEqual({ self: true });
});

test('scope, registered condition parameters and validity can be edited without dropping grant metadata', async ({ page }) => {
  const { root, writes } = await fixture(page);
  await root.locator('.field-sidebar').getByRole('button', { name: '角色与权限', exact: true }).click();
  const editor = root.locator('.react-grant-details');
  await editor.locator('summary').click();
  await editor.getByLabel('南湖', { exact: true }).check();
  await editor.getByLabel('指定岗位', { exact: true }).fill('office_lead');
  await editor.getByLabel('权限生效日期').fill('2026-10-21');
  await editor.getByLabel('权限结束日期').fill('2026-11-03');
  await root.getByRole('button', { name: '保存权限', exact: true }).click();
  await expect(root.locator('.permissions-workspace').getByRole('status')).toContainText('权限已保存');
  const saved = writes.find(write => write.path === '/api/roles/custom-role').body.grants[0];
  expect(saved).toEqual({ ...grants[0], scope: { campusIds: ['campus-hunnan', 'campus-nanhu'], departmentIds: ['hardware'] },
    conditions: [{ code: 'activeDutyRole', parameters: { kind: 'office_lead' } }], validity: { effectiveFrom: '2026-10-21', effectiveTo: '2026-11-03' } });
});


test('operational and React pages share a session and navigation follows grants rather than legacy roles', async ({ page }) => {
  const errors = [], memberTokens = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/members') memberTokens.push(request.headers().authorization);
  });
  const { root } = await fixture(page, { manageRoles: false, roleName: 'technician' });
  await expect(root.getByRole('button', { name: '角色与权限', exact: true })).toBeHidden();
  await root.getByRole('button', { name: '人员管理', exact: true }).first().click();
  await expect(root.locator('.react-members-page')).toContainText('测试成员');
  await root.getByRole('button', { name: '账号安全', exact: true }).click();
  await expect(root.locator('.workspace-page:visible')).toContainText('root001');
  await expect(root.locator('.react-members-page')).toBeHidden();
  await root.getByRole('button', { name: '人员管理', exact: true }).first().click();
  await expect(root.locator('.react-members-page')).toContainText('测试成员');
  // Cached rows render immediately; revalidation completes independently.
  await expect.poll(() => memberTokens.length).toBeGreaterThanOrEqual(1);
  expect(memberTokens.every(value => value === 'Bearer test-token')).toBe(true);
  await root.locator('.field-sidebar').getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(root.locator('#login-view')).toBeVisible();
  await expect(root.locator('.react-members-page')).toHaveCount(0);
  await expect(root.getByRole('button', { name: '人员管理', exact: true }).first()).toBeHidden();
  expect(errors).toEqual([]);
});


test('a business role manager can configure ordinary grants with a technician base account',async({page})=>{
  const {root,writes}=await fixture(page,{roleName:'technician'});
  await root.locator('.field-sidebar').getByRole('button',{name:'角色与权限',exact:true}).click();
  await root.getByRole('checkbox',{name:'本人签到'}).check();
  await root.getByRole('button',{name:'保存权限',exact:true}).click();
  await expect(root.locator('.permissions-workspace').getByRole('status')).toContainText('权限已保存');
  expect(writes.filter(write=>write.path==='/api/roles/custom-role')).toHaveLength(1);
});

test('a business manager adds an ordinary role without defaulting to a hidden system role',async({page})=>{
  const {root,writes}=await fixture(page,{roleName:'technician',protectedFirstRole:true});
  await root.getByRole('button',{name:'人员管理',exact:true}).first().click();
  await root.getByRole('button',{name:'人员详情'}).click();
  const dialog=root.getByRole('dialog');
  await dialog.getByRole('button',{name:'角色授权',exact:true}).click();
  await dialog.getByRole('button',{name:'添加角色',exact:true}).click();
  await expect(dialog.getByRole('combobox',{name:'角色',exact:true}).last()).toHaveValue('custom-role');
  await expect(dialog.getByRole('option',{name:'最高管理员',exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'保存角色授权',exact:true}).click();
  await expect(dialog.getByRole('status')).toContainText('角色授权已保存');
  expect(writes.find(write=>write.method==='PUT').body.bindings.every(binding=>binding.roleId==='custom-role')).toBe(true);
});
