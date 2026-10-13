import { test, expect } from '@playwright/test';

const dates = ['2026-10-12','2026-10-13','2026-10-14','2026-10-15'];
const slots = ['19:00–20:00','20:00–21:00'];
async function loginMock(page, campuses=['南湖','浑南']) {
  await page.route('**/api/auth/login', route => route.fulfill({ json:{token:'test-only',account:'test-admin',role:'admin',authorizedCampuses:campuses} }));
  const items=campuses.flatMap(campus => dates.flatMap(date => slots.map((timeSlot,index) => ({campus,date,timeSlot,capacity:10,occupied:index ? 10:4,remaining:index ? 0:6,booked:index ? 8:2,inProgress:2,ended:false}))));
  await page.route('**/api/appointments/overview', route => route.fulfill({ json:{dates,campuses,updatedAt:'2026-10-12T08:00:00Z',items,week:{start:'2026-10-12',end:'2026-10-18',dates,items}} }));
  await page.route('**/api/appointments?*', route => {
    const params=new URL(route.request().url()).searchParams;
    return route.fulfill({json:{items:params.get('status')==='completed' ? []:[{id:'reserve020261012-01',name:'测试同学',studentId:'20260001',date:params.get('date') || dates[0],campus:params.get('campus')==='浑南' ? '浑南':'南湖',timeSlot:params.get('timeSlot') || slots[0],status:'booked',deviceType:'笔记本电脑',brand:'联想',deviceModel:'ThinkPad',faultType:'蓝屏'}],counts:{all:12,booked:8,in_progress:2,completed:2},filteredCounts:{all:2,booked:1,in_progress:0,completed:1}}});
  });
  await page.goto('/staff/');
  await page.locator('#login-id').fill('test-admin');
  await page.locator('#login-password').fill('test-only');
  await page.locator('#login-form button').click();
  await expect(page.locator('.staff-campus-panel')).toHaveCount(campuses.length);
}

test('staff search and details retain historical booking and repair identifiers', async ({ page }) => {
  await loginMock(page);
  const item = {id:'reverse020261012-07',repairNumber:'020261015-03',name:'历史预约同学',studentId:'20260007',
    campus:'南湖',date:dates[0],timeSlot:slots[0],status:'completed',outcome:'repaired',
    deviceType:'笔记本电脑',brand:'联想',deviceModel:'ThinkPad',repairNote:'旧维修说明',assignedTo:'test-admin'};
  await page.route('**/api/appointments?*', route=>{
    const q = new URL(route.request().url()).searchParams.get('q');
    return route.fulfill({json:{items:q===item.id || q===item.repairNumber ? [item]:[],counts:{all:1,completed:1},filteredCounts:{all:1,completed:1}}});
  });
  await page.route(`**/api/appointments/${item.id}/attachments`, route=>route.fulfill({json:{items:[]}}));
  for (const number of [item.id,item.repairNumber]) {
    await page.locator('#staff-search').fill(number);
    await expect(page.locator('#appointments-table')).toContainText(item.id);
    await expect(page.locator('#appointments-table')).toContainText(`历史维修编号：${item.repairNumber}`);
    await page.locator(`[data-detail="${item.id}"]`).click();
    await expect(page.locator('#detail-summary')).toContainText(`预约编号 ${item.id}`);
    await expect(page.locator('#detail-summary')).toContainText(`历史维修编号：${item.repairNumber}`);
    await page.locator('#close-detail').click();
  }
});

