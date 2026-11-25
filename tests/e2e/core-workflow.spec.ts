import type { FieldOrder } from './support/staff.ts';
import type { AppointmentCredential } from '../../shared/appointment-types.ts';
import { present } from '../helpers/present.ts';
import type { ManagedBookingDto } from '../../frontend/staff-react/management-types.ts';
import { runWorkflow } from '../fixtures/workflow-seed.ts';
import { test, expect } from './support/fixtures.ts';
import {
  loginStaff,
  chooseOption,
  staffPage,
  navigationEntry,
  dutyPage,
  onsiteOrder,
  publishDuty,
  staffApi
} from './support/staff.ts';
import { chooseTime, fillDevice, goReview, submitStudent, PHOTO } from './support/student.ts';
import { WORKFLOW_TIME } from '../fixtures/workflow-seed.ts';
import { dateKey, weekRange, addDays } from '../../shared/time.ts';

const thisWeek = weekRange(dateKey(new Date(WORKFLOW_TIME))).start;
const nextWeek = addDays(thisWeek, 7);

test(
  'student books against the real capacity service, signs, and opens the private result',
  { tag: ['@smoke', '@mobile-smoke'] },
  async ({ page }) => {
    await runWorkflow(
      'ui-student-booking',
      'initial',
      [
        ['initial', 'BOOK', 'booked'],
        ['booked', 'PRIVATE_RESULT', 'privateResult']
      ],
      [
        {
          event: 'BOOK',

          run: async () => {
            await page.goto('/');
            await chooseTime(page);
            await fillDevice(page, { studentId: '20269991' });
            await goReview(page);
            await submitStudent(page);
            await expect(page.locator('#success-summary')).toContainText('南湖测试维修室');
          }
        },
        {
          event: 'PRIVATE_RESULT',

          run: async () => {
            await page.locator('#view-created-appointment').click();
            await expect(page.locator('#appointment-detail')).toBeVisible();
            await expect(page.locator('#appointment-detail')).not.toContainText('操作历史');
          }
        }
      ]
    );
  }
);

test('working campus isolates data, survives navigation and reload, and resets between logins', async ({
  page
}) => {
  let orders: Record<string, FieldOrder>, work: import("@playwright/test").Locator, campus: import("@playwright/test").Locator;

  await runWorkflow(
    'ui-working-campus',
    'initial',
    [
      ['initial', 'LOGIN', 'nanhu'],
      ['nanhu', 'SWITCH', 'hunnan'],
      ['hunnan', 'NAVIGATE', 'hunnan'],
      ['hunnan', 'RELOAD', 'hunnan'],
      ['hunnan', 'LOGOUT', 'loggedOut'],
      ['loggedOut', 'MEMBER_LOGIN', 'singleCampus'],
      ['singleCampus', 'MEMBER_LOGOUT', 'loggedOut'],
      ['loggedOut', 'ROOT_LOGIN', 'nanhu']
    ],
    [
      {
        event: 'LOGIN',

        run: async () => {
          await loginStaff(page, 'root001', process.env.E2E_ROOT_PASSWORD);
          orders = {};
          for (const [index, campus] of ['南湖', '浑南'].entries())
            orders[campus] = await onsiteOrder(page, {
              campus,
              studentId: String(20271000 + index),
              name: '校区选择回归' + campus
            });
          await staffPage(page, '今日工作');
          work = page.locator('.field-content');
          campus = work.getByRole('group', { name: '接待校区', exact: true });
          await expect(
            campus.getByRole('button', { name: '切换校区，当前南湖', exact: true })
          ).toBeVisible();
          await work.getByRole('button', { name: '刷新工作台', exact: true }).click();
          await expect(
            work.getByRole('button').filter({ hasText: present(orders['南湖']).id })
          ).toBeVisible();
        }
      },
      {
        event: 'SWITCH',

        run: async () => {
          const { promise: boardReady, resolve: releaseBoard } = Promise.withResolvers<void>();
          await page.route('**/api/field/board*', async (route) => {
            if (new URL(route.request().url()).searchParams.get('campusId') === 'campus-hunnan')
              await boardReady;
            await route.continue();
          });
          try {
            await campus.getByRole('button', { name: '切换校区，当前南湖', exact: true }).click();
            await expect(
              work.getByRole('button').filter({ hasText: orders['南湖'].id })
            ).not.toBeVisible();
            await expect(work).toHaveAttribute('aria-busy', 'true');
          } finally {
            releaseBoard();
          }
          await expect(
            work.getByRole('button').filter({ hasText: orders['浑南'].id })
          ).toBeVisible();
          await expect(
            work.getByRole('button').filter({ hasText: orders['南湖'].id })
          ).not.toBeVisible();
        }
      },
      {
        event: 'NAVIGATE',

        run: async () => {
          await staffPage(page, '个人中心');
          await expect(
            work
              .getByRole('group', { name: '签到校区', exact: true })
              .getByRole('button', { name: '南湖', exact: true })
          ).toHaveAttribute('aria-pressed', 'true');
          await staffPage(page, '今日工作');
          await work.getByRole('button', { name: '刷新工作台', exact: true }).click();
          await expect(
            campus.getByRole('button', { name: '切换校区，当前浑南', exact: true })
          ).toBeVisible();
        }
      },
      {
        event: 'RELOAD',

        run: async () => {
          await page.reload();
          await staffPage(page, '今日工作');
          await expect(
            campus.getByRole('button', { name: '切换校区，当前浑南', exact: true })
          ).toBeVisible();
          await expect(
            work.getByRole('button').filter({ hasText: orders['浑南'].id })
          ).toBeVisible();
        }
      },
      {
        event: 'LOGOUT',

        run: async () => {
          await staffPage(page, '个人中心');
          await work.getByRole('button', { name: '退出登录', exact: true }).click();
          await expect(page.locator('#login-id')).toBeVisible();
        }
      },
      {
        event: 'MEMBER_LOGIN',

        run: async () => {
          await loginStaff(page, '20261003', 'StaffTest!2026');
          await staffPage(page, '今日工作');
          await expect(campus.getByText('南湖', { exact: true })).toBeVisible();
          await expect(campus.getByRole('button')).toHaveCount(0);
        }
      },
      {
        event: 'MEMBER_LOGOUT',

        run: async () => {
          await staffPage(page, '个人中心');
          await work.getByRole('button', { name: '退出登录', exact: true }).click();
          await expect(page.locator('#login-id')).toBeVisible();
        }
      },
      {
        event: 'ROOT_LOGIN',

        run: async () => {
          await loginStaff(page, 'root001', process.env.E2E_ROOT_PASSWORD);
          await staffPage(page, '今日工作');
          await expect(
            campus.getByRole('button', { name: '切换校区，当前南湖', exact: true })
          ).toBeVisible();
        }
      }
    ]
  );
});

