import { present } from '../helpers/present.ts';
import type { ItemsResponse } from '../../shared/api-types.ts';
import type { AttachmentDto } from '../../shared/appointment-types.ts';
import type { FieldOrder } from './support/staff.ts';
import { runWorkflow } from '../fixtures/workflow-seed.ts';
import { test, expect } from './support/fixtures.ts';
import { loginStaff, staffPage, onsiteOrder, staffApi, chooseOption } from './support/staff.ts';
import { PHOTO, chooseTime } from './support/student.ts';
import { writeFile } from 'node:fs/promises';
import { cameraPhoto, CORRUPT_JPEG, CORRUPT_HEIC } from '../fixtures/photos.ts';

async function orderWithPhotos(page: import('@playwright/test').Page, { received = false, selectPhotos = true } = {}) {
  await loginStaff(page, '20261003');
  await staffPage(page, '今日工作');
  const order = await onsiteOrder(page);
  if (received) await staffApi(page, `/api/appointments/${order.id}/receive`, {
    revision: 0, requestId: crypto.randomUUID(), photosCaptured: true, uploadTimedOut: true
  });
  await page.getByRole('button', { name: '刷新工作台', exact: true }).click();
  await page.getByRole('button').filter({ hasText: order.id }).first().click();
  const dialog = page.getByRole('dialog', { name: '维修工单', exact: true });
  for (const side of selectPhotos ? ['正面', '背面'] : []) {
    const input = dialog.getByLabel(`设备${side}照片`, { exact: true });
    // setInputFiles can target disabled inputs while saved photos are being checked.
    await expect(input).toBeEnabled();
    await input.setInputFiles({ name: `${side}.png`, mimeType: 'image/png', buffer: PHOTO });
  }
  return { order, dialog };
}

for (const received of [false, true]) test(`8 and 15 MiB originals compress before ${received ? 'deferred intake supplementation' : 'receiving the device'}`, async ({ page }) => {
  const { order, dialog } = await orderWithPhotos(page, { received, selectPhotos: false });
  const uploads: string[] = [];
  await page.route(`**/api/appointments/${order.id}/attachments`, async route => {
    if (route.request().method() === 'POST') uploads.push(route.request().headers()['x-attachment-purpose']);
    await route.continue();
  });
  const front = cameraPhoto(8), back = cameraPhoto(15);
  expect(front.length).toBeGreaterThanOrEqual(8 * 1024 * 1024);
  expect(back.length).toBeGreaterThanOrEqual(15 * 1024 * 1024);
  await dialog.getByLabel('设备正面照片', { exact: true }).setInputFiles({
    name: 'camera-8MiB.png', mimeType: 'image/png', buffer: front
  });
  await expect(dialog.getByRole('img', { name: '设备正面照片', exact: true })).toBeVisible();
  await page.route('**/__large-camera.png', route => route.fulfill({ contentType: 'image/png', body: back }));
  const transfer = await page.evaluateHandle(async () => {
    const data = new DataTransfer();
    data.items.add(new File([await (await fetch('/__large-camera.png')).blob()], 'camera-15MiB.png', { type: 'image/png' }));
    return data;
  });
  await dialog.locator('.field-intake-photo').last().dispatchEvent('drop', { dataTransfer: transfer });
  await transfer.dispose();
  await expect(dialog.getByRole('img', { name: '设备背面照片', exact: true })).toBeVisible();
  await expect(dialog.locator('.field-intake-photo [role=alert]')).toHaveCount(0);
  await dialog.getByRole('button', { name: received ? '重试补传照片' : '接收并开始维修', exact: true }).click();
  await expect.poll(async () => {
    const detail = await staffApi<FieldOrder>(page, `/api/field/appointments/${order.id}`, null, 'GET');
    return !!detail.frontPhotoId && !!detail.backPhotoId && !detail.photoDeferredBy;
  }).toBe(true);
  expect(uploads.sort()).toEqual(['intake_back', 'intake_front']);
  const saved = await staffApi<ItemsResponse<AttachmentDto>>(page, `/api/appointments/${order.id}/attachments`, null, 'GET');
  expect(saved.items.map(item => item.purpose).sort()).toEqual(['intake_back', 'intake_front']);
  for (const item of saved.items) {
    // The server measures actual bytes; WebKit omits binary postDataBuffer().
    expect(item.mimeType).toBe('image/jpeg');
    expect(item.size).toBeGreaterThan(0);
    expect(item.size).toBeLessThanOrEqual(1024 * 1024);
  }
});

