import { test, expect } from './support/fixtures.mjs';
import {
  loginStaff,
  chooseOption,
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

test('release time links editable input with four independent continuous tube digits', async ({
  page,
  isMobile
}) => {
  await loginStaff(page);
  await staffPage(page, '预约配置');
  await page.getByRole('button', { name: '放号时间', exact: true }).click();
  const field = page.getByLabel('放号时间（北京时间）', { exact: true });
  await expect(field).toBeEnabled();
  await field.fill('09:59');
  const trigger = page.getByRole('button', { name: '选择放号时间', exact: true });
  await field.click();
  const dialog = page.getByRole('dialog', { name: '选择放号时间', exact: true });
  const hourTens = dialog.getByRole('spinbutton', { name: '小时十位', exact: true });
  const hours = dialog.getByRole('spinbutton', { name: '小时个位', exact: true });
  const minuteTens = dialog.getByRole('spinbutton', { name: '分钟十位', exact: true });
  const minutes = dialog.getByRole('spinbutton', { name: '分钟个位', exact: true });
  await expect(field).toBeFocused();
  await expect(dialog.getByRole('spinbutton')).toHaveCount(4);
  if (isMobile) {
    const digit = await minutes.boundingBox();
    await page.mouse.move(digit.x + digit.width / 2, digit.y + digit.height / 2);
    await page.mouse.down();
    await page.mouse.move(digit.x + digit.width / 2, digit.y + digit.height / 2 - 18, { steps: 3 });
    await page.mouse.up();
  } else {
    await minutes.hover();
    await page.mouse.wheel(0, 40);
  }
  await expect(minutes).toHaveAttribute('aria-valuenow', '0');
  await expect(hours).toHaveAttribute('aria-valuenow', '9');
  await expect(minuteTens).toHaveAttribute('aria-valuenow', isMobile ? '5' : '0');
  await expect(field).toHaveValue(isMobile ? '09:50' : '09:00');
  if (!isMobile) {
    await minuteTens.hover();
    await page.mouse.wheel(0, -40);
    await expect(field).toHaveValue('09:50');
    await hourTens.hover();
    await page.mouse.wheel(0, 120);
    await expect(field).toHaveValue('19:50');
    await field.fill('09:09');
    await minutes.hover();
    await page.mouse.wheel(0, 120);
    await expect(field).toHaveValue('09:10');
    await minuteTens.hover();
    await page.mouse.wheel(0, 120);
    await expect(field).toHaveValue('09:20');
    await hours.hover();
    await page.mouse.wheel(0, 120);
    await expect(field).toHaveValue('10:20');
    await field.fill('23:59');
    await hours.hover();
    await page.mouse.wheel(0, 360);
    await expect(field).toHaveValue('00:59');
    await page.mouse.wheel(0, -120);
    await expect(field).toHaveValue('23:59');
    await field.fill('09:50');
  }
  const bounds = await minutes.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 - 36, {
    steps: 6
  });
  await page.mouse.up();
  await expect(minutes).toHaveAttribute('aria-valuenow', '2');
  await expect(field).toHaveValue('09:52');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(field).toHaveValue('09:59');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await hourTens.press('End');
  await expect(field).toHaveValue('23:59');
  await expect(hours).toHaveAttribute('aria-valuemax', '3');
  await hours.press('ArrowUp');
  await expect(field).toHaveValue('20:59');
  await hours.press('ArrowRight');
  await expect(minuteTens).toBeFocused();
  await field.fill('12:00');
  await expect(hourTens).toHaveAttribute('aria-valuenow', '1');
  await expect(hours).toHaveAttribute('aria-valuenow', '2');
  for (let tens = 0; tens < 6; tens++) {
    for (let ones = 0; ones < 10; ones++) {
      await expect(field).toHaveValue(`12:${tens}${ones}`);
      await minutes.press('ArrowUp');
    }
    await minuteTens.press('ArrowUp');
  }
  await expect(field).toHaveValue('12:00');
  await field.fill('2301');
  await expect(field).toHaveValue('23:01');
  await expect(minutes).toHaveAttribute('aria-valuenow', '1');
  await dialog.getByRole('button', { name: '确定 23:01', exact: true }).click();
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await field.fill('08:30');
  await expect(field).toHaveValue('08:30');
  await page.setViewportSize({ width: 320, height: 480 });
  await field.click();
  await expect(dialog).toBeVisible();
  await expect(async () => {
    const picker = await dialog.boundingBox();
    const inputBounds = await field.boundingBox();
    expect(picker.x).toBeGreaterThanOrEqual(0);
    expect(picker.x + picker.width).toBeLessThanOrEqual(320);
    expect(
      picker.y + picker.height <= inputBounds.y || picker.y >= inputBounds.y + inputBounds.height
    ).toBe(true);
    for (const digit of await dialog.getByRole('spinbutton').all()) {
      expect((await digit.boundingBox()).width).toBeGreaterThanOrEqual(44);
    }
  }).toPass();
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
    await expect(page.getByRole('region', { name: '工作视窗', exact: true })).toBeVisible();
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
    campus = work.getByRole('group', { name: '接待校区', exact: true });
  await expect(campus.getByRole('button', { name: '南湖', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await work.getByRole('button', { name: '刷新工作台', exact: true }).click();
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
    await campus.getByRole('button', { name: '浑南', exact: true }).click();
    await expect(work.getByRole('button').filter({ hasText: orders['南湖'].id })).not.toBeVisible();
    await expect(work).toHaveAttribute('aria-busy', 'true');
  } finally {
    releaseBoard();
  }
  await expect(work.getByRole('button').filter({ hasText: orders['浑南'].id })).toBeVisible();
  await expect(work.getByRole('button').filter({ hasText: orders['南湖'].id })).not.toBeVisible();
  await staffPage(page, '个人中心');
  await expect(
    work
      .getByRole('group', { name: '签到校区', exact: true })
      .getByRole('button', { name: '南湖', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await staffPage(page, '今日工作');
  await work.getByRole('button', { name: '刷新工作台', exact: true }).click();
  await expect(campus.getByRole('button', { name: '浑南', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.reload();
  await staffPage(page, '今日工作');
  await expect(campus.getByRole('button', { name: '浑南', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(work.getByRole('button').filter({ hasText: orders['浑南'].id })).toBeVisible();
  await staffPage(page, '个人中心');
  await work.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.locator('#login-id')).toBeVisible();
  await loginStaff(page, '20261003', 'StaffTest!2026');
  await staffPage(page, '今日工作');
  await expect(work.getByRole('group', { name: '接待校区' }).getByRole('button', { name: '南湖', exact: true })).toBeDisabled();
  await staffPage(page, '个人中心');
  await work.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.locator('#login-id')).toBeVisible();
  await loginStaff(page, 'root001', process.env.E2E_ROOT_PASSWORD);
  await staffPage(page, '今日工作');
  await expect(campus.getByRole('button', { name: '南湖', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('hardware staff receive photos, correct a repair and keep internal notes out of the student result', async ({
  page
}) => {
  await loginStaff(page, '20261003', 'StaffTest!2026');
  await staffPage(page, '今日工作');
  const created = await onsiteOrder(page);
  await page.getByRole('button', { name: '刷新工作台', exact: true }).click();
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
  await page.getByRole('button', { name: '刷新工作台', exact: true }).click();
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
  await personal.getByRole('textbox', { name: '所在周', exact: true }).fill(nextWeek);
  await personal.getByRole('button', { name: '修改通常时间', exact: true }).click();
  await personal.getByRole('checkbox', { name: '周一', exact: true }).check();
  await personal.getByRole('button', { name: '保存空闲', exact: true }).click();
  await expect(personal.getByRole('button', { name: '修改通常时间', exact: true })).toBeVisible();
  const manager = await context.newPage();
  await loginStaff(manager, '20261001');
  const planner = await dutyPage(manager, '安排下周');
  await planner.getByRole('textbox', { name: '所在周', exact: true }).fill(nextWeek);
  await planner.getByRole('button', { name: '生成建议班表', exact: true }).click();
  await expect(planner.getByRole('button', { name: /^移除周宁 / })).toBeVisible();
  await planner.getByRole('button', { name: '发布班表', exact: true }).click();
  await expect(planner.getByRole('button', { name: '发布班表', exact: true })).toBeDisabled();
  await page.reload();
  personal = await dutyPage(page, '我的值班');
  await personal.getByRole('textbox', { name: '所在周', exact: true }).fill(nextWeek);
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
  await personal.getByRole('textbox', { name: '所在周', exact: true }).fill(nextWeek);
  const shift = personal.getByRole('article').filter({ hasText: nextWeek });
  await shift.getByRole('button', { name: '登记请假', exact: true }).click();
  await personal.getByLabel('请假原因').fill('临时有课');
  await shift.getByRole('button', { name: '登记请假', exact: true }).click();
  await expect(shift.getByRole('button', { name: '撤销请假', exact: true })).toBeVisible();
  await shift.getByRole('button', { name: '邀请接替', exact: true }).click();
  await chooseOption(
    worker,
    personal.getByRole('combobox', { name: '接替成员', exact: true }),
    'member-root001'
  );
  await shift.getByRole('button', { name: '发送接替邀请', exact: true }).click();
  await expect(personal.getByText('待对方确认', { exact: false })).toBeVisible();
  const recipient = await dutyPage(page, '我的值班');
  await recipient.getByRole('textbox', { name: '所在周', exact: true }).fill(nextWeek);
  await recipient.getByRole('button', { name: '确认接替', exact: true }).click();
  await expect(
    recipient
      .getByRole('article')
      .filter({ hasText: nextWeek })
      .filter({ hasText: '周宁 → 预览负责人' })
  ).toContainText('已接替');
});

test('daytime supplementation explains its default time without changing attendance', async ({
  page
}) => {
  await loginStaff(page, '20261001');
  const daily = await dutyPage(page, '今日值班');
  await daily.getByRole('button', { name: '补录其他人员', exact: true }).click();
  const form = page.getByRole('dialog', { name: '补记漏签', exact: true });
  await chooseOption(
    page,
    form.getByRole('combobox', { name: '工作人员', exact: true }),
    'member-20261003'
  );
  await form.getByLabel('补录或修正原因').fill('白天已核实到岗，补录当天考勤');
  await form.getByRole('button', { name: '保存考勤', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText(
    '补录默认记为当天 19:00，目前尚未到该时间，请在 19:00 后补录'
  );
  await expect(form).toBeVisible();
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
  await expect(correction.getByRole('textbox', { name: '实际到场时间', exact: true })).toHaveCount(
    0
  );
  await correction.getByLabel('补录或修正原因').fill('现场已核实漏签');
  await correction.getByRole('button', { name: '保存考勤', exact: true }).click();
  await expect(person.getByText('已签到', { exact: true })).toBeVisible();
  await person.getByRole('button', { name: '修正时间', exact: true }).click();
  const adjustment = page.getByRole('dialog', { name: '修正签到时间', exact: true });
  await adjustment.getByRole('button', { name: '选择实际到场时间', exact: true }).click();
  await expect(adjustment.getByRole('spinbutton', { name: '小时十位', exact: true })).toBeVisible();
  const theme = await adjustment.locator('.workspace-time-popover').evaluate((panel) => {
    const properties = ['backgroundImage', 'color', 'padding', 'borderRadius'];
    const read = (node) => {
      const style = getComputedStyle(node.querySelector('.time-picker-actions button'));
      return properties.map((property) => style[property]);
    };
    const nested = read(panel);
    const standalone = panel.cloneNode(true);
    document.body.append(standalone);
    const expected = read(standalone);
    standalone.remove();
    return { nested, expected };
  });
  expect(theme.nested).toEqual(theme.expected);
  await page.keyboard.press('Escape');
  await expect(adjustment).toBeVisible();
  await expect(adjustment.getByRole('textbox', { name: '实际到场时间', exact: true })).toHaveValue(
    '19:00'
  );
  await adjustment.getByRole('textbox', { name: '实际到场时间', exact: true }).fill('19:08');
  await adjustment.getByLabel('补录或修正原因').fill('现场核实实际到场时间');
  await adjustment.getByRole('button', { name: '保存考勤', exact: true }).click();
  await expect(person).toContainText('19:08');
  await expect(person).not.toContainText('按班次开始时间');
});

test('temporary attendance uses the selected historical date and campus without a time picker', async ({
  page
}) => {
  await loginStaff(page);
  const daily = await dutyPage(page, '今日值班');
  await daily
    .getByRole('group', { name: '考勤校区', exact: true })
    .getByRole('button', { name: '浑南', exact: true })
    .click();
  const day = addDays(thisWeek, -5);
  await daily.getByLabel('值班日期').fill(day);
  await daily.getByRole('button', { name: '刷新值班', exact: true }).click();
  await daily.getByRole('button', { name: '补录其他人员', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '补记漏签', exact: true });
  await expect(dialog).toContainText(`${day} · 浑南`);
  await expect(dialog.locator('.workspace-date-field,.workspace-time-field')).toHaveCount(0);
  await chooseOption(
    page,
    dialog.getByRole('combobox', { name: '工作人员', exact: true }),
    'member-20261004'
  );
  await dialog.getByLabel('补录或修正原因').fill('已核实历史漏签');
  await dialog.getByRole('button', { name: '保存考勤', exact: true }).click();
  await expect(dialog).toBeHidden();
  const person = daily.getByRole('article').filter({ hasText: '许晨' });
  await expect(person).toContainText('临时到场');
  await expect(person).toContainText('19:00');
  await expect(person).toContainText('按班次开始时间');
  await page.reload();
  const reloaded = await dutyPage(page, '今日值班');
  await reloaded
    .getByRole('group', { name: '考勤校区', exact: true })
    .getByRole('button', { name: '浑南', exact: true })
    .click();
  await reloaded.getByLabel('值班日期').fill(day);
  await expect(reloaded.getByRole('article').filter({ hasText: '许晨' })).toContainText('19:00');
});

test('save-and-switch retains a failed draft and navigates only after a successful save', async ({
  page
}) => {
  await loginStaff(page, '20261001');
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