test(
  'hardware staff receive photos, correct a repair and keep internal notes out of the student result',
  { tag: ['@smoke', '@mobile-smoke'] },
  async ({ page }) => {
    let created: AppointmentCredential, dialog: import("@playwright/test").Locator;

    await runWorkflow(
      'ui-repair',
      'initial',
      [
        ['initial', 'RECEIVE_AND_START', 'repairing'],
        ['repairing', 'FINISH', 'completed'],
        ['completed', 'CORRECT', 'corrected'],
        ['corrected', 'CUSTOMER_VIEW', 'privateResult']
      ],
      [
        {
          event: 'RECEIVE_AND_START',

          run: async () => {
            await page.goto('/');
            await chooseTime(page);
            await fillDevice(page, { studentId: '20269992' });
            await goReview(page);
            const bookingResponse = page.waitForResponse(response =>
              new URL(response.url()).pathname === '/api/appointments' &&
              response.request().method() === 'POST' && response.status() === 201
            );
            await submitStudent(page);
            created = await (await bookingResponse).json();
            await loginStaff(page, '20261003', 'StaffTest!2026');
            await staffPage(page, '今日工作');
            await page.getByRole('button', { name: '刷新工作台', exact: true }).click();
            await page.getByRole('button').filter({ hasText: created.id }).click();
            dialog = page.getByRole('dialog', { name: '维修工单' });
            for (const side of ['正面', '背面'])
              await dialog
                .getByLabel(`设备${side}照片`, { exact: true })
                .setInputFiles({ name: side + '.png', mimeType: 'image/png', buffer: PHOTO });
            await dialog.getByRole('button', { name: '接收并开始维修', exact: true }).click();
            await expect(dialog.locator('.repair-summary-fields').getByText('周宁', { exact: true })).toBeVisible();
          }
        },
        {
          event: 'FINISH',

          run: async () => {
            await dialog.getByLabel('部分解决', { exact: true }).check();
            await dialog.getByLabel('简短处理说明').fill('系统恢复，键盘仍需更换（内部）');
            await dialog.getByRole('button', { name: '结束本次服务' }).click();
            await expect(dialog.getByRole('button', { name: '保存结果更正' })).toBeVisible();
          }
        },
        {
          event: 'CORRECT',

          run: async () => {
            await dialog.getByLabel('已解决', { exact: true }).check();
            await dialog.getByLabel('简短处理说明').fill('键盘更换后通过复核（内部）');
            await dialog.getByRole('button', { name: '保存结果更正' }).click();
            await expect(dialog.getByText('已解决 · 键盘更换后通过复核（内部）')).toBeVisible();
          }
        },
        {
          event: 'CUSTOMER_VIEW',

          run: async () => {
            // The public HTTP projection must stay private even when the UI omits fields.
            const customer = await page.request.get(`/api/appointments/${created.id}`, {
              headers: { 'X-Appointment-Token': created.accessToken }
            });
            expect(customer.ok()).toBeTruthy();
            const visible = await customer.json();
            expect(visible.outcome).toBe('repaired');
            expect(JSON.stringify(visible)).not.toMatch(/内部|repairNote|actorAccount|before_json/);
            await page.goto('/#lookup');
            await page.getByRole('button', { name: /笔记本.*联想/ }).click();
            const liquidMetal = page
              .locator('#detail-information dl > div')
              .filter({ has: page.getByText('液金散热', { exact: true }) });
            await expect(liquidMetal.locator('dd')).toHaveText('不清楚');
          }
        }
      ]
    );
  }
);