test('unsafe pixel dimensions fail before preview and corrupt pixels explain the compression failure', async ({ page }) => {
  const { order, dialog } = await orderWithPhotos(page);
  const front = dialog.locator('.field-intake-photo').first();
  const input = front.getByLabel('设备正面照片', { exact: true });
  const preview = front.getByRole('img', { name: '设备正面照片', exact: true });
  await expect(preview).toBeVisible();
  const previous = await preview.getAttribute('src');
  const oversized = Buffer.from(PHOTO);
  oversized.writeUInt32BE(10001, 16); oversized.writeUInt32BE(5000, 20);
  await input.setInputFiles({ name: 'huge-pixels.png', mimeType: 'image/png', buffer: oversized });
  await expect(front.getByRole('alert')).toContainText('5000 万像素');
  await expect(preview).toHaveAttribute('src', present(previous));
  await input.setInputFiles({ name: 'damaged.jpg', mimeType: 'image/jpeg', buffer: CORRUPT_JPEG });
  await expect(front.getByText('damaged.jpg', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '接收并开始维修', exact: true }).click();
  await expect(dialog.getByText(/正面：照片压缩失败（图片解码失败/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: '接收并开始维修', exact: true })).toBeEnabled();
  const saved = await staffApi<ItemsResponse<AttachmentDto>>(page, `/api/appointments/${order.id}/attachments`, null, 'GET');
  expect(saved.items.map(item => item.purpose)).toEqual(['intake_back']);
});

test('photo inspection blocks stale uploads and a newer selection wins over a slow replacement', async ({ page }) => {
  const { dialog } = await orderWithPhotos(page);
  const front = dialog.locator('.field-intake-photo').first();
  const input = front.getByLabel('设备正面照片', { exact: true });
  const start = dialog.getByRole('button', { name: '接收并开始维修', exact: true });
  await expect(front.getByRole('img', { name: '设备正面照片', exact: true })).toBeVisible();
  await expect(dialog.getByRole('img', { name: '设备背面照片', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const arrayBuffer = Blob.prototype.arrayBuffer;
    let release: () => void, pending: Promise<ArrayBuffer>;
    const gate = new Promise<void>(resolve => { release = resolve; });
    window.releasePhotoRead = async () => { release(); await pending; };
    // Hold only the next header read; allow the next selection to finish first.
    Blob.prototype.arrayBuffer = function () {
      Blob.prototype.arrayBuffer = arrayBuffer;
      pending = gate.then(() => arrayBuffer.call(this));
      return pending;
    };
  });
  await input.setInputFiles({ name: 'slow.png', mimeType: 'image/png', buffer: PHOTO });
  await expect(front.getByText('正在检查照片…', { exact: true })).toBeVisible();
  await expect(start).toBeDisabled();
  await input.setInputFiles({ name: 'latest.png', mimeType: 'image/png', buffer: PHOTO });
  await expect(front.getByText('latest.png', { exact: true })).toBeVisible();
  await expect(start).toBeEnabled();
  await page.evaluate(() => window.releasePhotoRead());
  await expect(front.getByText('latest.png', { exact: true })).toBeVisible();
  await start.click();
  await expect(dialog.getByRole('button', { name: '结束本次服务', exact: true })).toBeVisible();
});

test('mobile dropzone hit testing covers the icon, padding and lower edge', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'Native drag coordinates are driven through Chromium CDP.');
  await page.setViewportSize({ width: 375, height: 812 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 3, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const { dialog } = await orderWithPhotos(page, { selectPhotos: false });
  const photo = dialog.locator('.field-intake-photo').first();
  const zone = photo.getByRole('button', { name: '添加设备正面照片', exact: true });
  await zone.scrollIntoViewIfNeeded();
  const bounds = await zone.boundingBox();
  const icon = await zone.locator('svg').boundingBox();
  const filename = testInfo.outputPath('mobile-drag.png');
  await writeFile(filename, PHOTO);
  const data = { items: [], files: [filename], dragOperationsMask: 1 };
  const points = [
    { x: present(bounds).x + present(bounds).width / 2, y: present(bounds).y + 4 },
    { x: present(icon).x + present(icon).width / 2, y: present(icon).y - 4 },
    { x: present(icon).x + present(icon).width / 2, y: present(icon).y + present(icon).height / 2 },
    { x: present(bounds).x + present(bounds).width / 2, y: present(bounds).y + present(bounds).height - 4 }
  ];
  await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', ...points[0], data });
  for (const point of points) {
    await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', ...point, data });
    await expect(photo).toHaveClass(/is-dragging/);
    await expect(zone.getByText('松开添加', { exact: true })).toBeVisible();
  }
  await zone.locator('svg').dispatchEvent('dragleave', { clientX: points[2].x, clientY: points[2].y, relatedTarget: null });
  await expect(photo).toHaveClass(/is-dragging/);
  await zone.locator('strong').dispatchEvent('dragleave', { clientX: points[1].x, clientY: points[1].y, relatedTarget: null });
  await expect(photo).toHaveClass(/is-dragging/);
  await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x: present(bounds).x + present(bounds).width + 4, y: points[1].y, data });
  await expect(photo).not.toHaveClass(/is-dragging/);
  await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', ...points[1], data });
  await expect(photo).toHaveClass(/is-dragging/);
  await cdp.send('Input.dispatchDragEvent', { type: 'drop', ...points[1], data });
  await expect(photo.getByRole('img', { name: '设备正面照片', exact: true })).toBeVisible();
  await expect(photo).not.toHaveClass(/is-dragging/);
  await cdp.detach();
});

