import { test, expect } from '@playwright/test';

const firstSlot = '19:00–20:00', secondSlot = '20:00–21:00';
const day = page => page.locator('[data-date="2026-10-12"]');
const slot = (page, value = firstSlot) => page.locator(`[data-slot="${value}"]`);
function summary(campus, date) {
  return {
    date, slotCapacities: { [firstSlot]: campus === '浑南' ? 5 : 10, [secondSlot]: 10 },
    slots: { [firstSlot]: date === '2026-10-12' ? 2 : 0, [secondSlot]: 0 }
  };
}
async function setup(page, instant = '2026-10-12T12:00:00+08:00', handler) {
  await page.clock.install({ time: new Date(instant) });
  await page.route('**/api/live/summary?*', async route => {
    const query = new URL(route.request().url()).searchParams;
    if (handler) return handler(route, query);
    await route.fulfill({ json: summary(query.get('campus'), query.get('date')) });
  });
  await page.goto('/');
}

test('dates show availability immediately, campus controls sync, and selections keep the original payload', async ({ page }) => {
  await setup(page);
  await expect(page.locator('#booking-days button')).toHaveCount(4);
  await expect(day(page)).toContainText('周一 · 10/12');
  await expect(day(page)).toContainText('剩余 18 名');
  await expect(page.locator('[data-date="2026-10-13"]')).toContainText('剩余 20 名');
  await expect(page.locator('[name=campus]')).toHaveValue('南湖');
  await expect(page.locator('#booking-slot-panel')).toBeHidden();
  await expect(page.locator('input[type=date], select[name=timeSlot]')).toHaveCount(0);
  await page.locator('#booking-form [type=submit]').click();
  await expect(page.locator('#booking-selection')).toContainText('请先');
  await expect(day(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(slot(page)).toContainText('剩余 8 名');
  await slot(page).click();
  await expect(page.locator('#booking-selection')).toContainText('已选：南湖 · 周一 · 10/12 · 19:00–20:00');
  await page.locator('[data-campus="浑南"]').click();
  await expect(page.locator('[name=campus]')).toHaveValue('浑南');
  await expect(page.locator('[name=timeSlot]')).toHaveValue('');
  await expect(day(page)).toContainText('剩余 13 名');
  await expect(slot(page)).toContainText('剩余 3 名');
  await page.locator('[name=campus]').selectOption('南湖');
  await expect(page.locator('[data-campus="南湖"]')).toHaveAttribute('aria-pressed', 'true');
  await slot(page, secondSlot).click();
  await expect(page.locator('[name=timeSlot]')).toHaveValue(secondSlot);
  await page.locator('[data-date="2026-10-13"]').click();
  await expect(page.locator('[name=timeSlot]')).toHaveValue('');
  await slot(page).click();
  await expect(page.locator('[name=timeSlot]')).toHaveValue(firstSlot);
  const data = await page.locator('#booking-form').evaluate(form => Object.fromEntries(new FormData(form)));
  expect({ campus: data.campus, date: data.date, timeSlot: data.timeSlot }).toEqual({ campus: '南湖', date: '2026-10-13', timeSlot: firstSlot });
  await page.screenshot({ path: 'output/playwright/booking-picker-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(slot(page)).toBeVisible();
  await page.screenshot({ path: 'output/playwright/booking-picker-mobile.png', fullPage: true });
});

test('failed reads can be retried and choosing dates invalidates full or paused selections', async ({ page }) => {
  let failed = true, capacity = 10;
  await setup(page, undefined, async (route, query) => {
    if (failed) return route.fulfill({ status: 503, json: { error: '暂不可用' } });
    const data = summary(query.get('campus'), query.get('date'));
    data.slotCapacities[firstSlot] = capacity;
    await route.fulfill({ json: data });
  });
  await expect(day(page)).toContainText('读取失败');
  await expect(day(page)).toBeDisabled();
  await expect(page.locator('#booking-retry')).toBeVisible();
  failed = false;
  await page.locator('#booking-retry').click();
  await day(page).click(); await slot(page).click();
  await expect(page.locator('[name=timeSlot]')).toHaveValue(firstSlot);
  capacity = 2;
  await day(page).click();
  await expect(slot(page)).toContainText('预约已满');
  await expect(slot(page)).toBeDisabled();
  await expect(page.locator('[name=timeSlot]')).toHaveValue('');
  await expect(page.locator('#booking-selection')).toContainText('重新选择');
  capacity = 0;
  await day(page).click();
  await expect(slot(page)).toContainText('暂停预约');
  await slot(page, secondSlot).click();
  await expect(page.locator('[name=timeSlot]')).toHaveValue(secondSlot);
  failed = true;
  await day(page).click();
  await expect(page.locator('#booking-retry')).toBeVisible();
  await expect(page.locator('[name=timeSlot]')).toHaveValue('');
  await expect(slot(page, secondSlot)).toBeDisabled();
});

test('expired times and dates outside the service window stay hidden across the deadline and weekend', async ({ page }) => {
  await setup(page, '2026-10-15T20:59:45+08:00');
  await expect(page.locator('#booking-days button')).toHaveCount(1);
  await page.locator('[data-date="2026-10-15"]').click();
  await expect(slot(page)).toBeHidden();
  await slot(page, secondSlot).click();
  await expect(page.locator('[name=timeSlot]')).toHaveValue(secondSlot);
  await expect(page.locator('[data-date="2026-10-15"]')).toContainText('剩余 10 名');
  await page.clock.fastForward(30000);
  await page.locator('[data-campus="南湖"]').click();
  await expect(page.locator('#booking-empty')).toBeVisible();
  await expect(page.locator('#booking-days button')).toHaveCount(0);
  await expect(page.locator('[name=date]')).toHaveValue('');
  await expect(page.locator('[name=timeSlot]')).toHaveValue('');
  await page.clock.setSystemTime(new Date('2026-10-16T12:00:00+08:00'));
  await page.locator('[data-campus="南湖"]').click();
  await expect(page.locator('#booking-days button')).toHaveCount(1);
  await expect(page.locator('[data-date="2026-10-19"]')).toContainText('周一 · 10/19');
});

test('a delayed response for the previous campus cannot replace current availability', async ({ page }) => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await setup(page, undefined, async (route, query) => {
    if (query.get('campus') === '南湖') await pending;
    await route.fulfill({ json: summary(query.get('campus'), query.get('date')) });
  });
  await page.locator('[data-campus="浑南"]').click();
  await expect(day(page)).toContainText('剩余 13 名');
  const previousResponses = [];
  page.on('response', response => {
    if (response.url().includes('/api/live/summary?') && new URL(response.url()).searchParams.get('campus') === '南湖') previousResponses.push(response.finished());
  });
  const lastResponse = page.waitForResponse(response => response.url().includes('date=2026-10-15') && response.url().includes('campus=%E5%8D%97%E6%B9%96'));
  release(); await lastResponse; await Promise.all(previousResponses);
  await expect(day(page)).toContainText('剩余 13 名');
  await day(page).click(); await slot(page).click();
  await expect(slot(page)).toContainText('剩余 3 名');
  await expect(page.locator('[name=campus]')).toHaveValue('浑南');
});

test('switching campuses displays cached counts until fresh availability arrives', async ({ page }) => {
  let release, gate = Promise.resolve(), changed = false, changedDate = false;
  await setup(page, undefined, async (route, query) => {
    await gate;
    const data = summary(query.get('campus'), query.get('date'));
    if (changed && query.get('campus') === '南湖' && (query.get('date') === '2026-10-12' || changedDate)) data.slots[firstSlot] = 10;
    await route.fulfill({ json: data });
  });
  await day(page).click();
  await slot(page).click();
  await expect(page.locator('[name=timeSlot]')).toHaveValue(firstSlot);
  await page.locator('[data-campus="浑南"]').click();
  await expect(day(page)).toBeEnabled();
  await expect(day(page)).toContainText('剩余 13 名');
  gate = new Promise(resolve => { release = resolve; });
  await page.locator('[data-campus="南湖"]').click();
  await expect(page.locator('#booking-picker')).toHaveAttribute('aria-busy', 'true');
  await expect(day(page)).toContainText('剩余 18 名');
  await expect(slot(page)).toContainText('剩余 8 名');
  await expect(day(page).locator('.booking-count-reel')).toHaveCount(0);
  await expect(day(page)).toBeDisabled();
  await expect(slot(page)).toBeDisabled();
  await page.locator('#booking-form [type=submit]').click();
  await expect(page.locator('#booking-selection')).toContainText('等待名额确认');
  release();
  await expect(day(page)).toBeEnabled();
  await expect(day(page).locator('.booking-count-reel')).toHaveCount(0);
  changed = true;
  await page.locator('[data-campus="浑南"]').click();
  await expect(day(page)).toBeEnabled();
  gate = new Promise(resolve => { release = resolve; });
  await page.locator('[name=campus]').selectOption('南湖');
  await expect(day(page)).toContainText('剩余 18 名');
  await expect(slot(page)).toContainText('剩余 8 名');
  release();
  await expect(day(page)).toContainText('剩余 10 名');
  await expect(day(page).locator('.booking-count-reel')).toHaveCount(1);
  await expect(slot(page)).toContainText('预约已满');
  await expect(slot(page)).toBeDisabled();
  await expect(page.locator('[name=timeSlot]')).toHaveValue('');
  changedDate = true;
  gate = new Promise(resolve => { release = resolve; });
  await page.locator('[data-date="2026-10-13"]').click();
  await expect(slot(page)).toContainText('剩余 10 名');
  await expect(slot(page).locator('.booking-count-reel')).toHaveCount(0);
  release();
  await expect(slot(page)).toContainText('预约已满');
});

test('availability polls every 30 seconds, keeps unchanged digits still, and pauses in hidden tabs', async ({ page }) => {
  const requests = [];
  let changed = false;
  await setup(page, undefined, async (route, query) => {
    requests.push({ campus: query.get('campus'), date: query.get('date') });
    const data = summary(query.get('campus'), query.get('date'));
    if (changed) data.slots[firstSlot] += 2;
    await route.fulfill({ json: data });
  });
  await expect(day(page)).toBeEnabled();
  expect(requests).toHaveLength(4);
  const originalReel = await day(page).locator('.booking-count-reel').elementHandle();
  await page.clock.fastForward(29000);
  expect(requests).toHaveLength(4);
  await page.clock.fastForward(1000);
  await expect.poll(() => requests.length).toBe(8);
  await expect(day(page)).toBeEnabled();
  expect(await day(page).locator('.booking-count-reel').evaluate((element, original) => element === original, originalReel)).toBe(true);
  changed = true;
  await page.clock.fastForward(30000);
  await expect(day(page)).toContainText('剩余 16 名');
  expect(requests).toHaveLength(12);
  expect(await day(page).locator('.booking-count-reel').evaluate((element, original) => element === original, originalReel)).toBe(false);
  await expect(day(page).locator('.booking-count-value')).toHaveText('16');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(60000);
  expect(requests).toHaveLength(12);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => requests.length).toBe(16);
  await expect(day(page)).toBeEnabled();
  await day(page).click();
  await expect(slot(page)).toBeEnabled();
  expect(requests).toHaveLength(17);
  await slot(page).click();
  await expect(page.locator('[name=timeSlot]')).toHaveValue(firstSlot);
  expect(requests).toHaveLength(18);
  await page.locator('[data-campus="浑南"]').click();
  await expect(day(page)).toBeEnabled();
  expect(requests).toHaveLength(22);
  expect(requests.slice(-4).every(request => request.campus === '浑南')).toBe(true);
});

test('loading starts at zero, counts roll in place and refreshes preserve selection', async ({ page }) => {
  let release;
  let gate = new Promise(resolve => { release = resolve; });
  let largeCounts = false;
  await setup(page, undefined, async (route, query) => {
    await gate;
    const data = summary(query.get('campus'), query.get('date'));
    if (largeCounts) data.slotCapacities = { [firstSlot]: 1000, [secondSlot]: 1000 };
    await route.fulfill({ json: data });
  });
  const count = day(page).locator('.booking-remaining');
  await expect(count).toHaveText('剩余 0 名');
  const placeholderBox = await count.boundingBox();
  release();
  await expect(day(page)).toBeEnabled();
  await expect(count.locator('.booking-count-value')).toHaveText('18');
  await expect(count.locator('.booking-count-reel')).toHaveAttribute('aria-hidden', 'true');
  await expect(count.locator('.booking-count-column')).toHaveCount(2);
  expect((await count.boundingBox()).width).toBe(placeholderBox.width);
  await day(page).click();
  await slot(page).click();
  await expect(page.locator('[name=timeSlot]')).toHaveValue(firstSlot);
  const countNode = await count.elementHandle();
  const previousText = await page.locator('#booking-updated').textContent();
  const previousSlotBox = await slot(page).locator('.booking-remaining').boundingBox();
  gate = new Promise(resolve => { release = resolve; });
  largeCounts = true;
  await slot(page).click();
  await expect(page.locator('#booking-picker')).toHaveAttribute('aria-busy', 'true');
  await expect(day(page)).toContainText('剩余 18 名');
  await expect(slot(page)).toContainText('剩余 8 名');
  await expect(slot(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#booking-updated')).toHaveText(previousText);
  expect(await slot(page).evaluate(button => getComputedStyle(button).opacity)).toBe('1');
  expect(await count.evaluate((element, original) => element === original, countNode)).toBe(true);
  release();
  await expect(day(page)).toContainText('剩余 1998 名');
  await expect(slot(page)).toContainText('剩余 998 名');
  expect((await count.boundingBox()).width).toBe(placeholderBox.width);
  expect((await slot(page).locator('.booking-remaining').boundingBox()).width).toBe(previousSlotBox.width);
  await expect(page.locator('[name=timeSlot]')).toHaveValue(firstSlot);
  gate = new Promise(resolve => { release = resolve; });
  await page.locator('[data-campus="浑南"]').click();
  await expect(count).toHaveText('剩余 0 名');
  await expect(slot(page).locator('.booking-remaining')).toHaveText('剩余 0 名');
  expect((await count.boundingBox()).width).toBe(placeholderBox.width);
  release();
  await expect(day(page)).toBeEnabled();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  largeCounts = false;
  await page.locator('[data-campus="浑南"]').click();
  await expect(day(page)).toContainText('剩余 13 名');
  await expect(count.locator('.booking-count-column')).toHaveCount(0);
});

test('full days are disabled and a slot that fills during confirmation never becomes selected', async ({ page }) => {
  let filled = false;
  await setup(page, undefined, async (route, query) => {
    const date = query.get('date'), data = summary(query.get('campus'), date);
    if (date === '2026-10-12') data.slots = { [firstSlot]: 10, [secondSlot]: 10 };
    if (date === '2026-10-15') data.slotCapacities = { [firstSlot]: 0, [secondSlot]: 0 };
    if (filled && date === '2026-10-13') data.slots[firstSlot] = 10;
    await route.fulfill({ json: data });
  });
  await expect(day(page)).toContainText('预约已满');
  await expect(day(page)).toBeDisabled();
  await expect(page.locator('[data-date="2026-10-15"]')).toContainText('暂停预约');
  await expect(page.locator('[data-date="2026-10-15"]')).toBeDisabled();
  await page.locator('[data-date="2026-10-13"]').click();
  await expect(slot(page)).toBeEnabled();
  filled = true;
  await slot(page).click();
  await expect(slot(page)).toBeDisabled();
  await expect(page.locator('[name=timeSlot]')).toHaveValue('');
  await expect(slot(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#booking-selection')).toContainText('预约已满');
});

for (const count of [1, 2, 3, 4]) {
  test(`${count} available days fill the narrow layout without scrolling on campus or date choices`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await setup(page, `2026-10-${16 - count}T12:00:00+08:00`);
    await expect(page.locator('#booking-days button')).toHaveCount(count);
    await expect(page.locator('#booking-days button').first()).toBeEnabled();
    const initialScroll = await page.evaluate(() => scrollY);
    await page.locator('[data-campus="浑南"]').click();
    await expect(page.locator('#booking-days button').first()).toBeEnabled();
    expect(await page.evaluate(() => scrollY)).toBe(initialScroll);
    await page.locator('#booking-days button').first().click();
    await expect(page.locator('#booking-slots button').first()).toBeEnabled();
    const geometry = await page.locator('#booking-picker').evaluate(element => {
      const rect = element.getBoundingClientRect();
      const days = [...document.querySelectorAll('#booking-days button')].map(button => button.getBoundingClientRect().top);
      return { scroll: scrollY, height: rect.height, screen: innerHeight, rows: new Set(days).size, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(geometry.scroll).toBe(initialScroll);
    expect(geometry.height).toBeLessThanOrEqual(geometry.screen);
    const silhouettes = await page.locator('#booking-days button').evaluateAll(buttons => buttons.map(button => getComputedStyle(button).clipPath));
    expect(silhouettes.every(shape => count === 1 ? shape === 'none' : shape.startsWith('polygon('))).toBe(true);
    expect(geometry.overflow).toBe(false);
  });
}

test('four future slots retain the horizontal row style within a phone screen', async ({ page }) => {
  const futureSlots = ['19:00–19:30', '19:30–20:00', '20:00–20:30', '20:30–21:00'];
  await page.route('**/shared/constants.js', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/export const TIME_SLOTS = .*?;/, `export const TIME_SLOTS = ${JSON.stringify(futureSlots)};`);
    await route.fulfill({ response, body });
  });
  await page.setViewportSize({ width: 375, height: 667 });
  await setup(page, undefined, async (route, query) => {
    await route.fulfill({ json: { date: query.get('date'),
      slotCapacities: Object.fromEntries(futureSlots.map(slot => [slot, 10])),
      slots: Object.fromEntries(futureSlots.map(slot => [slot, 0]))
    } });
  });
  await day(page).click();
  await expect(page.locator('#booking-slots button')).toHaveCount(4);
  await expect(page.locator('#booking-slots button').first()).toBeEnabled();
  const geometry = await page.locator('#booking-picker').evaluate(element => ({
    height: element.getBoundingClientRect().height, screen: innerHeight,
    rows: new Set([...document.querySelectorAll('#booking-slots button')].map(button => button.getBoundingClientRect().top)).size,
    overflow: document.documentElement.scrollWidth > innerWidth
  }));
  expect(geometry.height).toBeLessThanOrEqual(geometry.screen);
  expect(geometry.rows).toBe(4);
  expect(geometry.overflow).toBe(false);
  await page.locator('#booking-slots button').last().click();
  await expect(page.locator('[name=timeSlot]')).toHaveValue(futureSlots[3]);
  await page.screenshot({ path: 'output/playwright/future-four-slots-mobile.png' });
});

for (const reason of ['该校区该时段已满', '该校区该时段暂停预约']) {
  test(`submission rejection (${reason}) clears the slot but preserves fields and handwriting for resubmission`, async ({ page }) => {
    let rejected = false;
    const payloads = [];
    await setup(page, undefined, async (route, query) => {
      const data = summary(query.get('campus'), query.get('date'));
      if (rejected) {
        if (reason.includes('已满')) data.slots[firstSlot] = 10;
        else data.slotCapacities[firstSlot] = 0;
      }
      await route.fulfill({ json: data });
    });
    await page.route('**/api/appointments', async route => {
      const payload = route.request().postDataJSON(); payloads.push(payload);
      if (!rejected) {
        rejected = true;
        return route.fulfill({ status: 409, json: { error: reason } });
      }
      await route.fulfill({ status: 201, json: { ...payload, id: 'reserve020261012-99', accessToken: 'a'.repeat(43) } });
    });
    await day(page).click(); await slot(page).click();
    await expect(page.locator('[name=timeSlot]')).toHaveValue(firstSlot);
    for (const [name, value] of Object.entries({ studentId: '20269987', name: '名额冲突测试', social: 'test-contact', brand: '联想', deviceModel: 'ThinkPad', issue: '测试故障说明' })) {
      await page.locator(`[name="${name}"]`).fill(value);
    }
    for (const [name, value] of Object.entries({ deviceType: '笔记本电脑', warranty: '否', faultType: '蓝屏' })) {
      await page.locator(`[name="${name}"]`).selectOption(value);
    }
    await page.locator('.check-box').click();
    const box = await page.locator('#signature-canvas').boundingBox();
    await page.mouse.move(box.x + 30, box.y + 30); await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + 80, { steps: 15 });
    await page.mouse.move(box.x + 70, box.y + 110, { steps: 15 }); await page.mouse.up();
    await page.locator('#confirm-signature').click();
    await page.locator('#booking-form [type=submit]').click();
    await expect(page.locator('#booking-selection')).toContainText(reason);
    await expect(page.locator('#success-panel')).toBeHidden();
    await expect(page.locator('[name=timeSlot]')).toHaveValue('');
    await expect(slot(page)).toBeDisabled();
    await expect(page.locator('[name=name]')).toHaveValue('名额冲突测试');
    await expect(page.locator('[name=issue]')).toHaveValue('测试故障说明');
    await expect(page.locator('[name=agreement]')).toBeChecked();
    await expect(page.locator('#signature-status')).toContainText('已完成手写签名');
    await slot(page, secondSlot).click();
    await expect(page.locator('[name=timeSlot]')).toHaveValue(secondSlot);
    await page.locator('#booking-form [type=submit]').click();
    await expect(page.locator('#success-panel')).toBeVisible();
    expect(payloads).toHaveLength(2);
    expect(payloads[1].signature).toEqual(payloads[0].signature);
    expect(payloads[1].timeSlot).toBe(secondSlot);
  });
}
