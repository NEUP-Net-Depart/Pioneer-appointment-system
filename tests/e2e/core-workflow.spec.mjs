import { test, expect } from './support/fixtures.mjs';
import {
  loginStaff,
  staffPage,
  navigationEntry,
  dutyPage,
  onsiteOrder,
  publishDuty,
  staffApi
} from './support/staff.mjs';
import { chooseTime, fillDevice, goReview, submitStudent, PHOTO } from './support/student.mjs';
import { WORKFLOW_TIME } from '../fixtures/workflow-seed.mjs';
import { dateKey, weekRange, addDays } from '../../shared/time.js';

const thisWeek = weekRange(dateKey(new Date(WORKFLOW_TIME))).start;
const nextWeek = addDays(thisWeek, 7);

test('student books against the real capacity service, signs, and opens the private result', async ({
  page
}) => {
  await page.goto('/');
  await chooseTime(page);
  await fillDevice(page, { studentId: '20269991' });
  await goReview(page);
  await submitStudent(page);
  await expect(page.locator('#success-summary')).toContainText('南湖测试维修室');
  await page.locator('#view-created-appointment').click();
  await expect(page.locator('#appointment-detail')).toBeVisible();
  await expect(page.locator('#appointment-detail')).not.toContainText('操作历史');
});

test('cold entries wait for route code and business data instead of flashing the wrong content', async ({
  page
}) => {
  let release;
  const ready = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/user/main.js', async (route) => {
    await ready;
    await route.continue();
  });
  try {
    await page.goto('/#lookup', { waitUntil: 'commit' });
    await expect(page.locator('#student-loading')).toBeVisible();
    await expect(page.locator('#booking-view')).not.toBeVisible();
  } finally {
    release();
  }
  await expect(page.locator('#lookup-list')).toBeVisible();
  await expect(page.locator('#student-loading')).toBeHidden();
  await expect(page.locator('#booking-view')).toBeHidden();
  let releaseBoard;
  const boardReady = new Promise((resolve) => {
    releaseBoard = resolve;
  });
  await page.route('**/api/field/board*', async (route) => {
    await boardReady;
    await route.continue();
  });
  try {
    await loginStaff(page, 'root001', process.env.E2E_ROOT_PASSWORD);
    await staffPage(page, '今日工作');
    await expect(page.getByRole('heading', { name: '今日工作', exact: true })).toBeVisible();
    await expect(page.locator('.field-content')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByText('今日没有待接收工单', { exact: true })).not.toBeVisible();
  } finally {
    releaseBoard();
  }
  await expect(page.locator('.field-content')).toHaveAttribute('aria-busy', 'false');
});

test('working campus isolates data, survives navigation and reload, and resets between logins', async ({
  page
}) => {
  await loginStaff(page, 'root001', process.env.E2E_ROOT_PASSWORD);
  const orders = {};
  for (const [index, campus] of ['南湖', '浑南'].entries())
    orders[campus] = await onsiteOrder(page, {
      campus,
      studentId: String(20271000 + index),
      name: '校区选择回归' + campus
    });
  await staffPage(page, '今日工作');
  const work = page.locator('.field-content'),
    campus = work.getByRole('combobox', { name: '工作校区' });
  await expect(campus).toHaveValue('campus-nanhu');
  await work.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(work.getByRole('button').filter({ hasText: orders['南湖'].id })).toBeVisible();
  let releaseBoard;
  const boardReady = new Promise((resolve) => {
    releaseBoard = resolve;
  });
  await page.route('**/api/field/board*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('campusId') === 'campus-hunnan')
      await boardReady;
    await route.continue();
  });
  try {
    await campus.selectOption('campus-hunnan');
    await expect(work.getByRole('button').filter({ hasText: orders['南湖'].id })).not.toBeVisible();
    await expect(work).toHaveAttribute('aria-busy', 'true');
  } finally {
    releaseBoard();
  }
  await expect(work.getByRole('button').filter({ hasText: orders['浑南'].id })).toBeVisible();
  await expect(work.getByRole('button').filter({ hasText: orders['南湖'].id })).not.toBeVisible();
  await staffPage(page, '个人中心');
  await expect(campus).toHaveValue('campus-hunnan');
  await staffPage(page, '今日工作');
  await work.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(campus).toHaveValue('campus-hunnan');
  await page.reload();
  await staffPage(page, '今日工作');
  await expect(campus).toHaveValue('campus-hunnan');
  await expect(work.getByRole('button').filter({ hasText: orders['浑南'].id })).toBeVisible();
  await staffPage(page, '个人中心');
  await work.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.locator('#login-id')).toBeVisible();
  await loginStaff(page, '20261003', 'StaffTest!2026');
  await staffPage(page, '今日工作');
  await expect(work.locator('.field-scope')).toContainText('南湖校区');
  await staffPage(page, '个人中心');
  await work.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.locator('#login-id')).toBeVisible();
  await loginStaff(page, 'root001', process.env.E2E_ROOT_PASSWORD);
  await staffPage(page, '今日工作');
  await expect(campus).toHaveValue('campus-nanhu');
});