for (const width of [320,390,768,1440]) {
  test(`overview and unified filters fit ${width}px and drill down into the right campus/date/slot`, async ({page}) => {
    await page.setViewportSize({width,height:1000});
    await loginMock(page);
    await expect(page.locator('#staff-overview-campuses')).toContainText('剩余 6 名');
    await expect(page.locator('#staff-overview-campuses')).toContainText('名额已满');
    await page.locator('[data-overview-date="2026-10-14"]').click();
    const request=page.waitForRequest(request => request.url().includes('/api/appointments?') && new URL(request.url()).searchParams.get('date')==='2026-10-14');
    await page.locator('.staff-slot-main[data-overview-campus="浑南"][data-overview-slot="20:00–21:00"]').click();
    const query=new URL((await request).url()).searchParams;
    expect(query.get('campus')).toBe('浑南');expect(query.get('timeSlot')).toBe(slots[1]);
    await expect(page.locator('#staff-campus-filter')).toHaveValue('浑南');
    await expect(page.locator('#staff-date-filter')).toHaveValue('2026-10-14');
    await expect(page.locator('#staff-slot-filter')).toHaveValue(slots[1]);
    await expect(page.locator('#count-all')).toHaveText('2');
    await expect(page.locator('#metric-total')).toHaveText('12');
    await page.locator('[data-column-menu=status]').click();
    await page.locator('[data-filter=completed]').click();
    await expect(page.locator('#staff-empty')).toBeVisible();
    await page.locator('#staff-menu-status [data-menu-close]').last().click();
    await page.locator('[data-column-menu=campus]').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-column-menu=campus]')).toBeFocused();
    const sortRequest=page.waitForRequest(request => request.url().includes('/api/appointments?') && new URL(request.url()).searchParams.get('sorts')==='campus:desc');
    await page.locator('[data-column-sort=campus]').click();
    await page.locator('[data-column-sort=campus]').click();
    await sortRequest;
    await expect(page.locator('th[data-sort-column=campus]')).toHaveAttribute('aria-sort','descending');
    await page.locator('#staff-clear-filters').click();
    await expect(page.locator('#staff-slot-filter')).toHaveValue('');
    await expect(page.locator('#staff-sort-summary')).toContainText('点击列名');
    await expect(page.locator('[data-filter=all]')).toHaveAttribute('aria-pressed','true');
    for(const selector of ['.staff-overview','.staff-record-tools','.staff-appointments-wrap']) {
      const box=await page.locator(selector).boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
    }
    await expect(page.locator('.staff-appointments-wrap table')).toHaveCSS('display','table');
    await expect(page.locator('.staff-appointments-wrap thead')).toHaveCSS('display','table-header-group');
    await expect(page.locator('.staff-appointments-wrap tbody tr')).toHaveCSS('display','table-row');
    const header=await page.locator('th[data-sort-column=date]').boundingBox(), cell=await page.locator('#appointments-table tr:first-child td:nth-child(2)').boundingBox();
    expect(Math.abs(header.x-cell.x)).toBeLessThan(1);
    if(width<1100) {
      const original=await page.locator('#appointments-table tr:first-child td:first-child').boundingBox();
      await page.locator('.staff-appointments-wrap').evaluate(element => {element.scrollLeft=450;});
      const pinned=await page.locator('#appointments-table tr:first-child td:first-child').boundingBox();
      expect(Math.abs(original.x-pinned.x)).toBeLessThan(1);
      await page.locator('.staff-appointments-wrap').evaluate(element => {element.scrollLeft=0;});
    }
    await page.locator('#staff-overview-title').scrollIntoViewIfNeeded();
    await page.screenshot({path:`output/playwright/staff-overview-${width}.png`,fullPage:true,style:'#toast { display: none !important; }'});
  });
}

