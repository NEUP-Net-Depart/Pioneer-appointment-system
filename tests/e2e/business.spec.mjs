import {test,expect} from '@playwright/test';
import {mkdir,readFile} from 'node:fs/promises';
import {dateKey,addDays,serviceDay,slotDeadline} from '../../shared/time.js';

const memberPassword='e2e-member-password-only';
const bookingDates=[0,1,2,3].map(n=>addDays(dateKey(),n)).filter(serviceDay);
const date=bookingDates.find(day=>Date.now()<Date.parse(slotDeadline(day,'19:00–19:30'))) || bookingDates[0];
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
  await page.locator('[data-slot="19:00–19:30"]').click();
  await expect(page.locator('[name=timeSlot]')).toHaveValue('19:00–19:30');
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

test('weekday capacity configuration preserves booked days and unsaved edits', async ({ browser }) => {
  const contexts=await Promise.all([30,31].map(n=>browser.newContext({baseURL:process.env.E2E_BASE_URL,extraHTTPHeaders:{'CF-Connecting-IP':`198.51.100.${n}`}})));
  const root=await contexts[0].newPage(), student=await contexts[1].newPage();
  let token,item;
  const weekday=new Date(date+'T00:00:00Z').getUTCDay();
  const row=day=>root.locator(`.capacity-row[data-campus="南湖"][data-weekday="${day}"][data-time-slot="19:00–19:30"]`);
  async function save(capacity) {
    await row(weekday).locator('input').fill(String(capacity));
    await root.locator('#capacity-save-all').click();
    await expect(root.locator('#capacity-draft-status')).toHaveText('所有配置已保存');
    await expect(row(weekday).locator('input')).toHaveAttribute('title',capacity===0 ? '暂停预约':`最多 ${capacity} 人`);
  }
  try {
    await login(root,'root001',process.env.E2E_ROOT_PASSWORD);
    token=await root.evaluate(()=>sessionStorage.getItem('pioneerToken'));
    await root.getByRole('button',{name:'个人设置',exact:true}).click();
    await expect(root.locator('.capacity-row')).toHaveCount(32);
    await expect(root.locator('.capacity-row:visible')).toHaveCount(16);
    await expect(row(weekday).locator('input')).toHaveValue('5');
    await row(weekday).locator('input').fill('1.5');
    await root.locator('#capacity-save-all').click();
    expect(await row(weekday).locator('input').evaluate(input=>input.validity.valid)).toBe(false);
    await save(3);
    item=await booking(student,'20269900',{file:false});
    await save(0);
    const summary=await (await contexts[0].request.get(`/api/live/summary?date=${date}&campus=${encodeURIComponent('南湖')}`)).json();
    expect(summary.slotCapacities['19:00–19:30']).toBe(3);
    expect(summary.slots['19:00–19:30']).toBe(1);
    const future=await (await contexts[0].request.get(`/api/live/summary?date=${addDays(date,7)}&campus=${encodeURIComponent('南湖')}`)).json();
    expect(future.slotCapacities['19:00–19:30']).toBe(0);
    await row(weekday).locator('input').fill('7');
    await root.locator('[data-capacity-campus="浑南"]').click();
    await root.locator('[data-capacity-campus="南湖"]').click();
    await expect(row(weekday).locator('input')).toHaveValue('7');
    await root.locator('#reload-capacities').click();
    await expect(row(weekday).locator('input')).toHaveValue('7');
    await root.locator('#capacity-discard').click();
    await expect(row(weekday).locator('input')).toHaveValue('0');
    await root.locator('.capacity-tools summary').click();
    await root.locator('#capacity-bulk-value').fill('11');
    await root.locator('#capacity-bulk-scope').selectOption('week');
    await root.getByRole('button',{name:'统一填写',exact:true}).click();
    await expect(root.locator('#capacity-draft-status')).toContainText('16 项');
    await expect(root.locator('#capacity-draft-status')).toContainText('南湖 周一、周二、周三、周四');
    await root.locator('#capacity-copy-campus').click();
    await expect(root.locator('#capacity-draft-status')).toContainText('32 项');
    await root.locator('[data-capacity-campus="浑南"]').click();
    await expect(root.locator('.capacity-campus:visible [data-day-total="1"]')).toHaveText('44');
    await root.locator('[data-capacity-campus="南湖"]').click();
    await root.locator('#capacity-save-all').click();
    await expect(root.locator('#capacity-draft-status')).toHaveText('所有配置已保存');
    await expect(row(weekday).locator('input')).toHaveAttribute('title','最多 11 人');
    await root.locator('#capacity-bulk-value').fill('7');
    await root.locator('#capacity-bulk-scope').selectOption(String(weekday));
    await root.getByRole('button',{name:'统一填写',exact:true}).click();
    await expect(root.locator('#capacity-draft-status')).toContainText('4 项');
    await root.locator('#capacity-copy-day').selectOption(String(weekday));
    await root.locator('#capacity-copy-week').click();
    await expect(root.locator('#capacity-draft-status')).toContainText('16 项');
    const another = weekday === 1 ? 2 : 1;
    await row(another).locator('input').fill('6');
    await root.locator('#capacity-undo').click();
    await expect(root.locator('#capacity-draft-status')).toContainText('5 项');
    await expect(row(weekday).locator('input')).toHaveValue('7');
    await expect(row(another).locator('input')).toHaveValue('6');
    await root.locator('#capacity-discard').click();
    await expect(root.locator('#capacity-draft-status')).toHaveText('所有配置已保存');
    await root.locator('.capacity-tools summary').click();
    await capture(root,'weekday-capacities-desktop');
    for (const width of [320,390,768]) {
      await root.setViewportSize({width,height:844});
      expect(await root.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await expect(root.locator('.capacity-row:visible')).toHaveCount(16);
      const box = await row(weekday).locator('input').boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(40);
    }
    await root.setViewportSize({width:390,height:844});
    await capture(root,'weekday-capacities-mobile');
    await root.locator('.capacity-tools summary').click();
    expect(await root.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await capture(root,'weekday-capacities-mobile-tools');
  } finally {
    if (item) {
      const link=new URL(item.link),access=link.hash.match(/access=([^&]+)/)?.[1];
      await contexts[0].request.patch(`/api/appointments/${item.id}/status`,{headers:{'X-Appointment-Token':decodeURIComponent(access || '')},data:{status:'completed',outcome:'cancelled'}});
    }
    if(token) {
      const headers={Authorization:`Bearer ${token}`};
      const result=await contexts[0].request.get('/api/slot-capacities',{headers});
      const items=(await result.json()).items.filter(item=>item.capacity!==5).map(item=>({...item,capacity:5}));
      if(items.length) expect((await contexts[0].request.patch('/api/slot-capacities',{headers,data:{items}})).ok()).toBe(true);
    }
    await Promise.all(contexts.map(context=>context.close()));
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

    await root.getByRole('button',{name:'维修后台',exact:true}).click();
    // Wait for the refreshed list after another staff member completes the repair.
    await expect(root.locator('#appointments-table tr').filter({hasText:item.id})).toContainText('修复成功');
    await root.locator(`[data-detail="${item.id}"]`).click();
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
    await expect(member.locator('.capacity-row')).toHaveCount(16);
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
