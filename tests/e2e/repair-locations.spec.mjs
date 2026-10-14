import { test, expect } from '@playwright/test';
import { bookingDates } from '../../shared/booking-slots.js';
import { TIME_SLOTS } from '../../shared/constants.js';

const firstSlot = TIME_SLOTS[0];
const formRow = (page, campus = '南湖') => page.locator(`[data-location-campus="${campus}"]`);
const items = (location = '南湖主楼 101 室') => [
  { campus: '南湖', location, revision: 1 },
  { campus: '浑南', location: '浑南教学楼 201 室', revision: 1 }
];

async function mockAvailability(page) {
  await page.clock.install({ time: new Date('2026-10-12T12:00:00+08:00') });
  await page.route('**/api/live/summary?*', route => route.fulfill({ json: {
    slots: Object.fromEntries(TIME_SLOTS.map(slot => [slot, 0])),
    slotCapacities: Object.fromEntries(TIME_SLOTS.map(slot => [slot, 10]))
  } }));
}

test('superadmin saves locations, preserves drafts, rejects stale writes and updates an existing booking', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, extraHTTPHeaders: { 'CF-Connecting-IP': '198.51.100.71' } });
  const root = await context.newPage(), student = await context.newPage();
  const errors = [];
  for (const page of [root, student]) page.on('pageerror', error => errors.push(error.message));
  let headers;
  try {
    await root.goto('/staff/');
    await root.locator('#login-id').fill('root001');
    await root.locator('#login-password').fill(process.env.E2E_ROOT_PASSWORD);
    await root.locator('#login-form button').click();
    await expect(root.locator('#app-shell')).toBeVisible();
    headers = { Authorization: `Bearer ${await root.evaluate(() => sessionStorage.getItem('pioneerToken'))}` };
    await root.getByRole('button', { name: '个人设置', exact: true }).click();
    await expect(root.locator('.repair-location-form')).toHaveCount(2);
    const row = formRow(root), input = row.locator('input');
    await input.fill('南湖主楼 101 室');
    await row.getByRole('button', { name: '保存地点' }).click();
    await expect(row.locator('p')).toHaveText('已保存');
    const date = bookingDates()[0];
    const response = await context.request.post('/api/appointments', { data: {
      studentId: '20269715', name: '地点同步测试', campus: '南湖', social: 'test-contact',
      deviceType: '笔记本电脑', brand: '测试', deviceModel: '测试型号', warranty: '否', faultType: '蓝屏', issue: '故障说明',
      date, timeSlot: firstSlot, agreementAt: new Date().toISOString(), agreementVersion: 'v1.1',
      signature: [Array.from({ length: 8 }, (_, index) => [0.1 + index * 0.08, 0.2 + index % 2 * 0.08])]
    } });
    expect(response.status()).toBe(201);
    const appointment = await response.json();
    await student.goto(`/#appointment=${appointment.id}&access=${appointment.accessToken}`);
    await expect(student.locator('.lookup-arrival strong')).toHaveText('南湖主楼 101 室');

    await input.fill('尚未保存的地点');
    const current = (await (await context.request.get('/api/repair-locations')).json()).items.find(item => item.campus === '南湖');
    expect((await context.request.patch('/api/repair-locations', { headers, data: { ...current, location: '南湖主楼 202 室' } })).status()).toBe(200);
    await root.getByRole('button', { name: '维修后台', exact: true }).click();
    await root.getByRole('button', { name: '个人设置', exact: true }).click();
    await expect(input).toHaveValue('尚未保存的地点');
    await row.getByRole('button', { name: '保存地点' }).click();
    await expect(row.locator('p')).toContainText('已被更新');
    await expect(input).toHaveValue('尚未保存的地点');
    await root.locator('#reload-repair-locations').click();
    await expect(input).toHaveValue('南湖主楼 202 室');
    await student.locator('#refresh-my-appointments').click();
    await expect(student.locator('.lookup-arrival strong')).toHaveText('南湖主楼 202 室');
    await expect(student.locator('#lookup-results')).toContainText(appointment.id);
    await expect(student.locator('#lookup-results')).toContainText(firstSlot);
    for (const width of [320, 1440]) {
      await root.setViewportSize({ width, height: 1000 });
      await root.locator('#repair-location-settings').scrollIntoViewIfNeeded();
      expect(await root.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await root.screenshot({ path: `output/playwright/repair-location-settings-${width}.png`, fullPage: true });
      await student.setViewportSize({ width, height: 1000 });
      expect(await student.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const card = await student.locator('.appointment-card').boundingBox();
      const copy = await student.locator('.lookup-arrival [data-copy-repair-location]').boundingBox();
      expect(copy.x + copy.width).toBeLessThanOrEqual(card.x + card.width - 12);
      const upload = await student.locator('.attachment-upload button').boundingBox();
      expect(upload.x + upload.width).toBeLessThanOrEqual(card.x + card.width - 12);
      await student.screenshot({ path: `output/playwright/repair-location-lookup-${width}.png`, fullPage: true });
    }
    await input.fill('');
    await row.getByRole('button', { name: '保存地点' }).click();
    await expect(row.locator('p')).toHaveText('已保存');
    await student.locator('#refresh-my-appointments').click();
    await expect(student.locator('.lookup-arrival strong')).toHaveText('地点待确认，请联系工作人员');
    await root.reload();
    await root.getByRole('button', { name: '个人设置', exact: true }).click();
    await expect(formRow(root).locator('input')).toHaveValue('');
    expect(errors).toEqual([]);
  } finally {
    if (headers) {
      const data = await (await context.request.get('/api/repair-locations')).json();
      for (const item of data.items) if (item.location) await context.request.patch('/api/repair-locations', { headers, data: { ...item, location: '' } });
    }
    await context.close();
  }
});