for(const width of [320,1440]) {
  test(`this week overview aggregates and drills down without losing the range at ${width}px`, async ({page})=>{
    await page.setViewportSize({width,height:900});await loginMock(page);
    await page.locator('[data-overview-date=week]').click();
    await expect(page.locator('[data-overview-date=week]')).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('#staff-overview-state')).toContainText('本周 10/12–10/18');
    await expect(page.locator('.staff-campus-panel').first()).toContainText('待处理 56 人');
    await expect(page.locator('.staff-campus-panel').first()).toContainText('剩余可约 24 名');
    if(width===320) {
      const rows=await page.locator('#staff-overview-dates button').evaluateAll(buttons=>buttons.map(button=>button.getBoundingClientRect().y));
      expect(new Set(rows).size).toBe(1);
      await page.screenshot({path:'output/playwright/staff-overview-week-320.png',fullPage:true,style:'#toast { display: none !important; }'});
    }
    const request=page.waitForRequest(r=>{
      const q=new URL(r.url()).searchParams;
      return r.url().includes('/api/appointments?') && q.get('campus')==='浑南' && q.get('status')==='in_progress' && q.get('timeSlot')===slots[0];
    });
    await page.locator(`[data-overview-campus="浑南"][data-overview-slot="${slots[0]}"][data-overview-status=in_progress]`).click();
    const q=new URL((await request).url()).searchParams;
    expect(q.get('date')).toBe('');expect(q.get('dateFrom')).toBe('2026-10-12');expect(q.get('dateTo')).toBe('2026-10-18');
    await expect(page.locator('[data-column-summary=date]')).toContainText('本周 10/12–10/18');
    await page.locator('[data-column-menu=date]').click();await page.locator('[data-nearby-date]').first().click();
    await expect(page.locator('#staff-date-filter')).toHaveAttribute('data-from','');
    await page.locator('#staff-menu-date [data-menu-close]').last().click();
    await page.locator('[data-overview-date=week]').click();await page.locator('#staff-clear-filters').click();
    await expect(page.locator('[data-column-summary=date]')).toHaveText('全部日期与时段');
  });
}

test('a single authorized campus and failed overview refresh keep the last visible data', async ({page}) => {
  await loginMock(page,['南湖']);
  await expect(page.locator('#staff-campus-filter option').filter({hasText:'浑南'})).toHaveJSProperty('hidden',true);
  await page.route('**/api/appointments/overview', route => route.fulfill({status:503,json:{error:'unavailable'}}));
  await page.locator('#staff-refresh').click();
  await expect(page.locator('#staff-overview-state')).toContainText('保留上次数据');
  await expect(page.locator('.staff-campus-panel')).toHaveCount(1);
});

test('column filters compose, stay visible in the headers and fit a narrow screen', async ({page}) => {
  await page.clock.install({time:new Date('2026-10-12T04:00:00Z')});
  await page.setViewportSize({width:320,height:700});
  await loginMock(page);
  await page.locator('[data-column-menu=campus]').click();
  await page.locator('#staff-campus-filter').selectOption('南湖');
  await page.locator('#staff-menu-campus [data-menu-close]').last().click();
  await expect(page.locator('[data-column-summary=campus]')).toHaveText('南湖');
  await page.locator('[data-column-menu=date]').click();
  await page.locator('[data-nearby-date="2026-10-13"]').click();
  await page.locator('#staff-slot-filter').selectOption(slots[1]);
  await expect(page.locator('[data-column-summary=date]')).toContainText('10/13');
  const box=await page.locator('#staff-menu-date').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(320);expect(box.y+box.height).toBeLessThanOrEqual(700);
  await page.screenshot({path:'output/playwright/staff-column-menu-320.png',style:'#toast { display: none !important; }'});
  await page.locator('[data-nearby-date="2026-10-13"]').click();
  await expect(page.locator('#staff-date-filter')).toHaveValue('');
  await expect(page.locator('#staff-slot-filter')).toHaveValue(slots[1]);
  await page.keyboard.press('Escape');
  await expect(page.locator('#staff-menu-date')).toBeHidden();
  await expect(page.locator('#staff-menu-shade')).toBeHidden();
});

test('column clicks cycle independently and preserve multi-sort priority', async ({page}) => {
  await loginMock(page);
  const choose=async(key,sorts)=>{
    const request=page.waitForRequest(r=>r.url().includes('/api/appointments?') && new URL(r.url()).searchParams.get('sorts')===sorts);
    await page.locator(`[data-column-sort=${key}]`).click();await request;
  };
  await choose('campus','campus:asc');
  await choose('date','campus:asc,date:asc');
  await choose('campus','campus:desc,date:asc');
  await expect(page.locator('[data-sort-marker=date]')).toHaveText('↑2');
  await choose('campus','date:asc');
  await expect(page.locator('[data-sort-marker=date]')).toHaveText('↑1');
  await choose('date','date:desc');await choose('date','');
  await expect(page.locator('[data-sort-marker=date]')).toBeHidden();
  await page.locator('th[data-sort-column=date]').click({position:{x:3,y:3}});
  await expect(page.locator('[data-sort-marker=date]')).toHaveText('↑1');
  const heading=await page.locator('th[data-sort-column=date]').boundingBox(), summary=await page.locator('[data-column-summary=date]').boundingBox();
  await page.locator('th[data-sort-column=date]').click({position:{x:summary.x-heading.x+5,y:summary.y-heading.y+5}});
  await expect(page.locator('[data-sort-marker=date]')).toHaveText('↓1');
  await page.locator('[data-column-menu=date]').click();
  await expect(page.locator('#staff-menu-date')).toBeVisible();
  await expect(page.locator('[data-sort-marker=date]')).toHaveText('↓1');
  await page.keyboard.press('Escape');
  await page.locator('[data-column-sort=date]').focus();await page.keyboard.press('Enter');
  await expect(page.locator('[data-sort-marker=date]')).toBeHidden();
});

