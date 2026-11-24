import { test, expect } from './support/fixtures.mjs';
import { chooseTime, fillDevice, goReview, sign, submitStudent } from './support/student.mjs';

test('a previously issued private link opens the same appointment in a fresh browser', async ({
  page,
  browser,
  baseURL
}) => {
  await page.goto('/');
  await chooseTime(page);
  await fillDevice(page);
  await goReview(page);
  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/appointments' &&
      response.request().method() === 'POST' &&
      response.ok()
  );
  await submitStudent(page);
  const { id, accessToken } = await (await created).json();

  const visitor = await browser.newContext({ baseURL });
  try {
    const tab = await visitor.newPage();
    const auth = tab.waitForRequest(
      (request) => new URL(request.url()).pathname === '/api/appointments/' + id
    );
    const fragment = new URLSearchParams({ appointment: id, access: accessToken });
    await tab.goto('/#' + fragment);
    const request = await auth;
    expect(request.url()).not.toContain(accessToken);
    expect(request.headers()['x-appointment-token']).toBe(accessToken);
    const status = tab.getByText('已预约', { exact: true }).filter({ visible: true });
    await expect(tab.getByText(id, { exact: true })).toBeVisible();
    expect(tab.url()).not.toContain(accessToken);
    await expect(status).toBeVisible();
    await tab.reload();
    await expect(tab.getByText(id, { exact: true })).toBeVisible();
    await expect(status).toBeVisible();
  } finally {
    await visitor.close();
  }
});

test('reloading after a disconnected submission recovers the original appointment', async ({
  page,
  context
}) => {
  await page.goto('/');
  await chooseTime(page);
  await fillDevice(page);
  await goReview(page);
  const createdIds = new Set();
  await page.route('**/api/appointments', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    const first = createdIds.size === 0;
    const { id } = await response.json();
    createdIds.add(id);
    if (first) {
      await context.setOffline(true);
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  try {
    await page.getByRole('checkbox', { name: /我已阅读并同意/ }).check();
    await sign(page);
    await page.getByRole('button', { name: '确认并提交预约' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: '暂时无法确认预约是否创建' })
    ).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
  const [originalId] = createdIds;
  expect(originalId).toBeTruthy();
  await page.reload();
  const success = page.getByRole('region', { name: '预约成功' });
  await expect(success.getByText(originalId, { exact: true })).toBeVisible();
  await success.getByRole('button', { name: '我的预约', exact: true }).click();
  const appointment = page.getByRole('button', { name: /笔记本 · 联想/ });
  await expect(appointment).toHaveCount(1);
  await appointment.click();
  await expect(page.getByText(originalId, { exact: true }).filter({ visible: true })).toHaveCount(
    1
  );
  expect([...createdIds]).toEqual([originalId]);
});
