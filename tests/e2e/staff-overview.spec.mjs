import { test, expect } from '@playwright/test';
import { mockStaff, loginStaff, staffPage } from './support/staff.mjs';
const dates=['2026-10-12','2026-10-13','2026-10-14','2026-10-15'];
const item={id:'reverse020261012-07',repairNumber:'020261015-03',name:'测试同学',studentId:'20260007',campus:'南湖',date:dates[0],timeSlot:'19:00–19:30',status:'completed',outcome:'repaired',deviceType:'笔记本电脑',brand:'联想',deviceModel:'ThinkPad',repairNote:'旧维修说明',canReadDetails:true,canCorrect:true,canRecover:true};
async function fixture(page,campuses=['南湖','浑南']){
  await mockStaff(page,{campuses});
  const items=campuses.flatMap(campus=>dates.map(date=>({campus,date,timeSlot:'19:00–19:30',capacity:10,occupied:4,remaining:6,booked:2,inProgress:2,ended:false})));
  await page.route('**/api/appointments/overview',route=>route.fulfill({json:{dates,campuses,updatedAt:'2026-10-15T02:00:00Z',items,week:{start:dates[0],end:'2026-10-18',dates,items}}}));
  await page.route('**/api/appointments?*',route=>route.fulfill({json:{items:[item],counts:{all:1,completed:1},filteredCounts:{all:1,completed:1}}}));
  await page.route('**/api/field/appointments/*',route=>route.fulfill({json:item}));
  await loginStaff(page);await staffPage(page,'预约记录');
}
const query=page=>page.waitForRequest(req=>new URL(req.url()).pathname==='/api/appointments');

