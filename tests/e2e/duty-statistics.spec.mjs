import { test, expect } from './support/fixtures.mjs';
import { loginStaff, dutyPage, staffApi, staffPage } from './support/staff.mjs';
import { dateKey } from '../../shared/time.js';
import { WORKFLOW_TIME } from '../fixtures/workflow-seed.mjs';

test('unified availability offers four weekdays with accessible mobile controls', async ({
  page
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loginStaff(page, '20261002');
  const personal = await dutyPage(page, '我的值班');
  const statistics = personal.getByRole('region', { name: '空闲时间', exact: true });
  await expect(
    statistics.getByRole('heading', { name: '空闲时间', exact: true })
  ).toBeVisible();
  await statistics.getByRole('button', { name: '修改通常时间', exact: true }).click();
  await expect(statistics.getByRole('button', { name: '保存空闲', exact: true })).toBeDisabled();
  const campus = statistics.getByRole('group', { name: '南湖', exact: true });
  await expect(campus.getByRole('checkbox')).toHaveCount(4);
  for (const name of ['周五', '周六', '周日'])
    await expect(statistics.getByRole('checkbox', { name, exact: true })).toHaveCount(0);
  await campus.getByRole('checkbox', { name: '周一', exact: true }).check();
  await campus.getByRole('checkbox', { name: '周四', exact: true }).check();
  const keyboardChoice = campus.getByRole('checkbox', { name: '周二', exact: true });
  await keyboardChoice.focus();
  await page.keyboard.press('Space');
  await expect(keyboardChoice).toBeChecked();
  for (const label of await campus.locator('label').all()) {
    const bounds = await label.boundingBox();
    expect(bounds.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await statistics.getByRole('heading').click();
  await statistics.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await statistics.screenshot({ path: 'output/issue151-demo/duty-statistics-office-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await statistics.screenshot({ path: 'output/issue151-demo/duty-statistics-office-desktop.png' });
  await statistics.getByRole('button', { name: '保存空闲', exact: true }).click();
  await expect(statistics.getByRole('button', { name: '修改通常时间', exact: true })).toBeVisible();
  await page.reload();
  await dutyPage(page, '我的值班');
  await expect(statistics).toContainText('周一 南湖、周二 南湖、周四 南湖');
});

test.describe('single check-in confirmation and scheduling review', () => {
  test.use({ workflowTime: '2026-10-15T11:10:00Z' });

  async function supportCode(page, campusId = 'campus-hunnan', account = 'root001') {
    await loginStaff(page, account);
    await staffApi(page, '/api/attendance/self-check-in', { campusId, requestId: crypto.randomUUID() });
    const event = await staffApi(page, '/api/attendance/events', { campusId, type: 'duty' });
    const credential = await staffApi(page, `/api/attendance/events/${event.id}/token`, { revision: event.revision });
    const bytes = await page.evaluate(async (token) => {
      const { qrImage } = await import('/shared/zxing.js');
      const image = await qrImage(token);
      return Array.from(new Uint8Array(await image.arrayBuffer()));
    }, credential.token);
    return { name: 'support.png', mimeType: 'image/png', buffer: Buffer.from(bytes) };
  }

  test('capture cross-campus attendance dialogs', async ({ page, context }) => {
    const support = await supportCode(page);
    const { publishDuty } = await import('./support/staff.mjs');
    await publishDuty(page, { weekStart: '2026-10-12', businessDate: '2026-10-15' });
    const home = await supportCode(await context.newPage(), 'campus-nanhu', '20261001');
    const member = await context.newPage();
    await loginStaff(member, '20261003');
    await staffPage(member, '今日工作');
    const scan = async (image) => {
      await member.getByRole('button', { name: '扫码', exact: true }).click();
      await member.screenshot({ path: 'output/attendance-preview/scanner.png', animations: 'disabled' });
      await member.getByLabel('相册识别', { exact: true }).setInputFiles(image);
    };
    await scan(support);
    const confirm = member.getByRole('button', { name: '确认在浑南签到' });
    await expect(confirm).toBeEnabled();
    await member.screenshot({ path: 'output/attendance-preview/support.png', animations: 'disabled' });
    await confirm.click();
    await expect(member.getByRole('dialog')).toHaveCount(0);
    await member.screenshot({ path: 'output/attendance-preview/signed.png', animations: 'disabled' });
    await scan(home);
    await expect(member.getByRole('alert')).toContainText('不能在两个校区重复签到');
    await member.screenshot({ path: 'output/attendance-preview/conflict.png', animations: 'disabled' });
  });

  test('cross-campus support check-in recovers a lost response and stays signed after reloading', async ({ page, context }) => {
    const image = await supportCode(page);
    const member = await context.newPage();
    await loginStaff(member, '20261003');
    await staffPage(member, '今日工作');
    await member.getByRole('button', { name: '扫码', exact: true }).click();
    await member.getByLabel('相册识别', { exact: true }).setInputFiles(image);
    const confirmation = member.getByRole('dialog', { name: '确认到岗信息', exact: true });
    await expect(confirmation).toContainText('浑南校区');
    await member.route('**/api/attendance/check-ins', async (route) => {
      await route.fetch();
      await route.abort('failed');
    }, { times: 1 });
    await confirmation.getByRole('button', { name: '确认签到', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    const window = member.getByRole('region', { name: '工作视窗' });
    await expect(window.getByText('已签到', { exact: true })).toBeVisible();
    await member.reload();
    await expect(window.getByText('已签到', { exact: true })).toBeVisible();
    const history = await staffApi(member, '/api/me/attendance?campusId=campus-hunnan', null, 'GET');
    expect(history.items).toHaveLength(1);
    expect(history.items[0].campusId).toBe('campus-hunnan');
    expect(history.items[0].nonScheduled).toBe(true);
    const summary = await staffApi(member, '/api/me/volunteer-summary', null, 'GET');
    expect(summary.totalHours).toBeGreaterThan(0);
  });

  test('check-in failures stay in the dialog, revalidate identity and allow retry or rescan', async ({ page, context }) => {
    const image = await supportCode(page);
    const member = await context.newPage();
    await loginStaff(member, '20261003');
    await staffPage(member, '今日工作');
    let attempts = 0;
    await member.route('**/api/attendance/preview', async (route) => {
      attempts++;
      if (attempts === 1)
        return route.fulfill({ status: 403, json: { error: '当前身份无法签到，请联系负责人核对任职信息', code: 'ATTENDANCE_IDENTITY_DENIED' } });
      if (attempts === 2)
        return route.fulfill({ status: 409, json: { error: '该日期暂停维修，不能签到', code: 'SERVICE_DAY_PAUSED' } });
      return route.continue();
    });
    await member.getByRole('button', { name: '扫码', exact: true }).click();
    const refreshedIdentity = member.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/me');
    await member.getByLabel('相册识别', { exact: true }).setInputFiles(image);
    const confirmation = member.getByRole('dialog', { name: '确认到岗信息', exact: true });
    await expect(confirmation.getByRole('alert')).toContainText('当前身份无法签到');
    await member.screenshot({ path: 'output/attendance-preview/identity.png', animations: 'disabled' });
    expect((await refreshedIdentity).ok()).toBe(true);
    await expect(member.getByRole('button', { name: '重新加载工作区', exact: true })).toHaveCount(0);
    await expect(confirmation.getByRole('button', { name: '确认签到', exact: true })).toBeDisabled();
    await confirmation.getByRole('button', { name: '重新读取', exact: true }).click();
    await expect(confirmation.getByRole('alert')).toContainText('暂停维修');
    await member.screenshot({ path: 'output/attendance-preview/paused.png', animations: 'disabled' });
    await confirmation.getByRole('button', { name: '重新扫码', exact: true }).click();
    await expect(member.getByRole('dialog', { name: '工作人员签到', exact: true })).toBeVisible();
    await member.getByLabel('相册识别', { exact: true }).setInputFiles(image);
    await expect(confirmation.getByRole('button', { name: '确认签到', exact: true })).toBeEnabled();
    await confirmation.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(member.getByRole('dialog')).toHaveCount(0);
    await expect(member.getByRole('region', { name: '工作视窗' })).toBeVisible();
  });

  test('QR confirmation reminds an unfilled repair member without a form or a second result dialog', async ({ page, context }) => {
    await loginStaff(page, '20261001');
    await staffApi(page, '/api/attendance/self-check-in', { campusId: 'campus-nanhu', requestId: crypto.randomUUID() });
    const event = await staffApi(page, '/api/attendance/events', { campusId: 'campus-nanhu', type: 'duty', requestId: crypto.randomUUID() });
    const credential = await staffApi(page, `/api/attendance/events/${event.id}/token`, { revision: event.revision });
    const bytes = await page.evaluate(async (token) => {
      const { qrImage } = await import('/shared/zxing.js');
      const image = await qrImage(token);
      return Array.from(new Uint8Array(await image.arrayBuffer()));
    }, credential.token);
    const member = await context.newPage();
    await loginStaff(member, '20261003');
    await staffPage(member, '今日工作');
    await member.getByRole('button', { name: '扫码', exact: true }).click();
    await member.getByLabel('相册识别', { exact: true }).setInputFiles({ name: 'attendance.png', mimeType: 'image/png', buffer: Buffer.from(bytes) });
    const confirmation = member.getByRole('dialog', { name: '确认到岗信息', exact: true });
    await expect(confirmation).toBeVisible();
    await expect(member.getByRole('dialog')).toHaveCount(1);
    await expect(confirmation.getByRole('note')).toContainText('下周空闲未填写');
    await expect(confirmation.getByRole('checkbox')).toHaveCount(0);
    await expect(confirmation.getByRole('button', { name: '确认签到', exact: true })).toBeEnabled();
    if (member.viewportSize().width < 600) await confirmation.screenshot({ path: 'output/issue151-demo/check-in-reminder-mobile.png' });
    await confirmation.getByRole('button', { name: '确认签到', exact: true }).click();
    await expect(member.getByRole('dialog')).toHaveCount(0);
    await expect(member.getByRole('region', { name: '工作视窗' }).getByText('已签到', { exact: true })).toBeVisible();
    const availability = await staffApi(member, '/api/me/availability', null, 'GET');
    expect(availability.usual.revision).toBe(-1);
  });

  test('direct check-in shares confirmation, omits completed reminders and recovers a lost response', async ({ page }) => {
    await loginStaff(page, '20261002');
    await staffApi(page, '/api/me/availability', { weekStart: '', revision: -1, requestId: crypto.randomUUID(), windows: [{ weekday: 1, campusId: 'campus-nanhu', startAt: '19:00', endAt: '21:00' }] }, 'PUT');
    const personal = await dutyPage(page, '我的值班');
    await personal.getByRole('button', { name: '到岗签到', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: '确认到岗信息', exact: true });
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole('heading', { name: '陈宇', exact: true })).toBeVisible();
    await page.screenshot({ path: 'output/attendance-preview/direct.png', animations: 'disabled' });
    await expect(confirmation.getByRole('note')).toHaveCount(0);
    await page.route('**/api/attendance/self-check-in', async (route) => {
      await route.fetch();
      await route.abort('failed');
    }, { times: 1 });
    await confirmation.getByRole('button', { name: '确认签到', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(personal.locator('.duty-checkin-actions')).toContainText('已签到');
    const attendance = await staffApi(page, '/api/me/attendance?businessDate=2026-10-15&campusId=campus-nanhu', null, 'GET');
    expect(attendance.items).toHaveLength(1);
  });

  test('repair omissions remain visible before suggestions, after manual changes and after publishing an office shift', async ({ page }) => {
    await loginStaff(page, '20261001');
    const planner = await dutyPage(page, '安排下周');
    const review = planner.getByRole('region', { name: '排班核对', exact: true });
    const repair = review.getByRole('list', { name: '维修待安排成员', exact: true });
    await expect(repair.getByText('周宁', { exact: true })).toBeVisible();
    await expect(repair).toContainText('尚未填空闲');
    await planner.getByRole('button', { name: '生成建议班表', exact: true }).click();
    await expect(planner.getByText('建议已生成，请核对后发布', { exact: true })).toBeVisible();
    await expect(repair.getByText('周宁', { exact: true })).toHaveCount(0);
    await expect(planner.getByRole('group', { name: '排班概览' })).toContainText('空闲冲突');
    await planner.getByRole('button', { name: /^移除周宁 / }).click();
    await expect(repair.getByText('周宁', { exact: true })).toBeVisible();
    await planner.getByRole('button', { name: '选择人员', exact: true }).first().click();
    let picker = page.getByRole('dialog', { name: '选择值班人员', exact: true });
    await picker.getByRole('checkbox', { name: /周宁/ }).check();
    await picker.getByRole('button', { name: '完成选择', exact: true }).click();
    await expect(repair.getByText('周宁', { exact: true })).toHaveCount(0);
    await planner.getByRole('button', { name: /^移除周宁 / }).click();
    await expect(repair.getByText('周宁', { exact: true })).toBeVisible();
    await planner.getByRole('button', { name: '选择人员', exact: true }).nth(1).click();
    picker = page.getByRole('dialog', { name: '选择值班人员', exact: true });
    await picker.getByRole('checkbox', { name: /陈宇/ }).check();
    await picker.getByRole('button', { name: '完成选择', exact: true }).click();
    await planner.getByRole('button', { name: '发布班表', exact: true }).click();
    await expect(planner.getByText('维修和办公班表已发布，签到已自动准备', { exact: true })).toBeVisible();
    await expect(repair.getByText('周宁', { exact: true })).toBeVisible();
    await expect(review.getByRole('heading', { name: '维修值班', exact: true }).locator('..')).toContainText('缺岗：');
  });
});

test('duty statistics excludes a promoted deputy and their old availability from automatic and manual planning', async ({
  page,
  context
}) => {
  const worker = await context.newPage();
  await loginStaff(worker, '20261003');
  const personal = await dutyPage(worker, '我的值班');
  await expect(personal.getByRole('heading', { name: '空闲时间', exact: true })).toBeVisible();
  await staffApi(
    worker,
    '/api/me/availability',
    {
      weekStart: '',
      revision: -1,
      requestId: crypto.randomUUID(),
      windows: [{ weekday: 1, campusId: 'campus-nanhu', startAt: '19:00', endAt: '21:00' }]
    },
    'PUT'
  );
  await loginStaff(page);
  const detail = await staffApi(page, '/api/members/member-20261003', null, 'GET');
  await staffApi(page, '/api/members/member-20261003/memberships', {
    revision: detail.member.revision,
    effectiveFrom: dateKey(new Date(WORKFLOW_TIME)),
    requestId: crypto.randomUUID(),
    memberships: [
      {
        assignmentType: 'primary',
        departmentId: 'dept-hardware',
        positionCode: 'deputy_head',
        replacesMembershipId: detail.member.memberships.find(
          (post) => post.assignmentType === 'primary'
        ).id
      }
    ]
  });
  await loginStaff(worker, '20261003');
  const excluded = await dutyPage(worker, '我的值班');
  const statistics = excluded.getByRole('region', { name: '值班统计', exact: true });
  await expect(statistics.getByText('不参与值班统计', { exact: true })).toBeVisible();
  await expect(statistics.getByRole('button')).toHaveCount(0);
  const planner = await dutyPage(page, '安排下周');
  await planner.getByRole('button', { name: '生成建议班表', exact: true }).click();
  await expect(planner.getByText('建议已生成，请核对后发布', { exact: true })).toBeVisible();
  await expect(planner.getByRole('button', { name: /^移除周宁 / })).toHaveCount(0);
  await expect(planner.getByText(/缺少硬件部负责人/)).toHaveCount(0);
  await planner.getByRole('button', { name: '选择人员', exact: true }).first().click();
  const picker = page.getByRole('dialog', { name: '选择值班人员', exact: true });
  await expect(picker.getByRole('checkbox', { name: /周宁/ })).toHaveCount(0);
  await expect(picker.getByRole('checkbox', { name: /林悦/ })).toHaveCount(0);
  await worker.close();
});

test('exchange-only members see nonparticipation instead of availability controls', async ({ page, context }) => {
  await loginStaff(page);
  const detail = await staffApi(page, '/api/members/member-20261004', null, 'GET');
  await staffApi(page, '/api/members/member-20261004/memberships', {
    revision: detail.member.revision,
    effectiveFrom: dateKey(new Date(WORKFLOW_TIME)),
    requestId: crypto.randomUUID(),
    memberships: [{ assignmentType: 'exchange', departmentId: 'dept-hardware', positionCode: 'member' }]
  });
  const member = await context.newPage();
  await loginStaff(member, '20261004');
  const personal = await dutyPage(member, '我的值班');
  const statistics = personal.getByRole('region', { name: '值班统计', exact: true });
  await expect(statistics.getByText('不参与值班统计', { exact: true })).toBeVisible();
  await expect(statistics.getByRole('button')).toHaveCount(0);
  await expect(statistics.getByRole('checkbox')).toHaveCount(0);
});

test('duty statistics keeps a clear nonparticipation panel for department heads on mobile', async ({
  page
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loginStaff(page, '20261001');
  const personal = await dutyPage(page, '我的值班');
  const statistics = personal.getByRole('region', { name: '值班统计', exact: true });
  await expect(statistics.getByText('不参与值班统计', { exact: true })).toBeVisible();
  await expect(statistics.getByRole('checkbox')).toHaveCount(0);
  await expect(statistics.getByRole('button')).toHaveCount(0);
  await statistics.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expect(page.getByText('登录成功', { exact: true })).toHaveCSS('opacity', '0');
  await statistics.screenshot({ path: 'output/issue151-demo/duty-statistics-exempt-mobile.png' });
});
