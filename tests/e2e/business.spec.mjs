import {test,expect} from '@playwright/test';
import {mkdir,readFile} from 'node:fs/promises';
import {dateKey,addDays,serviceDay,slotDeadline} from '../../shared/time.js';

const memberPassword='e2e-member-password-only';
const bookingDates=[0,1,2,3].map(n=>addDays(dateKey(),n)).filter(serviceDay);
const date=bookingDates.find(day=>Date.now()<Date.parse(slotDeadline(day,'19:00–20:00'))) || bookingDates[0];
async function login(page,account,password){
  await page.goto('/staff/');
  await page.locator('#login-id').fill(account);await page.locator('#login-password').fill(password);
  await page.locator('#login-form button').click();await expect(page.locator('#app-shell')).toBeVisible();
}
async function booking(page,studentId,{file=true}={}){
  await page.goto('/');
  for(const [name,value] of Object.entries({studentId,name:'浏览器测试同学',social:'e2e-private-contact',brand:'联想',deviceModel:'ThinkPad',issue:'启动后蓝屏'}))await page.locator(`[name="${name}"]`).fill(value);
  for(const [name,value] of Object.entries({campus:'南湖',deviceType:'笔记本电脑',warranty:'否',faultType:'蓝屏'}))await page.locator(`[name="${name}"]`).selectOption(value);
  await page.locator(`[data-date="${date}"]`).click();
  await page.locator('[data-slot="19:00–20:00"]').click();
  await expect(page.locator('[name=timeSlot]')).toHaveValue('19:00–20:00');
  if(file)await page.locator('#appointment-attachments').setInputFiles({name:'故障描述.txt',mimeType:'text/plain',buffer:Buffer.from('browser attachment')});
  await page.locator('.check-box').click();
  await expect(page.locator('#signature-modal')).toBeVisible();
  await page.locator('#confirm-signature').click();await expect(page.locator('#signature-modal')).toBeVisible();
  const box=await page.locator('#signature-canvas').boundingBox();
  await page.mouse.move(box.x+30,box.y+30);await page.mouse.down();
  await page.mouse.move(box.x+160,box.y+80,{steps:15});await page.mouse.move(box.x+70,box.y+110,{steps:15});await page.mouse.up();
  expect(await page.locator('#signature-modal .modal').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await capture(page, 'signature-' + studentId);
  await page.locator('#confirm-signature').click();await page.locator('#booking-form [type=submit]').click();
  await expect(page.locator('#success-panel')).toBeVisible();
  const id = await page.locator('#success-code').textContent();
  expect(id).toMatch(new RegExp(`^reserve0${date.replaceAll('-','')}-\\d{2,}$`));
  return {id,link:await page.locator('#success-link-fallback').inputValue()};
}
async function application(page,studentId,name){
  await page.goto('/staff/?activate=1');
  for(const [id,value] of Object.entries({'activation-student-id':studentId,'activation-name':name,'activation-password':memberPassword,'activation-confirm':memberPassword}))await page.locator('#'+id).fill(value);
  await page.locator('#activation-campus').selectOption('南湖');await page.locator('#activation-form [type=submit]').click();
  await expect(page.locator('#activation-status')).toContainText('等待管理员');
}
async function capture(page,name){
  await mkdir('output/playwright',{recursive:true});await page.screenshot({path:`output/playwright/${name}.png`,fullPage:true,animations:'disabled'});
}

test('administrators configure persistent slot capacities and student choices follow full or paused slots', async ({ browser }) => {
  const contexts = await Promise.all([30,31].map(n => browser.newContext({ baseURL: process.env.E2E_BASE_URL, extraHTTPHeaders: { 'CF-Connecting-IP': `198.51.100.${n}` } })));
  const root = await contexts[0].newPage(), student = await contexts[1].newPage(), booked = await contexts[1].newPage();
  const errors = [];
  for (const page of [root, student, booked]) page.on('pageerror', error => errors.push(error.message));
  let token, item;
  const row = (campus, slot) => root.locator(`.capacity-row[data-campus="${campus}"][data-time-slot="${slot}"]`);
  const first = row('南湖', '19:00–20:00'), second = row('南湖', '20:00–21:00');
  async function save(target, capacity) {
    await target.locator('input').fill(String(capacity));
    await target.getByRole('button', { name: '保存', exact: true }).click();
    await expect(target.locator('p')).toHaveText(capacity === 0 ? '暂停预约' : `开放预约 · 最多 ${capacity} 人`);
  }
  async function refreshStudent() {
    await student.bringToFront();
    await student.locator(`[data-date="${date}"]`).click();
  }
  try {
    await login(root, 'root001', process.env.E2E_ROOT_PASSWORD);
    token = await root.evaluate(() => sessionStorage.getItem('pioneerToken'));
    await root.getByRole('button', { name: '个人设置', exact: true }).click();
    await expect(root.locator('.capacity-row')).toHaveCount(4);
    await expect(first.locator('input')).toHaveValue('10');
    await first.locator('input').fill('1.5');
    await first.getByRole('button', { name: '保存', exact: true }).click();
    expect(await first.locator('input').evaluate(input => input.validity.valid)).toBe(false);
    await save(first, 3); await save(second, 12);
    await expect(row('浑南', '19:00–20:00').locator('input')).toHaveValue('10');
    item = await booking(booked, '20269900', { file: false });
    await student.goto('/');
    await student.locator('[name=campus]').selectOption('南湖');
    await student.locator(`[data-date="${date}"]`).click();
    await expect(student.locator('[data-slot="19:00–20:00"]')).toContainText('剩余 2 名');
    await expect(student.locator('[data-slot="20:00–21:00"]')).toContainText('剩余 12 名');
    await student.locator('[data-slot="19:00–20:00"]').click();
    await expect(student.locator('#booking-selection')).toContainText('19:00–20:00');
    await expect(student.locator('[data-slot="19:00–20:00"]')).toContainText('最多 3 人');

    await first.locator('input').fill('7'); await second.locator('input').fill('15');
    const headers = { Authorization: `Bearer ${token}` };
    const settings = await (await contexts[0].request.get('/api/slot-capacities', { headers })).json();
    const current = settings.items.find(value => value.campus === '南湖' && value.timeSlot === '19:00–20:00');
    expect((await contexts[0].request.patch('/api/slot-capacities', { headers, data: { ...current, capacity: 5 } })).status()).toBe(200);
    await root.waitForResponse(response => new URL(response.url()).pathname === '/api/slot-capacities' && response.request().method() === 'GET', { timeout: 15000 });
    await expect(first.locator('input')).toHaveValue('7'); await expect(second.locator('input')).toHaveValue('15');
    await first.getByRole('button', { name: '保存', exact: true }).click();
    await expect(first.locator('p')).toContainText('配置已更新');
    await expect(second.locator('input')).toHaveValue('15');
    await root.locator('#reload-capacities').click();
    await expect(first.locator('input')).toHaveValue('5'); await expect(second.locator('input')).toHaveValue('12');

    await save(first, 1); await refreshStudent();
    await expect(student.locator('[name=timeSlot]')).toHaveValue('');
    await expect(student.locator('[data-slot="19:00–20:00"]')).toHaveJSProperty('disabled', true);
    await expect(student.locator('[data-slot="19:00–20:00"]')).toContainText('预约已满');
    await save(first, 0); await refreshStudent();
    await expect(student.locator('[data-slot="19:00–20:00"]')).toContainText('暂停预约');
    await student.locator('[data-slot="20:00–21:00"]').click();
    await expect(student.locator('[data-slot="20:00–21:00"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(student.locator('[data-slot="20:00–21:00"]')).toContainText('最多 12 人');
    await student.locator('[name=campus]').selectOption('浑南');
    await expect(student.locator('[data-slot="19:00–20:00"]')).toContainText('剩余 10 名');
    await expect(student.locator('[data-slot="19:00–20:00"]')).toHaveJSProperty('disabled', false);
    await capture(student, 'student-configured-capacity');

    await root.reload(); await expect(root.locator('#app-shell')).toBeVisible();
    await root.getByRole('button', { name: '个人设置', exact: true }).click();
    await expect(first.locator('input')).toHaveValue('0');
    await root.setViewportSize({ width: 390, height: 844 });
    expect(await root.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await capture(root, 'mobile-capacity-settings');
    await root.setViewportSize({ width: 1440, height: 1000 }); await capture(root, 'admin-capacity-settings');
    await booked.getByRole('button', { name: '查看我的预约', exact: true }).click();
    await expect(booked.locator('#lookup-results')).toContainText(item.id);
    booked.once('dialog', dialog => dialog.accept());
    await booked.locator('[data-cancel]').click(); await expect(booked.locator('#lookup-results')).toContainText('已取消');
    await save(first, 4);
    await student.locator('[name=campus]').selectOption('南湖');
    await expect(student.locator('[data-slot="19:00–20:00"]')).toContainText('剩余 4 名');
    expect(errors).toEqual([]);
  } finally {
    if (token) {
      const headers = { Authorization: `Bearer ${token}` };
      const response = await contexts[0].request.get('/api/slot-capacities', { headers });
      if (response.ok()) {
        for (const current of (await response.json()).items.filter(value => value.capacity !== 10)) {
          expect((await contexts[0].request.patch('/api/slot-capacities', { headers, data: { ...current, capacity: 10 } })).status()).toBe(200);
        }
      }
    }
    await Promise.all(contexts.map(context => context.close()));
  }
});

test('student booking, private links, whitelist activation, staff permissions, recovery and settings work in Preview',async({browser})=>{
  test.setTimeout(120000);
  const errors=[];
  const contexts=await Promise.all([10,11,12,13].map(n=>browser.newContext({baseURL:process.env.E2E_BASE_URL,extraHTTPHeaders:{'CF-Connecting-IP':`198.51.100.${n}`}})));
  const [student,root,member,privatePage]=await Promise.all(contexts.map(context=>context.newPage()));
  for(const page of [student,root,member,privatePage])page.on('pageerror',error=>errors.push(error.message));
  try{
    const item=await booking(student,'20269901');
    await expect(student.locator('#credential-save-message')).toBeHidden();
    await student.reload();await student.getByRole('button',{name:'我的预约',exact:true}).click();
    await expect(student.locator('#lookup-results')).toContainText(item.id);
    await expect(student.locator('[data-queue-id]')).toContainText('当前第');
    const downloadPromise=student.waitForEvent('download');
    await student.locator('[data-file]').first().click();
    const download=await downloadPromise;expect(await readFile(await download.path(),'utf8')).toBe('browser attachment');
    await student.locator('[data-upload-input]').setInputFiles({name:'补充.txt',mimeType:'text/plain',buffer:Buffer.from('retry attachment')});
    await student.locator('[data-upload]').click();await expect(student.locator('[data-file]')).toHaveCount(2);
    await capture(student,'student-my-appointments');
    await privatePage.goto(item.link);await expect(privatePage.locator('#lookup-results')).toContainText(item.id);
    expect(new URL(privatePage.url()).hash).toBe('');
    const secret=new URLSearchParams(new URL(item.link).hash.slice(1)).get('access');
    expect((await contexts[3].request.get(`/api/appointments/${item.id}?studentId=20269901`)).status()).toBe(404);
    expect((await contexts[3].request.get(`/api/appointments/${item.id}?accessToken=${secret}`)).status()).toBe(404);

    await login(root,'root001',process.env.E2E_ROOT_PASSWORD);
    await root.getByRole('button',{name:'账号管理',exact:true}).click();
    await root.locator('#whitelist-csv').fill('studentId,expectedName\n20268801,浏览器测试部员');
    await root.locator('#whitelist-form [type=submit]').click();
    await expect(root.locator('#whitelist-table')).toContainText('20268801');
    await application(member,'20268801','浏览器测试部员');
    const pendingLogin=await contexts[2].newPage();
    await pendingLogin.goto('/staff/');await pendingLogin.locator('#login-id').fill('20268801');await pendingLogin.locator('#login-password').fill(memberPassword);
    await pendingLogin.locator('#login-form button').click();await expect(pendingLogin.locator('#login-message')).toContainText('账号或密码不正确');await pendingLogin.close();
    await root.getByRole('button',{name:'维修后台',exact:true}).click();await root.getByRole('button',{name:'账号管理',exact:true}).click();
    await expect(root.locator('[data-application]')).toHaveCount(1);
    await root.locator('#select-pending').check();await root.locator('#verify-identities').check();
    await root.locator('#review-note').fill('已当面逐一核验部员身份及学生证');
    await root.locator('#approve-applications').click();
    await expect(root.locator('#applications-table tr')).toHaveCount(0);
    await expect(root.locator('#applications-empty')).toBeVisible();
    await expect(root.locator('#whitelist-table')).not.toContainText('20268801');
    await capture(root,'admin-accounts');
    await member.locator('#refresh-activation').click();await expect(member.locator('#activation-status')).toContainText('审核已通过');
    await login(member,'20268801',memberPassword);
    await expect(member.locator('[data-view-link=stats]')).toBeHidden();
    await member.getByRole('button', { name: '个人设置', exact: true }).click();
    await expect(member.locator('#profile-info')).toContainText('授权 南湖');
    await expect(member.locator('#capacity-settings')).toBeHidden();
    await member.getByRole('button', { name: '维修后台', exact: true }).click();
    await expect(member.locator('#appointments-table')).toContainText(item.id);
    await expect(member.locator('#appointments-table')).not.toContainText('浏览器测试同学');
    await expect(member.locator('#appointments-table')).not.toContainText('e2e-private-contact');
    const staffToken=await member.evaluate(()=>sessionStorage.getItem('pioneerToken'));
    expect((await contexts[2].request.get(`/api/appointments/${item.id}/attachments`,{headers:{Authorization:'Bearer '+staffToken}})).status()).toBe(403);
    await member.locator(`[data-start="${item.id}"]`).click();
    await expect(member.locator('#intake-modal')).toBeVisible();
    await expect(member.locator('#appointments-table')).not.toContainText('浏览器测试同学');
    for(const side of ['front','back'])await member.locator('#intake-'+side).setInputFiles({name:side+'.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64')});
    await capture(member,'technician-intake-photos');
    await member.locator('#confirm-intake').click();await expect(member.locator('#intake-modal')).toBeHidden();
    await expect(member.locator('#appointments-table')).toContainText('浏览器测试同学');
    await expect(member.locator('#detail-modal')).toBeVisible();await expect(member.locator('#detail-summary')).toContainText('e2e-private-contact');
    await expect(member.locator('#recovery-panel')).toBeHidden();await expect(member.locator('#detail-assigned')).toHaveAttribute('readonly','');
    await capture(member,'technician-repair-detail');
    await member.setViewportSize({width:390,height:844});
    expect(await member.locator('.detail-modal').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    await capture(member,'mobile-technician-repair-detail');
    await member.setViewportSize({width:1440,height:1000});
    await member.locator('#complete-detail').click();await expect(member.locator('#detail-modal')).toBeVisible();
    await member.locator('#detail-outcome').selectOption('repaired');await member.locator('#detail-repair-note').fill('浏览器验收：已修复并测试');
    await member.locator('#complete-detail').click();await expect(member.locator('#detail-modal')).toBeHidden();
    await expect(member.locator('#toast')).toHaveText(`维修已结束，预约编号：${item.id}`);
    await student.locator('#refresh-my-appointments').click();await expect(student.locator('#lookup-results')).toContainText('修复成功');
    await expect(student.locator('[data-cancel]')).toHaveCount(0);
    await expect(student.locator('#lookup-results')).toContainText(item.id);
    await expect(student.locator('#lookup-results')).not.toContainText('历史维修编号');
    const completed = await contexts[0].request.get(`/api/appointments/${item.id}`,{headers:{'X-Appointment-Token':secret}});
    expect((await completed.json()).repairNumber).toBeNull();

    await root.getByRole('button',{name:'维修后台',exact:true}).click();await root.locator(`[data-detail="${item.id}"]`).click();
    await root.locator('#correction-panel summary').click();
    await root.locator('#correction-outcome').selectOption('not_needed');await root.locator('#detail-repair-note').fill('浏览器验收：复测后无需维修');
    root.once('dialog',dialog=>dialog.accept());await root.locator('#apply-correction').click();await expect(root.locator('#detail-modal')).toBeHidden();
    await expect(root.locator('#appointments-table')).toContainText('无需维修');
    await root.locator(`[data-detail="${item.id}"]`).click();
    await root.locator('#recovery-verified').check();await root.locator('#recovery-reason').fill('已当面核验学生证和预约联系方式');
    await root.locator('#recover-access').click();await expect(root.locator('#recovery-result')).toBeVisible();
    const recovered=await root.locator('#recovered-link').inputValue();
    expect(recovered).not.toBe(item.link);
    expect((await contexts[0].request.get(`/api/appointments/${item.id}`,{headers:{'X-Appointment-Token':secret}})).status()).toBe(404);
    await privatePage.goto(recovered);await expect(privatePage.locator('#lookup-results')).toContainText('浏览器验收：复测后无需维修');
    await root.locator('#close-detail').click();await root.getByRole('button',{name:'账号管理',exact:true}).click();
    await root.locator('[data-edit-user="20268801"]').click();
    await root.locator('#edit-user-role').selectOption('admin');
    await root.locator('[name=editCampus][value="南湖"]').uncheck();await root.locator('[name=editCampus][value="浑南"]').check();
    await root.locator('#user-edit-form [type=submit]').click();await expect(root.locator('#user-edit-modal')).toBeHidden();
    await member.reload();await expect(member.locator('#login-view')).toBeVisible();await login(member,'20268801',memberPassword);
    await expect(member.locator('[data-view-link=stats]')).toBeVisible();await expect(member.locator('#appointments-table')).not.toContainText(item.id);
    await member.getByRole('button',{name:'个人设置',exact:true}).click();await expect(member.locator('#profile-info')).toContainText('所属 南湖 · 授权 浑南');
    await expect(member.locator('.capacity-row')).toHaveCount(2);
    await expect(member.locator('.capacity-row[data-campus="南湖"]')).toHaveCount(0);
    await member.locator('#current-password').fill(memberPassword);await member.locator('#new-password').fill('changed-member-password');await member.locator('#confirm-password').fill('changed-member-password');
    await member.locator('#password-form [type=submit]').click();await expect(member.locator('#login-view')).toBeVisible();
    await login(member,'20268801','changed-member-password');
    await root.locator('[data-toggle-user="20268801"]').click();await expect(root.locator('#users-table')).toContainText('已停用');
    await member.reload();await expect(member.locator('#login-view')).toBeVisible();
    await root.locator('[data-toggle-user="20268801"]').click();await expect(root.locator('[data-toggle-user="20268801"]')).toHaveText('停用');
    await login(member,'20268801','changed-member-password');
    await member.getByRole('button',{name:'个人设置',exact:true}).click();await member.locator('#revoke-sessions').click();await expect(member.locator('#login-view')).toBeVisible();

    await root.getByRole('button',{name:'个人设置',exact:true}).click();
    await root.locator('#current-password').fill(process.env.E2E_ROOT_PASSWORD);await root.locator('#new-password').fill(process.env.E2E_ROOT_PASSWORD+'new');await root.locator('#confirm-password').fill(process.env.E2E_ROOT_PASSWORD+'new');
    await root.locator('#password-form [type=submit]').click();await expect(root.locator('#login-view')).toBeVisible();
    await login(root,'root001',process.env.E2E_ROOT_PASSWORD+'new');
    expect(errors).toEqual([]);
  }finally{await Promise.all(contexts.map(context=>context.close()));}
});

test('historical private links display original identifiers and repair aliases save the original booking ID', async ({ browser }) => {
  const context = await browser.newContext({baseURL:process.env.E2E_BASE_URL});
  const page = await context.newPage(), accessToken = 'a'.repeat(43), errors = [];
  page.on('pageerror', error=>errors.push(error.message));
  const items = ['','reverse','reserve'].map((prefix,index)=>({
    id:`${prefix}020261012-${51+index}`,repairNumber:`020261015-${51+index}`,revision:0,
    name:'历史预约同学',campus:'南湖',date:'2026-10-12',timeSlot:'19:00–20:00',
    deviceType:'笔记本电脑',brand:'联想',deviceModel:'ThinkPad',status:'completed',outcome:'repaired',
    repairNote:'历史维修说明',createdAt:'2026-10-12T08:00:00Z',attachments:[]
  }));
  await page.route('**/api/appointments/*', route=>{
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1));
    const item = items.find(item=>item.id===id || item.repairNumber===id);
    if (!item || route.request().headers()['x-appointment-token']!==accessToken) return route.fulfill({status:404,json:{error:'预约不存在或访问凭证无效'}});
    return route.fulfill({json:item});
  });
  try {
    for (const item of items) for (const id of [item.id,item.repairNumber]) {
      await page.goto(`/#${new URLSearchParams({appointment:id,access:accessToken})}`);
      await expect(page.locator('#lookup-results')).toContainText(item.id);
      await expect(page.locator('#lookup-results')).toContainText(`历史维修编号 ${item.repairNumber}`);
      await expect(page.locator('#lookup-results')).toContainText('历史维修说明');
      expect(new URL(page.url()).hash).toBe('');
      const saved = await page.evaluate(()=>JSON.parse(localStorage.getItem('pioneerAppointmentAccess')));
      expect(saved[0]).toEqual({id:item.id,accessToken});
      await page.reload();await page.getByRole('button',{name:'我的预约',exact:true}).click();
      await expect(page.locator('#lookup-results')).toContainText(item.id);
    }
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('mobile booking and cancellation remain usable, and disabled storage offers a private link',async({browser})=>{
  const context=await browser.newContext({baseURL:process.env.E2E_BASE_URL,viewport:{width:390,height:844},extraHTTPHeaders:{'CF-Connecting-IP':'198.51.100.20'}});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    const item=await booking(page,'20269902',{file:false});
    await page.getByRole('button',{name:'查看我的预约',exact:true}).click();await expect(page.locator('#lookup-results')).toContainText(item.id);
    await capture(page,'mobile-my-appointments');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    page.once('dialog',dialog=>dialog.accept());await page.locator('[data-cancel]').click();await expect(page.locator('#lookup-results')).toContainText('已取消');
    await page.goto('/staff/?activate=1');await expect(page.locator('#activation-form')).toBeVisible();await capture(page,'mobile-activation');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
  }finally{await context.close();}
  const blocked=await browser.newContext({baseURL:process.env.E2E_BASE_URL,extraHTTPHeaders:{'CF-Connecting-IP':'198.51.100.21'}});
  await blocked.addInitScript(()=>Object.defineProperty(window,'localStorage',{value:{getItem(){throw new Error('disabled');},setItem(){throw new Error('disabled');}}}));
  const guest=await blocked.newPage();
  try{const item=await booking(guest,'20269903',{file:false});await expect(guest.locator('#credential-save-message')).toContainText('无法保存');expect(new URL(item.link).hash).toContain('access=');}
  finally{await blocked.close();}
});
