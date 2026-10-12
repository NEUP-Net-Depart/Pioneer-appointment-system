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

for (const width of [320,1440]) {
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
    await page.locator('[data-filter=completed]').click();
    await expect(page.locator('#staff-empty')).toBeVisible();
    await page.locator('#staff-sort').selectOption('campus');
    await page.locator('#staff-direction').selectOption('desc');
    await page.locator('#staff-clear-filters').click();
    await expect(page.locator('#staff-slot-filter')).toHaveValue('');
    await expect(page.locator('#staff-sort')).toHaveValue('date');
    await expect(page.locator('[data-filter=all]')).toHaveAttribute('aria-pressed','true');
    for(const selector of ['.staff-overview','.staff-query-grid','.staff-query-bottom']) {
      const box=await page.locator(selector).boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
    }
    await page.locator('#staff-overview-title').scrollIntoViewIfNeeded();
    await page.screenshot({path:`output/playwright/staff-overview-${width}.png`,fullPage:true,style:'#toast { visibility: hidden; }'});
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
