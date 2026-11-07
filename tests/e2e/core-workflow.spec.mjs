import {test,expect} from '@playwright/test';
import {loginStaff,staffPage,navigationEntry} from './support/staff.mjs';
import {chooseTime,fillDevice,goReview,submitStudent,PHOTO} from './support/student.mjs';
const now=new Date('2026-10-15T02:00:00Z');
test.beforeEach(async({page})=>{await page.clock.install({time:now});});
async function api(page,path,data,method='POST'){
 const token=await page.evaluate(()=>sessionStorage.getItem('pioneerToken'));
 const response=await page.request.fetch(path,{method,headers:{Authorization:`Bearer ${token}`},...(data?{data}:{})});
 const body=await response.json();expect(response.ok(),JSON.stringify(body)).toBeTruthy();return body;
}
async function openOrder(page,id){await staffPage(page,'预约记录');await page.locator('tr').filter({hasText:id}).getByRole('button',{name:'查看详情'}).click();await expect(page.getByRole('dialog',{name:'维修工单'})).toBeVisible();}
async function screenshot(page,testInfo,name){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath(name+'.png'),fullPage:true});}

test('student books against the real capacity service, signs, and opens the private result',async({page},testInfo)=>{
 await page.goto('/');await chooseTime(page);await fillDevice(page,{studentId:testInfo.project.name==='chromium'?'20269991':'20269992'});await goReview(page);await submitStudent(page);
 await expect(page.locator('#success-summary')).toContainText('南湖测试维修室');
 await screenshot(page,testInfo,'booking');
 await page.locator('#view-created-appointment').click();await expect(page.locator('#appointment-detail')).toBeVisible();
 await expect(page.locator('#appointment-detail')).not.toContainText('操作历史');
});

test('cold entries wait for route code and business data instead of flashing the wrong content',async({page})=>{
 let release;
 const ready=new Promise(resolve=>{release=resolve;});
 await page.route('**/user/main.js',async route=>{await ready;await route.continue();});
 try{
  await page.goto('/#lookup',{waitUntil:'commit'});
  await expect(page.locator('#student-loading')).toBeVisible();
  await expect(page.locator('#booking-view')).not.toBeVisible();
 }finally{release();}
 await expect(page.locator('#lookup-list')).toBeVisible();
 await expect(page.locator('#student-loading')).toBeHidden();
 await expect(page.locator('#booking-view')).toBeHidden();
 let releaseBoard;
 const boardReady=new Promise(resolve=>{releaseBoard=resolve;});
 await page.route('**/api/field/board*',async route=>{await boardReady;await route.continue();});
 try{
  await loginStaff(page,'root001',process.env.E2E_ROOT_PASSWORD);
  await expect(page.getByRole('heading',{name:'现场工作台',exact:true})).toBeVisible();
  await expect(page.locator('.field-content')).toHaveAttribute('aria-busy','true');
  await expect(page.getByText('暂无符合条件的工单',{exact:true})).not.toBeVisible();
 }finally{releaseBoard();}
 await expect(page.locator('.field-content')).toHaveAttribute('aria-busy','false');
});