test('cancelling a photo picker keeps the repair dialog and selected photos', async ({ page }) => {
  const { dialog } = await orderWithPhotos(page, { selectPhotos: false });
  const front = dialog.getByLabel('设备正面照片', { exact: true });
  await front.dispatchEvent('cancel', { bubbles: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('已准备 0 / 2 张')).toBeVisible();
  await front.setInputFiles({ name: 'front.png', mimeType: 'image/png', buffer: PHOTO });
  const preview = dialog.getByRole('img', { name: '设备正面照片', exact: true });
  const original = present(await preview.getAttribute('src'));
  await front.dispatchEvent('cancel', { bubbles: true });
  await expect(dialog).toBeVisible();
  await expect(preview).toHaveAttribute('src', original);
  await expect(dialog.getByText('已准备 1 / 2 张')).toBeVisible();
  await dialog.getByRole('button', { name: '补充照片', exact: true }).click();
  const upload = dialog.locator('.repair-attachment-upload');
  const supplement = upload.getByLabel('补充照片', { exact: true });
  await supplement.dispatchEvent('cancel', { bubbles: true });
  await expect(dialog).toBeVisible();
  await expect(upload).toBeVisible();
  await supplement.setInputFiles({ name: 'supplement.png', mimeType: 'image/png', buffer: PHOTO });
  await supplement.dispatchEvent('cancel', { bubbles: true });
  await expect(dialog).toBeVisible();
  await expect(upload.getByRole('img', { name: '补充照片', exact: true })).toBeVisible();
  const confirmation = page.getByRole('dialog', { name: '有未保存的调整', exact: true });
  await expect(confirmation).toHaveCount(0);
  await upload.getByRole('button', { name: '取消', exact: true }).click();
  await confirmation.getByRole('button', { name: '丢弃并继续', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(upload).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(preview).toHaveAttribute('src', original);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('booking, onsite registration and repair correction share device questions', async ({ page }) => {
  await page.goto('/');
  await chooseTime(page);
  await page.locator('[name=deviceType]').selectOption('笔记本');
  await page.locator('[name=brand]').selectOption('Dell');
  await expect(page.locator('#liquid-metal-field')).toBeVisible();
  await expect(page.locator('#dell-g15-field')).toBeVisible();
  await page.locator('[name=deviceType]').selectOption('台式机');
  await expect(page.locator('#liquid-metal-field')).toBeHidden();
  await expect(page.locator('#dell-g15-field')).toBeHidden();
  await loginStaff(page);
  await staffPage(page, '今日工作');
  await page.getByRole('button', { name: '现场登记', exact: true }).click();
  const registration = page.getByRole('dialog', { name: '临时维修登记', exact: true });
  await registration.getByRole('textbox', { name: '品牌', exact: true }).fill('Dell');
  await expect(registration.getByRole('combobox', { name: '是否使用液金散热', exact: true })).toBeVisible();
  await expect(registration.getByRole('combobox', { name: 'Dell G15 / G16 系列', exact: true })).toBeVisible();
  await chooseOption(page, registration.getByRole('combobox', { name: '设备类型', exact: true }), '台式机');
  await expect(registration.getByRole('combobox', { name: '是否使用液金散热', exact: true })).toHaveCount(0);
  await expect(registration.getByRole('combobox', { name: 'Dell G15 / G16 系列', exact: true })).toHaveCount(0);
  await registration.getByRole('button', { name: '关闭', exact: true }).click();
  const order = await onsiteOrder(page, { brand: 'Dell', liquidMetal: '是', dellG15: '是' });
  await page.getByRole('button', { name: '刷新工作台', exact: true }).click();
  await page.getByRole('button').filter({ hasText: order.id }).first().click();
  const dialog = page.getByRole('dialog', { name: '维修工单', exact: true });
  await dialog.getByRole('button', { name: '修改工单信息', exact: true }).click();
  const information = dialog.locator('.repair-information .repair-control-panel');
  const device = information.getByRole('group', { name: '设备与故障', exact: true });
  const supplemental = information.getByRole('group', { name: '现场补充', exact: true });
  await expect(device.getByRole('combobox', { name: '是否使用液金散热', exact: true })).toBeVisible();
  await expect(device.getByRole('combobox', { name: 'Dell G15 / G16 系列', exact: true })).toBeVisible();
  await expect(information.getByLabel('学号', { exact: true })).toHaveJSProperty('readOnly', true);
  await chooseOption(page, device.getByRole('combobox', { name: '设备类型', exact: true }), '台式机');
  await expect(device.getByRole('combobox', { name: '是否使用液金散热', exact: true })).toHaveCount(0);
  await expect(device.getByRole('combobox', { name: 'Dell G15 / G16 系列', exact: true })).toHaveCount(0);
  await chooseOption(page, device.getByRole('combobox', { name: '故障分类', exact: true }), '蓝屏');
  await supplemental.getByLabel('设备序列号', { exact: true }).fill('SUPPLEMENT-SN');
  await supplemental.getByLabel('登记备注', { exact: true }).fill('现场检查补充');
  await information.getByRole('button', { name: '保存工单信息', exact: true }).click();
  await expect(information).toHaveCount(0);
  const saved = await staffApi<FieldOrder>(page, `/api/field/appointments/${order.id}`, null, 'GET');
  expect(saved.deviceType).toBe('台式机');
  expect(saved.liquidMetal).toBe('');
  expect(saved.dellG15).toBe('');
  expect(saved.faultType).toBe('蓝屏');
  expect(saved.serial).toBe('SUPPLEMENT-SN');
  expect(present(saved.original).note).toBe('现场检查补充');
});

test('intake dropzones validate files, replace previews and receive the order', async ({ page }) => {
  const { order, dialog } = await orderWithPhotos(page, { selectPhotos: false });
  const front = dialog.locator('.field-intake-photo').first();
  const back = dialog.locator('.field-intake-photo').last();
  await expect(dialog.getByText('已准备 0 / 2 张')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '接收并开始维修', exact: true })).toBeInViewport();
  const chooserPromise = page.waitForEvent('filechooser');
  await front.getByRole('button', { name: '添加设备正面照片', exact: true }).focus();
  await page.keyboard.press('Enter');
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'oversized.png', mimeType: 'image/png', buffer: Buffer.alloc(32 * 1024 * 1024 + 1) });
  await expect(front.getByRole('alert')).toContainText('32 MiB');
  await expect(dialog.getByText('已准备 0 / 2 张')).toBeVisible();
  const transfer = await page.evaluateHandle((bytes) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], 'QQ-device.png', { type: 'image/png' }));
    return data;
  }, Array.from(PHOTO));
  await front.dispatchEvent('dragover', { dataTransfer: transfer });
  await expect(front).toHaveClass(/is-dragging/);
  await front.dispatchEvent('drop', { dataTransfer: transfer });
  await expect(front.getByRole('img', { name: '设备正面照片', exact: true })).toBeVisible();
  await expect(front.getByText('QQ-device.png')).toBeVisible();
  await expect(front.getByRole('alert')).toHaveCount(0);
  await expect(front).not.toHaveClass(/is-dragging/);
  await expect(dialog.getByText('已准备 1 / 2 张')).toBeVisible();
  const original = present(await front.locator('img').getAttribute('src'));
  const invalid = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(['text'], 'notes.txt', { type: 'text/plain' }));
    return data;
  });
  await front.dispatchEvent('drop', { dataTransfer: invalid });
  await expect(front.getByRole('alert')).toContainText('JPEG、PNG 或 WebP');
  await expect(front.locator('img')).toHaveAttribute('src', original);
  const multiple = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    for (const name of ['one.png', 'two.png']) data.items.add(new File(['image'], name, { type: 'image/png' }));
    return data;
  });
  await back.dispatchEvent('drop', { dataTransfer: multiple });
  await expect(back.getByRole('alert')).toContainText('一张照片');
  await front.getByLabel('设备正面照片', { exact: true }).setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: PHOTO });
  await expect(front.getByRole('alert')).toHaveCount(0);
  await expect(front.getByText('replacement.png')).toBeVisible();
  await expect(front.locator('img')).not.toHaveAttribute('src', original);
  await back.dispatchEvent('drop', { dataTransfer: transfer });
  await expect(back.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByText('已准备 2 / 2 张')).toBeVisible();
  await dialog.getByRole('button', { name: '接收并开始维修', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '结束本次服务', exact: true })).toBeVisible();
  const detail = await staffApi<FieldOrder>(page, `/api/field/appointments/${order.id}`, null, 'GET');
  expect(detail.frontPhotoId).toBeTruthy();
  expect(detail.backPhotoId).toBeTruthy();
  await transfer.dispose();
  await invalid.dispose();
  await multiple.dispose();
});

