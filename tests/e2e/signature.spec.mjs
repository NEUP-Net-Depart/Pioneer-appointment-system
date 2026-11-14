import { test, expect } from './support/fixtures.mjs';
import { chooseTime, fillDevice, goReview } from './support/student.mjs';
import { loginStaff, staffPage, staffApi } from './support/staff.mjs';

async function ink(canvas) {
  return canvas.evaluate((element) => {
    const { width, height } = element;
    const data = element.getContext('2d').getImageData(0, 0, width, height).data;
    let left = width,
      right = -1,
      top = height,
      bottom = -1,
      count = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (!data[(y * width + x) * 4 + 3]) continue;
        count++;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    return { count, ratio: count ? (right - left + 1) / (bottom - top + 1) : 0 };
  });
}

async function draw(page, canvas, browserName, hasTouch) {
  await canvas.scrollIntoViewIfNeeded();
  const b = await canvas.boundingBox(),
    length = Math.min(b.width, b.height) * 0.35;
  const start = { x: b.x + b.width * 0.2, y: b.y + b.height * 0.2 };
  const points = [start];
  for (let i = 1; i <= 12; i++) points.push({ x: start.x + (length * i) / 12, y: start.y });
  for (let i = 1; i <= 12; i++)
    points.push({ x: start.x + length, y: start.y + (length * i) / 12 });
  if (hasTouch && browserName === 'chromium') {
    // Native Chromium touch input exercises scrolling prevention and event delivery.
    const session = await page.context().newCDPSession(page);
    try {
      for (let i = 0; i < points.length; i++)
        await session.send('Input.dispatchTouchEvent', {
          type: i ? 'touchMove' : 'touchStart',
          touchPoints: [{ ...points[i], id: 1 }]
        });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await session.detach();
    }
  } else if (hasTouch) {
    // Playwright's WebKit API only exposes taps; replay a standard touch gesture.
    await canvas.evaluate((element, points) => {
      function send(type, point, ended = false) {
        const touch = {
          identifier: 7,
          target: element,
          clientX: point.x,
          clientY: point.y,
          force: 0.5
        };
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.assign(event, {
          touches: ended ? [] : [touch],
          targetTouches: ended ? [] : [touch],
          changedTouches: [touch]
        });
        element.dispatchEvent(event);
      }
      points.forEach((point, i) => send(i ? 'touchmove' : 'touchstart', point));
      send('touchend', points[points.length - 1], true);
    }, points);
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (const point of points.slice(1)) await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  }
  await expect.poll(async () => (await ink(canvas)).count).toBeGreaterThan(10);
}

test('signature keeps its proportions through rotation, confirmation and cancelled replacement', async ({
  page,
  browserName
}, info) => {
  const hasTouch = !!info.project.use.hasTouch;
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await chooseTime(page);
  await fillDevice(page);
  await goReview(page);
  await page.locator('#open-signature').click();
  const canvas = page.locator('#signature-canvas');
  await draw(page, canvas, browserName, hasTouch);
  const original = await ink(canvas);
  await page.setViewportSize({ width: 812, height: 450 });
  await expect
    .poll(async () => Math.abs((await ink(canvas)).ratio - original.ratio))
    .toBeLessThan(0.15);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(async () => Math.abs((await ink(canvas)).ratio - original.ratio))
    .toBeLessThan(0.15);
  await page.locator('#confirm-signature').click();
  const preview = page.locator('#confirmed-signature');
  await expect(preview).toBeVisible();
  expect(Math.abs((await ink(preview)).ratio - original.ratio)).toBeLessThan(0.15);
  const confirmed = await preview.evaluate((c) => c.toDataURL());
  await page.locator('#open-signature').click();
  await draw(page, canvas, browserName, hasTouch);
  await page.locator('#undo-signature').click();
  expect((await ink(canvas)).count).toBe(0);
  await page.locator('#confirm-signature').click();
  await expect(page.locator('#signature-error')).toContainText('请完整手写本人姓名');
  await page.locator('#cancel-signature').click();
  expect(await preview.evaluate((c) => c.toDataURL())).toBe(confirmed);
  await page.locator('[name=agreement]').check();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/appointments') && r.request().method() === 'POST'
  );
  await page.locator('#booking-submit').click();
  expect((await response).ok()).toBeTruthy();
  await expect(page.locator('#success-panel')).toBeVisible();
});

test('onsite signature survives an accidental tap and returning to edit, then persists and renders', async ({
  page,
  browserName
}, info) => {
  const hasTouch = !!info.project.use.hasTouch;
  await loginStaff(page);
  await staffPage(page, '今日工作');
  await page.getByRole('button', { name: '现场登记', exact: true }).click();
  const registration = page.getByRole('dialog', { name: '临时维修登记', exact: true });
  for (const [label, value] of [
    ['姓名', '签名回归同学'],
    ['学号', '20269996'],
    ['QQ / 微信', '123456789'],
    ['设备厂商', '联想']
  ]) {
    await registration.getByRole('textbox', { name: label, exact: true }).fill(value);
  }
  await registration.getByRole('button', { name: '下一步：机主确认' }).click();
  const canvas = registration.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  if (hasTouch) {
    const b = await canvas.boundingBox();
    await page.touchscreen.tap(b.x + 10, b.y + 10);
  } else await canvas.click({ position: { x: 10, y: 10 } });
  await draw(page, canvas, browserName, hasTouch);
  const before = await ink(canvas);
  await registration.getByRole('button', { name: '返回修改', exact: true }).click();
  await registration.getByRole('button', { name: '下一步：机主确认' }).click();
  await expect.poll(async () => (await ink(canvas)).count).toBeGreaterThan(10);
  expect(Math.abs((await ink(canvas)).ratio - before.ratio)).toBeLessThan(0.1);
  await registration.getByRole('checkbox').check();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/scan/onsite') && r.request().method() === 'POST'
  );
  await registration.getByRole('button', { name: '确认登记', exact: true }).click();
  const result = await response;
  expect(result.ok()).toBeTruthy();
  const created = await result.json();
  const detail = await staffApi(page, '/api/field/appointments/' + created.id, null, 'GET');
  const stored = JSON.parse(detail.original.signature);
  expect(stored.version).toBe(2);
  expect(stored.strokes).toHaveLength(2);
  await page.getByRole('button', { name: '查看原始登记与协议', exact: true }).click();
  await expect
    .poll(async () => (await ink(page.locator('.repair-signature'))).count)
    .toBeGreaterThan(10);
});
