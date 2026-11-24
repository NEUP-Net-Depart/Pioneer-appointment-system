import { test, expect } from './support/fixtures.mjs';
import { chooseTime, fillDevice, goReview, sign, submitStudent } from './support/student.mjs';

test('an issued private link works on another browser and stays out of the request URL', async ({
  page,
  browser,
  baseURL
}) => {
  await page.goto('/');
  await chooseTime(page);
  await fillDevice(page);
  await goReview(page);
  await submitStudent(page);
  const { id, accessToken } = await page.evaluate(
    () => JSON.parse(localStorage.pioneerAppointmentAccess)[0]
  );

  const visitor = await browser.newContext({ baseURL });
  try {
    const tab = await visitor.newPage();
    const auth = tab.waitForRequest(
      (request) => new URL(request.url()).pathname === '/api/appointments/' + id
    );
    const fragment = new URLSearchParams({ appointment: id, access: accessToken });
    await tab.goto('/#' + fragment);
    const request = await auth;
    expect(new URL(request.url()).search).toBe('');
    expect(request.headers()['x-appointment-token']).toBe(accessToken);
    await expect(tab).toHaveURL(new URL('/#detail=' + id, baseURL).href);
    await expect(tab.locator('#detail-status')).toHaveText('已预约');
    await tab.reload();
    await expect(tab.locator('#detail-status')).toHaveText('已预约');
    expect(await tab.evaluate(() => JSON.parse(localStorage.pioneerAppointmentAccess))).toEqual([
      { id, accessToken }
    ]);
  } finally {
    await visitor.close();
  }
});

test('reload resolves a persisted attempt after a committed response and the first resolver response are lost', async ({
  page
}) => {
  await page.goto('/');
  await chooseTime(page);
  await fillDevice(page);
  await goReview(page);
  const creates = [],
    resolutions = [];
  await page.route('**/api/appointments', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    creates.push(route.request().headers()['idempotency-key']);
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    await route.abort('failed');
  });
  await page.route('**/api/booking-attempts/resolve', async (route) => {
    resolutions.push(route.request().postDataJSON().requestKey);
    if (resolutions.length === 1) await route.abort('failed');
    else await route.continue();
  });
  await page.locator('[name=agreement]').check();
  await sign(page);
  await page.locator('#booking-submit').click();
  await expect(page.locator('#booking-error')).toContainText('暂时无法确认预约是否创建');
  const pending = await page.evaluate(() =>
    JSON.parse(sessionStorage.pioneerStudentBookingAttempt)
  );
  expect(pending).toEqual({ key: creates[0], pending: true });
  await page.reload();
  await expect(page.locator('#success-panel')).toBeVisible();
  expect(creates).toEqual([pending.key]);
  expect(resolutions).toEqual([pending.key, pending.key]);
  expect(
    await page.evaluate(() => sessionStorage.getItem('pioneerStudentBookingAttempt'))
  ).toBeNull();
  await page.locator('#success-panel [data-view-link=lookup]').click();
  await expect(page.locator('.student-record')).toHaveCount(1);
});
