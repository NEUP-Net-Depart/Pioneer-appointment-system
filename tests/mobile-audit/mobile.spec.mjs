/* global document, window, getComputedStyle, requestAnimationFrame */
import { test, expect, api, login, loginApi, navigate, draw, PHOTO, orderFixture } from './support.mjs';
import { inventory } from '../../scripts/mobile-audit-inventory.mjs';
import { chooseTime, fillDevice, goReview } from '../e2e/support/student.mjs';
import { randomUUID } from 'node:crypto';

const catalog = await inventory();
test.skip(process.env.E2E_FIELD !== 'true', 'Requires the disposable field fixture');
const fit = sample => expect.soft(sample.documentWidth, sample.id).toBeLessThanOrEqual(sample.viewport.width + 1);
async function settled(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator('[aria-busy=true]:visible')).toHaveCount(0);
}

test('public-entry-and-activation', async ({ page, audit }) => {
  await page.goto('/staff/');
  await expect(page.locator('#login-id')).toBeVisible();
  fit(await audit.capture('staff-login', { axe: true }));
  fit(await audit.captureFont200('staff-login'));
  await page.locator('#login-id').fill('20999999');
  await page.locator('#login-password').fill('InvalidAudit!2026');
  await page.getByRole('button', { name: '进入系统' }).click();
  await expect(page.locator('#login-message')).not.toBeEmpty();
  await audit.capture('login-error');
  await page.getByRole('link', { name: '部员首次激活' }).click();
  await expect(page.locator('#activation-form')).toBeVisible();
  fit(await audit.capture('staff-activation', { axe: true }));
  fit(await audit.captureFont200('staff-activation'));
  await page.locator('#activation-name').fill('很长的测试姓名'.repeat(20));
  await expect(page.locator('#length-error-activation-name')).toBeVisible();
  fit(await audit.capture('activation-long-name-validation'));
  await page.locator('#activation-name').fill('移动端测试同学');
  await page.locator('#activation-student-id').fill('20999999');
  await page.locator('#activation-campus').selectOption('南湖');
  await page.locator('#activation-password').fill('LocalAudit!2026');
  await page.locator('#activation-confirm').fill('LocalAudit!2026');
  await page.getByRole('button', { name: '提交激活申请' }).click();
  await expect(page.locator('.toast')).not.toBeEmpty();
  await audit.capture('activation-no-invitation-feedback');
});

test('student-real-booking-upload-query-cancel', async ({ page, audit }, info) => {
  await page.goto('/');
  await expect(page.locator('#booking-picker')).toBeVisible();
  fit(await audit.capture('student-step-1', { axe: true }));
  fit(await audit.captureFont200('student-step-1'));
  await page.locator('[data-view-link=lookup]').first().click();
  await expect(page.locator('#lookup-list')).toBeVisible();
  fit(await audit.capture('lookup-list-empty'));
  fit(await audit.captureFont200('lookup-list-empty'));
  await page.locator('[data-view-link=booking]').first().click();
  await chooseTime(page);
  const sid = String(2000000000 + info.project.name.split('').reduce((n, ch) => n * 31 + ch.charCodeAt(0) >>> 0, 0));
  await fillDevice(page, { studentId: sid, name: '欧阳司徒移动端测试长姓名同学' });
  await page.locator('[name=issue]').fill('设备情况及复现步骤。'.repeat(55));
  await page.locator('#appointment-attachments').setInputFiles({ name: 'mobile-audit.png', mimeType: 'image/png', buffer: PHOTO });
  await expect(page.locator('.photo-card')).toContainText('照片已准备好');
  fit(await audit.capture('student-step-2', { axe: true }));
  fit(await audit.captureFont200('student-step-2'));
  await page.locator('[data-preview]').first().click();
  await expect(page.locator('#photo-modal')).toBeVisible();
  fit(await audit.capture('student-photo-preview'));
  await page.locator('#close-photo').click();
  await goReview(page);
  fit(await audit.capture('student-step-3'));
  fit(await audit.captureFont200('student-step-3'));
  await page.locator('#booking-submit').click();
  await expect(page.locator('[data-error-for=agreement]')).toBeVisible();
  await audit.capture('student-agreement-validation');
  await page.locator('[name=agreement]').check();
  await page.locator('#agreement-link').click();
  fit(await audit.capture('student-agreement-dialog'));
  await page.keyboard.press('Escape');
  await expect(page.locator('#agreement-modal')).toBeHidden();
  await page.locator('#open-signature').click();
  fit(await audit.capture('student-signature'));
  const original = info.project.use.viewport;
  await page.setViewportSize({ width: original.height, height: original.width });
  fit(await audit.capture('student-signature-landscape'));
  await page.setViewportSize(original);
  await draw(page, page.locator('#signature-canvas'));
  await page.locator('#confirm-signature').click();
  await page.locator('#booking-submit').click();
  await expect(page.locator('#success-panel')).toBeVisible();
  await expect(page.locator('#success-photo-message')).toContainText('照片已全部上传');
  await expect(page.locator('#success-repair-qr img')).toBeVisible();
  fit(await audit.capture('success-panel', { axe: true }));
  fit(await audit.captureFont200('success-panel'));
  await page.locator('#view-created-appointment').click();
  await expect(page.locator('#appointment-detail')).toContainText(sid);
  fit(await audit.capture('lookup-detail', { axe: true }));
  fit(await audit.captureFont200('lookup-detail'));
  await page.locator('[data-cancel-open]').click();
  fit(await audit.capture('student-cancel-confirmation'));
  await page.locator('[data-cancel-confirm]').click();
  await expect(page.locator('#detail-summary')).toContainText('已取消');
  await page.locator('#back-to-appointments').click();
  await expect(page.locator('.student-record')).toHaveCount(1);
  fit(await audit.capture('lookup-list'));
});