test('record pages survive polling, manual refresh and navigation while changed sorts reset pagination',async({page})=>{
  await page.clock.install();await mockStaff(page);
  const reads=[];
  await page.route('**/api/appointments?*',route=>{
    const params=new URL(route.request().url()).searchParams;reads.push(params);
    const cursor=params.get('cursor'),numbers=cursor==='third-page'?[5,6]:cursor?[3,4]:[1,2];
    return route.fulfill({json:{items:numbers.map(n=>({...item,id:`page-${n}`,name:`分页学生${n}`})),counts:{all:6,completed:6},filteredCounts:{all:6,completed:6},nextCursor:cursor==='third-page'?null:cursor?'third-page':'second-page'}});
  });
  await loginStaff(page);await staffPage(page,'预约记录');
  const rows=page.locator('.records-table tbody tr');await expect(rows).toHaveCount(2);
  await page.getByRole('button',{name:'加载更多预约',exact:true}).click();await expect(rows).toHaveCount(4);
  await page.clock.fastForward(31000);await expect.poll(()=>reads.length).toBeGreaterThanOrEqual(4);
  await expect(rows).toHaveCount(4);await expect(rows.locator('strong').filter({hasText:'分页学生'})).toHaveText(['分页学生1','分页学生2','分页学生3','分页学生4']);
  await page.getByRole('button',{name:'刷新记录',exact:true}).click();
  await expect(page.locator('.records-result-meta')).toContainText('4 条记录');await expect(rows).toHaveCount(4);
  await staffPage(page,'账号安全');await staffPage(page,'预约记录');
  await expect(page.locator('.records-result-meta')).toContainText('4 条记录');await expect(rows).toHaveCount(4);
  await page.getByRole('button',{name:'加载更多预约',exact:true}).click();await expect(rows).toHaveCount(6);
  await page.getByRole('button',{name:'刷新记录',exact:true}).click();
  await expect(page.locator('.records-result-meta')).toContainText('6 条记录');await expect(rows).toHaveCount(6);
  await expect(page.getByRole('button',{name:'加载更多预约',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:/^校区，/}).click();await expect(rows).toHaveCount(2);
  await page.getByRole('button',{name:'加载更多预约',exact:true}).click();await expect(rows).toHaveCount(4);
  expect(reads.at(-1).get('sorts')).toBe('campus:asc');expect(reads.at(-1).get('limit')).toBe('100');
});
test('staff search and details retain historical booking and repair identifiers',async({page})=>{
  await fixture(page);
  for(const number of [item.id,item.repairNumber]){
    const pending=page.waitForRequest(req=>req.url().includes('/api/appointments?')&&new URL(req.url()).searchParams.get('q')===number);
    await page.getByRole('searchbox',{name:'查找预约'}).fill(number);await pending;
    await page.getByRole('button',{name:'查看详情'}).click();
    await expect(page.getByRole('dialog')).toContainText(item.id);await expect(page.locator('.records-table')).toContainText(item.repairNumber);
    await page.getByRole('button',{name:'关闭',exact:true}).click();
  }
});

test('an expired session preserves the member repair draft for the next login',async({page})=>{
  await page.clock.install();await fixture(page);
  let expired=false;
  await page.route('**/api/field/appointments/*',route=>expired
    ? route.fulfill({status:401,json:{error:'登录已过期'}})
    : route.fulfill({json:{...item,status:'in_progress',canFinish:true}}));
  await page.getByRole('button',{name:'查看详情'}).click();
  const note=page.getByRole('dialog').getByRole('textbox',{name:'维修说明',exact:true});
  await note.fill('退出后继续核查的维修草稿');
  const draftKey=`field:member-root001:${item.id}`;
  await expect.poll(()=>page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)||'{}').note,draftKey)).toBe('退出后继续核查的维修草稿');
  expired=true;await page.clock.fastForward(31000);await expect(page.locator('#login-form')).toBeVisible();
  expect(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).note,draftKey)).toBe('退出后继续核查的维修草稿');
  expired=false;await loginStaff(page);await staffPage(page,'预约记录');await page.getByRole('button',{name:'查看详情'}).click();
  await expect(page.getByRole('dialog').getByRole('textbox',{name:'维修说明',exact:true})).toHaveValue('退出后继续核查的维修草稿');
});
for(const width of [320,390,768,1440])test(`overview, responsive records and filters remain usable at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await fixture(page);await page.getByText('近期预约概览',{exact:true}).click();
  await expect(page.locator('.records-campus')).toHaveCount(2);
  const pending=query(page);await page.locator('.records-campus').first().getByRole('button',{name:'待签到 2',exact:true}).first().click();
  const params=new URL((await pending).url()).searchParams;expect(params.get('campus')).toBe('南湖');expect(params.get('status')).toBe('booked');expect(params.get('timeSlot')).toBe('19:00–19:30');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`output/playwright/react-records-${width}.png`,fullPage:true});
});
test('a single authorized campus and failed overview refresh keep the last visible data',async({page})=>{
  await fixture(page,['南湖']);await page.getByText('近期预约概览',{exact:true}).click();await expect(page.locator('.records-campus')).toHaveCount(1);
  await page.route('**/api/appointments/overview',route=>route.fulfill({status:503,json:{error:'概览暂不可用'}}));
  await page.getByRole('button',{name:'刷新记录',exact:true}).click();await expect(page.locator('.records-overview')).toContainText('概览暂不可用');await expect(page.locator('.records-campus')).toHaveCount(1);
});
test('column filters compose and stay visible after the modal closes',async({page})=>{
  await fixture(page);await page.getByRole('button',{name:'全部校区',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'浑南校区',exact:true}).click();await page.getByRole('button',{name:'完成',exact:true}).click();
  await page.getByRole('button',{name:'全部状态',exact:true}).click();const pending=query(page);await page.getByRole('dialog').getByRole('button',{name:/^已完成/}).click();
  const p=new URL((await pending).url()).searchParams;expect(p.get('campus')).toBe('浑南');expect(p.get('status')).toBe('completed');await page.getByRole('button',{name:'完成',exact:true}).click();
  await expect(page.locator('.records-toolbar')).toContainText('浑南校区');await expect(page.locator('.records-toolbar')).toContainText('已完成');
});
test('column clicks cycle independently and preserve multi-sort priority',async({page})=>{
  await fixture(page);const campus=page.getByRole('button',{name:/^校区，/}),date=page.getByRole('button',{name:/^预约时间，/});
  await campus.click();await campus.click();await date.click();await expect(page.locator('.records-result-meta')).toContainText('1. 校区↓ → 2. 预约时间↑');
  const pending=page.waitForRequest(req=>req.url().includes('sorts=')&&new URL(req.url()).searchParams.get('sorts')==='date:asc');await campus.click();await pending;
  await expect(page.locator('th').nth(1)).toHaveAttribute('aria-sort','ascending');
});
test('date filter focuses today, supports historical dates and preserves other filters',async({page})=>{
  await page.clock.setFixedTime(new Date('2026-10-15T02:00:00Z'));await fixture(page);await page.getByRole('button',{name:'全部日期',exact:true}).click();
  await expect(page.getByRole('dialog').locator('[aria-current=date]')).toBeFocused();
  await page.getByText('查找历史记录',{exact:true}).click();await page.getByLabel('历史日期',{exact:true}).fill('2026-09-30');await page.getByRole('button',{name:'完成',exact:true}).click();
  await expect(page.locator('.records-toolbar')).toContainText('09/30');await page.getByRole('button',{name:/09\/30/}).first().click();await expect(page.getByLabel('历史日期',{exact:true})).toHaveValue('2026-09-30');
});
test('date choices toggle on repeat clicks and keyboard activation',async({page})=>{
  await page.clock.setFixedTime(new Date('2026-10-15T02:00:00Z'));await fixture(page);await page.getByRole('button',{name:'全部日期',exact:true}).click();const today=page.getByRole('dialog').locator('[aria-current=date]');await today.click();await expect(today).toHaveAttribute('aria-pressed','true');await today.press('Enter');await expect(today).toHaveAttribute('aria-pressed','false');
});
for(const day of ['2026-10-15','2026-10-16','2026-12-31'])test(`nearby date choices stay within the booking window on ${day}`,async({page})=>{
  await page.clock.setFixedTime(new Date(day+'T02:00:00Z'));await fixture(page);await page.getByRole('button',{name:'全部日期',exact:true}).click();
  const options=page.getByRole('dialog').locator('.record-options button');const labels=await options.allTextContents();
  expect(labels.length).toBeLessThanOrEqual(4);expect(labels.every(label=>!/[六日]/.test(label))).toBe(true);await expect(page.getByLabel('历史日期',{exact:true})).toHaveAttribute('max',day);
});
for(const width of [320,390,768,1440,2864])test(`staff shell aligns navigation and content at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});await fixture(page);const main=await page.locator('.workspace-page:visible').boundingBox();expect(main.x).toBeGreaterThanOrEqual(0);expect(main.x+main.width).toBeLessThanOrEqual(width+1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
