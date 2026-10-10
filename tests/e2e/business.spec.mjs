import {test,expect} from '@playwright/test';
import {mkdir,readFile} from 'node:fs/promises';
import {dateKey,addDays,serviceDay} from '../../shared/time.js';

const memberPassword='e2e-member-password-only';
const date=[0,1,2,3].map(n=>addDays(dateKey(),n)).find(serviceDay);
async function login(page,account,password){
  await page.goto('/staff/');
  await page.locator('#login-id').fill(account);await page.locator('#login-password').fill(password);
  await page.locator('#login-form button').click();await expect(page.locator('#app-shell')).toBeVisible();
}
async function booking(page,studentId,{file=true}={}){
  await page.goto('/');
  for(const [name,value] of Object.entries({studentId,name:'浏览器测试同学',social:'e2e-private-contact',brand:'联想',deviceModel:'ThinkPad',issue:'启动后蓝屏'}))await page.locator(`[name="${name}"]`).fill(value);
  for(const [name,value] of Object.entries({campus:'南湖',deviceType:'笔记本电脑',warranty:'否',faultType:'蓝屏',timeSlot:'19:00–20:00'}))await page.locator(`[name="${name}"]`).selectOption(value);
  await page.locator('[name=date]').fill(date);
  if(file)await page.locator('#appointment-attachments').setInputFiles({name:'故障描述.txt',mimeType:'text/plain',buffer:Buffer.from('browser attachment')});
  await page.locator('.check-box').click();await page.locator('#booking-form [type=submit]').click();
  await expect(page.locator('#success-panel')).toBeVisible();
  return {id:await page.locator('#success-code').textContent(),link:await page.locator('#success-private-link').getAttribute('href')};
}
async function application(page,studentId,name){
  await page.goto('/staff/?activate=1');
  for(const [id,value] of Object.entries({'activation-student-id':studentId,'activation-name':name,'activation-contact':'核验微信号','activation-password':memberPassword,'activation-confirm':memberPassword}))await page.locator('#'+id).fill(value);
  await page.locator('#activation-campus').selectOption('南湖');await page.locator('#activation-form [type=submit]').click();
  await expect(page.locator('#activation-status')).toContainText('等待管理员');
}
async function capture(page,name){
  await mkdir('output/playwright',{recursive:true});await page.screenshot({path:`output/playwright/${name}.png`,fullPage:true,animations:'disabled'});
}

test('student booking, private links, whitelist activation, staff permissions, recovery and settings work in Preview',async({browser})=>{
  test.setTimeout(120000);
  const errors=[];
  const contexts=await Promise.all([10,11,12,13].map(n=>browser.newContext({baseURL:process.env.E2E_BASE_URL,extraHTTPHeaders:{'CF-Connecting-IP':`198.51.100.${n}`}})));
  const [student,root,member,privatePage]=await Promise.all(contexts.map(context=>context.newPage()));
  for(const page of [student,root,member,privatePage])page.on('pageerror',error=>errors.push(error.message));
  try{
    const item=await booking(student,'20269901');
    await expect(student.locator('#credential-save-message')).toContainText('自动保存在此浏览器');
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
    await root.locator('#approve-applications').click();await expect(root.locator('#applications-table')).toContainText('已通过');
    await capture(root,'admin-accounts');
    await member.locator('#refresh-activation').click();await expect(member.locator('#activation-status')).toContainText('审核已通过');
    await login(member,'20268801',memberPassword);
    await expect(member.locator('[data-view-link=stats]')).toBeHidden();
    await expect(member.locator('#appointments-table')).toContainText(item.id);
    await expect(member.locator('#appointments-table')).not.toContainText('浏览器测试同学');
    await expect(member.locator('#appointments-table')).not.toContainText('e2e-private-contact');
    const staffToken=await member.evaluate(()=>sessionStorage.getItem('pioneerToken'));
    expect((await contexts[2].request.get(`/api/appointments/${item.id}/attachments`,{headers:{Authorization:'Bearer '+staffToken}})).status()).toBe(403);
    await member.locator(`[data-claim="${item.id}"]`).click();
    await expect(member.locator('#appointments-table')).toContainText('浏览器测试同学');
    await member.locator(`[data-detail="${item.id}"]`).click();await expect(member.locator('#detail-summary')).toContainText('e2e-private-contact');
    await expect(member.locator('#recovery-panel')).toBeHidden();await expect(member.locator('#detail-assigned')).toHaveAttribute('readonly','');
    await capture(member,'technician-repair-detail');
    await member.locator('#detail-status').selectOption('completed');await member.locator('#detail-repair-note').fill('浏览器验收：已修复并测试');
    await member.locator('#save-detail').click();await expect(member.locator('#detail-modal')).toBeHidden();

    await root.getByRole('button',{name:'维修后台',exact:true}).click();await root.locator(`[data-detail="${item.id}"]`).click();
    await root.locator('#recovery-verified').check();await root.locator('#recovery-reason').fill('已当面核验学生证和预约联系方式');
    await root.locator('#recover-access').click();await expect(root.locator('#recovery-result')).toBeVisible();
    const recovered=await root.locator('#recovered-link').inputValue();
    expect(recovered).not.toBe(item.link);
    expect((await contexts[0].request.get(`/api/appointments/${item.id}`,{headers:{'X-Appointment-Token':secret}})).status()).toBe(404);
    await privatePage.goto(recovered);await expect(privatePage.locator('#lookup-results')).toContainText('浏览器验收：已修复并测试');
    await root.locator('#close-detail').click();await root.getByRole('button',{name:'账号管理',exact:true}).click();
    await root.locator('[data-edit-user="20268801"]').click();
    await root.locator('#edit-user-role').selectOption('admin');
    await root.locator('[name=editCampus][value="南湖"]').uncheck();await root.locator('[name=editCampus][value="浑南"]').check();
    await root.locator('#user-edit-form [type=submit]').click();await expect(root.locator('#user-edit-modal')).toBeHidden();
    await member.reload();await expect(member.locator('#login-view')).toBeVisible();await login(member,'20268801',memberPassword);
    await expect(member.locator('[data-view-link=stats]')).toBeVisible();await expect(member.locator('#appointments-table')).not.toContainText(item.id);
    await member.getByRole('button',{name:'个人设置',exact:true}).click();await expect(member.locator('#profile-info')).toContainText('所属 南湖 · 授权 浑南');
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
