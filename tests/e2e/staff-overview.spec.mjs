import { test, expect } from '@playwright/test';

const dates = ['2026-10-12','2026-10-13','2026-10-14','2026-10-15'];
const slots = ['19:00–20:00','20:00–21:00'];
async function loginMock(page, campuses=['南湖','浑南']) {
  await page.route('**/api/auth/login', route => route.fulfill({ json:{token:'test-only',account:'test-admin',role:'admin',authorizedCampuses:campuses} }));
  await page.route('**/api/appointments/overview', route => route.fulfill({ json:{dates,campuses,updatedAt:'2026-10-12T08:00:00Z',items:campuses.flatMap(campus => dates.flatMap(date => slots.map((timeSlot,index) => ({campus,date,timeSlot,capacity:10,occupied:index ? 10:4,remaining:index ? 0:6,booked:index ? 8:2,inProgress:2,ended:false}))))} }));
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

for (const width of [320,390,768,1440]) {
  test(`overview and unified filters fit ${width}px and drill down into the right campus/date/slot`, async ({page}) => {
    await page.setViewportSize({width,height:1000});
    await loginMock(page);
    await expect(page.locator('#staff-overview-campuses')).toContainText('剩余 6 名');
    await expect(page.locator('#staff-overview-campuses')).toContainText('名额已满');
    await page.locator('[data-overview-date="2026-10-14"]').click();
    const request=page.waitForRequest(request => request.url().includes('/api/appointments?') && new URL(request.url()).searchParams.get('date')==='2026-10-14');
    await page.locator('[data-overview-campus="浑南"][data-overview-slot="20:00–21:00"]').click();
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

test('a single authorized campus and failed overview refresh keep the last visible data', async ({page}) => {
  await loginMock(page,['南湖']);
  await expect(page.locator('#staff-campus-filter option').filter({hasText:'浑南'})).toHaveJSProperty('hidden',true);
  await page.route('**/api/appointments/overview', route => route.fulfill({status:503,json:{error:'unavailable'}}));
  await page.locator('#staff-refresh').click();
  await expect(page.locator('#staff-overview-state')).toContainText('保留上次数据');
  await expect(page.locator('.staff-campus-panel')).toHaveCount(1);
});

test('column filters compose, stay visible in the headers and fit a narrow screen', async ({page}) => {
  await page.setViewportSize({width:320,height:700});
  await loginMock(page);
  await page.locator('[data-column-menu=campus]').click();
  await page.locator('#staff-campus-filter').selectOption('南湖');
  await page.locator('#staff-menu-campus [data-menu-close]').last().click();
  await expect(page.locator('[data-column-summary=campus]')).toHaveText('南湖');
  await page.locator('[data-column-menu=date]').click();
  await page.locator('#staff-date-manual').fill('2026-10-13');
  await page.locator('#staff-date-manual').press('Enter');
  await page.locator('#staff-slot-filter').selectOption(slots[1]);
  await expect(page.locator('[data-column-summary=date]')).toContainText('10/13');
  const box=await page.locator('#staff-menu-date').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(320);expect(box.y+box.height).toBeLessThanOrEqual(700);
  await page.screenshot({path:'output/playwright/staff-column-menu-320.png',style:'#toast { display: none !important; }'});
  await page.locator('#staff-clear-date').click();
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

test('desktop uses available width and offers a centered calendar with direct and keyboard selection', async ({page}) => {
  await page.setViewportSize({width:1920,height:1080});await loginMock(page);
  const shell=await page.locator('.staff-shell').boundingBox();expect(shell.width).toBeGreaterThan(1800);
  await page.locator('[data-column-menu=date]').click();
  const box=await page.locator('#staff-menu-date').boundingBox();expect(box.width).toBeGreaterThan(700);
  expect(Math.abs(box.x+box.width/2-960)).toBeLessThan(10);expect(Math.abs(box.y+box.height/2-540)).toBeLessThan(1);
  await page.locator('#staff-calendar-year').selectOption('2026');await page.locator('#staff-calendar-month').selectOption('10');
  await page.locator('[data-calendar-date="2026-10-13"]').click();
  await expect(page.locator('#staff-date-filter')).toHaveValue('2026-10-13');
  await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  await expect(page.locator('#staff-date-filter')).toHaveValue('2026-10-14');
  await page.locator('#staff-calendar-next').click();await expect(page.locator('#staff-calendar-month')).toHaveValue('11');
  await page.locator('#staff-calendar-prev').click();await expect(page.locator('#staff-calendar-month')).toHaveValue('10');
  await page.locator('#staff-date-manual').fill('2026-02-30');await page.locator('#staff-date-manual').press('Enter');
  await expect(page.locator('#staff-date-manual')).toHaveAttribute('aria-invalid','true');await expect(page.locator('#staff-date-filter')).toHaveValue('2026-10-14');
  await page.locator('#staff-date-manual').fill('2026/10/15');await page.locator('#staff-date-manual').press('Enter');
  await expect(page.locator('[data-column-summary=date]')).toContainText('2026/10/15');
  await page.screenshot({path:'output/playwright/staff-calendar-1920.png'});
  await page.locator('#staff-menu-date [data-menu-close]').last().click();
  await page.screenshot({path:'output/playwright/staff-workbench-1920.png',fullPage:true});
});
