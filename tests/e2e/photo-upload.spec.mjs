import { runWorkflow } from '../fixtures/workflow-seed.mjs';
import { test, expect } from './support/fixtures.mjs';
import { loginStaff, staffPage, onsiteOrder, staffApi, chooseOption } from './support/staff.mjs';
import { PHOTO, chooseTime } from './support/student.mjs';
import { writeFile } from 'node:fs/promises';

async function orderWithPhotos(page, { received = false, selectPhotos = true } = {}) {
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
    { x: bounds.x + bounds.width / 2, y: bounds.y + 4 },
    { x: icon.x + icon.width / 2, y: icon.y - 4 },
    { x: icon.x + icon.width / 2, y: icon.y + icon.height / 2 },
    { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height - 4 }
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
  await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x: bounds.x + bounds.width + 4, y: points[1].y, data });
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
  const original = await preview.getAttribute('src');
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

test('booking, onsite registration and repair correction share device questions', async ({ page }, testInfo) => {
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
  const saved = await staffApi(page, `/api/field/appointments/${order.id}`, null, 'GET');
  expect(saved.deviceType).toBe('台式机');
  expect(saved.liquidMetal).toBe('');
  expect(saved.dellG15).toBe('');
  expect(saved.faultType).toBe('蓝屏');
  expect(saved.serial).toBe('SUPPLEMENT-SN');
  expect(saved.original.note).toBe('现场检查补充');
  await dialog.getByRole('button', { name: '修改工单信息', exact: true }).click();
  await information.screenshot({ path: testInfo.outputPath('aligned-information.png') });
  expect(await dialog.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
});

test('intake dropzones validate files, replace previews and receive the order', async ({ page }, testInfo) => {
  const { order, dialog } = await orderWithPhotos(page, { selectPhotos: false });
  const front = dialog.locator('.field-intake-photo').first();
  const back = dialog.locator('.field-intake-photo').last();
  await expect(dialog.getByText('已准备 0 / 2 张')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '接收并开始维修', exact: true })).toBeInViewport();
  const frontBounds = await front.boundingBox();
  const backBounds = await back.boundingBox();
  expect(Math.abs(frontBounds.y - backBounds.y)).toBeLessThan(2);
  expect(backBounds.x).toBeGreaterThan(frontBounds.x);
  const tools = dialog.getByRole('region', { name: '维修信息', exact: true });
  const official = dialog.getByRole('region', { name: '官方支持', exact: true });
  await expect(tools.getByRole('heading', { name: '维修信息', exact: true })).toBeVisible();
  await expect(official.getByRole('heading', { name: '官方支持', exact: true })).toBeVisible();
  const toolActions = [
    tools.getByRole('button', { name: '查看照片与附件', exact: true }),
    tools.getByRole('button', { name: '补充照片', exact: true }),
    official.getByRole('button', { name: '查询保修状态', exact: true }),
    official.getByRole('link', { name: '查找售后网点', exact: true })
  ];
  const bounds = await Promise.all(toolActions.map((action) => action.boundingBox()));
  expect(Math.abs(bounds[0].x - bounds[2].x)).toBeLessThan(2);
  expect(Math.abs(bounds[1].x - bounds[3].x)).toBeLessThan(2);
  expect(Math.abs(bounds[0].y - bounds[1].y)).toBeLessThan(2);
  expect(Math.abs(bounds[2].y - bounds[3].y)).toBeLessThan(2);
  const primaryBounds = await dialog.getByRole('button', { name: '接收并开始维修', exact: true }).boundingBox();
  const secondaryBounds = await dialog.getByRole('button', { name: '仅接收设备', exact: true }).boundingBox();
  expect(Math.abs(primaryBounds.width - secondaryBounds.width)).toBeLessThan(2);
  expect(primaryBounds.height).toBeGreaterThanOrEqual(48);
  expect(Math.abs(primaryBounds.height - secondaryBounds.height)).toBeLessThan(2);
  expect(bounds[0].y).toBeLessThan(bounds[2].y);
  await expect(front.locator('.field-photo-dropzone > svg')).toHaveCount(1);
  await expect(back.locator('.field-photo-dropzone > svg')).toHaveCount(1);
  await expect(tools.getByRole('button', { name: '修改工单信息', exact: true })).toHaveCount(1);
  await expect(tools.getByText('修正设备资料', { exact: true })).toHaveCount(0);
  await expect(tools.locator('svg')).toHaveCount(0);
  await dialog.screenshot({ path: testInfo.outputPath('intake-empty.png') });
  const chooserPromise = page.waitForEvent('filechooser');
  await front.getByRole('button', { name: '添加设备正面照片', exact: true }).focus();
  await page.keyboard.press('Enter');
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'oversized.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await expect(front.getByRole('alert')).toContainText('5 MB');
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
  const original = await front.locator('img').getAttribute('src');
  const invalid = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(['text'], 'notes.txt', { type: 'text/plain' }));
    return data;
  });
  await front.dispatchEvent('drop', { dataTransfer: invalid });
  await expect(front.getByRole('alert')).toContainText('5 MB');
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
  await dialog.screenshot({ path: testInfo.outputPath('intake-ready.png') });
  const overflow = await dialog.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);
  await dialog.getByRole('button', { name: '接收并开始维修', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '结束本次服务', exact: true })).toBeVisible();
  const detail = await staffApi(page, `/api/field/appointments/${order.id}`, null, 'GET');
  expect(detail.frontPhotoId).toBeTruthy();
  expect(detail.backPhotoId).toBeTruthy();
  await transfer.dispose();
  await invalid.dispose();
  await multiple.dispose();
});