test('hardware staff receive photos, correct a repair and keep internal notes out of the student result', async ({
  page
}) => {
  await loginStaff(page, '20261003', 'StaffTest!2026');
  await staffPage(page, '今日工作');
  const created = await onsiteOrder(page);
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('button').filter({ hasText: created.id }).click();
  const dialog = page.getByRole('dialog', { name: '维修工单' });
  for (const side of ['正面', '背面'])
    await dialog
      .getByLabel(`设备${side}照片`, { exact: true })
      .setInputFiles({ name: side + '.png', mimeType: 'image/png', buffer: PHOTO });
  await dialog.getByRole('button', { name: '接收并开始维修', exact: true }).click();
  await expect(dialog.getByText('当前主修：周宁')).toBeVisible();
  await dialog.getByLabel('部分解决', { exact: true }).check();
  await dialog.getByLabel('简短处理说明').fill('系统恢复，键盘仍需更换（内部）');
  await dialog.getByRole('button', { name: '结束本次服务' }).click();
  await expect(dialog.getByRole('button', { name: '保存结果更正' })).toBeVisible();
  await dialog.getByLabel('已解决', { exact: true }).check();
  await dialog.getByLabel('简短处理说明').fill('键盘更换后通过复核（内部）');
  await dialog.getByRole('button', { name: '保存结果更正' }).click();
  await expect(dialog.getByText('已解决 · 键盘更换后通过复核（内部）')).toBeVisible();
  // The public HTTP projection must stay private even when the UI omits fields.
  const customer = await page.request.get(`/api/appointments/${created.id}`, {
    headers: { 'X-Appointment-Token': created.accessToken }
  });
  expect(customer.ok()).toBeTruthy();
  const visible = await customer.json();
  expect(visible.outcome).toBe('repaired');
  expect(JSON.stringify(visible)).not.toMatch(/内部|repairNote|actorAccount|before_json/);
  await page.goto(
    '/#' + new URLSearchParams({ appointment: created.id, access: created.accessToken })
  );
  const liquidMetal = page
    .locator('#detail-information dl > div')
    .filter({ has: page.getByText('液金散热', { exact: true }) });
  await expect(liquidMetal.locator('dd')).toHaveText('不清楚');
});

test('office reception lets hardware take over and a manager finish with the original owner', async ({
  page,
  context
}) => {
  await loginStaff(page, '20261001', 'StaffTest!2026');
  await staffPage(page, '今日工作');
  const created = await onsiteOrder(page, { name: '共同值班同学' });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('button').filter({ hasText: created.id }).click();
  const dialog = page.getByRole('dialog', { name: '维修工单' });
  await expect(dialog.getByRole('button', { name: '接收并开始维修', exact: true })).toHaveCount(0);
  for (const side of ['正面', '背面'])
    await dialog
      .getByLabel(`设备${side}照片`, { exact: true })
      .setInputFiles({ name: side + '.png', mimeType: 'image/png', buffer: PHOTO });
  await dialog.getByRole('button', { name: '仅接收设备', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '仅接收设备', exact: true })).toHaveCount(0);
  const worker = await context.newPage();
  await loginStaff(worker, '20261003', 'StaffTest!2026');
  await staffPage(worker, '今日工作');
  await worker.getByRole('button').filter({ hasText: created.id }).click();
  const workDialog = worker.getByRole('dialog', { name: '维修工单' });
  await expect(workDialog.getByLabel('设备正面照片', { exact: true })).toHaveCount(0);
  await workDialog.getByRole('button', { name: '确认接手并开始维修', exact: true }).click();
  await expect(workDialog.getByRole('button', { name: '结束本次服务', exact: true })).toBeVisible();
  await page.reload();
  await staffPage(page, '今日工作');
  await page.getByRole('button').filter({ hasText: created.id }).click();
  await dialog.getByLabel('部分解决', { exact: true }).check();
  await dialog.getByLabel('简短处理说明').fill('系统恢复，键盘仍需更换');
  await dialog.getByRole('button', { name: '结束本次服务', exact: true }).click();
  await expect(dialog.getByText('部分解决 · 系统恢复，键盘仍需更换')).toBeVisible();
  await expect(dialog.getByText('当前主修：周宁')).toBeVisible();
});