test('compact date filter focuses today and preserves a collapsed historical filter', async ({page}) => {
  await page.clock.install({time:new Date('2026-10-12T04:00:00Z')});await loginMock(page);
  await page.locator('[data-column-menu=date]').click();
  await expect(page.locator('[data-nearby-date="2026-10-12"]')).toBeFocused();
  await expect(page.locator('#staff-date-filter')).toHaveValue('');
  await expect(page.locator('#staff-date-history')).not.toHaveAttribute('open','');
  await page.locator('#staff-date-history summary').click();
  await page.locator('#staff-date-manual').fill('2026-09-10');await page.locator('#staff-date-manual').press('Enter');
  await expect(page.locator('#staff-date-filter')).toHaveValue('2026-09-10');
  await page.locator('#staff-menu-date [data-menu-close]').last().click();await page.locator('[data-column-menu=date]').click();
  await expect(page.locator('[data-nearby-date="2026-10-12"]')).toBeFocused();
  await expect(page.locator('#staff-date-history')).not.toHaveAttribute('open','');
  await expect(page.locator('#staff-date-filter')).toHaveValue('2026-09-10');
  await expect(page.locator('#staff-calendar-selection')).toHaveText('已选 2026 / 09 / 10');
});

test('date filter toggles on repeat clicks and keyboard activation while preserving other filters', async ({page}) => {
  await page.clock.install({time:new Date('2026-10-12T04:00:00Z')});
  await loginMock(page);
  await page.locator('[data-column-menu=date]').click();
  await page.locator('#staff-slot-filter').selectOption(slots[1]);
  const day=page.locator('[data-nearby-date="2026-10-13"]');
  await day.click();await expect(page.locator('#staff-date-filter')).toHaveValue('2026-10-13');
  await expect(day).toHaveAttribute('aria-pressed','true');
  for(const activate of [()=>day.click(),()=>day.press('Enter'),()=>day.press('Space')]) {
    const request=page.waitForRequest(r=>r.url().includes('/api/appointments?') && new URL(r.url()).searchParams.get('date')==='');
    await activate();await request;
    await expect(page.locator('#staff-date-filter')).toHaveValue('');
    await expect(day).toHaveAttribute('aria-pressed','false');await expect(day).toBeFocused();
    await expect(page.locator('#staff-calendar-selection')).toHaveText('全部日期');
    await expect(page.locator('#staff-slot-filter')).toHaveValue(slots[1]);
    await day.click();
  }
  await page.locator('[data-nearby-date="2026-10-14"]').click();
  await expect(page.locator('#staff-date-filter')).toHaveValue('2026-10-14');
  await expect(day).toHaveAttribute('aria-pressed','false');
});