test('administrative tools are directly available without expanding a group', async ({ page }, testInfo) => {
  await loginStaff(page);
  await staffPage(page, '今日工作');
  const order = await onsiteOrder(page);
  await page.getByRole('button', { name: '刷新工作台', exact: true }).click();
  await page.getByRole('button').filter({ hasText: order.id }).first().click();
  const dialog = page.getByRole('dialog', { name: '维修工单', exact: true });
  const original = dialog.getByRole('button', { name: '查看原始登记与协议', exact: true });
  await expect(original).toBeVisible();
  await expect(dialog.locator('.repair-tools-more')).toHaveCount(0);
  const tools = dialog.getByRole('region', { name: '维修信息', exact: true });
  await expect(tools.locator('button.repair-tool-trigger')).toHaveCount(6);
  await dialog.screenshot({ path: testInfo.outputPath('administrator-intake.png') });
  const modify = tools.getByRole('button', { name: '修改工单信息', exact: true });
  const credential = tools.getByRole('button', { name: '补发查询链接', exact: true });
  const before = await Promise.all([modify.boundingBox(), credential.boundingBox()]);
  expect(Math.abs(before[0].y - before[1].y)).toBeLessThan(2);
  await modify.hover();
  await expect(modify).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(modify).toHaveCSS('border-bottom-width', '0px');
  await expect(dialog.getByRole('region', { name: '官方支持', exact: true })).toHaveCSS('border-top-width', '0px');
  await modify.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(modify).toBeFocused();
  await expect(modify).toHaveCSS('outline-width', '2px');
  await expect(modify).toHaveCSS('border-radius', '8px');
  await tools.screenshot({ path: testInfo.outputPath('tools-keyboard-focus.png') });
  await modify.click();
  await expect(modify).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const information = tools.locator('.repair-information .repair-control-panel');
  await expect(information).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(information.getByRole('textbox', { name: '故障描述与补充说明', exact: true })).toHaveJSProperty('tagName', 'TEXTAREA');
  await information.screenshot({ path: testInfo.outputPath('information-expanded.png') });
  await credential.click();
  await expect(information).toHaveCount(0);
  await expect(tools.locator('.repair-information-row .repair-control-panel')).toHaveCount(1);
  const after = await Promise.all([modify.boundingBox(), credential.boundingBox()]);
  expect(Math.abs(after[0].y - after[1].y)).toBeLessThan(2);
  const row = await tools.locator('.repair-information-row').boundingBox();
  for (const panel of await tools.locator('.repair-information-row .repair-control-panel').all()) {
    const bounds = await panel.boundingBox();
    expect(Math.abs(bounds.x - row.x)).toBeLessThan(2);
    expect(Math.abs(bounds.width - row.width)).toBeLessThan(2);
  }
  await tools.getByLabel('已人工核验机主身份', { exact: true }).check();
  await tools.getByLabel('核验说明（勿录入完整联系方式）', { exact: true }).fill('现场核对学生证与预约资料一致');
  await expect(tools.getByRole('button', { name: '签发私人链接', exact: true })).toBeEnabled();
  await original.click();
  const unsaved = page.getByRole('dialog', { name: '有未保存的调整', exact: true });
  await expect(unsaved).toBeVisible();
  await unsaved.getByRole('button', { name: '丢弃并继续', exact: true }).click();
  const record = page.getByRole('dialog', { name: '原始登记与协议', exact: true });
  await expect(record).toBeVisible();
  await record.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(record).toBeHidden();
  await expect(original).toBeVisible();
});

