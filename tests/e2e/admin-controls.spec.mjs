import { test, expect } from './support/fixtures.mjs';
import { chooseOption, loginStaff, staffPage, dutyPage } from './support/staff.mjs';

test('filters retain focus and selection', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loginStaff(page);
  const records = await staffPage(page, '预约记录');
  const trigger = records
    .locator('.records-filter-actions')
    .getByRole('button', { name: '筛选预约时段', exact: true });
  await trigger.click();
  const filter = page.getByRole('dialog', { name: '预约时段筛选', exact: true });
  const choice = filter.getByRole('button').nth(1);
  const timeSlot = await choice.textContent();
  await choice.click();
  await expect(filter).toBeHidden();
  await expect(trigger).toHaveText(timeSlot);
  await expect(trigger).toBeFocused();
});

test('an old refresh cannot report success for a newly selected statistics scope', async ({
  page
}) => {
  let hold = false;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let delayed = false;
  await page.route('**/api/stats/summary?*', async (route) => {
    const day = new URL(route.request().url()).searchParams.get('day');
    if (hold && !day) {
      delayed = true;
      await gate;
    }
    await route.fulfill({
      json: {
        total: day ? 2 : 1,
        completed: 0,
        cancelled: 0,
        expired: 0,
        repairSuccessRate: 0,
        linkedRepairs: 0,
        completionRate: 0,
        daily: {},
        faults: {},
        campuses: {},
        technicians: {}
      }
    });
  });
  await loginStaff(page);
  const statistics = await staffPage(page, '统计分析');
  const total = statistics.getByRole('article').filter({ hasText: '预约总数' }).locator('strong');
  await expect(total).toContainText('1');
  hold = true;
  await statistics.getByRole('button', { name: '刷新统计', exact: true }).click();
  try {
    await expect.poll(() => delayed).toBe(true);
    await statistics.getByRole('textbox', { name: '查看单日', exact: true }).fill('2026-10-12');
    await expect(statistics.getByRole('button', { name: '刷新统计', exact: true })).toBeEnabled();
    await expect(total).toContainText('2');
  } finally {
    release();
  }
  await expect(statistics.locator('.workspace-refresh-state')).toHaveText('');
});