test('office reception lets hardware take over and a manager finish with the original owner', async ({
  page,
  context
}) => {
  let created: FieldOrder, dialog: import("@playwright/test").Locator;

  await runWorkflow(
    'ui-office-reception',
    'initial',
    [
      ['initial', 'OFFICE_RECEIVE', 'received'],
      ['received', 'HARDWARE_START', 'repairing'],
      ['repairing', 'MANAGER_FINISH', 'completed']
    ],
    [
      {
        event: 'OFFICE_RECEIVE',

        run: async () => {
          await loginStaff(page, '20261001', 'StaffTest!2026');
          await staffPage(page, '今日工作');
          created = await onsiteOrder(page, { name: '共同值班同学' });
          await page.getByRole('button', { name: '刷新工作台', exact: true }).click();
          await page.getByRole('button').filter({ hasText: created.id }).click();
          dialog = page.getByRole('dialog', { name: '维修工单' });
          await expect(
            dialog.getByRole('button', { name: '接收并开始维修', exact: true })
          ).toHaveCount(0);
          for (const side of ['正面', '背面'])
            await dialog
              .getByLabel(`设备${side}照片`, { exact: true })
              .setInputFiles({ name: side + '.png', mimeType: 'image/png', buffer: PHOTO });
          await dialog.getByRole('button', { name: '仅接收设备', exact: true }).click();
          await expect(dialog.getByRole('button', { name: '仅接收设备', exact: true })).toHaveCount(
            0
          );
        }
      },
      {
        event: 'HARDWARE_START',

        run: async () => {
          const worker = await context.newPage();
          await loginStaff(worker, '20261003', 'StaffTest!2026');
          await staffPage(worker, '今日工作');
          await worker.getByRole('button').filter({ hasText: created.id }).click();
          const workDialog = worker.getByRole('dialog', { name: '维修工单' });
          await expect(workDialog.getByLabel('设备正面照片', { exact: true })).toHaveCount(0);
          await workDialog.getByRole('button', { name: '开始维修', exact: true }).click();
          await expect(
            workDialog.getByRole('button', { name: '结束本次服务', exact: true })
          ).toBeVisible();
        }
      },
      {
        event: 'MANAGER_FINISH',

        run: async () => {
          await page.reload();
          await staffPage(page, '今日工作');
          await page.getByRole('button').filter({ hasText: created.id }).click();
          await dialog.getByLabel('部分解决', { exact: true }).check();
          await dialog.getByLabel('简短处理说明').fill('系统恢复，键盘仍需更换');
          await dialog.getByRole('button', { name: '结束本次服务', exact: true }).click();
          await expect(dialog.getByText('部分解决 · 系统恢复，键盘仍需更换')).toBeVisible();
          await expect(dialog.locator('.repair-summary-fields').getByText('周宁', { exact: true })).toBeVisible();
        }
      }
    ]
  );
});

