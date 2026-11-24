import { present } from '../helpers/present.ts';
import type { StaffResult } from './support/staff.ts';
import { test, expect } from './support/fixtures.ts';
import { loginStaff, dutyPage, staffApi, staffPage, navigationEntry } from './support/staff.ts';
import { dateKey } from '../../shared/time.ts';
import { WORKFLOW_TIME } from '../fixtures/workflow-seed.ts';

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
    expect(present(bounds).height).toBeGreaterThanOrEqual(44);
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

  async function attendanceImage(page: import('@playwright/test').Page, campusId: string) {
    await staffApi(page, '/api/attendance/self-check-in', { campusId, requestId: crypto.randomUUID() });
    const event = await staffApi<StaffResult<'createAttendanceEvent'>>(page, '/api/attendance/events', { campusId, type: 'duty', requestId: crypto.randomUUID() });
    const credential = await staffApi<StaffResult<'issueAttendanceToken'>>(page, `/api/attendance/events/${event.id}/token`, { revision: event.revision });
    const bytes = await page.evaluate(async (token: string) => {
      const { qrImage } = await import('/shared/zxing.js');
      const image = await qrImage(token);
      return Array.from(new Uint8Array(await image.arrayBuffer()));
    }, credential.token);
    return { name: 'attendance.png', mimeType: 'image/png', buffer: Buffer.from(bytes) };
  }

  test('wrong-campus QR stays in the dialog and a local QR can be rescanned @smoke @mobile-smoke', async ({ page, context }) => {
    await loginStaff(page);
    const wrongCampus = await attendanceImage(page, 'campus-hunnan');
    const issuer = await context.newPage();
    await loginStaff(issuer, '20261001');
    const localCampus = await attendanceImage(issuer, 'campus-nanhu');
    const member = await context.newPage();
    await loginStaff(member, '20261003');
    await staffPage(member, '今日工作');
    await member.getByRole('button', { name: '扫码', exact: true }).click();
    const album = member.getByLabel('相册识别', { exact: true });
    await album.setInputFiles(wrongCampus);
    const confirmation = member.getByRole('dialog', { name: '确认到岗信息', exact: true });
    await expect(confirmation.getByRole('alert')).toHaveText('你没有该校区的签到权限');
    await expect(confirmation.getByRole('button', { name: '确认签到', exact: true })).toHaveCount(0);
    await expect(member.getByRole('button', { name: '重新加载工作区', exact: true })).toHaveCount(0);
    await confirmation.getByRole('button', { name: '重新扫码', exact: true }).click();
    await album.setInputFiles(localCampus);
    await confirmation.getByRole('button', { name: '确认签到', exact: true }).click();
    await expect(member.getByRole('dialog')).toHaveCount(0);
    await expect(member.getByRole('region', { name: '工作视窗' }).getByText('已签到', { exact: true })).toBeVisible();
  });

  test('QR confirmation reminds an unfilled repair member without a form or a second result dialog', async ({ page, context }) => {
    await loginStaff(page, '20261001');
    const image = await attendanceImage(page, 'campus-nanhu');
    const member = await context.newPage();
    await loginStaff(member, '20261003');
    await staffPage(member, '今日工作');
    await member.getByRole('button', { name: '扫码', exact: true }).click();
    await member.getByLabel('相册识别', { exact: true }).setInputFiles(image);
    const confirmation = member.getByRole('dialog', { name: '确认到岗信息', exact: true });
    await expect(confirmation).toBeVisible();
    await expect(member.getByRole('dialog')).toHaveCount(1);
    await expect(confirmation.getByRole('note')).toContainText('下周空闲未填写');
    await expect(confirmation.getByRole('checkbox')).toHaveCount(0);
    await expect(confirmation.getByRole('button', { name: '确认签到', exact: true })).toBeEnabled();
    if (present(member.viewportSize()).width < 600) await confirmation.screenshot({ path: 'output/issue151-demo/check-in-reminder-mobile.png' });
    await confirmation.getByRole('button', { name: '确认签到', exact: true }).click();
    await expect(member.getByRole('dialog')).toHaveCount(0);
    await expect(member.getByRole('region', { name: '工作视窗' }).getByText('已签到', { exact: true })).toBeVisible();
    const availability = await staffApi<StaffResult<'availability'>>(member, '/api/me/availability', null, 'GET');
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
    await expect(confirmation.getByRole('note')).toHaveCount(0);
    await page.route('**/api/attendance/self-check-in', async (route) => {
      await route.fetch();
      await route.abort('failed');
    }, { times: 1 });
    await confirmation.getByRole('button', { name: '确认签到', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(personal.locator('.duty-checkin-actions')).toContainText('已签到');
    const attendance = await staffApi<StaffResult<'attendanceList'>>(page, '/api/me/attendance?businessDate=2026-10-15&campusId=campus-nanhu', null, 'GET');
    expect(attendance.items).toHaveLength(1);
  });

  test('repair omissions remain visible before suggestions, after manual changes and after publishing an office shift', async ({ page, browserName }) => {
    await loginStaff(page, '20261001');
    const planner = await dutyPage(page, '安排下周');
    const review = planner.getByRole('region', { name: '异常信息', exact: true });
    const openReview = () => planner.getByRole('button', { name: /^异常信息/ }).click();
    const closeReview = () => page.getByRole('dialog', { name: '异常信息', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
    const assigneeInPlanner = () => planner.locator('.duty-assignee').getByRole('button', { name: '周宁', exact: true });
    const removeShift = async () => {
      await planner.getByRole('button', { name: '移除周宁', exact: true }).click();
    };
    const repair = review.getByRole('list', { name: '维修待安排成员', exact: true });
    await openReview();
    await expect(repair.getByText('周宁', { exact: true })).toBeVisible();
    await expect(repair).toContainText('未填写统计表');
    await closeReview();
    await planner.getByRole('button', { name: '生成建议班表', exact: true }).click();
    await expect(planner.getByText('建议已生成', { exact: true })).toBeVisible();
    await openReview();
    await expect(repair.getByText('周宁', { exact: true })).toHaveCount(0);
    await expect(review.getByRole('button', { name: /周宁.*自动.*未填写统计表/ })).toBeVisible();
    await closeReview();
    await assigneeInPlanner().click();
    const member = page.getByRole('dialog', { name: '周宁', exact: true });
    await expect(member.getByText('未填写统计表', { exact: true }).first()).toBeVisible();
    await member.getByRole('button', { name: '交换班次', exact: true }).click();
    await member.getByRole('combobox', { name: '与谁交换', exact: true }).click();
    await expect(member.getByRole('option', { name: /预览负责人/ })).toBeEnabled();
    await member.getByRole('button', { name: '移动班次', exact: true }).click();
    await member.getByRole('combobox', { name: '移动到', exact: true }).click();
    await member.locator('[role="option"]:not(:disabled)').filter({ hasText: '维修' }).first().click();
    await member.getByRole('button', { name: '确认调整', exact: true }).click();
    await expect(member).toHaveCount(0);
    await planner.getByRole('button', { name: '撤销', exact: true }).click();
    if (browserName === 'chromium') {
      const assignee = page.locator('.duty-assignee').getByRole('button', { name: '周宁', exact: true });
      const columns = planner.locator('.duty-day-column');
      const weekday = await columns.filter({ hasNot: assignee }).first().getByRole('heading', { level: 3 }).innerText();
      const target = columns.filter({ has: page.getByRole('heading', { name: weekday, level: 3, exact: true }) }).locator('.duty-shift-group').first();
      await planner.locator('.duty-assignee').getByRole('button', { name: '周宁', exact: true }).dragTo(target);
      await expect(target.getByRole('button', { name: '周宁', exact: true })).toBeVisible();
      await planner.getByRole('button', { name: '撤销', exact: true }).click();
    }
    await removeShift();
    await openReview();
    await expect(repair.getByText('周宁', { exact: true })).toBeVisible();
    await closeReview();
    await planner.getByRole('button', { name: /选择人员$/ }).first().click();
    let picker = page.getByRole('dialog', { name: '选择值班人员', exact: true });
    await expect(picker.getByRole('checkbox', { name: /陈宇/ })).toBeVisible();
    await picker.getByRole('checkbox', { name: /周宁/ }).check();
    await picker.getByRole('button', { name: '完成选择', exact: true }).click();
    await expect(assigneeInPlanner()).toBeVisible();
    await removeShift();
    await planner.getByRole('button', { name: /选择人员$/ }).nth(1).click();
    picker = page.getByRole('dialog', { name: '选择值班人员', exact: true });
    await expect(picker.getByRole('checkbox', { name: /周宁/ })).toHaveCount(0);
    await picker.getByRole('checkbox', { name: /陈宇/ }).check();
    await picker.getByRole('button', { name: '完成选择', exact: true }).click();
    await (await navigationEntry(page, '今日工作')).click();
    const leave = page.getByRole('dialog', { name: '有未保存的调整' });
    await expect(leave.getByRole('button', { name: '发布并继续', exact: true })).toBeVisible();
    await leave.getByRole('button', { name: '取消操作' }).click();
    await planner.getByRole('button', { name: '发布班表', exact: true }).click();
    await page.getByRole('dialog', { name: '发布前确认', exact: true }).getByRole('button', { name: '确认发布', exact: true }).click();
    await expect(planner.getByText('班表已发布', { exact: true })).toBeVisible();
    await openReview();
    await expect(repair.getByText('周宁', { exact: true })).toBeVisible();
    await expect(review.getByRole('heading', { name: '缺岗', exact: true })).toBeVisible();
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
  const detail = await staffApi<StaffResult<'memberDetail'>>(page, '/api/members/member-20261003', null, 'GET');
  await staffApi(page, '/api/members/member-20261003/memberships', {
    revision: detail.member.revision,
    effectiveFrom: dateKey(new Date(WORKFLOW_TIME)),
    requestId: crypto.randomUUID(),
    memberships: [
      {
        assignmentType: 'primary',
        departmentId: 'dept-hardware',
        positionCode: 'deputy_head',
        replacesMembershipId: present(detail.member.memberships.find(
          (post) => post.assignmentType === 'primary'
        )).id
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
  await expect(planner.getByText('建议已生成', { exact: true })).toBeVisible();
  await expect(planner.locator('.duty-assignee').getByRole('button', { name: '周宁', exact: true })).toHaveCount(0);
  await expect(planner.getByText(/缺少硬件部负责人/)).toHaveCount(0);
  await planner.getByRole('button', { name: /选择人员$/ }).first().click();
  const picker = page.getByRole('dialog', { name: '选择值班人员', exact: true });
  await expect(picker.getByRole('checkbox', { name: /周宁/ })).toHaveCount(0);
  await expect(picker.getByRole('checkbox', { name: /林悦/ })).toHaveCount(0);
  await worker.close();
});

test('exchange-only members see nonparticipation instead of availability controls', async ({ page, context }) => {
  await loginStaff(page);
  const detail = await staffApi<StaffResult<'memberDetail'>>(page, '/api/members/member-20261004', null, 'GET');
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