test('full-admin-inventory-and-secondary-views', async ({ page, audit }) => {
  await login(page);
  for (const entry of catalog.pages.filter(row => row.type === 'workspace')) {
    await navigate(page, entry.label);
    await settled(page);
    await expect(page.locator('.workspace-route:not([hidden]) h1:visible')).not.toBeEmpty();
    fit(await audit.capture(entry.id.replace(':', '-'), { axe: ['staff', 'permissions', 'stats', 'members', 'settings'].includes(entry.id) }));
    fit(await audit.captureFont200(entry.id.replace(':', '-')));
  }
  for (const [parent, labels] of [
    ['账号管理', ['激活审核', '加入资格', '账号列表']],
    ['预约配置', ['日期实际容量', '维修地点', '暂停日期', '放号时间', '校区公告', '每周模板']],
    ['班次与排班', ['我的申请', '班次']],
    ['请假审批', ['已批准', '已退回', '全部', '待审批']],
  ]) {
    await navigate(page, parent);
    for (const label of labels) {
      await page.locator('.workspace-route:not([hidden])').getByRole('button', { name: new RegExp(`^${label}(?:\\s|$)`) }).first().click();
      await settled(page);
      fit(await audit.capture(`section-${parent}-${label}`));
    }
  }
  await navigate(page, '成员管理');
  await settled(page);
  await page.locator('.members-results .react-row').filter({ hasText: '陈宇' }).getByRole('button', { name: '编辑成员与权限' }).click();
  const dialog = page.getByRole('dialog');
  for (const label of ['成员资料', '工作资格', '角色授权']) {
    await dialog.getByRole('button', { name: label, exact: true }).click();
    fit(await audit.capture(`member-${label}`, { axe: label === '工作资格' }));
  }
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toBeHidden();
  await navigate(page, '维修排班管理');
  await page.getByRole('button', { name: '新建收集任务', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  fit(await audit.capture('collection-composer-scope', { axe: true }));
  await page.getByRole('dialog').getByRole('button', { name: '下一步：人数与名单' }).click();
  fit(await audit.capture('collection-composer-members'));
  await page.getByRole('dialog').getByRole('button', { name: '下一步：确认发布' }).click();
  fit(await audit.capture('collection-composer-confirm'));
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await navigate(page, '预约记录');
  await settled(page);
  for (const [button, title] of [['全部日期', '预约时间筛选'], ['全部校区', '校区筛选'], ['全部状态', '状态筛选']]) {
    await page.locator('.records-filter-actions').getByRole('button', { name: button, exact: true }).click();
    await expect(page.getByRole('dialog', { name: title })).toBeVisible();
    fit(await audit.capture(`record-filter-${title}`));
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  }
});

test('technician-real-signin-search-intake-finish-permission', async ({ page, request, audit }, info) => {
  const office = await loginApi(request, '20261001');
  const home = await api(request, '/api/field/home', office.token);
  const event = await api(request, '/api/attendance/events', office.token, { type: 'duty', businessDate: home.businessDate, campusId: 'campus-nanhu', requestId: randomUUID() });
  const credential = await api(request, `/api/attendance/events/${event.id}/token`, office.token, { revision: event.revision });
  const order = await orderFixture(request, office.token, info);
  await login(page, '20261002');
  await navigate(page, '个人中心');
  await page.getByRole('button', { name: '到岗签到', exact: true }).click();
  const bytes = await page.evaluate(async text => {
    const { qrImage } = await import('/shared/zxing.js');
    return Array.from(new Uint8Array(await (await qrImage(text)).arrayBuffer()));
  }, credential.token);
  await page.getByRole('dialog').locator('input[type=file]').setInputFiles({ name: 'attendance-qr.png', mimeType: 'image/png', buffer: Buffer.from(bytes) });
  await expect(page.getByRole('dialog', { name: '确认到岗签到' })).toBeVisible();
  fit(await audit.capture('technician-signin-preview'));
  await page.getByRole('button', { name: '确认签到', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(/到岗签到成功|已完成到岗签到/);
  await audit.capture('technician-signin-result');
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await navigate(page, '维修工作台');
  await page.getByRole('combobox', { name: '预约编号', exact: true }).fill(order.id);
  const option = page.getByRole('option').filter({ hasText: order.id });
  await expect(option).toBeVisible();
  fit(await audit.capture('repair-search-options'));
  await option.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('设备正面照片', { exact: true }).setInputFiles({ name: 'front.png', mimeType: 'image/png', buffer: PHOTO });
  await page.getByLabel('设备背面照片', { exact: true }).setInputFiles({ name: 'back.png', mimeType: 'image/png', buffer: PHOTO });
  fit(await audit.capture('repair-intake', { axe: true }));
  await page.getByRole('button', { name: '确认开始维修', exact: true }).click();
  await expect(page.getByRole('heading', { name: '当前维修', exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('textbox', { name: '维修说明', exact: true }).fill('本地隔离移动审查：完成驱动排查与验证。');
  await page.getByLabel('修复成功', { exact: true }).check();
  fit(await audit.capture('repair-in-progress'));
  await page.getByRole('button', { name: '提交维修结果', exact: true }).click();
  fit(await audit.capture('repair-finish-confirm'));
  await page.getByRole('button', { name: '确认提交', exact: true }).click();
  await expect(page.getByRole('heading', { name: '维修记录已提交', exact: true })).toBeVisible();
  await audit.capture('repair-completed');
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  const token = await page.evaluate(() => sessionStorage.getItem('pioneerToken'));
  for (const view of ['members', 'permissions', 'stats', 'users', 'capacity', 'roster-manage', 'office-roster', 'leave-review']) {
    await page.evaluate(view => window.dispatchEvent(new CustomEvent('staff-request-navigation', { detail: view })), view);
    await expect(page.locator('.workspace-route:not([hidden])')).toHaveAttribute('data-route', 'workbench');
  }
  for (const path of ['/api/members', '/api/roles', '/api/permissions']) expect((await request.get(path, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(403);
  fit(await audit.capture('technician-permission-guard'));
});

test('office-real-registration-and-lead-management', async ({ page, audit, request }, info) => {
  await login(page, '20261001');
  await page.getByRole('button', { name: '＋ 临时登记', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '临时维修登记' });
  const sid = String(6000000000 + info.project.name.split('').reduce((n, ch) => n * 31 + ch.charCodeAt(0) >>> 0, 0));
  for (const [label, value] of [['姓名', '欧阳司徒移动端测试长姓名同学'], ['学号', sid], ['QQ / 微信', 'mobile-local'], ['设备厂商', '联想'], ['设备型号', 'ThinkPad Mobile Audit']]) await dialog.getByLabel(label, { exact: true }).fill(value);
  await dialog.getByLabel('故障描述（选填）', { exact: true }).fill('现场登记长文本。'.repeat(100));
  fit(await audit.capture('office-registration-form', { axe: true }));
  await dialog.getByRole('button', { name: '下一步：机主确认' }).click();
  await dialog.getByRole('checkbox').check();
  await draw(page, dialog.locator('canvas'));
  fit(await audit.capture('office-registration-signature'));
  await dialog.getByRole('button', { name: '确认登记', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toHaveAccessibleName('临时维修登记');
  await expect(page.getByRole('dialog')).toContainText('ThinkPad Mobile Audit');
  await audit.capture('office-registration-result');
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  // Ordinary office staff must never acquire administration through a legacy account label.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('staff-request-navigation', { detail: 'members' })));
  await expect(page.locator('.workspace-route:not([hidden])')).toHaveAttribute('data-route', 'workbench');
  await page.evaluate(() => sessionStorage.clear());
  await login(page, '20261004');
  await navigate(page, '现场管理');
  await settled(page);
  fit(await audit.capture('repair-lead-operations', { axe: true }));
  await navigate(page, '预约记录');
  await page.getByLabel('查找预约', { exact: true }).fill(sid);
  await expect(page.locator('.records-table tbody tr')).toHaveCount(1);
  await page.locator('.records-table tbody tr button').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  fit(await audit.capture('repair-lead-record-detail'));
  const correct = page.getByRole('button', { name: '修正预约记录', exact: true });
  await expect(correct).toBeVisible();
  await correct.click();
  fit(await audit.capture('repair-lead-correction'));
  const member = await loginApi(request, '20261004');
  expect((await api(request, '/api/field/home', member.token)).permissions['repair.transfer']).toBe(true);
});

test('font200-orientation-focus-camera-and-network', async ({ page, audit }, info) => {
  await page.goto('/');
  await chooseTime(page);
  await fillDevice(page);
  await page.locator('[name=name]').focus();
  await expect(page.locator('[name=name]')).toBeFocused();
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => ({ tag: document.activeElement.tagName, outline: getComputedStyle(document.activeElement).outline, shadow: getComputedStyle(document.activeElement).boxShadow }));
  expect(focus.tag).not.toBe('BODY');
  await audit.capture('student-keyboard-focus');
  // True text-only enlargement of every computed font; no fixed sleeps and no CSS page zoom.
  await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('*')];
    const sizes = nodes.map(node => parseFloat(getComputedStyle(node).fontSize));
    nodes.forEach((node, i) => { if (sizes[i]) node.style.fontSize = `${sizes[i] * 2}px`; });
  });
  fit(await audit.capture('student-font200'));
  await page.reload();
  await page.goto('/staff/');
  await login(page, '20261003');
  await navigate(page, '账号安全');
  await page.locator('[name=currentPassword]').fill('StaffTest!2026');
  await page.locator('[name=newPassword]').fill('StaffTest!New2026');
  await page.locator('[name=confirmPassword]').fill('Different!2026');
  await page.getByRole('button', { name: '修改密码并退出' }).click();
  await expect(page.locator('[name=confirmPassword]')).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: '两次新密码不一致' })).toBeVisible();
  fit(await audit.capture('password-validation'));
  const size = info.project.use.viewport;
  await page.setViewportSize({ width: size.height, height: size.width });
  fit(await audit.capture('staff-landscape'));
  await page.setViewportSize(size);
  await navigate(page, '个人中心');
  await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('*')];
    const sizes = nodes.map(node => parseFloat(getComputedStyle(node).fontSize));
    nodes.forEach((node, i) => { if (sizes[i]) node.style.fontSize = `${sizes[i] * 2}px`; });
  });
  fit(await audit.capture('staff-font200'));
  await page.reload();
  await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();
  await navigate(page, '个人中心');
  await page.evaluate(() => {
    window.__auditCameraRequests = [];
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {} });
    window.__auditMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async constraints => {
      window.__auditCameraRequests.push(constraints);
      throw new DOMException('Audit permission denial', 'NotAllowedError');
    } });
  });
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, value: true }));
  await page.getByRole('button', { name: '到岗签到', exact: true }).click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.getByRole('button', { name: '开启摄像头', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__auditCameraRequests.length)).toBeGreaterThan(0);
  fit(await audit.capture('camera-denied'));
  expect((await page.evaluate(() => window.__auditCameraRequests))[0].video.facingMode).toEqual({ exact: 'environment' });
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await page.route('**/api/field/home', route => route.fulfill({ status: 503, json: { error: '本地模拟网络不可用' } }));
  await page.reload();
  await expect(page.getByRole('heading', { name: '工作区暂时不可用' })).toBeVisible();
  await audit.capture('workspace-network-error');
  await expect(page.getByRole('button', { name: '重新加载工作区' })).toBeVisible();
});
