import { test, expect } from './support/fixtures.mjs';
import { chooseTime, fillDevice, goReview, sign } from './support/student.mjs';

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