test('repair tools protect drafts when cancelling, switching and closing', async ({ page }) => {
  await loginStaff(page);
  await staffPage(page, '今日工作');
  const order = await onsiteOrder(page);
  await page.getByRole('button', { name: '刷新工作台', exact: true }).click();
  await page.getByRole('button').filter({ hasText: order.id }).first().click();
  const dialog = page.getByRole('dialog', { name: '维修工单', exact: true });
  const modify = dialog.getByRole('button', { name: '修改工单信息', exact: true });
  const information = dialog.locator('.repair-information .repair-control-panel');
  const confirmation = page.getByRole('dialog', { name: '有未保存的调整', exact: true });
  await modify.click();
  const originalBrand = await information.getByLabel('品牌', { exact: true }).inputValue();
  await information.getByLabel('品牌', { exact: true }).fill('未保存品牌');
  const actions = information.locator('.repair-panel-actions');
  await actions.getByRole('button', { name: '取消', exact: true }).click();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '取消操作', exact: true }).click();
  await expect(information.getByLabel('品牌', { exact: true })).toHaveValue('未保存品牌');
  await dialog.getByRole('button', { name: '补充照片', exact: true }).click();
  await confirmation.getByRole('button', { name: '丢弃并继续', exact: true }).click();
  await expect(information).toHaveCount(0);
  const upload = dialog.locator('.repair-attachment-upload');
  await upload.getByLabel('补充照片', { exact: true }).setInputFiles({ name: 'draft.png', mimeType: 'image/png', buffer: PHOTO });
  await modify.click();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '丢弃并继续', exact: true }).click();
  await expect(information.getByLabel('品牌', { exact: true })).toHaveValue(originalBrand);
  await information.getByLabel('品牌', { exact: true }).fill('荣耀');
  await information.getByLabel('登记备注', { exact: true }).fill('已核实完整登记信息');
  const endpoint = `**/api/appointments/${order.id}/information`;
  await page.route(endpoint, route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '模拟保存失败' }) }));
  await dialog.getByRole('button', { name: '补充照片', exact: true }).click();
  await confirmation.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole('status')).toContainText('尚未保存成功');
  await page.unroute(endpoint);
  await confirmation.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(upload).toBeVisible();
  const detail = await staffApi<FieldOrder>(page, `/api/field/appointments/${order.id}`, null, 'GET');
  expect(detail.brand).toBe('荣耀');
  expect(present(detail.original).note).toBe('已核实完整登记信息');
  await upload.getByLabel('补充照片', { exact: true }).setInputFiles({ name: 'close-draft.png', mimeType: 'image/png', buffer: PHOTO });
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '取消操作', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(upload.getByText('close-draft.png', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await confirmation.getByRole('button', { name: '丢弃并继续', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('supplemental photos accept large originals through the shared dropzone and compress before upload', async ({ page }) => {
  const { order, dialog } = await orderWithPhotos(page, { received: true, selectPhotos: false });
  const attachments = dialog.getByRole('region', { name: '附件与设备照片', exact: true });
  await attachments.getByRole('button', { name: '查看照片与附件', exact: true }).click();
  await attachments.getByRole('button', { name: '补充照片', exact: true }).click();
  const panel = attachments.locator('.repair-attachment-upload');
  await expect(panel.getByRole('button', { name: '添加补充照片', exact: true })).toBeVisible();
  const dataTransfer = await page.evaluateHandle(bytes => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes), new Uint8Array(8 * 1024 * 1024 - bytes.length)], '维修过程.png', { type: 'image/png' }));
    return transfer;
  }, Array.from(PHOTO));
  await panel.locator('.field-intake-photo').dispatchEvent('drop', { dataTransfer });
  await dataTransfer.dispose();
  await expect(panel.getByRole('img', { name: '补充照片', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '确认上传照片', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(attachments.getByRole('button', { name: /维修过程/ })).toBeVisible();
  const detail = await staffApi<FieldOrder>(page, `/api/field/appointments/${order.id}`, null, 'GET');
  expect(detail.frontPhotoId).toBeFalsy();
  expect(detail.backPhotoId).toBeFalsy();
  const uploaded = await staffApi<ItemsResponse<AttachmentDto>>(page, `/api/appointments/${order.id}/attachments`, null, 'GET');
  expect(uploaded.items).toHaveLength(1);
  expect(uploaded.items[0].purpose).toBe('general');
  expect(uploaded.items[0].size).toBeLessThanOrEqual(1024 * 1024);
});

test('supplemental HEIC and HEIF selections reach image processing and preserve actionable decoding errors', async ({ page }) => {
  const { dialog } = await orderWithPhotos(page, { selectPhotos: false });
  await dialog.getByRole('button', { name: '补充照片', exact: true }).click();
  const panel = dialog.locator('.repair-attachment-upload');
  const input = panel.getByLabel('补充照片', { exact: true });
  await expect(input).toHaveAttribute('accept', 'image/*');
  for (const extension of ['heic', 'heif']) {
    // A recognized container with undecodable pixels must reach the compressor,
    // which can offer format-specific guidance on browsers without HEIC support.
    await input.setInputFiles({
      name: `camera.${extension}`,
      mimeType: `image/${extension}`,
      buffer: CORRUPT_HEIC
    });
    await expect(panel.getByText(`camera.${extension}`, { exact: true })).toBeVisible();
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await panel.getByRole('button', { name: '确认上传照片', exact: true }).click();
    await expect(dialog.getByRole('region', { name: '附件与设备照片', exact: true }).getByRole('status')).toContainText('当前浏览器无法处理 HEIC/HEIF 照片');
    await expect(panel.getByRole('button', { name: '确认上传照片', exact: true })).toBeEnabled();
  }
});

for (const skip of [false, true]) test(`slow binary photos survive 30 seconds ${skip ? 'and attach after skipping and closing the modal' : 'while the user keeps waiting'}`, async ({ page, context }) => {
  const { order, dialog } = await orderWithPhotos(page);
  const requests: import("@playwright/test").Request[] = [];
  const { promise: gate, resolve: release } = Promise.withResolvers<void>();
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
    const detail = await staffApi<FieldOrder>(page, `/api/field/appointments/${order.id}`, null, 'GET');
    return !!detail.frontPhotoId && !!detail.backPhotoId && !detail.photoDeferredBy;
  }).toBe(true);
  const detail = await staffApi<FieldOrder>(page, `/api/field/appointments/${order.id}`, null, 'GET');
  expect(detail.status).toBe(skip ? 'completed' : 'in_progress');
  const attachments = await staffApi<ItemsResponse<AttachmentDto>>(page, endpoint, null, 'GET');
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

for (const action of ['retry', 'skip', 'skip with a pending photo']) test(`a failed side allows ${action} immediately and reuses the successful photo`, async ({ page }) => {
  const { order, dialog } = await orderWithPhotos(page);
  const purposes: string[] = [];
  let failBack = true;
  const { promise: frontGate, resolve: releaseFront } = Promise.withResolvers<void>();
  await page.route(`**/api/appointments/${order.id}/attachments`, async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    const purpose = route.request().headers()['x-attachment-purpose'];
    purposes.push(purpose);
    if (purpose === 'intake_back' && failBack) {
      failBack = false;
      await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: '上传过于频繁，请稍后重试' }) });
    } else {
      if (purpose === 'intake_front' && action === 'skip with a pending photo') await frontGate;
      await route.continue();
    }
  });
  const start = dialog.getByRole('button', { name: '接收并开始维修', exact: true });
  await start.click();
  await expect(dialog.getByText(/背面：上传过于频繁/)).toBeVisible();
  // No clock advance: errors must allow skipping before the 30-second timer.
  if (action === 'skip with a pending photo') {
    await expect(dialog.getByText('照片上传失败，可以跳过并稍后重试补传。仍在上传的照片会继续，成功后自动补入本工单。')).toBeVisible();
    await dialog.getByRole('button', { name: '跳过等待，继续当前操作', exact: true }).click();
    releaseFront();
  } else {
    await expect(start).toBeEnabled();
    const skip = dialog.getByRole('button', { name: '跳过等待，接收并开始维修', exact: true });
    await expect(skip).toBeEnabled();
    await (action === 'skip' ? skip : start).click();
  }
  await expect(dialog.getByRole('button', { name: '结束本次服务', exact: true })).toBeVisible();
  if (action !== 'retry') {
    await expect.poll(async () => {
      const detail = await staffApi<FieldOrder>(page, `/api/field/appointments/${order.id}`, null, 'GET');
      return !!detail.frontPhotoId && !detail.backPhotoId && !!detail.photoDeferredBy;
    }).toBe(true);
    await dialog.getByRole('button', { name: '重试补传照片', exact: true }).click();
    await expect.poll(async () => {
      const detail = await staffApi<FieldOrder>(page, `/api/field/appointments/${order.id}`, null, 'GET');
      return !!detail.frontPhotoId && !!detail.backPhotoId && !detail.photoDeferredBy;
    }).toBe(true);
  }
  expect(purposes.filter(value => value === 'intake_front')).toHaveLength(1);
  expect(purposes.filter(value => value === 'intake_back')).toHaveLength(2);
  const attachments = await staffApi<ItemsResponse<AttachmentDto>>(page, `/api/appointments/${order.id}/attachments`, null, 'GET');
  expect(attachments.items).toHaveLength(2);
});