test('nearby date choices stay within the booking window across weekdays and year end', async ({page}) => {
  await page.clock.install({time:new Date('2026-10-12T04:00:00Z')});
  await page.setViewportSize({width:320,height:700});await loginMock(page);
  for(const [today,expected] of [
    ['2026-10-12',['2026-10-12','2026-10-13','2026-10-14','2026-10-15']],
    ['2026-10-13',['2026-10-13','2026-10-14','2026-10-15']],
    ['2026-10-14',['2026-10-14','2026-10-15']],
    ['2026-10-15',['2026-10-15']],
    ['2026-10-16',['2026-10-19']],
    ['2026-10-17',['2026-10-19','2026-10-20']],
    ['2026-10-18',['2026-10-19','2026-10-20','2026-10-21']],
    ['2027-01-02',['2027-01-04','2027-01-05']]
  ]) {
    await page.clock.setSystemTime(new Date(`${today}T04:00:00Z`));
    await page.locator('[data-column-menu=date]').click();
    expect(await page.locator('[data-nearby-date]').evaluateAll(buttons=>buttons.map(button=>button.dataset.nearbyDate))).toEqual(expected);
    const panel=await page.locator('#staff-menu-date').boundingBox();
    expect(panel.x).toBeGreaterThanOrEqual(0);expect(panel.x+panel.width).toBeLessThanOrEqual(320);expect(panel.height).toBeLessThan(450);
    if(today==='2026-10-12')await page.screenshot({path:'output/playwright/staff-date-compact-320.png'});
    await page.locator('#staff-menu-date [data-menu-close]').last().click();
  }
});

test('compact date panel centers on desktop and supports recent and historical selection', async ({page}) => {
  await page.clock.install({time:new Date('2026-10-12T04:00:00Z')});
  await page.setViewportSize({width:1920,height:1080});await loginMock(page);
  await page.locator('[data-column-menu=date]').click();
  const box=await page.locator('#staff-menu-date').boundingBox();expect(box.width).toBeGreaterThan(400);expect(box.width).toBeLessThan(500);expect(box.height).toBeLessThan(450);
  expect(Math.abs(box.x+box.width/2-960)).toBeLessThan(10);expect(Math.abs(box.y+box.height/2-540)).toBeLessThan(1);
  await page.locator('[data-nearby-date="2026-10-13"]').click();await expect(page.locator('#staff-date-filter')).toHaveValue('2026-10-13');
  await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await expect(page.locator('#staff-date-filter')).toHaveValue('2026-10-14');
  await page.screenshot({path:'output/playwright/staff-date-compact-1920.png'});
  await page.locator('#staff-date-history summary').click();
  for(const invalid of ['2026-02-30','2026-11-15']){
    await page.locator('#staff-date-manual').fill(invalid);await page.locator('#staff-date-manual').press('Enter');
    await expect(page.locator('#staff-date-manual')).toHaveAttribute('aria-invalid','true');await expect(page.locator('#staff-date-filter')).toHaveValue('2026-10-14');
  }
  await page.locator('#staff-date-manual').fill('2026/09/15');await page.locator('#staff-date-manual').press('Enter');
  await expect(page.locator('[data-column-summary=date]')).toContainText('2026/09/15');
});