test('repair tools protect drafts when cancelling, switching and closing', async ({ page }, testInfo) => {
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
  const [cancel, save] = await Promise.all([
    actions.getByRole('button', { name: '取消', exact: true }).boundingBox(),
    actions.getByRole('button', { name: '保存工单信息', exact: true }).boundingBox()
  ]);
  expect(Math.abs(cancel.y - save.y)).toBeLessThan(2);
  await actions.screenshot({ path: testInfo.outputPath('paired-form-actions.png') });
  await actions.getByRole('button', { name: '取消', exact: true }).click();
  await expect(confirmation).toBeVisible();
  await expect(confirmation.locator('.workspace-unsaved-actions > button')).toHaveCount(2);
  const discard = confirmation.getByRole('button', { name: '丢弃并继续', exact: true });
  const continueSave = confirmation.getByRole('button', { name: '保存并继续', exact: true });
  await expect(discard).toHaveCSS('background-color', 'rgb(180, 35, 24)');
  const [discardBounds, saveBounds] = await Promise.all([discard.boundingBox(), continueSave.boundingBox()]);
  expect(Math.abs(discardBounds.y - saveBounds.y)).toBeLessThan(2);
  expect(discardBounds.x).toBeLessThan(saveBounds.x);
  await confirmation.screenshot({ path: testInfo.outputPath('unsaved-confirmation.png') });
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
  await dialog.getByRole('button', { name: '补发查询链接', exact: true }).click();
  await confirmation.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole('status')).toContainText('尚未保存成功');
  await page.unroute(endpoint);
  await confirmation.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(dialog.locator('.repair-credential .repair-control-panel')).toBeVisible();
  const detail = await staffApi(page, `/api/field/appointments/${order.id}`, null, 'GET');
  expect(detail.brand).toBe('荣耀');
  expect(detail.original.note).toBe('已核实完整登记信息');
  await dialog.getByLabel('核验说明（勿录入完整联系方式）', { exact: true }).fill('尚未提交的身份核验');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '取消操作', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: '核验说明（勿录入完整联系方式）', exact: true })).toHaveValue('尚未提交的身份核验');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await confirmation.getByRole('button', { name: '丢弃并继续', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('supplemental photos accept large originals through the shared dropzone and compress before upload', async ({ page }, testInfo) => {
  const { order, dialog } = await orderWithPhotos(page, { received: true, selectPhotos: false });
  const attachments = dialog.getByRole('region', { name: '附件与设备照片', exact: true });
  await attachments.getByRole('button', { name: '查看照片与附件', exact: true }).click();
  await attachments.getByRole('button', { name: '补充照片', exact: true }).click();
  const view = attachments.getByRole('button', { name: '查看照片与附件', exact: true });
  const add = attachments.getByRole('button', { name: '补充照片', exact: true });
  await expect(attachments.locator('.repair-attachment-list')).toHaveCount(0);
  const bounds = await Promise.all([view.boundingBox(), add.boundingBox()]);
  expect(Math.abs(bounds[0].y - bounds[1].y)).toBeLessThan(2);
  const panel = attachments.locator('.repair-attachment-upload');
  await expect(panel.getByRole('button', { name: '添加补充照片', exact: true })).toBeVisible();
  await panel.screenshot({ path: testInfo.outputPath('supplement-upload.png') });
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
  const detail = await staffApi(page, `/api/field/appointments/${order.id}`, null, 'GET');
  expect(detail.frontPhotoId).toBeFalsy();
  expect(detail.backPhotoId).toBeFalsy();
  const uploaded = await staffApi(page, `/api/appointments/${order.id}/attachments`, null, 'GET');
  expect(uploaded.items).toHaveLength(1);
  expect(uploaded.items[0].purpose).toBe('general');
  expect(uploaded.items[0].size).toBeLessThanOrEqual(600 * 1024);
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
      buffer: Buffer.from('00000018667479706865696300000000686569636d696631', 'hex')
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

for (const action of ['retry', 'skip', 'skip with a pending photo']) test(`a failed side allows ${action} immediately and reuses the successful photo`, async ({ page }) => {
  const { order, dialog } = await orderWithPhotos(page);
  const purposes = [];
  let failBack = true;
  let releaseFront;
  const frontGate = new Promise(resolve => { releaseFront = resolve; });
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
      const detail = await staffApi(page, `/api/field/appointments/${order.id}`, null, 'GET');
      return !!detail.frontPhotoId && !detail.backPhotoId && !!detail.photoDeferredBy;
    }).toBe(true);
    await dialog.getByRole('button', { name: '重试补传照片', exact: true }).click();
    await expect.poll(async () => {
      const detail = await staffApi(page, `/api/field/appointments/${order.id}`, null, 'GET');
      return !!detail.frontPhotoId && !!detail.backPhotoId && !detail.photoDeferredBy;
    }).toBe(true);
  }
  expect(purposes.filter(value => value === 'intake_front')).toHaveLength(1);
  expect(purposes.filter(value => value === 'intake_back')).toHaveLength(2);
  const attachments = await staffApi(page, `/api/appointments/${order.id}/attachments`, null, 'GET');
  expect(attachments.items).toHaveLength(2);
});

test('manual supplementation also releases the modal after 30 seconds without cancelling photos', async ({
  page,
  context
}) => {
  let order, dialog, release, count;

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
          const gate = new Promise((resolve) => {
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
              const detail = await staffApi(
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
