import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '192.0.2.92' } });

async function expandGroup(page, name) {
  const group = page.locator('.field-sidebar').getByRole('button', { name, exact: true }).first();
  if (await group.getAttribute('aria-expanded') === 'false') await group.click();
}

test.skip(process.env.E2E_FIELD !== 'true', 'Uses the isolated staff fixture');

test('dense rosters keep seven people per shift readable and expose one contextual adjustment',async({page})=>{
  const campusIds=['campus-nanhu','campus-hunnan'];
  const slots=campusIds.flatMap(campusId=>Array.from({length:4},(_,day)=>({businessDate:`2027-07-${String(5+day).padStart(2,'0')}`,campusId,startAt:'19:00',endAt:'21:00',ordinaryMinimum:6})));
  const assignments=slots.flatMap(slot=>Array.from({length:7},(_,i)=>({...slot,memberId:`dense-${slot.businessDate}-${slot.campusId}-${i}`,roleKind:i===0?'repair_lead':'',locked:false})));
  const members=assignments.map((row,index)=>({memberId:row.memberId,name:index===1?'欧阳测试长姓名':`示例人员${index+1}`,pool:row.roleKind?'lead':'ordinary',identities:[{code:row.roleKind?'repair_lead':'repair_staff',label:row.roleKind?'维修值班负责人':'维修工作人员'}],available:slots,manualSlots:slots,reportedWindows:slots}));
  const task={id:'dense-roster-ui',weekStart:'2027-07-05',scopeLabel:'南湖、浑南 · 每班七人',dutyType:'repair',campusScope:{campusIds},slotStart:'19:00',slotEnd:'21:00',actions:{manage:true,configure:true}};
  // A presentation fixture only; commands continue to be covered with real D1 in the workflow tests below.
  await page.route('**/api/roster-tasks',route=>route.fulfill({json:{items:[task]}}));
  await page.route('**/api/roster-tasks/dense-roster-ui/roster',route=>route.fulfill({json:{task,stage:'adjusting',collectionState:'closed',members,slots,protectedAssignments:[],draft:{id:'dense-draft',status:'draft',version:0,assignments,validation:{valid:true,errors:[]}}}}));
  await page.goto('/staff/');await page.locator('#login-id').fill('root001');await page.locator('#login-password').fill(process.env.E2E_ROOT_PASSWORD);await page.getByRole('button',{name:'进入系统'}).click();await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();await expandGroup(page,'值班管理');await page.locator('.field-sidebar').getByRole('button',{name:'维修排班管理',exact:true}).click();
  await expect(page.locator('.roster-person')).toHaveCount(56);await expect(page.locator('.roster-person-actions')).toHaveCount(0);
  const first=page.locator('.roster-person').first();await first.getByRole('button').click();await page.getByRole('dialog').getByLabel('锁定此班次',{exact:true}).check();await page.getByRole('dialog').getByRole('button',{name:'完成调整',exact:true}).click();await expect(first).toContainText('已锁定');await page.getByRole('button',{name:'撤销未保存调整',exact:true}).click();
  const disclosure=page.locator('.workspace-more-actions>summary');await disclosure.click();await expect(page.getByRole('button',{name:'重新自动排班',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(disclosure).toBeFocused();await expect(page.getByRole('button',{name:'重新自动排班',exact:true})).toBeHidden();
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const column=page.locator('.roster-day-column:visible').first();await expect(column.locator('.roster-person')).toHaveCount(7);
    expect((await column.boundingBox()).height).toBeLessThan(950);
    const boxes=await column.locator('.roster-person:visible').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));expect(Math.max(...boxes)).toBeLessThan(140);
    await page.screenshot({path:`output/field-workflow/dense-roster-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});await first.getByRole('button').click();await page.getByRole('dialog').getByRole('button',{name:'移除此安排',exact:true}).click();await expect(page.locator('.roster-person')).toHaveCount(55);await page.getByRole('button',{name:'撤销未保存调整',exact:true}).click();await expect(page.locator('.roster-person')).toHaveCount(56);
});

test('attendance managers correct historical time without altering identity and can export the same month',async({page,request})=>{
  const ip={'CF-Connecting-IP':'192.0.2.197'};await page.setExtraHTTPHeaders(ip);
  const login=await request.post('/api/auth/login',{headers:ip,data:{account:'root001',password:process.env.E2E_ROOT_PASSWORD}});
  const headers={...ip,Authorization:`Bearer ${(await login.json()).token}`},day='2026-10-15';
  const imported=await request.post('/api/members/import',{headers,data:{csv:'studentId,name,homeCampusId,departmentId\n20261990,考勤核查样例,campus-nanhu,dept-hardware',confirm:true}});expect(imported.ok(),await imported.text()).toBe(true);
  const memberId=(await imported.json()).items[0].memberId;
  const event=await request.post('/api/attendance/events',{headers,data:{type:'duty',businessDate:day,campusId:'campus-nanhu',startsAt:`${day}T08:00:00+08:00`,endsAt:`${day}T22:00:00+08:00`,requestId:crypto.randomUUID()}});
  expect(event.ok(),await event.text()).toBe(true);
  const saved=await request.post('/api/attendance/corrections',{headers,data:{memberId,eventId:(await event.json()).id,occurredAt:`${day}T09:00:00+08:00`,reason:'核查测试记录',requestId:crypto.randomUUID()}});
  expect(saved.ok(),await saved.text()).toBe(true);const original=await saved.json();
  await page.goto('/staff/');await page.locator('#login-id').fill('root001');await page.locator('#login-password').fill(process.env.E2E_ROOT_PASSWORD);await page.getByRole('button',{name:'进入系统'}).click();
  await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();await expandGroup(page,'值班管理');await page.locator('.field-sidebar').getByRole('button',{name:'考勤核查',exact:true}).click();
  await page.getByLabel('考勤月份',{exact:true}).fill(day.slice(0,7));
  const row=page.locator('.attendance-history-list li').filter({hasText:'考勤核查样例'}).filter({hasText:day});await row.getByRole('button',{name:'修正时间',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('实际签到时间',{exact:true}).fill(`${day}T09:15`);await dialog.getByLabel('修正原因',{exact:true}).fill('核对线下登记时间');
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();await expect(dialog.getByText('修改尚未保存，是否放弃？',{exact:true})).toBeVisible();await dialog.getByRole('button',{name:'继续填写',exact:true}).click();await expect(dialog.getByLabel('修正原因',{exact:true})).toHaveValue('核对线下登记时间');
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`output/field-workflow/attendance-correction-${width}.png`,fullPage:true});}
  await dialog.getByRole('button',{name:'确认保存考勤',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(row).toContainText('09:15');
  const records=await request.get(`/api/attendance?all=1&businessDate=${day}`,{headers});const record=(await records.json()).items.find(item=>item.id===original.id);expect(record.revision).toBe(original.revision+1);expect(record.identitySnapshot).toEqual(original.identitySnapshot);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出本月汇总',exact:true}).click();expect((await download).suggestedFilename()).toBe(`考勤-${day.slice(0,7)}.csv`);
});

test('collection creation saves the chosen campus daily minimums before availability collection',async({page,request})=>{
  await page.setExtraHTTPHeaders({'CF-Connecting-IP':'192.0.2.199'});
  await page.goto('/staff/');await page.locator('#login-id').fill('root001');await page.locator('#login-password').fill(process.env.E2E_ROOT_PASSWORD);await page.getByRole('button',{name:'进入系统'}).click();
  await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();await expandGroup(page,'值班管理');
  await page.locator('.field-sidebar').getByRole('button',{name:'维修排班管理',exact:true}).click();
  await page.getByRole('button',{name:'新建收集任务',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('周一日期',{exact:true}).fill('2027-05-03');
  await dialog.getByRole('group',{name:'参与校区',exact:true}).getByLabel('南湖',{exact:true}).uncheck();
  await dialog.getByRole('group',{name:'参与校区',exact:true}).getByLabel('浑南',{exact:true}).check();
  await dialog.getByRole('spinbutton',{name:'统一人数',exact:true}).fill('3');
  await dialog.getByRole('button',{name:'应用到所有工作日',exact:true}).click();
  await dialog.getByRole('spinbutton',{name:'浑南校区周三最低人数',exact:true}).fill('5');
  await dialog.getByLabel('填报截止',{exact:true}).fill('2027-05-02T18:00');
  const responsePromise=page.waitForResponse(response=>response.url().endsWith('/api/roster-tasks') && response.request().method()==='POST');
  await dialog.getByRole('button',{name:'发布收集任务',exact:true}).click();
  const response=await responsePromise;expect(response.ok(),await response.text()).toBe(true);
  const task=await response.json();expect(task.campusScope.campusIds).toEqual(['campus-hunnan']);
  const login=await request.post('/api/auth/login',{headers:{'CF-Connecting-IP':'192.0.2.199'},data:{account:'root001',password:process.env.E2E_ROOT_PASSWORD}});
  const saved=await request.get(`/api/roster-tasks/${task.id}/requirements`,{headers:{Authorization:`Bearer ${(await login.json()).token}`}});
  const rows=(await saved.json()).requirements;expect(rows.map(row=>row.ordinaryMinimum)).toEqual([3,3,5,3]);expect(rows.every(row=>row.campusId==='campus-hunnan')).toBe(true);
});

test('staffing needs support a weekly default, per-day adjustments and responsive independent navigation',async({page,request})=>{
  await page.setExtraHTTPHeaders({'CF-Connecting-IP':'192.0.2.198'});
  const login=await request.post('/api/auth/login',{headers:{'CF-Connecting-IP':'192.0.2.198'},data:{account:'root001',password:process.env.E2E_ROOT_PASSWORD}});
  const token=(await login.json()).token,headers={Authorization:`Bearer ${token}`};
  const created=await request.post('/api/roster-tasks',{headers,data:{weekStart:'2027-04-05',campusId:'campus-nanhu',slotStart:'19:00',slotEnd:'21:00',deadline:'2027-04-04T10:00:00Z'}});
  expect(created.ok(),await created.text()).toBe(true);const task=await created.json();
  await page.goto('/staff/');await page.locator('#login-id').fill('root001');await page.locator('#login-password').fill(process.env.E2E_ROOT_PASSWORD);await page.getByRole('button',{name:'进入系统'}).click();
  await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();await expandGroup(page,'值班管理');
  await expect(page.locator('.field-sidebar').getByRole('button',{name:'维修人员需求',exact:true})).toHaveCount(0);
  await page.locator('.field-sidebar').getByRole('button',{name:'维修排班管理',exact:true}).click();
  await page.getByRole('combobox',{name:'排班周与校区',exact:true}).selectOption(task.id);
  await page.getByRole('button',{name:'任务设置',exact:true}).click();
  await page.getByRole('spinbutton',{name:'普通人员最低人数',exact:true}).fill('4');
  await page.getByRole('button',{name:'应用到整周工作日',exact:true}).click();
  await expect(page.getByRole('spinbutton',{name:'2027-04-05普通人员最低人数',exact:true})).toHaveValue('4');
  await page.getByRole('spinbutton',{name:'2027-04-06普通人员最低人数',exact:true}).fill('2');
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`output/field-workflow/staffing-needs-${width}.png`,fullPage:true});
  }
  await page.getByRole('button',{name:'保存人员需求',exact:true}).click();
  await expect(page.getByText('需求已保存。已发布班表保持原样，待发布草稿需要重新校验。',{exact:true})).toBeVisible();
  const saved=await request.get(`/api/roster-tasks/${task.id}/requirements`,{headers});
  expect((await saved.json()).requirements.map(row=>row.ordinaryMinimum)).toEqual([4,2,4,4]);
});

test('off-duty leaders can prepare schedules without gaining field coordination', async ({ page, request }) => {
  await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': '192.0.2.120' });
  const root = await request.post('/api/auth/login', { data: { account: 'root001', password: process.env.E2E_ROOT_PASSWORD } }).then(response => response.json());
  async function command(path, data, method = data ? 'POST' : 'GET', token = root.token) {
    const response = await request.fetch(path, { method, headers: { Authorization: `Bearer ${token}` }, ...(data ? { data } : {}) });
    const result = await response.json(); expect(response.ok(), JSON.stringify(result)).toBe(true); return result;
  }
  await command('/api/staff-whitelist/import', { csv: 'studentId,expectedName\n20998721,提前排班负责人', expectedRole: 'technician', authorizedCampuses: ['南湖'] });
  const application = await command('/api/activation', { studentId: '20998721',name:'提前排班负责人',homeCampus:'南湖',password:'ScheduleTest!2026' });
  await command('/api/activation-requests/review', { ids:[application.id],status:'approved',identityVerified:true });
  const member = await command('/api/members/member-20998721');
  await command('/api/members/member-20998721/roles', { revision:member.member.revision,bindings:['role-repair-lead','role-office-lead'].map(roleId => ({roleId,scope:{campusIds:['campus-nanhu']},effectiveFrom:'2026-01-01'})) },'PUT');
  await page.goto('/staff/'); await page.locator('#login-id').fill('20998721'); await page.locator('#login-password').fill('ScheduleTest!2026');
  await page.getByRole('button', {name:'进入系统'}).click();
  await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();
  const token = await page.evaluate(() => sessionStorage.getItem('pioneerToken'));
  const profile = await command('/api/auth/me',undefined,'GET',token);
  expect(profile.todayDuties).toEqual([]);
  const nav = page.locator('.field-sidebar');
  await expect(nav.getByRole('button',{name:'现场管理',exact:true})).toHaveCount(0);
  await expect(nav.getByRole('button',{name:'接待台',exact:true})).toHaveCount(0);
  await expandGroup(page,'值班管理');
  for (const name of ['维修排班管理','办公排班管理','请假审批']) await expect(nav.getByRole('button',{name,exact:true})).toBeVisible();
  await nav.getByRole('button',{name:'维修排班管理',exact:true}).click();
  await page.getByRole('button',{name:'新建收集任务',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'发布收集任务',exact:true});
  await dialog.getByLabel('周一日期',{exact:true}).fill('2027-01-11');
  await dialog.getByLabel('填报截止',{exact:true}).fill('2027-01-10T18:00');
  await dialog.getByRole('button',{name:'发布收集任务',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('收集任务已发布，成员现在可以填报时间。',{exact:true})).toBeVisible();
  for (const width of [1440,390,320]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

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
    const dialog = page.getByRole('dialog', { name: '发布收集任务', exact: true });
    const campus = dialog.getByRole('group', { name: '参与校区', exact: true });
    // The account is bound only to Nanhu: a grant for Hunnan cannot extend it.
    await expect(campus.getByRole('checkbox')).toHaveCount(1);
    await expect(campus.getByRole('checkbox')).toBeChecked();
    const departments = dialog.getByRole('group', { name: '参与部门', exact: true });
    await expect(departments.getByRole('button', { name: '硬件部', exact: true })).toHaveAttribute('aria-pressed','true');
    await expect(departments.getByRole('button', { name: '办公室', exact: true })).toHaveCount(0);
    await expect(departments.getByRole('button', { name: '全部部门', exact: true })).toHaveCount(0);
    await departments.getByRole('button', { name: '硬件部', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '发布收集任务', exact: true })).toBeDisabled();
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
    await dialog.getByRole('button', { name: '发布收集任务', exact: true }).click();
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

test('office collection generates a balanced roster, publishes a coordinator and preserves revisions', async ({ page, request }) => {
  await page.setExtraHTTPHeaders({'CF-Connecting-IP':'192.0.2.95'});
  await page.goto('/staff/');await page.locator('#login-id').fill('root001');await page.locator('#login-password').fill(process.env.E2E_ROOT_PASSWORD);await page.getByRole('button',{name:'进入系统'}).click();
  await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();await expandGroup(page,'值班管理');await page.locator('.field-sidebar').getByRole('button',{name:'办公排班管理',exact:true}).click();
  await page.getByRole('button',{name:'新建办公收集任务',exact:true}).click();const dialog=page.getByRole('dialog');
  await dialog.getByLabel('周一日期',{exact:true}).fill('2026-11-09');await dialog.getByLabel('填报截止',{exact:true}).fill('2026-11-08T18:00');
  await dialog.getByLabel('每周自动发布收集任务',{exact:true}).check();await dialog.getByLabel('自动发布星期',{exact:true}).selectOption('4');
  const createdPromise=page.waitForResponse(r=>r.url().endsWith('/api/roster-tasks')&&r.request().method()==='POST');
  await dialog.getByRole('button',{name:'发布办公收集',exact:true}).click();const created=await createdPromise;expect(created.ok(),await created.text()).toBe(true);const task=await created.json();await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'正在收集可用时间',exact:true})).toBeVisible();
  const login=await request.post('/api/auth/login',{data:{account:'20261001',password:'StaffTest!2026'}}).then(r=>r.json());
  const windows=['2026-11-09','2026-11-10','2026-11-11','2026-11-12'].map(businessDate=>({businessDate,campusId:'campus-nanhu',startAt:'19:00',endAt:'21:00'}));
  const submitted=await request.put('/api/roster-tasks/'+task.id+'/submission',{headers:{Authorization:'Bearer '+login.token},data:{windows,unavailable:false,autoContinue:true,revision:-1,requestId:crypto.randomUUID()}});expect(submitted.ok(),await submitted.text()).toBe(true);
  await page.getByRole('button',{name:'刷新',exact:true}).click();await expect(page.getByText(/1 \/ .* 人已提交/)).toBeVisible();
  await page.getByRole('button',{name:'结束收集',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('未提交');await page.getByRole('button',{name:'确认结束收集',exact:true}).click();
  await page.getByRole('button',{name:'生成自动排班',exact:true}).click();await expect(page.locator('.roster-person')).toHaveCount(4);
  await page.locator('.roster-person').first().getByRole('button').click();await page.getByRole('dialog').getByLabel('设为当日协调人',{exact:true}).check();await page.getByRole('dialog').getByLabel('锁定此班次',{exact:true}).check();await page.getByRole('dialog').getByRole('button',{name:'完成调整',exact:true}).click();
  await page.getByRole('button',{name:'保存并校验',exact:true}).click();await expect(page.getByText('调整已保存，已重新校验。',{exact:true})).toBeVisible();
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'output/field-workflow/office-planner-'+width+'.png',fullPage:true});}
  await page.getByRole('button',{name:'检查并发布',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('4 班，1 人');await page.getByRole('button',{name:'确认发布',exact:true}).click();
  await expect(page.getByRole('heading',{name:'班表已发布',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'调整已发布班表',exact:true}).click();await expect(page.getByRole('heading',{name:'正在修订已发布班表',exact:true})).toBeVisible();await expect(page.locator('.roster-person')).toHaveCount(4);
  await page.reload();await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();await expandGroup(page,'值班管理');await page.locator('.field-sidebar').getByRole('button',{name:'办公排班管理',exact:true}).click();await page.getByLabel('排班周与校区',{exact:true}).selectOption(task.id);await expect(page.locator('.roster-person')).toHaveCount(4);
  const mine=await request.get('/api/me/roster?weekStart=2026-11-09',{headers:{Authorization:'Bearer '+login.token}});expect((await mine.json()).items.filter(item=>item.dutyType==='office')).toHaveLength(4);
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


test('partial roster managers configure their campuses without seeing whole-task publishing actions',async({page,request})=>{
  const ip={'CF-Connecting-IP':'192.0.2.191'};await page.setExtraHTTPHeaders(ip);
  const login=await request.post('/api/auth/login',{headers:ip,data:{account:'root001',password:process.env.E2E_ROOT_PASSWORD}}).then(r=>r.json());
  const headers={...ip,Authorization:'Bearer '+login.token};
  async function command(path,data,method=data?'POST':'GET'){const response=await request.fetch(path,{headers,method,...(data?{data}:{})});const value=await response.json();expect(response.ok(),JSON.stringify(value)).toBe(true);return value;}
  await command('/api/staff-whitelist/import',{csv:'studentId,expectedName\n20998722,部分范围排班负责人',expectedRole:'technician',authorizedCampuses:['南湖','浑南']});
  const application=await command('/api/activation',{studentId:'20998722',name:'部分范围排班负责人',homeCampus:'南湖',password:'ScheduleTest!2026'});await command('/api/activation-requests/review',{ids:[application.id],status:'approved',identityVerified:true});
  const role=await command('/api/roles',{code:'partial_schedule_manager',name:'分校区排班管理',grants:[{permissionCode:'roster.repair.manage',scope:{campusIds:['campus-nanhu']}},{permissionCode:'roster.repair.configure',scope:{campusIds:['campus-nanhu','campus-hunnan']}}]});const member=await command('/api/members/member-20998722');await command('/api/members/member-20998722/roles',{revision:member.member.revision,bindings:[{roleId:role.id,scope:{campusIds:['campus-nanhu','campus-hunnan']},effectiveFrom:'2026-01-01'}]},'PUT');
  const task=await command('/api/roster-tasks',{workflowVersion:1,weekStart:'2027-07-05',campusIds:['campus-nanhu','campus-hunnan'],slotStart:'19:00',slotEnd:'21:00',deadline:'2027-07-04T10:00:00Z',memberIds:['member-20261002'],requestId:crypto.randomUUID()});
  await page.goto('/staff/');await page.locator('#login-id').fill('20998722');await page.locator('#login-password').fill('ScheduleTest!2026');await page.getByRole('button',{name:'进入系统'}).click();await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();await expandGroup(page,'值班管理');await page.locator('.field-sidebar').getByRole('button',{name:'维修排班管理',exact:true}).click();await page.getByLabel('排班周与校区',{exact:true}).selectOption(task.id);
  await expect(page.getByRole('heading',{name:'收集任务设置',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'结束收集',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'生成自动排班',exact:true})).toHaveCount(0);
  await page.getByRole('spinbutton',{name:'普通人员最低人数',exact:true}).fill('2');await page.getByRole('button',{name:'应用到整周工作日',exact:true}).click();await page.getByRole('button',{name:'保存人员需求',exact:true}).click();await expect(page.getByText('需求已保存。已发布班表保持原样，待发布草稿需要重新校验。',{exact:true})).toBeVisible();
});

test('member submits a whole week, keeps input between tabs and controls automatic continuation',async({page,request})=>{
  await page.setExtraHTTPHeaders({'CF-Connecting-IP':'192.0.2.93'});
  const login=await request.post('/api/auth/login',{data:{account:'root001',password:process.env.E2E_ROOT_PASSWORD}}).then(r=>r.json());
  const created=await request.post('/api/roster-tasks',{headers:{Authorization:'Bearer '+login.token},data:{workflowVersion:1,weekStart:'2027-06-14',campusIds:['campus-nanhu','campus-hunnan'],slotStart:'19:00',slotEnd:'21:00',deadline:'2027-06-13T10:00:00Z',memberIds:['member-20261002'],requestId:crypto.randomUUID()}});expect(created.ok(),await created.text()).toBe(true);const task=await created.json();
  await page.goto('/staff/');await page.locator('#login-id').fill('20261002');await page.locator('#login-password').fill('StaffTest!2026');await page.getByRole('button',{name:'进入系统'}).click();await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();await expandGroup(page,'我的');await page.locator('.field-sidebar').getByRole('button',{name:'班次与排班',exact:true}).click();
  const form=page.locator('.weekly-availability');await form.getByLabel('排班任务',{exact:true}).selectOption(task.id);await expect(form.getByLabel('南湖校区',{exact:true})).toHaveCount(4);await expect(form.getByLabel('浑南校区',{exact:true})).toHaveCount(0);
  await form.getByLabel('南湖校区',{exact:true}).first().check();await form.getByLabel('后续同岗位收集自动延续本周选择',{exact:true}).check();
  await page.getByRole('button',{name:/我的申请/}).click();await page.getByRole('button',{name:/^班次/}).filter({hasNotText:'排班'}).first().click();await expect(form.getByLabel('南湖校区',{exact:true}).first()).toBeChecked();
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`output/field-workflow/weekly-availability-${width}.png`,fullPage:true});}
  await form.getByRole('button',{name:'提交整周可用时间',exact:true}).click();await expect(form.getByText('整周可用时间已提交，截止前可以修改。',{exact:true})).toBeVisible();await expect(form.getByText('维修可用时间自动延续已开启',{exact:true})).toBeVisible();
  await form.getByRole('button',{name:'关闭后续自动延续',exact:true}).click();await expect(form.getByText('维修可用时间自动延续已开启',{exact:true})).toHaveCount(0);
  await form.getByLabel('整周无法参加',{exact:true}).check();await form.getByRole('button',{name:'提交整周可用时间',exact:true}).click();await expect(form.getByText('整周可用时间已提交，截止前可以修改。',{exact:true})).toBeVisible();await page.reload();await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();await expandGroup(page,'我的');await page.locator('.field-sidebar').getByRole('button',{name:'班次与排班',exact:true}).click();await form.getByLabel('排班任务',{exact:true}).selectOption(task.id);await expect(form.getByLabel('整周无法参加',{exact:true})).toBeChecked();
});

test('repair manager closes collection, manually overrides availability, locks and restores a draft', async ({ page, request }) => {
  await page.setExtraHTTPHeaders({'CF-Connecting-IP':'192.0.2.94'});
  const root=await request.post('/api/auth/login',{data:{account:'root001',password:process.env.E2E_ROOT_PASSWORD}}).then(r=>r.json());
  const headers={Authorization:'Bearer '+root.token};
  const created=await request.post('/api/roster-tasks',{headers,data:{workflowVersion:1,weekStart:'2026-10-19',campusIds:['campus-nanhu'],slotStart:'18:00',slotEnd:'19:00',deadline:'2026-10-18T10:00:00Z',memberIds:['member-20261002'],requestId:crypto.randomUUID()}});expect(created.ok(),await created.text()).toBe(true);const task=await created.json();
  const technician=await request.post('/api/auth/login',{data:{account:'20261002',password:'StaffTest!2026'}}).then(r=>r.json());
  const fill=await request.put('/api/roster-tasks/'+task.id+'/submission',{headers:{Authorization:'Bearer '+technician.token},data:{windows:[{businessDate:'2026-10-19',campusId:'campus-nanhu',startAt:'18:00',endAt:'19:00'}],unavailable:false,revision:-1,requestId:crypto.randomUUID()}});expect(fill.ok(),await fill.text()).toBe(true);
  await page.goto('/staff/');await page.locator('#login-id').fill('root001');await page.locator('#login-password').fill(process.env.E2E_ROOT_PASSWORD);await page.getByRole('button',{name:'进入系统'}).click();await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();await expandGroup(page,'值班管理');await page.locator('.field-sidebar').getByRole('button',{name:'维修排班管理',exact:true}).click();await page.getByLabel('排班周与校区',{exact:true}).selectOption(task.id);
  await page.getByRole('button',{name:'结束收集',exact:true}).click();await page.getByRole('button',{name:'确认结束收集',exact:true}).click();await page.getByRole('button',{name:'生成自动排班',exact:true}).click();
  const person=page.locator('.roster-person').filter({hasText:'陈宇'});await expect(person).toHaveCount(1);await expect(page.getByRole('button',{name:'检查并发布',exact:true})).toBeDisabled();
  await person.getByRole('button',{name:/^调整/}).click();const picker=page.getByRole('dialog');await picker.getByLabel('目标班次',{exact:true}).selectOption('2026-10-20:campus-nanhu:18:00:19:00');await picker.getByRole('button',{name:'移动到本班次',exact:true}).click();await expect(picker.getByRole('alert')).toContainText('未填报');await picker.getByRole('button',{name:'确认人工安排',exact:true}).click();await picker.getByRole('button',{name:'完成调整',exact:true}).click();
  await person.getByRole('button',{name:/^调整/}).click();await page.getByRole('dialog').getByLabel('锁定此班次',{exact:true}).check();await page.getByRole('dialog').getByRole('button',{name:'完成调整',exact:true}).click();await page.locator('.field-sidebar').getByRole('button',{name:'预约记录',exact:true}).click();await expect(page.getByRole('dialog',{name:'有未保存的调整'})).toBeVisible();await page.getByRole('button',{name:'留在当前页面',exact:true}).click();
  await page.getByRole('button',{name:'保存并校验',exact:true}).click();await expect(page.getByText('调整已保存，已重新校验。',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'检查并发布',exact:true})).toBeDisabled();
  await page.locator('.workspace-more-actions>summary').click();await page.getByRole('button',{name:'重新自动排班',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'重新生成',exact:true}).click();await expect(page.getByText('已生成排班草稿，请处理缺口并核对安排。',{exact:true})).toBeVisible();await expect(person).toContainText('已锁定');
  await page.reload();await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();await expandGroup(page,'值班管理');await page.locator('.field-sidebar').getByRole('button',{name:'维修排班管理',exact:true}).click();await page.getByLabel('排班周与校区',{exact:true}).selectOption(task.id);await expect(person).toContainText('人工安排');await expect(person).toContainText('已锁定');
  const day=page.locator('.roster-day-column').filter({hasText:'10-20'});await expect(day).toContainText('陈宇');
  await page.locator('.field-sidebar').evaluate(node=>{node.dataset.persisted='yes';});await page.locator('.field-sidebar').getByRole('button',{name:'预约记录',exact:true}).click();await expect(page.locator('.records-workspace')).toBeVisible();await expect(page.locator('[data-view=staff]')).toBeHidden();await expandGroup(page,'我的');await page.locator('.field-sidebar').getByRole('button',{name:'账号安全',exact:true}).click();await expect(page.getByRole('heading',{name:'账号安全',exact:true})).toBeVisible();await expect(page.locator('[data-view=settings]')).toBeHidden();await expect(page.locator('.field-sidebar')).toHaveAttribute('data-persisted','yes');await page.locator('.field-sidebar').getByRole('button',{name:'维修排班管理',exact:true}).click();
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});if(width<768)await page.locator('.roster-mobile-days').getByRole('button').nth(1).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(person).toBeVisible();await page.screenshot({path:'output/field-workflow/planner-'+width+'.png',fullPage:true});}
});