test('ordinary network staff receive photos, finish and correct an onsite repair without attendance, keeping student notes private',async({page},testInfo)=>{
 await loginStaff(page,'20261002','StaffTest!2026');
 const created=await api(page,'/api/scan/onsite',{requestId:crypto.randomUUID(),campus:'南湖',studentId:testInfo.project.name==='chromium'?'20269981':'20269982',name:'现场测试同学',social:'test-contact',deviceType:'笔记本',brand:'联想',deviceModel:'',warranty:'不清楚',faultType:'系统',signature:[Array.from({length:12},(_,i)=>[.1+i*.05,.2+i*.03])]});
 await openOrder(page,created.id);
 const dialog=page.getByRole('dialog',{name:'维修工单'});
 await expect(dialog.getByRole('button',{name:'稍后补传，继续接单'})).toHaveCount(0);
 for(const side of ['正面','背面'])await dialog.getByLabel(`设备${side}照片`,{exact:true}).setInputFiles({name:side+'.png',mimeType:'image/png',buffer:PHOTO});
 await dialog.getByRole('button',{name:'直接接单，开始维修'}).click();
 await expect(dialog.getByText('当前主修：陈宇')).toBeVisible();
 await dialog.getByLabel('部分解决',{exact:true}).check();await dialog.getByLabel('简短处理说明').fill('系统恢复，键盘仍需更换（内部）');await dialog.getByRole('button',{name:'结束本次服务'}).click();
 await expect(dialog.getByRole('button',{name:'保存结果更正'})).toBeVisible();
 await dialog.getByLabel('已解决',{exact:true}).check();await dialog.getByLabel('简短处理说明').fill('键盘更换后通过复核（内部）');await dialog.getByRole('button',{name:'保存结果更正'}).click();
 await expect(dialog.getByText('已解决 · 键盘更换后通过复核（内部）')).toBeVisible();
 await expect(dialog.getByRole('button',{name:'查询保修',exact:true})).toHaveCount(0);
 await screenshot(page,testInfo,'repair');
 const customer=await page.request.get(`/api/appointments/${created.id}`,{headers:{'X-Appointment-Token':created.accessToken}});
 expect(customer.ok()).toBeTruthy();const visible=await customer.json();expect(visible.outcome).toBe('repaired');expect(JSON.stringify(visible)).not.toMatch(/内部|repairNote|actorAccount|before_json/);
 const home=await api(page,'/api/field/home',null,'GET');expect(home.presence).toBeFalsy();expect(home.todayDuties).toHaveLength(0);
 await page.goto('/#'+new URLSearchParams({appointment:created.id,access:created.accessToken}));
 const liquidMetal=page.locator('#detail-information dl > div').filter({has:page.getByText('液金散热',{exact:true})});
 await expect(liquidMetal.locator('dd')).toHaveText('不清楚');
 await expect(page.locator('#detail-information')).not.toContainText('unknown');
});

test('staff can find a booked order by student ID in records and open it to start repair',async({page},testInfo)=>{
 const studentId=testInfo.project.name==='chromium'?'020269971':'020269972';
 const guestList=await page.request.get('/api/appointments?'+new URLSearchParams({q:studentId}));
 const guestSearch=await page.request.post('/api/scan/search',{data:{q:studentId}});
 expect(guestList.status()).toBe(401);
 expect(guestSearch.status()).toBe(401);
 await loginStaff(page,'20261002','StaffTest!2026');
 const created=await api(page,'/api/scan/onsite',{requestId:crypto.randomUUID(),campus:'南湖',studentId,name:'学号查询测试',social:'student-search',deviceType:'笔记本',brand:'联想',warranty:'不清楚',faultType:'系统',signature:[Array.from({length:12},(_,i)=>[.1+i*.05,.2+i*.03])]});
 await staffPage(page,'预约记录');
 const records=page.getByRole('searchbox',{name:'查找预约'});
 await expect(records).toHaveAttribute('placeholder',/完整学号/);
 const searchResponse=page.waitForResponse(response=>{
  const url=new URL(response.url());
  return url.pathname==='/api/appointments' && url.searchParams.get('q')===studentId;
 });
 await records.fill(studentId);
 const result=await searchResponse;
 expect(result.ok()).toBeTruthy();
 expect((await result.json()).items.map(item=>item.id)).toEqual([created.id]);
 const row=page.getByRole('row').filter({hasText:created.id});
 await expect(row).toBeVisible();
 await row.getByRole('button',{name:'查看详情'}).click();
 const order=page.getByRole('dialog',{name:'维修工单'});
 await expect(order.getByText(studentId,{exact:false})).toBeVisible();
 await order.getByRole('button',{name:'关闭',exact:true}).click();
 await staffPage(page,'维修工作台');
 await page.getByRole('combobox',{name:'预约编号 / 学号',exact:true}).fill(studentId);
 await page.getByRole('option').filter({hasText:created.id}).click();
 await expect(order.getByRole('button',{name:'直接接单，开始维修'})).toBeVisible();
});

