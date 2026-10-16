import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '192.0.2.92' } });

async function expandGroup(page, name) {
  const group = page.locator('.field-sidebar').getByRole('button', { name, exact: true }).first();
  if (await group.getAttribute('aria-expanded') === 'false') await group.click();
}

test.skip(process.env.E2E_FIELD !== 'true', 'Uses the isolated staff fixture');

test('department manager creates only authorized roster scopes across screen sizes', async ({ page, request }) => {
  await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': '192.0.2.119' });
  const root = await request.post('/api/auth/login', { data: { account: 'root001', password: process.env.E2E_ROOT_PASSWORD } }).then(response => response.json());
  const headers = { Authorization: `Bearer ${root.token}` };
  async function command(path, data, method = data ? 'POST' : 'GET') {
    const response = await request.fetch(path, { method, headers, ...(data ? { data } : {}) });
    const result = await response.json();
    expect(response.ok(), JSON.stringify(result)).toBe(true);
    return result;
  }
  const original = await command('/api/members/member-20261004');
  const role = await command('/api/roles', { code: 'department_browser_' + Date.now(), name: '部门排班负责人', grants: [
    { permissionCode: 'roster.repair.manage', scope: { campusIds: ['campus-nanhu'], departmentIds: ['dept-hardware'] }, conditions: [{ code: 'activeDutyRole', version: 1, parameters: { kind: 'repair_lead' } }] },
  ] });
  try {
    await command('/api/members/member-20261004/roles', { revision: original.member.revision, bindings: [{ roleId: role.id, scope: { campusIds: ['campus-nanhu','campus-hunnan'] }, effectiveFrom: '2026-01-01' }] }, 'PUT');
    await page.goto('/staff/');
    await page.locator('#login-id').fill('20261004'); await page.locator('#login-password').fill('StaffTest!2026');
    await page.getByRole('button', { name: '进入系统' }).click();
    await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();
    await expandGroup(page, '值班管理');
    await page.locator('.field-sidebar').getByRole('button', { name: '维修排班管理', exact: true }).click();
    await page.getByRole('button', { name: '新建收集任务', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '收集下周可用时间', exact: true });
    const campus = dialog.getByRole('combobox', { name: '校区', exact: true });
    // The account is bound only to Nanhu: a grant for Hunnan cannot extend it.
    await expect(campus.locator('option')).toHaveCount(1);
    await expect(campus).toHaveValue('campus-nanhu');
    const departments = dialog.getByRole('group', { name: '参与部门', exact: true });
    await expect(departments.getByRole('button', { name: '硬件部', exact: true })).toHaveAttribute('aria-pressed','true');
    await expect(departments.getByRole('button', { name: '办公室', exact: true })).toHaveCount(0);
    await expect(departments.getByRole('button', { name: '全部部门', exact: true })).toHaveCount(0);
    await departments.getByRole('button', { name: '硬件部', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '创建收集任务', exact: true })).toBeDisabled();
    await departments.getByRole('button', { name: '硬件部', exact: true }).click();
    await dialog.getByLabel('周一日期', { exact: true }).fill('2026-12-07');
    await dialog.getByLabel('填报截止', { exact: true }).fill('2026-12-06T18:00');
    await mkdir('output/field-workflow', { recursive: true });
    for (const width of [1440,390,320]) {
      await page.setViewportSize({ width,height:900 });
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `output/field-workflow/department-roster-${width}.png`,fullPage:true });
    }
    const created = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/roster-tasks');
    await dialog.getByRole('button', { name: '创建收集任务', exact: true }).click();
    const response = await created;
    expect(response.ok(), await response.text()).toBe(true);
    expect(response.request().postDataJSON().departmentIds).toEqual(['dept-hardware']);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel('排班周与校区')).toContainText('硬件部');
  } finally {
    const latest = await command('/api/members/member-20261004');
    await command('/api/members/member-20261004/roles', { revision: latest.member.revision, bindings: original.bindings }, 'PUT');
  }
});