test('location reads stay independent of instant choices, retain cached data and recover from failures', async ({ page }) => {
  await mockAvailability(page);
  let fail = true, block = false, release, changed = false, reads = 0;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/repair-locations', async route => {
    reads++;
    if (block) await gate;
    await route.fulfill(fail ? { status: 503, json: { error: '读取失败' } } : { json: { items: items(changed ? '南湖新地点 303 室' : undefined) } });
  });
  await page.goto('/');
  await expect(page.locator('#booking-repair-location')).toHaveText('地点暂时无法读取，请重试');
  fail = false;
  await page.locator('.booking-arrival [data-repair-retry]').click();
  await expect(page.locator('#booking-repair-location')).toHaveText('南湖主楼 101 室');
  block = true;
  await page.locator('[data-campus="浑南"]').click();
  await expect(page.locator('#booking-repair-location')).toHaveText('浑南教学楼 201 室');
  await page.locator('[data-date="2026-10-12"]').click();
  await page.locator(`[data-slot="${firstSlot}"]`).click();
  await expect(page.locator('[name=timeSlot]')).toHaveValue(firstSlot);
  await page.locator('[data-campus="南湖"]').click();
  await expect(page.locator('#booking-repair-location')).toHaveText('南湖主楼 101 室');
  changed = true; release(); block = false;
  await expect(page.locator('#booking-repair-location')).toHaveText('南湖新地点 303 室');
  fail = true;
  await page.locator('[name=campus]').selectOption('浑南');
  await expect(page.locator('.booking-arrival [data-location-state]')).toBeVisible();
  await expect(page.locator('#booking-repair-location')).toHaveText('浑南教学楼 201 室');
  fail = false;
  await page.locator('.booking-arrival [data-repair-retry]').click();
  await expect(page.locator('.booking-arrival [data-location-state]')).toBeHidden();
  expect(reads).toBe(5);
});

for (const width of [320, 390, 1440]) {
  test(`plain-text addresses and copy controls fit ${width}px without executing markup`, async ({ page, context }) => {
    await mockAvailability(page);
    const address = '<img src=x onerror=alert(1)> 南湖教学楼 · ' + '很长的维修地点说明'.repeat(15);
    await page.route('**/api/repair-locations', route => route.fulfill({ json: { items: items(address) } }));
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await expect(page.locator('#booking-repair-location')).toHaveText(address);
    await expect(page.locator('#booking-repair-location img')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const picker = await page.locator('#booking-picker').boundingBox();
    const copy = await page.locator('#booking-copy-location').boundingBox();
    expect(copy.x + copy.width).toBeLessThanOrEqual(picker.x + picker.width - 12);
    await page.locator('#booking-copy-location').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);
    await page.screenshot({ path: `output/playwright/repair-location-booking-${width}.png`, fullPage: true });
  });
}