for (const width of [320,1440]) {
  test(`overview campus and status actions compose exact filters at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:1000});await loginMock(page);
    await page.locator('[data-column-sort=campus]').click();
    async function select(selector,{campus,date,timeSlot,status}) {
      const request=page.waitForRequest(r=>{
        if(!r.url().includes('/api/appointments?'))return false;
        const q=new URL(r.url()).searchParams;
        return q.get('campus')===campus && q.get('date')===date && q.get('timeSlot')===timeSlot && q.get('status')===status;
      });
      await page.locator(selector).click();
      const q=new URL((await request).url()).searchParams;expect(q.get('sorts')).toBe('campus:asc');
      await expect(page.locator('#staff-campus-filter')).toHaveValue(campus);
      await expect(page.locator('#staff-date-filter')).toHaveValue(date);
      await expect(page.locator('#staff-slot-filter')).toHaveValue(timeSlot);
      await expect(page.locator(`[data-filter=${status}]`)).toHaveAttribute('aria-pressed','true');
    }
    await select('[data-overview-date="2026-10-14"]',{campus:'all',date:dates[2],timeSlot:'',status:'all'});
    await select('.staff-slot-main[data-overview-campus="浑南"][data-overview-slot="19:00–20:00"]',{campus:'浑南',date:dates[2],timeSlot:slots[0],status:'all'});
    await select('[data-overview-campus="浑南"][data-overview-slot="19:00–20:00"][data-overview-status=in_progress]',{campus:'浑南',date:dates[2],timeSlot:slots[0],status:'in_progress'});
    await expect(page.locator('[data-column-summary=status]')).toHaveText('维修中');
    await select('[data-overview-campus="浑南"][data-overview-slot="19:00–20:00"][data-overview-status=booked]',{campus:'浑南',date:dates[2],timeSlot:slots[0],status:'booked'});
    await select('.staff-campus-link[data-overview-campus="南湖"]',{campus:'南湖',date:dates[2],timeSlot:'',status:'all'});
    await select('[data-overview-campus="浑南"][data-overview-status=pending]',{campus:'浑南',date:dates[2],timeSlot:'',status:'pending'});
    await expect(page.locator('[data-column-summary=status]')).toHaveText('待处理（待签到与维修中）');
    await expect(page.locator('#count-pending')).toHaveText('1');
    const statusButton=page.locator('[data-overview-campus="南湖"][data-overview-slot="20:00–21:00"][data-overview-status=in_progress]');
    await statusButton.focus();await page.keyboard.press('Enter');
    await expect(page.locator('#staff-campus-filter')).toHaveValue('南湖');
    await expect(page.locator('#staff-slot-filter')).toHaveValue(slots[1]);
    await expect(page.locator('[data-filter=in_progress]')).toHaveAttribute('aria-pressed','true');
    expect(await page.locator('#staff-overview-campuses button button').count()).toBe(0);
  });
}

test('top bars align brand and navigation to opposite edges at desktop widths and fit smaller screens', async ({page}) => {
  await page.route('**/api/auth/me',route=>route.fulfill({json:{account:'test-admin',role:'admin',authorizedCampuses:['南湖','浑南']}}));
  await loginMock(page);
  for(const width of [320,390,768,1024,1440,1920]) {
    await page.setViewportSize({width,height:1000});
    for(const path of ['/staff/','/']) {
      await page.goto(path);
      const header=page.locator('.topbar-inner');
      await expect(header).toBeVisible();
      expect(await header.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
      const brand=await header.locator('.brand').boundingBox(),nav=await header.locator('.main-nav').boundingBox();
      if(width>=1440) {
        expect(brand.x).toBeLessThanOrEqual(101);
        if(path==='/')expect(nav.x+nav.width).toBeGreaterThan(width-125);
        else {
          const account=await header.locator('.account-area').boundingBox();
          expect(account.x+account.width).toBeGreaterThan(width-125);
          expect(account.x-nav.x-nav.width).toBeLessThanOrEqual(25);
          expect(nav.x-brand.x-brand.width).toBeGreaterThan(100);
        }
      }
      if(width===1920)await page.screenshot({path:`output/playwright/topbar-${path==='/'?'user':'staff'}-1920.png`});
    }
  }
});

test('staff top section shares column edges and spacing from narrow screens to ultrawide', async ({page}) => {
  await loginMock(page);
  for(const width of [320,390,768,1440,1920,2864]) {
    await page.setViewportSize({width,height:1000});
    await page.locator('.topbar').scrollIntoViewIfNeeded();
    const title=await page.locator('#staff-view .staff-intro').boundingBox(),metrics=await page.locator('.staff-shell .metrics-row').boundingBox(),overview=await page.locator('.staff-overview').boundingBox();
    expect(Math.abs(title.x-metrics.x)).toBeLessThan(1);expect(Math.abs(metrics.x-overview.x)).toBeLessThan(1);
    expect(Math.abs(title.width-metrics.width)).toBeLessThan(1);
    const brand=await page.locator('.topbar .brand').boundingBox();
    if(width>760)expect(Math.abs(brand.x-title.x)).toBeLessThan(1);
    const button=await page.locator('#export-csv').boundingBox();
    expect(Math.abs(button.x+button.width-title.x-title.width)).toBeLessThan(1);
    await expect(page.locator('#staff-view .staff-intro')).toHaveCSS('background-image','none');
    if([390,1920,2864].includes(width))await page.screenshot({path:`output/playwright/staff-top-${width}.png`,animations:'disabled',style:'#toast { display: none !important; }'});
  }
});