test('member availability produces a published shift visible after reloading', async ({
  page,
  context
}) => {
  await loginStaff(page, '20261003');
  let personal = await dutyPage(page, '我的值班');
  await personal.getByLabel('所在周').fill(nextWeek);
  await personal.getByRole('button', { name: '修改通常时间', exact: true }).click();
  await personal.getByRole('checkbox', { name: '周一', exact: true }).check();
  await personal.getByRole('button', { name: '保存空闲', exact: true }).click();
  await expect(personal.getByRole('button', { name: '修改通常时间', exact: true })).toBeVisible();
  const manager = await context.newPage();
  await loginStaff(manager, '20261001');
  const planner = await dutyPage(manager, '安排下周');
  await planner.getByLabel('所在周').fill(nextWeek);
  await planner.getByRole('button', { name: '生成建议班表', exact: true }).click();
  await expect(planner.getByRole('button', { name: /^移除周宁 / })).toBeVisible();
  await planner.getByRole('button', { name: '发布班表', exact: true }).click();
  await expect(planner.getByRole('button', { name: '发布班表', exact: true })).toBeDisabled();
  await page.reload();
  personal = await dutyPage(page, '我的值班');
  await personal.getByLabel('所在周').fill(nextWeek);
  await expect(personal.getByRole('article').filter({ hasText: nextWeek })).toContainText('维修');
});

test('a member requests leave and the recipient confirms the replacement', async ({
  page,
  context
}) => {
  await loginStaff(page);
  await publishDuty(page, { weekStart: nextWeek });
  const worker = await context.newPage();
  await loginStaff(worker, '20261003');
  const personal = await dutyPage(worker, '我的值班');
  await personal.getByLabel('所在周').fill(nextWeek);
  const shift = personal.getByRole('article').filter({ hasText: nextWeek });
  await shift.getByRole('button', { name: '登记请假', exact: true }).click();
  await personal.getByLabel('请假原因').fill('临时有课');
  await shift.getByRole('button', { name: '登记请假', exact: true }).click();
  await expect(shift.getByRole('button', { name: '撤销请假', exact: true })).toBeVisible();
  await shift.getByRole('button', { name: '邀请接替', exact: true }).click();
  await personal
    .getByRole('combobox', { name: '接替成员', exact: true })
    .selectOption('member-root001');
  await shift.getByRole('button', { name: '发送接替邀请', exact: true }).click();
  await expect(personal.getByText('待对方确认', { exact: false })).toBeVisible();
  const recipient = await dutyPage(page, '我的值班');
  await recipient.getByLabel('所在周').fill(nextWeek);
  await recipient.getByRole('button', { name: '确认接替', exact: true }).click();
  await expect(
    recipient
      .getByRole('article')
      .filter({ hasText: nextWeek })
      .filter({ hasText: '周宁 → 预览负责人' })
  ).toContainText('已接替');
});

test('daily duty review and historical arrival correction update the selected member', async ({
  page
}) => {
  await loginStaff(page, '20261001');
  await publishDuty(page, { weekStart: thisWeek });
  const daily = await dutyPage(page, '今日值班');
  await daily.getByLabel('值班日期').fill(thisWeek);
  const person = daily.getByRole('article').filter({ hasText: '周宁' });
  await expect(person.getByText('未签到', { exact: true })).toBeVisible();
  await person.getByRole('button', { name: '确认未到', exact: true }).click();
  await expect(person.getByText('已确认未到', { exact: true })).toBeVisible();
  await person.getByRole('button', { name: '撤销未到', exact: true }).click();
  await expect(person.getByText('未签到', { exact: true })).toBeVisible();
  await person.getByRole('button', { name: '补记漏签', exact: true }).click();
  const correction = page.getByRole('dialog', { name: '补记漏签', exact: true });
  await expect(correction).toContainText('周宁');
  await expect(correction.getByLabel('实际到场时间')).toHaveValue(`${thisWeek}T19:00`);
  await correction.getByLabel('补录或修正原因').fill('现场已核实漏签');
  await correction.getByRole('button', { name: '保存考勤', exact: true }).click();
  await expect(person.getByText('已签到', { exact: true })).toBeVisible();
});

test('save-and-switch retains a failed draft and navigates only after a successful save', async ({
  page
}) => {
  await loginStaff(page, 'root001', process.env.E2E_ROOT_PASSWORD);
  await staffPage(page, '预约配置');
  await page.getByRole('button', { name: '放号时间', exact: true }).click();
  const time = page.getByLabel('放号时间（北京时间）');
  await expect(time).toBeEnabled();
  const original = await time.inputValue(),
    next = original === '08:00' ? '09:00' : '08:00';
  await time.fill(next);
  const rejectSave = (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 503, json: { error: '测试保存失败' } })
      : route.continue();
  await page.route('**/api/booking-settings', rejectSave);
  await (await navigationEntry(page, '预约记录')).click();
  await page.getByRole('button', { name: '保存并切换', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('测试保存失败');
  await expect(time).toHaveValue(next);
  const before = await staffApi(
    page,
    '/api/booking-settings/manage?campus=' + encodeURIComponent('南湖'),
    null,
    'GET'
  );
  expect(before.settings.releaseTime).toBe(original);
  await page.unroute('**/api/booking-settings', rejectSave);
  await page.getByRole('button', { name: '保存并切换', exact: true }).click();
  await expect(page.getByRole('heading', { name: '预约记录', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const after = await staffApi(
    page,
    '/api/booking-settings/manage?campus=' + encodeURIComponent('南湖'),
    null,
    'GET'
  );
  expect(after.settings.releaseTime).toBe(next);
});