test('searchable choices stay usable inside member dialogs and return focus', async ({ page }) => {
  await loginStaff(page);
  const people = await staffPage(page, '人员管理');
  await people.getByRole('button', { name: '新增人员', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新增人员', exact: true });
  const college = create.getByRole('combobox', { name: '学院', exact: true });
  await college.click();
  const search = page.getByRole('searchbox', { name: '搜索学院', exact: true });
  await expect(search).toBeFocused();
  await search.fill('计算机');
  await page.getByRole('option', { name: /计算机科学与工程学院/ }).click();
  await expect(college).toHaveText('计算机科学与工程学院');
  await expect(college).toBeFocused();
  await college.click();
  await page.keyboard.press('Escape');
  await expect(create).toBeVisible();
  await expect(college).toBeFocused();
  await expect(page.getByRole('listbox')).toHaveCount(0);
});

test('campus belongs to each duty task and the weekly export inherits the report scope', async ({
  page
}) => {
  await loginStaff(page);
  const today = await dutyPage(page, '今日值班');
  await today
    .getByRole('group', { name: '考勤校区', exact: true })
    .getByRole('button', { name: '南湖', exact: true })
    .click();
  const planner = await dutyPage(page, '安排下周');
  await planner
    .getByRole('group', { name: '排班校区', exact: true })
    .getByRole('button', { name: '浑南', exact: true })
    .click();
  await dutyPage(page, '今日值班');
  await expect(
    today
      .getByRole('group', { name: '考勤校区', exact: true })
      .getByRole('button', { name: '南湖', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  const reports = await dutyPage(page, '统计与历史');
  const scope = reports.getByRole('group', { name: '报表校区', exact: true });
  await expect(scope.getByRole('button', { name: '南湖', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await scope.getByRole('button', { name: '全部授权校区', exact: true }).click();
  await expect(scope.getByRole('button', { name: '全部授权校区', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await reports.getByRole('button', { name: '选择报表月份', exact: true }).click();
  await page
    .getByRole('dialog', { name: '选择报表月份', exact: true })
    .getByRole('button', { name: '10月', exact: true })
    .click();
  await expect(reports.getByRole('textbox', { name: '月份', exact: true })).toHaveValue('2026-10');
  await reports
    .getByRole('group', { name: '报表校区', exact: true })
    .getByRole('button', { name: '浑南', exact: true })
    .click();
  await reports.getByRole('button', { name: '按周核算与导出', exact: true }).click();
  const weekly = page.getByRole('dialog', { name: '按周核算并导出考勤', exact: true });
  await expect(weekly.getByText('浑南', { exact: true })).toBeVisible();
  await expect(weekly.getByRole('combobox')).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 812 });
  const start = weekly.getByRole('textbox', { name: '开始工作周', exact: true });
  await start.fill('2026-10-19');
  await weekly.getByRole('button', { name: '选择开始工作周', exact: true }).click();
  const calendar = weekly.getByRole('dialog', { name: '选择开始工作周', exact: true });
  await calendar.locator('[data-day="2026-10-21"]').click();
  await expect(start).toHaveValue('2026-10-19');
  await weekly.getByRole('button', { name: '选择结束工作周', exact: true }).click();
  const end = weekly.getByRole('dialog', { name: '选择结束工作周', exact: true });
  await expect(end.locator('[data-day="2026-10-12"]')).toBeDisabled();

});

test('configuration tasks retain their own campus when changing views', async ({ page }) => {
  await page.route('**/api/auth/me', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), homeCampus: '浑南' } });
  });
  await loginStaff(page);
  const configuration = await staffPage(page, '预约配置');
  const campus = configuration.getByRole('group', { name: '当前配置校区', exact: true });
  await expect(campus.getByRole('button', { name: '浑南校区', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await campus.getByRole('button', { name: '南湖校区', exact: true }).click();
  await configuration.getByRole('button', { name: '日期实际容量', exact: true }).click();
  await expect(campus.getByRole('button', { name: '浑南校区', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(
    configuration.getByRole('button', { name: '刷新当日容量', exact: true })
  ).toBeVisible();
  await expect(
    configuration.getByRole('button', { name: '刷新每周模板', exact: true })
  ).toHaveCount(0);
  await configuration.getByRole('button', { name: '每周模板', exact: true }).click();
  await expect(campus.getByRole('button', { name: '南湖校区', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await configuration.getByRole('button', { name: '放号时间', exact: true }).click();
  await expect(campus.getByRole('button', { name: '浑南校区', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('Sunday ends the Monday-based duty week and calendar selections use its Monday identifier', async ({ page }) => {
  await loginStaff(page);
  const planner = await dutyPage(page, '安排下周');
  const week = planner.getByRole('textbox', { name: '所在周', exact: true });
  await week.fill('2026-11-15');
  await planner.getByRole('button', { name: '选择所在周', exact: true }).click();
  const calendar = page.getByRole('dialog', { name: '选择所在周', exact: true });
  await expect(calendar.locator('.workspace-calendar-weekdays > span').first()).toHaveText('一');
  await expect(calendar.locator('[data-day="2026-11-09"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(calendar.locator('[data-day="2026-11-15"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(calendar.locator('[data-day="2026-11-16"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(calendar.locator('[data-day="2026-11-22"]')).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  const response = page.waitForResponse(
    (response) =>
      response.url().includes('/api/rosters/campus-week') &&
      new URL(response.url()).searchParams.get('weekStart') === '2026-11-16'
  );
  await calendar.locator('[data-day="2026-11-22"]').click();
  expect((await response).ok()).toBe(true);
  await expect(week).toHaveValue('2026-11-16');
});

test('single-campus reports offer only their authorized campus', async ({ page }) => {
  await loginStaff(page, '20261001');
  const reports = await dutyPage(page, '统计与历史');
  await expect(reports.getByLabel('报表校区', { exact: true })).toHaveText('南湖');
  await expect(reports.getByRole('button', { name: '浑南', exact: true })).toHaveCount(0);
  await reports.getByRole('button', { name: '按周核算与导出', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('南湖', { exact: true })).toBeVisible();
});

test('permission condition choices distinguish unrestricted and independent membership', async ({
  page
}) => {
  const role = {
    id: 'role-ui-test',
    name: '界面测试角色',
    revision: 0,
    grants: [
      {
        permissionCode: 'statistics.read',
        effect: 'allow',
        conditions: [{ code: 'activeDepartmentMembership', parameters: { isPrimary: true } }]
      }
    ]
  };
  const writes = [];
  await page.route('**/api/permissions', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            code: 'statistics.read',
            name: '统计读取',
            description: '查看统计',
            delegable: true,
            conditionKinds: []
          }
        ],
        conditionProviders: [
          {
            code: 'activeDepartmentMembership',
            description: '有效任职',
            parameterSchema: { properties: { isPrimary: { type: 'boolean' } } }
          }
        ]
      }
    })
  );
  await page.route('**/api/roles', (route) => route.fulfill({ json: { items: [role] } }));
  await page.route('**/api/roles/role-ui-test', async (route) => {
    const body = route.request().postDataJSON();
    writes.push(body);
    await route.fulfill({ json: { ...role, revision: writes.length, grants: body.grants } });
  });
  await loginStaff(page);
  const permissions = await staffPage(page, '系统权限');
  await permissions.getByText('范围、条件与有效期', { exact: true }).click();
  const scope = permissions.getByRole('combobox', { name: '任职范围', exact: true });
  await expect(scope).toHaveText('正式部门任职');
  await chooseOption(page, scope, '');
  await permissions.getByRole('button', { name: '保存权限', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].grants[0].conditions[0].parameters).toEqual({});
  await chooseOption(page, scope, 'false');
  await permissions.getByRole('button', { name: '保存权限', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].grants[0].conditions[0].parameters).toEqual({ isPrimary: false });
});
