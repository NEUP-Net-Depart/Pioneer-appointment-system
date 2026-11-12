import { test, expect } from './support/fixtures.mjs';
import { loginStaff, staffPage, onsiteOrder, staffApi } from './support/staff.mjs';
import { PHOTO } from './support/student.mjs';

async function orderWithPhotos(page, { received = false } = {}) {
  await loginStaff(page, '20261003');
  await staffPage(page, '今日工作');
  const order = await onsiteOrder(page);
  if (received) await staffApi(page, `/api/appointments/${order.id}/receive`, {
    revision: 0, requestId: crypto.randomUUID(), photosCaptured: true, uploadTimedOut: true
  });
  await page.getByRole('button', { name: '刷新工作台', exact: true }).click();
  await page.getByRole('button').filter({ hasText: order.id }).first().click();
  const dialog = page.getByRole('dialog', { name: '维修工单', exact: true });
  for (const side of ['正面', '背面']) {
    const input = dialog.getByLabel(`设备${side}照片`, { exact: true });
    // setInputFiles can target disabled inputs while saved photos are being checked.
    await expect(input).toBeEnabled();
    await input.setInputFiles({ name: `${side}.png`, mimeType: 'image/png', buffer: PHOTO });
  }
  return { order, dialog };
}

for (const skip of [false, true]) test(`slow binary photos survive 30 seconds ${skip ? 'and attach after skipping and closing the modal' : 'while the user keeps waiting'}`, async ({ page, context }) => {
  const { order, dialog } = await orderWithPhotos(page);
  const requests = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const endpoint = `/api/appointments/${order.id}/attachments`;
  await page.route(`**${endpoint}`, async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    requests.push(route.request());
    await gate;
    await route.continue();
  });
  await dialog.getByRole('button', { name: '接收并开始维修', exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  for (const request of requests) {
    expect(request.headers()['content-type']).toMatch(/^image\//);
  }
  await expect(dialog.getByRole('progressbar')).toHaveCount(2);
  const skipButton = dialog.getByRole('button', { name: '跳过等待，继续当前操作', exact: true });
  await expect(skipButton).toHaveCount(0);
  await context.clock.fastForward(30001);
  await expect(skipButton).toBeEnabled();
  for (const bar of await dialog.getByRole('progressbar').all())
    expect(Number(await bar.getAttribute('value'))).toBeLessThan(100);
  if (skip) {
    await skipButton.click();
    await expect(dialog.getByRole('button', { name: '结束本次服务', exact: true })).toBeVisible();
    // Advance the order while uploads are pending, then close its modal.
    await dialog.getByLabel('已解决', { exact: true }).check();
    await dialog.getByLabel('简短处理说明').fill('照片上传期间完成维修');
    await dialog.getByRole('button', { name: '结束本次服务', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '保存结果更正', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  await context.clock.fastForward(5000);
  release();
  await expect.poll(async () => {
    const detail = await staffApi(page, `/api/field/appointments/${order.id}`, null, 'GET');
    return !!detail.frontPhotoId && !!detail.backPhotoId && !detail.photoDeferredBy;
  }).toBe(true);
  const detail = await staffApi(page, `/api/field/appointments/${order.id}`, null, 'GET');
  expect(detail.status).toBe(skip ? 'completed' : 'in_progress');
  const attachments = await staffApi(page, endpoint, null, 'GET');
  expect(attachments.items).toHaveLength(2);
  // Verify persisted files without coupling the test to a particular encoder.
  const token = await page.evaluate(() => sessionStorage.getItem('pioneerToken'));
  for (const attachment of attachments.items) {
    const response = await page.request.get(`${endpoint}/${attachment.id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toBe(attachment.mimeType);
    expect((await response.body()).length).toBe(attachment.size);
  }
  expect(requests).toHaveLength(2);
});

test('a failed side shows the real error and retry reuses the successful photo', async ({ page }) => {
  const { order, dialog } = await orderWithPhotos(page);
  const purposes = [];
  let failBack = true;
  await page.route(`**/api/appointments/${order.id}/attachments`, async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    const purpose = route.request().headers()['x-attachment-purpose'];
    purposes.push(purpose);
    if (purpose === 'intake_back' && failBack) {
      failBack = false;
      await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: '上传过于频繁，请稍后重试' }) });
    } else await route.continue();
  });
  const start = dialog.getByRole('button', { name: '接收并开始维修', exact: true });
  await start.click();
  await expect(dialog.getByText(/背面：上传过于频繁/)).toBeVisible();
  await expect(start).toBeEnabled();
  await start.click();
  await expect(dialog.getByRole('button', { name: '结束本次服务', exact: true })).toBeVisible();
  expect(purposes.filter(value => value === 'intake_front')).toHaveLength(1);
  expect(purposes.filter(value => value === 'intake_back')).toHaveLength(2);
  const attachments = await staffApi(page, `/api/appointments/${order.id}/attachments`, null, 'GET');
  expect(attachments.items).toHaveLength(2);
});

test('manual supplementation also releases the modal after 30 seconds without cancelling photos', async ({ page, context }) => {
  const { order, dialog } = await orderWithPhotos(page, { received: true });
  let release, count = 0;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(`**/api/appointments/${order.id}/attachments`, async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    count++;
    await gate;
    await route.continue();
  });
  await dialog.getByRole('button', { name: '重试补传照片', exact: true }).click();
  await expect.poll(() => count).toBe(2);
  await context.clock.fastForward(30001);
  await dialog.getByRole('button', { name: '跳过等待，继续当前操作', exact: true }).click();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toBeHidden();
  release();
  await expect.poll(async () => {
    const detail = await staffApi(page, `/api/field/appointments/${order.id}`, null, 'GET');
    return !!detail.frontPhotoId && !!detail.backPhotoId && !detail.photoDeferredBy;
  }).toBe(true);
  expect(count).toBe(2);
});