test('manual supplementation also releases the modal after 30 seconds without cancelling photos', async ({
  page,
  context
}) => {
  let order: FieldOrder, dialog: import('@playwright/test').Locator, release: () => void, count: number;

  await runWorkflow(
    'ui-deferred-photo',
    'initial',
    [
      ['initial', 'UPLOAD_PENDING', 'uploading'],
      ['uploading', 'TIMEOUT_AND_CLOSE', 'deferred'],
      ['deferred', 'FINISH_UPLOAD', 'linked']
    ],
    [
      {
        event: 'UPLOAD_PENDING',

        run: async () => {
          ({ order, dialog } = await orderWithPhotos(page, { received: true }));

          count = 0;
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          await page.route(`**/api/appointments/${order.id}/attachments`, async (route) => {
            if (route.request().method() !== 'POST') {
              await route.continue();
              return;
            }
            count++;
            await gate;
            await route.continue();
          });
          await dialog.getByRole('button', { name: '重试补传照片', exact: true }).click();
          await expect.poll(() => count).toBe(2);
        }
      },
      {
        event: 'TIMEOUT_AND_CLOSE',

        run: async () => {
          await context.clock.fastForward(30001);
          await dialog.getByRole('button', { name: '跳过等待，继续当前操作', exact: true }).click();
          await dialog.getByRole('button', { name: '关闭', exact: true }).click();
          await expect(dialog).toBeHidden();
        }
      },
      {
        event: 'FINISH_UPLOAD',

        run: async () => {
          release();
          await expect
            .poll(async () => {
              const detail = await staffApi<FieldOrder>(
                page,
                `/api/field/appointments/${order.id}`,
                null,
                'GET'
              );
              return !!detail.frontPhotoId && !!detail.backPhotoId && !detail.photoDeferredBy;
            })
            .toBe(true);
          expect(count).toBe(2);
        }
      }
    ]
  );
});