test('weekly availability, publishing, direct leave and recipient confirmation work in the unified page',async({page,context},testInfo)=>{
 await loginStaff(page,'20261001','StaffTest!2026');await staffPage(page,'排班与可用时间');
 // Each browser uses a distinct week; no state reset or fixture shortcuts.
 const week=testInfo.project.name==='chromium'?'2026-10-19':'2026-10-26';
 await page.getByLabel('所在周').fill(week);await expect(page.getByRole('button',{name:'编排并发布'})).toBeVisible();
 await page.getByRole('button',{name:'编排并发布'}).click();await page.getByRole('button',{name:'添加班次'}).click();
 await page.getByRole('combobox',{name:'成员',exact:true}).selectOption('member-20261002');await page.getByRole('button',{name:'发布班表'}).click();
 await expect(page.getByRole('button',{name:'调整班表'})).toBeVisible();
 const worker=await context.newPage();await worker.clock.install({time:now});await loginStaff(worker,'20261002','StaffTest!2026');await staffPage(worker,'排班与可用时间');await worker.getByLabel('所在周').fill(week);
 const previousAvailability=await api(worker,'/api/me/availability?dutyType=repair',null,'GET');
 await worker.getByRole('button',{name:'修改通常时间'}).click();await worker.getByRole('button',{name:'添加时间'}).click();
 await (await navigationEntry(worker.locator('.field-sidebar'),'预约记录')).click();
 await worker.getByRole('button',{name:'保存并切换',exact:true}).click();
 await expect(worker.getByRole('heading',{name:'预约记录',exact:true})).toBeVisible();
 const availability=await api(worker,'/api/me/availability?dutyType=repair',null,'GET');expect(availability.usual.windows).toHaveLength(previousAvailability.usual.windows.length+1);
 await staffPage(worker,'排班与可用时间');
 await expect(worker.getByText(/沿用通常时间（未作本周确认）/)).toBeVisible();
 await worker.getByRole('button',{name:'登记请假',exact:true}).click();await worker.getByLabel('请假原因').fill('临时有课');await worker.getByRole('button',{name:'登记请假',exact:true}).click();
 await expect(worker.getByRole('button',{name:'撤销请假'})).toBeVisible();
 await worker.getByRole('button',{name:'邀请接替'}).click();await worker.getByRole('combobox',{name:'接替成员',exact:true}).selectOption('member-20261003');await worker.getByRole('button',{name:'发送接替邀请'}).click();
 await expect(worker.getByText('待对方确认',{exact:false})).toBeVisible();
 const recipient=await context.newPage();await recipient.clock.install({time:now});await loginStaff(recipient,'20261003','StaffTest!2026');await staffPage(recipient,'排班与可用时间');await recipient.getByLabel('所在周').fill(week);
 await recipient.getByRole('button',{name:'确认接替',exact:true}).click();await expect(recipient.locator('article').filter({hasText:week}).getByText('已接替',{exact:false})).toBeVisible();
 await expect(recipient.getByRole('button',{name:'登记请假',exact:true})).toBeVisible();
 await screenshot(recipient,testInfo,'schedule');await worker.close();await recipient.close();
});

test('save-and-switch retains a failed draft and navigates only after a successful save',async({page})=>{
 await loginStaff(page,'root001',process.env.E2E_ROOT_PASSWORD);
 await staffPage(page,'预约配置');
 await page.getByRole('button',{name:'放号时间',exact:true}).click();
 const time=page.getByLabel('放号时间（北京时间）');
 await expect(time).toBeEnabled();const original=await time.inputValue(),next=original==='08:00'?'09:00':'08:00';
 await time.fill(next);
 const rejectSave=route=>route.request().method()==='PATCH'
   ? route.fulfill({status:503,json:{error:'测试保存失败'}}) : route.continue();
 await page.route('**/api/booking-settings',rejectSave);
 await (await navigationEntry(page.locator('.field-sidebar'),'预约记录')).click();
 await page.getByRole('button',{name:'保存并切换',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('测试保存失败');
 await expect(time).toHaveValue(next);
 const before=await api(page,'/api/booking-settings/manage?campus='+encodeURIComponent('南湖'),null,'GET');
 expect(before.settings.releaseTime).toBe(original);
 await page.unroute('**/api/booking-settings',rejectSave);
 await page.getByRole('button',{name:'保存并切换',exact:true}).click();
 await expect(page.getByRole('heading',{name:'预约记录',exact:true})).toBeVisible();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 const after=await api(page,'/api/booking-settings/manage?campus='+encodeURIComponent('南湖'),null,'GET');
 expect(after.settings.releaseTime).toBe(next);
 await staffPage(page,'预约配置');
 await time.fill(original);await page.getByRole('button',{name:'保存放号时间',exact:true}).click();
 await expect(page.getByRole('button',{name:'保存放号时间',exact:true})).toBeDisabled();
});
