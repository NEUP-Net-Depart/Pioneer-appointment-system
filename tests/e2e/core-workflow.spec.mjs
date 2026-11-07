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
  await staffPage(page,'现场工作台');
  await expect(page.getByRole('heading',{name:'现场工作台',exact:true})).toBeVisible();
  await expect(page.locator('.field-content')).toHaveAttribute('aria-busy','true');
  await expect(page.getByText('暂无符合条件的工单',{exact:true})).not.toBeVisible();
 }finally{releaseBoard();}
 await expect(page.locator('.field-content')).toHaveAttribute('aria-busy','false');
});

test('ordinary network staff receive photos, finish and correct an onsite repair without attendance, keeping student notes private',async({page},testInfo)=>{
 await loginStaff(page,'20261002','StaffTest!2026');
 await expect(page.getByRole('heading',{name:'现场工作台',exact:true})).toBeVisible();
 await expect(page.locator('.field-sidebar').getByRole('button',{name:/^(值班|我的值班)$/,includeHidden:true})).toHaveCount(0);
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

test('weekly availability, publishing, direct leave and recipient confirmation work in the unified page',async({page,context},testInfo)=>{
 const week=testInfo.project.name==='chromium'?'2026-10-19':'2026-10-26';
 const freeDay=testInfo.project.name==='chromium'?'周一':'周二';
 const worker=await context.newPage();await worker.clock.install({time:now});await loginStaff(worker,'20261003','StaffTest!2026');
 await worker.getByLabel('所在周').fill(week);
 await worker.getByRole('button',{name:'修改通常时间'}).click();await worker.getByRole('checkbox',{name:freeDay,exact:true}).check();
 await worker.getByRole('button',{name:'保存空闲',exact:true}).click();
 await expect(worker.getByRole('button',{name:'修改通常时间',exact:true})).toBeVisible();
 await loginStaff(page,'20261001','StaffTest!2026');
 await page.getByRole('navigation',{name:'值班任务'}).getByRole('button',{name:'安排下周',exact:true}).click();
 const planner=page.locator('.duty-planner');
 await planner.getByLabel('所在周').fill(week);
 await planner.getByRole('button',{name:'生成建议班表'}).click();
 await expect(planner.getByRole('button',{name:/^移除周宁 /})).toBeVisible();
 await planner.getByRole('button',{name:'发布班表'}).click();
 await expect(planner.getByRole('button',{name:'发布班表'})).toBeDisabled();
 await screenshot(page,testInfo,'duty-planner');
 // Refresh the member page to pick up the published roster and preserve the selected week.
 await worker.reload();await worker.getByLabel('所在周').fill(week);
 const firstDate=(await api(worker,`/api/me/roster?weekStart=${week}`,null,'GET')).items[0].businessDate;
 const memberShift=worker.getByRole('article').filter({hasText:firstDate});
 await memberShift.getByRole('button',{name:'登记请假',exact:true}).click();
 await worker.getByLabel('请假原因').fill('临时有课');await memberShift.getByRole('button',{name:'登记请假',exact:true}).click();
 await expect(worker.getByRole('button',{name:'撤销请假'})).toBeVisible();
 await memberShift.getByRole('button',{name:'邀请接替'}).click();await worker.getByRole('combobox',{name:'接替成员',exact:true}).selectOption('member-root001');await worker.getByRole('button',{name:'发送接替邀请'}).click();
 await expect(worker.getByText('待对方确认',{exact:false})).toBeVisible();
 const recipient=await context.newPage();await recipient.clock.install({time:now});await loginStaff(recipient,'root001',process.env.E2E_ROOT_PASSWORD);
 await recipient.getByRole('navigation',{name:'值班任务'}).getByRole('button',{name:'我的值班',exact:true}).click();
 await recipient.locator('.duty-personal').getByLabel('所在周').fill(week);
 await recipient.getByRole('button',{name:'确认接替',exact:true}).click();await expect(recipient.locator('article').filter({hasText:firstDate}).getByText('已接替',{exact:false})).toBeVisible();
 await screenshot(recipient,testInfo,'schedule');await worker.close();await recipient.close();
});

test('daily duty review resolves an unsigned person and records a historical arrival directly from their row',async({page},testInfo)=>{
 await loginStaff(page,'20261001','StaffTest!2026');
 const campusId='campus-nanhu',weekStart='2026-10-12';
 const businessDate=testInfo.project.name==='chromium'?'2026-10-12':'2026-10-13';
 const current=await api(page,`/api/rosters/campus-week?${new URLSearchParams({campusId,weekStart})}`,null,'GET');
 await api(page,'/api/rosters/campus-week',{
   campusId,weekStart,sourceVersion:current.sourceVersion,requestId:crypto.randomUUID(),
   rosters:current.rosters.map(row=>({...row,assignments:[...row.assignments,...(row.dutyType==='repair'?[{memberId:'member-20261003',businessDate,startAt:'19:00',endAt:'21:00'}]:[])]}))
 },'PUT');
 const daily=page.locator('.duty-day');
 await daily.getByLabel('值班日期').fill(businessDate);
 const person=daily.locator('.duty-person').filter({hasText:'周宁'});
 await expect(person.getByText('未签到',{exact:true})).toBeVisible();
 await person.getByRole('button',{name:'确认未到',exact:true}).click();
 await expect(person.getByText('已确认未到',{exact:true})).toBeVisible();
 await person.getByRole('button',{name:'撤销未到',exact:true}).click();
 await expect(person.getByText('未签到',{exact:true})).toBeVisible();
 await person.getByRole('button',{name:'补记漏签',exact:true}).click();
 const correction=page.getByRole('dialog',{name:'补记漏签'});
 await expect(correction).toContainText('周宁');
 await expect(correction.getByLabel('实际到场时间')).toHaveValue(`${businessDate}T19:00`);
 await correction.getByLabel('补录或修正原因').fill('现场已核实漏签');
 await correction.getByRole('button',{name:'保存考勤',exact:true}).click();
 await expect(person.getByText('已签到',{exact:true})).toBeVisible();
 await screenshot(page,testInfo,'duty-review');
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