test('members preview, confirm and recover a swap through responsive personal workspaces', async ({ browser }) => {
  const contexts = await Promise.all([1,2].map(index => browser.newContext({ baseURL:process.env.E2E_BASE_URL,viewport:{ width:1440,height:1000 },extraHTTPHeaders:{ 'CF-Connecting-IP':`192.0.2.${100 + index}` } })));
  try {
    const [sender,invitee] = await Promise.all(contexts.map(context => context.newPage()));
    await invitee.clock.install();
    async function open(page,account) {
      await page.goto('/staff/');
      await page.locator('#login-id').fill(account); await page.locator('#login-password').fill('StaffTest!2026');
      await page.getByRole('button', { name:'进入系统' }).click();
      await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();
      await expandGroup(page,'我的');
      await page.locator('.field-sidebar').getByRole('button', { name:'班次与排班',exact:true }).click();
      await expect(page.locator('.duty-card')).toHaveCount(1);
    }
    await open(sender,'20261002'); await open(invitee,'20261003');
    // A second member's update must reach an already-open personal route.
    await sender.getByRole('button', { name:'发起换班',exact:true }).click();
    const targets = sender.getByRole('combobox', { name:'希望调换到',exact:true });
    await expect(targets.locator('option').filter({ hasText:'周宁' })).toHaveCount(1);
    await targets.selectOption({ label:await targets.locator('option').filter({ hasText:'周宁' }).textContent() });
    const projection = sender.getByRole('region', { name:'交换后的班次',exact:true });
    await expect(projection).toContainText('陈宇'); await expect(projection).toContainText('周宁');
    await expect(sender.getByRole('button', { name:'发送换班邀请',exact:true })).toBeEnabled();
    await sender.getByLabel('换班说明').fill('浏览器验收：双方确认后交换');
    await mkdir('output/field-workflow',{ recursive:true });
    for (const width of [1440,390,320]) {
      await sender.setViewportSize({ width,height:900 });
      expect(await sender.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(projection).toBeVisible();
      await sender.screenshot({ path:`output/field-workflow/swap-preview-${width}.png`,fullPage:true });
    }
    await sender.getByRole('button', { name:'发送换班邀请',exact:true }).click();
    await expect(sender.getByRole('status').filter({ hasText:'换班申请已发送' })).toBeVisible();
    await invitee.bringToFront();
    await invitee.locator('.field-sidebar').getByRole('button', { name:'维修工作台',exact:true }).click();
    await invitee.clock.fastForward(31000);
    await expect(invitee.getByRole('region', { name:'待响应的换班邀请' })).toContainText('1 份换班邀请等待你确认');
    await invitee.getByRole('button', { name:'查看邀请',exact:true }).click();
    const invitation = invitee.locator('.swap-invitation').filter({ hasText:'陈宇 与 周宁的换班' });
    await expect(invitation).toBeVisible();
    await invitation.getByRole('button', { name:'查看并确认',exact:true }).click();
    const confirmation = invitee.getByRole('dialog', { name:'换班详情',exact:true });
    await expect(confirmation).toContainText('浏览器验收：双方确认后交换');
    await expect(confirmation.getByRole('button', { name:'确认并同意换班',exact:true })).toBeEnabled();
    for (const width of [1440,390,320]) {
      await invitee.setViewportSize({ width,height:900 });
      await expect(confirmation).toBeVisible();
      expect(await confirmation.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await invitee.screenshot({ path:`output/field-workflow/swap-confirm-${width}.png`,fullPage:true });
    }
    await invitee.clock.resume();
    await confirmation.getByRole('button', { name:'确认并同意换班',exact:true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(invitation).toContainText('已生效');
    await invitee.reload();
    await expect(invitee.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();
    await invitee.setViewportSize({ width:1440,height:1000 });
    await expandGroup(invitee,'我的');
    await invitee.locator('.field-sidebar').getByRole('button', { name:'班次与排班',exact:true }).click();
    await invitee.getByRole('button', { name:/我的申请/ }).click();
    await expect(invitee.locator('.swap-invitation')).toContainText('已生效');
    await invitee.locator('.swap-invitation').getByRole('button', { name:'查看详情',exact:true }).click();
    await expect(invitee.getByRole('dialog', { name:'换班详情' })).toContainText('已生效');
    await expect(invitee.getByRole('button', { name:'确认并同意换班',exact:true })).toHaveCount(0);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('member submits leave and reviewer checks coverage in one responsive approval workspace', async ({ page, request }) => {
  await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': '192.0.2.96' });
  const session = await request.post('/api/auth/login', { data: { account: 'root001', password: process.env.E2E_ROOT_PASSWORD } }).then(response => response.json());
  const headers = { Authorization: `Bearer ${session.token}` };
  async function command(path, data, method = 'POST') {
    const response = await request.fetch(path, { method, headers, data });
    const body = await response.json();
    expect(response.ok(), JSON.stringify(body)).toBe(true);
    return body;
  }
  const task = await command('/api/roster-tasks', { dutyType: 'office', weekStart: '2026-11-16', campusId: 'campus-nanhu', slotStart: '19:00', slotEnd: '21:00', deadline: '2026-11-15T10:00:00Z' });
  const generated = await command('/api/rosters/generate', { taskId: task.id });
  const state = await command(`/api/roster-tasks/${task.id}/roster`, undefined, 'GET');
  const saved = await command(`/api/rosters/${generated.version.id}`, { version: generated.version.version, assignments: state.slots.flatMap(slot => ['member-20261001','member-root001'].map(memberId => ({ ...slot, memberId }))) }, 'PATCH');
  await command(`/api/rosters/${saved.id}/publish`, { version: saved.version });
  async function login(account) {
    await page.goto('/staff/');
    await page.locator('#login-form').getByLabel('学号', { exact: true }).fill(account);
    await page.locator('#login-form').getByLabel('密码', { exact: true }).fill(account === 'root001' ? process.env.E2E_ROOT_PASSWORD : 'StaffTest!2026');
    await page.getByRole('button', { name: '进入系统' }).click();
    await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();
  }
  await login('20261001');
  await expandGroup(page, '我的');
  await page.locator('.field-sidebar').getByRole('button', { name: '班次与排班', exact: true }).click();
  await page.getByLabel('值班周', { exact: true }).fill('2026-11-16');
  await expect(page.locator('.duty-card')).toHaveCount(4);
  await page.locator('.duty-card').first().getByRole('button', { name: '请假', exact: true }).click();
  await page.getByLabel('请假原因', { exact: true }).fill('审批闭环：课程考试');
  await page.getByRole('button', { name: '提交请假申请', exact: true }).click();
  await expect(page.getByText('请假申请已提交，等待负责人处理', { exact: true })).toBeVisible();
  await expect(page.locator('.request-row').filter({ hasText: '审批闭环：课程考试' })).toContainText('待处理');
  await page.locator('.field-sidebar').getByRole('button', { name: '退出登录', exact: true }).click();
  await login('root001');
  await expandGroup(page, '值班管理');
  await page.locator('.field-sidebar').getByRole('button', { name: '请假审批', exact: true }).click();
  await page.getByLabel('查找申请', { exact: true }).fill('审批闭环：课程考试');
  await page.getByRole('button', { name: /林悦.*待处理/ }).click();
  await expect(page.getByRole('heading', { name: '林悦的请假申请', exact: true })).toBeVisible();
  await expect(page.locator('.leave-coverage')).toContainText('预计出勤2');
  await expect(page.locator('.leave-coverage')).toContainText('批准后1');
  for (const width of [1440,390,320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { name: '林悦的请假申请', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width < 650) expect(await page.getByRole('dialog', { name: '请假申请', exact: true }).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: `output/field-workflow/leave-review-${width}.png`, fullPage: true });
  }
  await page.getByLabel('审批说明', { exact: true }).fill('已安排接待补位');
  await page.getByRole('button', { name: '批准请假', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '确认批准请假', exact: true });
  await expect(confirmation).toContainText('批准后预计 1 人出勤');
  await confirmation.getByRole('button', { name: '确认操作', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '请假已批准' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '林悦的请假申请', exact: true })).toBeVisible();
  await expect(page.getByText('已安排接待补位', { exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: '请假申请', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.field-sidebar').getByRole('button', { name: '退出登录', exact: true }).click();
  await login('20261001');
  await expandGroup(page, '我的');
  await page.locator('.field-sidebar').getByRole('button', { name: '班次与排班', exact: true }).click();
  await page.getByLabel('值班周', { exact: true }).fill('2026-11-16');
  await expect(page.locator('.duty-card').first()).toContainText('请假 · 已批准');
  await expect(page.locator('.duty-card').first().getByRole('button', { name: '请假', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /我的申请/ }).click();
  await expect(page.locator('.request-row').filter({ hasText: '审批闭环：课程考试' })).toContainText('审批说明：已安排接待补位');
});

test('office roster assigns one member across working days, publishes a coordinator and fits each screen', async ({ page, request }) => {
  await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': '192.0.2.95' });
  await page.goto('/staff/');
  await page.locator('#login-form').getByLabel('学号', { exact: true }).fill('root001');
  await page.locator('#login-form').getByLabel('密码', { exact: true }).fill(process.env.E2E_ROOT_PASSWORD);
  await page.getByRole('button', { name: '进入系统' }).click();
  await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();
  await expandGroup(page, '值班管理');
  await page.locator('.field-sidebar').getByRole('button', { name: '办公排班管理', exact: true }).click();
  await expect(page.getByRole('heading', { name: '办公排班管理', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建办公班表', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('工作周（周一）', { exact: true }).fill('2026-11-09');
  await dialog.getByRole('button', { name: '建立草稿', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  for (let index = 0; index < 4; index++) {
    await page.locator('.office-day').nth(index).getByRole('button', { name: '添加办公人员', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: /林悦/ }).click();
  }
  await page.locator('.office-day').first().getByLabel('协调人', { exact: true }).check();
  await page.getByRole('button', { name: '保存并校验', exact: true }).click();
  await expect(page.getByText('草稿已保存并校验。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '预览并发布', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('安排 1 人、4 班');
  await page.getByRole('button', { name: '发布办公排班', exact: true }).click();
  await expect(page.getByText('办公班表已发布，成员可在个人中心查看。')).toBeVisible();
  const publishedTaskId = await page.getByRole('combobox', { name: '排班周与校区', exact: true }).inputValue();
  await expect(page.locator('.office-assignment').getByText('当日协调人', { exact: true })).toHaveCount(1);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 650) await page.locator('.office-day-tabs').getByRole('button').nth(3).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('.office-day').nth(3)).toBeVisible();
    await page.screenshot({ path: `output/field-workflow/office-planner-${width}.png`, fullPage: true });
  }
  const login = await request.post('/api/auth/login', { data: { account: '20261001', password: 'StaffTest!2026' } }).then(response => response.json());
  const mine = await request.get('/api/me/roster?weekStart=2026-11-09', { headers: { Authorization: `Bearer ${login.token}` } });
  expect(mine.ok()).toBe(true);
  const own = await mine.json();
  expect(own.items.filter(item => item.dutyType === 'office')).toHaveLength(4);
  expect(own.items.some(item => item.roleKind === 'coordinator')).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();
  await expandGroup(page, '值班管理');
  await page.locator('.field-sidebar').getByRole('button', { name: '办公排班管理', exact: true }).click();
  // Several real weeks can coexist; explicitly reopen the week published above.
  await page.getByRole('combobox', { name: '排班周与校区', exact: true }).selectOption(publishedTaskId);
  await expect(page.getByText('已发布班表', { exact: true })).toBeVisible();
  await expect(page.locator('.office-assignment')).toHaveCount(4);
  await page.locator('.field-sidebar').getByRole('button', { name: '退出登录', exact: true }).click();
  await page.locator('#login-form').getByLabel('学号', { exact: true }).fill('20261001');
  await page.locator('#login-form').getByLabel('密码', { exact: true }).fill('StaffTest!2026');
  await page.getByRole('button', { name: '进入系统' }).click();
  await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();
  await expandGroup(page, '我的');
  await page.locator('.field-sidebar').getByRole('button', { name: '班次与排班', exact: true }).click();
  await page.getByLabel('值班周', { exact: true }).fill('2026-11-09');
  await expect(page.locator('.duty-card')).toHaveCount(4);
  await expect(page.getByText('办公接待 · 当日协调人', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('member reaches roster from My, chooses named shifts and can use narrow screens', async ({ page }) => {
  await page.goto('/staff/');
  await page.locator('#login-form').getByLabel('学号', { exact: true }).fill('20261002');
  await page.locator('#login-form').getByLabel('密码', { exact: true }).fill('StaffTest!2026');
  await page.getByRole('button', { name: '进入系统' }).click();
  await expect(page.locator('.field-app')).toBeVisible();
  await expect(page.locator('.field-sidebar').getByRole('button', { name: '成员管理', exact: true })).toHaveCount(0);
  await expect(page.locator('.field-sidebar').getByRole('button', { name: '授权管理', exact: true })).toHaveCount(0);
  await expandGroup(page, '我的');
  await page.locator('.field-sidebar').getByRole('button', { name: '个人中心', exact: true }).click();
  await page.getByRole('button', { name: '我的班次与申请' }).click();
  await expect(page.getByRole('heading', { name: '我的值班安排' })).toBeVisible();
  await page.getByRole('button', { name: '发起换班', exact: true }).first().click();
  await expect(page.getByLabel('希望调换到')).toBeEnabled();
  await expect(page.getByLabel('希望调换到').locator('option')).not.toHaveCount(1);
  await expect(page.getByLabel('希望调换到')).toContainText('周宁');
  await expect(page.getByLabel('对方成员 ID')).toHaveCount(0);
  await expect(page.getByLabel('对方班次版本')).toHaveCount(0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByLabel('希望调换到')).toBeVisible();
  }
});


test('manager restores a saved draft, adjusts a member and cannot publish missing leadership', async ({ page, request }) => {
  await page.goto('/staff/');
  await page.locator('#login-form').getByLabel('学号', { exact: true }).fill('root001');
  await page.locator('#login-form').getByLabel('密码', { exact: true }).fill(process.env.E2E_ROOT_PASSWORD);
  await page.getByRole('button', { name: '进入系统' }).click();
  async function openManager() {
    await expect(page.locator('.field-app')).toBeVisible();
    await expandGroup(page, '我的');
  await page.locator('.field-sidebar').getByRole('button', { name: '个人中心', exact: true }).click();
    await page.getByRole('button', { name: '我的班次与申请' }).click();
    await expandGroup(page, '值班管理');
    await page.getByRole('button', { name: '维修排班管理', exact: true }).click();
  }
  await openManager();
  await page.getByRole('button', { name: '新建收集任务' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('周一日期').fill('2026-10-19');
  await dialog.getByLabel('开始', { exact: true }).fill('18:00');
  await dialog.getByLabel('结束', { exact: true }).fill('19:00');
  await dialog.getByLabel('填报截止').fill('2026-10-18T18:00');
  const createdResponse = page.waitForResponse(response => response.url().endsWith('/api/roster-tasks') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: '创建收集任务', exact: true }).click();
  const response = await createdResponse;
  expect(response.ok()).toBe(true);
  const task = await response.json();
  await expect(dialog).toHaveCount(0);
  const login = await request.post('/api/auth/login', { data: { account: '20261002', password: 'StaffTest!2026' } });
  const technician = await login.json();
  for (const businessDate of ['2026-10-19', '2026-10-20']) {
    const saved = await request.put(`/api/roster-tasks/${task.id}/availability`, { headers: { Authorization: `Bearer ${technician.token}` }, data: { businessDate, campusId: 'campus-nanhu', startAt: '18:00', endAt: '19:00' } });
    expect(saved.ok(), await saved.text()).toBe(true);
  }
  await page.getByRole('button', { name: '生成草稿', exact: true }).click();
  const member = page.getByLabel('安排陈宇', { exact: true });
  await expect(member).toBeVisible();
  const balance = page.getByRole('region', { name:'排班覆盖与均衡',exact:true });
  await expect(balance).toContainText('覆盖或资格待补齐');
  await expect(balance).toContainText('人数差 1');
  await member.selectOption('2026-10-20:campus-nanhu:18:00:19:00');
  await expect(balance).toContainText('已调整，保存后重新校验');
  await page.locator('.field-sidebar').getByRole('button', { name: '预约记录', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '有未保存的调整' })).toBeVisible();
  await page.getByRole('button', { name: '留在当前页面', exact: true }).click();
  await expect(member).toHaveValue('2026-10-20:campus-nanhu:18:00:19:00');
  await page.getByRole('button', { name: '保存并校验', exact: true }).click();
  await expect(page.getByText('调整已保存，已重新校验。')).toBeVisible();
  await expect(page.getByRole('button', { name: '预览并发布' })).toBeDisabled();
  await page.getByLabel('锁定安排', { exact: true }).check();
  await page.getByRole('button', { name: '保存并校验', exact: true }).click();
  await expect(page.getByText('调整已保存，已重新校验。')).toBeVisible();
  await page.getByRole('button', { name: '重新生成草稿', exact: true }).click();
  await expect(page.getByText('草稿已保存。请核对人员安排和覆盖提示。')).toBeVisible();
  await page.reload();
  await openManager();
  // A different department's later-week task can sort first. Restore the
  // exact saved draft instead of assuming this suite created the only task.
  await page.getByRole('combobox', { name: '排班周与校区', exact: true }).selectOption(task.id);
  await expect(page.getByLabel('安排陈宇', { exact: true })).toHaveValue('2026-10-20:campus-nanhu:18:00:19:00');
  await page.locator('.field-sidebar').evaluate(node => { node.dataset.persisted = 'yes'; });
  const navigation = await page.locator('.field-sidebar nav button').allTextContents();
  await page.locator('.field-sidebar').getByRole('button', { name: '预约记录', exact: true }).click();
  expect((await page.locator('.field-sidebar nav button').allTextContents()).map(text => text.replace(/[−+]/g, ''))).toEqual(navigation.map(text => text.replace(/[−+]/g, '')));
  await expect(page.locator('.records-workspace')).toBeVisible();
  await expect(page.locator('[data-view=staff]')).toBeHidden();
  await expect(page.locator('#management-header')).toBeHidden();
  await expandGroup(page, '我的');
  await page.locator('.field-sidebar').getByRole('button', { name: '账号安全', exact: true }).click();
  await expect(page.getByRole('heading', { name: '账号安全', exact: true })).toBeVisible();
  await expect(page.locator('[data-view=settings]')).toBeHidden();
  await expect(page.locator('.field-sidebar')).toHaveAttribute('data-persisted', 'yes');
  await page.locator('.field-sidebar').getByRole('button', { name: '班次与排班', exact: true }).click();
  await expandGroup(page, '值班管理');
  await page.locator('.field-sidebar').getByRole('button', { name: '维修排班管理', exact: true }).click();
  await expect(page.getByLabel('安排陈宇', { exact: true })).toHaveValue('2026-10-20:campus-nanhu:18:00:19:00');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/field-workflow/planner-${width}.png`, fullPage: true });
  }
});