test('member availability produces a published shift visible after reloading', { tag: '@smoke' }, async ({
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
  await expect(planner.locator('.duty-assignee').getByRole('button', { name: '周宁', exact: true })).toBeVisible();
  await planner.getByRole('button', { name: '发布班表', exact: true }).click();
  await manager.getByRole('dialog', { name: '发布前确认', exact: true }).getByRole('button', { name: '确认发布', exact: true }).click();
  await expect(planner.getByText('班表已发布', { exact: true })).toBeVisible();
  await page.reload();
  personal = await dutyPage(page, '我的值班');
  await personal.getByRole('textbox', { name: '所在周', exact: true }).fill(nextWeek);
  await expect(personal.getByRole('article').filter({ hasText: nextWeek })).toContainText('维修');
});

test('a member invites a replacement and the recipient confirms without manager approval', async ({
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
  await expect(personal.getByRole('button', { name: /请假/ })).toHaveCount(0);
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

test('automatic absence and historical arrival correction update the selected member', async ({
  page
}) => {
  await loginStaff(page, '20261001');
  await publishDuty(page, { weekStart: thisWeek });
  const daily = await dutyPage(page, '今日值班');
  await daily.getByLabel('值班日期').fill(thisWeek);
  const person = daily.getByRole('article').filter({ hasText: '周宁' });
  await expect(person.getByText('缺勤', { exact: true })).toBeVisible();
  await expect(person.getByRole('button', { name: /确认未到|撤销未到|确认到场/ })).toHaveCount(0);
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
    const properties = ['background-image', 'color', 'padding', 'border-radius'];
    const read = (node: Element) => {
      const button = node.querySelector('.time-picker-actions button');
      if (!button) throw new Error('Missing time picker action');
      const style = getComputedStyle(button);
      return properties.map((property) => style.getPropertyValue(property));
    };
    const nested = read(panel);
    const standalone = panel.cloneNode(true);
    if (!(standalone instanceof Element)) throw new Error('Expected a time picker element');
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
  await person.getByRole('button', { name: '查看周宁的签到详情', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toContainText('按班次开始时间');
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
  await expect(person).toContainText('临时支援');
  await expect(person).toContainText('19:00');
  await person.getByRole('button', { name: '查看许晨的签到详情', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('按班次开始时间');
  await page.keyboard.press('Escape');
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
  let time: import("@playwright/test").Locator, next: "08:00" | "09:00", rejectSave: (route: import("@playwright/test").Route) => Promise<void>;

  await runWorkflow(
    'ui-save-draft',
    'initial',
    [
      ['initial', 'OPEN_EDITOR', 'editing'],
      ['editing', 'REJECT_SAVE', 'failed'],
      ['failed', 'RETRY_SAVE', 'saved']
    ],
    [
      {
        event: 'OPEN_EDITOR',

        run: async () => {
          await loginStaff(page, '20261001');
          await staffPage(page, '预约配置');
          await page.getByRole('button', { name: '放号时间', exact: true }).click();
          time = page.getByLabel('放号时间（北京时间）');
          await expect(time).toBeEnabled();
        }
      },
      {
        event: 'REJECT_SAVE',

        run: async () => {
          const original = await time.inputValue();
          next = original === '08:00' ? '09:00' : '08:00';
          await time.fill(next);
          rejectSave = (route: import('@playwright/test').Route) =>
            route.request().method() === 'PATCH'
              ? route.fulfill({ status: 503, json: { error: '测试保存失败' } })
              : route.continue();
          await page.route('**/api/booking-settings', rejectSave);
          await (await navigationEntry(page, '预约记录')).click();
          await page.getByRole('button', { name: '保存并继续', exact: true }).click();
          await expect(page.getByRole('dialog')).toContainText('测试保存失败');
          await expect(time).toHaveValue(next);
          const before = await staffApi<ManagedBookingDto>(
            page,
            '/api/booking-settings/manage?campus=' + encodeURIComponent('南湖'),
            null,
            'GET'
          );
          expect(before.settings.releaseTime).toBe(original);
        }
      },
      {
        event: 'RETRY_SAVE',

        run: async () => {
          await page.unroute('**/api/booking-settings', rejectSave);
          await page.getByRole('button', { name: '保存并继续', exact: true }).click();
          await expect(page.getByRole('heading', { name: '预约记录', exact: true })).toBeVisible();
          await expect(page.getByRole('dialog')).toHaveCount(0);
          const after = await staffApi<ManagedBookingDto>(
            page,
            '/api/booking-settings/manage?campus=' + encodeURIComponent('南湖'),
            null,
            'GET'
          );
          expect(after.settings.releaseTime).toBe(next);
        }
      }
    ]
  );
});
