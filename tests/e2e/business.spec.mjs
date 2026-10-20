import {staffPage,mockStaff,loginStaff} from './support/staff.mjs';
import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {dateKey,addDays,serviceDay,slotDeadline} from '../../shared/time.js';

import { chooseTime,fillDevice,goReview,sign,PHOTO } from './support/student.mjs';

const qqContact='98765432109';
const memberPassword='e2e-member-password-only';
// The disposable Worker clock is fixed by scripts/test-e2e.mjs.
const businessNow=new Date('2026-10-15T02:00:00Z');
const bookingDates=[0,1,2,3].map(n=>addDays(dateKey(businessNow),n)).filter(serviceDay);
const date=bookingDates.find(day=>businessNow.getTime()<Date.parse(slotDeadline(day,'19:00–19:30'))) || bookingDates[0];
async function login(page,account,password){
  await page.goto('/staff/');
  await page.locator('#login-id').fill(account);await page.locator('#login-password').fill(password);
  await page.locator('#login-form button').click();await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();
}
async function booking(page,studentId,{file=true}={}){
  await page.goto('/');await chooseTime(page);await fillDevice(page,{studentId,name:'浏览器测试同学'});await page.locator('[name=qqAccount]').fill(qqContact);await page.locator('[name=issue]').fill('启动后蓝屏');
  if(file){await page.locator('#appointment-attachments').setInputFiles({name:'故障照片.png',mimeType:'image/png',buffer:PHOTO});await expect(page.locator('#booking-photos')).toContainText('照片已准备好');}
  await goReview(page);await page.locator('[name=agreement]').check();await page.locator('#open-signature').click();await page.locator('#confirm-signature').click();await expect(page.locator('#signature-error')).toContainText('完整手写');await page.locator('#cancel-signature').click();await sign(page);
  await capture(page,'booking-review-'+studentId);await page.locator('#booking-submit').click();await expect(page.locator('#success-panel')).toBeVisible();
  if(file)await expect(page.locator('#success-photo-message')).toHaveText('照片已全部上传。');
  const id=await page.locator('#success-code').textContent();expect(id).toMatch(new RegExp(`^reserve0${date.replaceAll('-','')}-\\d{2,}$`));return {id,link:await page.locator('#success-link-fallback').inputValue()};
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


test('weekday capacity configuration preserves booked days and unsaved edits',async({browser})=>{
 const contexts=await Promise.all([30,31].map(n=>browser.newContext({baseURL:process.env.E2E_BASE_URL,extraHTTPHeaders:{'CF-Connecting-IP':`198.51.100.${n}`}}))),root=await contexts[0].newPage(),student=await contexts[1].newPage();
 let token,template;
 try{
  await login(root,'root001',process.env.E2E_ROOT_PASSWORD);token=await root.evaluate(()=>sessionStorage.getItem('pioneerToken'));const headers={Authorization:`Bearer ${token}`};
  const list=await (await root.request.get('/api/slot-capacities',{headers})).json();template=list.items.find(item=>item.campus==='南湖'&&item.weekday===4&&item.timeSlot==='19:00–19:30');
  await staffPage(root,'预约配置');const cell=root.getByRole('gridcell',{name:'南湖 周四 19:00–19:30',exact:true});
  await cell.dblclick();await cell.locator('input').fill('7');await cell.locator('input').press('Enter');await staffPage(root,'账号安全');await staffPage(root,'预约配置');await expect(cell.locator('input')).toHaveValue('7');
  await root.getByRole('button',{name:'预览并保存',exact:true}).click();await root.getByRole('button',{name:'确认保存全部修改',exact:true}).click();await expect(root.getByRole('button',{name:'预览并保存',exact:true})).toBeDisabled();
  const item=await booking(student,'20308101',{file:false});const before=await (await root.request.get('/api/slot-capacities/actual?'+new URLSearchParams({campus:'南湖',date}),{headers})).json();expect(before.source).toBe('snapshot');
  await cell.dblclick();await cell.locator('input').fill('9');await cell.locator('input').press('Enter');await root.getByRole('button',{name:'预览并保存',exact:true}).click();await root.getByRole('button',{name:'确认保存全部修改',exact:true}).click();
  const after=await (await root.request.get('/api/slot-capacities/actual?'+new URLSearchParams({campus:'南湖',date}),{headers})).json();expect(after.items).toEqual(before.items);expect(item.id).toContain('reserve');
 }finally{
  if(token&&template){const headers={Authorization:`Bearer ${token}`},list=await(await root.request.get('/api/slot-capacities',{headers})).json(),latest=list.items.find(row=>row.campus===template.campus&&row.weekday===template.weekday&&row.timeSlot===template.timeSlot);await root.request.patch('/api/slot-capacities',{headers,data:{...latest,capacity:template.capacity}});}
  await Promise.all(contexts.map(c=>c.close()));
 }
});
test('student booking, private links, React activation, staff permissions and credential recovery work in Preview',async({browser})=>{
 const contexts=await Promise.all([41,42].map(n=>browser.newContext({baseURL:process.env.E2E_BASE_URL,extraHTTPHeaders:{'CF-Connecting-IP':`198.51.100.${n}`}}))),root=await contexts[0].newPage(),student=await contexts[1].newPage();
 try{
  const booked=await booking(student,'20308102',{file:false});await login(root,'root001',process.env.E2E_ROOT_PASSWORD);const token=await root.evaluate(()=>sessionStorage.getItem('pioneerToken')),headers={Authorization:`Bearer ${token}`};
  const imported=await root.request.post('/api/staff-whitelist/import',{headers,data:{csv:'studentId,expectedName\n20308103,激活测试',expectedRole:'technician',authorizedCampuses:['南湖']}});expect(imported.ok(),await imported.text()).toBe(true);
  await application(student,'20308103','激活测试');await student.reload();await expect(student.locator('#activation-status')).toContainText('等待管理员');
  await staffPage(root,'账号管理');await root.getByRole('button',{name:'激活审核',exact:true}).click();await root.getByLabel('选择 20308103',{exact:true}).check();await expect(root.getByRole('button',{name:'批准申请',exact:true})).toBeDisabled();await root.getByLabel('我已逐一核实选中申请的本人身份').check();await root.getByRole('button',{name:'批准申请',exact:true}).click();
  await student.getByRole('button',{name:'刷新审核结果',exact:true}).click();await expect(student.locator('#activation-status')).toContainText('审核已通过');await student.getByRole('link',{name:'前往登录',exact:true}).click();await student.locator('#login-id').fill('20308103');await student.locator('#login-password').fill(memberPassword);await student.getByRole('button',{name:'进入系统'}).click();await expect(student.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();await expect(student.locator('.field-sidebar').getByRole('button',{name:'账号管理',exact:true})).toHaveCount(0);
  await staffPage(root,'预约记录');await root.getByRole('searchbox',{name:'查找预约'}).fill(booked.id);await root.locator('.records-table tbody tr').filter({hasText:booked.id}).getByRole('button',{name:'查看详情',exact:true}).click();await root.getByRole('button',{name:'重发客户凭证',exact:true}).click();await root.getByLabel('已人工核验客户本人身份').check();await root.getByLabel('身份核验说明',{exact:true}).fill('已经现场核验学生证与设备归属');await root.getByRole('button',{name:'签发新凭证',exact:true}).click();const link=await root.getByLabel('新私人链接',{exact:true}).inputValue();expect(new URL(link).hash).toContain(booked.id);
  const oldToken=new URL(booked.link).hash.match(/access=([^&]+)/)[1];expect((await root.request.get('/api/appointments/'+booked.id,{headers:{'X-Appointment-Token':oldToken}})).status()).toBe(404);
  await student.locator('.field-sidebar').getByRole('button',{name:'退出登录',exact:true}).click();await expect(student.locator('#login-form')).toBeVisible();
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});
test('historical private links preserve identifiers and React corrections submit the original booking ID',async({page})=>{
 const item={id:'reverse020261012-07',repairNumber:'020261015-03',campus:'南湖',date:'2026-10-12',timeSlot:'19:00–19:30',status:'completed',outcome:'repaired',repairNote:'历史维修',assignedTo:'root001',canReadDetails:true,canCorrect:true,canRecoverCredential:true,revision:0},writes=[];
 await mockStaff(page);await page.route('**/api/appointments?*',route=>route.fulfill({json:{items:[item],counts:{all:1}}}));await page.route('**/api/field/appointments/'+item.id,route=>route.fulfill({json:item}));await page.route('**/api/appointments/*/correction',route=>{writes.push({path:new URL(route.request().url()).pathname,body:route.request().postDataJSON()});return route.fulfill({json:item});});await loginStaff(page);await staffPage(page,'预约记录');await page.getByRole('searchbox',{name:'查找预约'}).fill(item.repairNumber);await expect(page.locator('.records-table')).toContainText(item.id);await expect(page.locator('.records-table')).toContainText(item.repairNumber);await page.getByRole('button',{name:'查看详情',exact:true}).click();await page.getByRole('button',{name:'修正预约记录',exact:true}).click();await page.getByLabel('纠错原因',{exact:true}).fill('核实旧编号后补充历史维修说明');await page.getByRole('button',{name:'核对修改',exact:true}).click();await page.getByRole('button',{name:'确认修正记录',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0].path).toBe('/api/appointments/'+item.id+'/correction');
});
test('mobile booking and cancellation remain usable, and disabled storage offers a private link',async({browser})=>{
  const context=await browser.newContext({baseURL:process.env.E2E_BASE_URL,viewport:{width:390,height:844},extraHTTPHeaders:{'CF-Connecting-IP':'198.51.100.20'}});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    const item=await booking(page,'20269902',{file:false});
    await page.getByRole('button',{name:'查看本次预约',exact:true}).click();await expect(page.locator('#appointment-detail')).toContainText(item.id);
    await capture(page,'mobile-my-appointments');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.locator('[data-cancel-open]').click();await page.locator('[data-cancel-confirm]').click();await expect(page.locator('#appointment-detail')).toContainText('已取消');
    await page.goto('/staff/?activate=1');await expect(page.locator('#activation-form')).toBeVisible();await capture(page,'mobile-activation');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
  }finally{await context.close();}
  const blocked=await browser.newContext({baseURL:process.env.E2E_BASE_URL,extraHTTPHeaders:{'CF-Connecting-IP':'198.51.100.21'}});
  await blocked.addInitScript(()=>Object.defineProperty(window,'localStorage',{value:{getItem(){throw new Error('disabled');},setItem(){throw new Error('disabled');}}}));
  const guest=await blocked.newPage();
  try{const item=await booking(guest,'20269903',{file:false});await expect(guest.locator('#credential-save-message')).toContainText('无法保存');expect(new URL(item.link).hash).toContain('access=');}
  finally{await blocked.close();}
});
