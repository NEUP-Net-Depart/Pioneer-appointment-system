import { test, expect } from './support/fixtures.mjs';
import {
  chooseOption,
  loginStaff,
  staffPage,
  dutyPage,
  navigationEntry
} from './support/staff.mjs';

test('switching cold and retained subpages does not replay their container reveal', async ({
  page
}) => {
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    window.shellReveals = [];
    Element.prototype.animate = function (frames, options) {
      if (
        Array.isArray(frames) &&
        frames.some((frame) => frame.maskSize === '100% 0%') &&
        this.closest('main') &&
        !this.closest('dialog') &&
        this.querySelector('h1,h2,input,nav')
      )
        window.shellReveals.push(this.className);
      return animate.call(this, frames, options);
    };
  });
  await loginStaff(page);
  await dutyPage(page, '今日值班');
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/rosters/campus-week?*', async (route) => {
    await gate;
    await route.continue();
  });
  await page.evaluate(() => {
    window.shellReveals = [];
  });
  try {
    const planner = await dutyPage(page, '安排下周');
    await expect(planner.getByRole('heading', { name: /^安排一周值班/ })).toBeVisible();
    await expect(planner.getByRole('button', { name: '发布班表', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => window.shellReveals)).toEqual([]);
    release();
    await expect(planner.getByRole('button', { name: '生成建议班表', exact: true })).toBeEnabled();
    await dutyPage(page, '今日值班');
    await dutyPage(page, '安排下周');
    await staffPage(page, '人员管理');
    await dutyPage(page, '安排下周');
    expect(await page.evaluate(() => window.shellReveals)).toEqual([]);
  } finally {
    release();
  }
});

test('mobile short filters fit their content and retain focus and selection', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loginStaff(page);
  const records = await staffPage(page, '预约记录');
  const trigger = records
    .locator('.records-filter-actions')
    .getByRole('button', { name: '全部校区', exact: true });
  await trigger.click();
  const filter = page.getByRole('dialog', { name: '校区筛选', exact: true });
  const bounds = await filter.boundingBox();
  expect(bounds.height).toBeLessThan(400);
  expect(bounds.y).toBeGreaterThan(300);
  await filter.getByRole('button', { name: '浑南校区', exact: true }).click();
  await filter.getByRole('button', { name: '完成', exact: true }).click();
  await expect(filter).toBeHidden();
  await expect(
    records
      .locator('.records-filter-actions')
      .getByRole('button', { name: '浑南校区', exact: true })
  ).toBeFocused();
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
  await expect(start).toHaveValue('2026-10-18');
  await weekly.getByRole('button', { name: '选择结束工作周', exact: true }).click();
  const end = weekly.getByRole('dialog', { name: '选择结束工作周', exact: true });
  await expect(end.locator('[data-day="2026-10-12"]')).toBeDisabled();
  const geometry = await end.locator('.workspace-calendar-days > button').evaluateAll((buttons) =>
    buttons.slice(0, 7).map((button) => {
      const bounds = button.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right };
    })
  );
  for (let index = 1; index < geometry.length; index++)
    expect(geometry[index - 1].right).toBeLessThanOrEqual(geometry[index].left + 1);
});

test('configuration tasks retain their own campus when changing views', async ({ page }) => {
  await loginStaff(page);
  const configuration = await staffPage(page, '预约配置');
  const campus = configuration.getByRole('group', { name: '当前配置校区', exact: true });
  await campus.getByRole('button', { name: '浑南校区', exact: true }).click();
  await configuration.getByRole('button', { name: '日期实际容量', exact: true }).click();
  await expect(campus.getByRole('button', { name: '南湖校区', exact: true })).toHaveAttribute(
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
  await expect(campus.getByRole('button', { name: '浑南校区', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await configuration.getByRole('button', { name: '放号时间', exact: true }).click();
  await expect(campus.getByRole('button', { name: '南湖校区', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('checkboxes remain square and show one check in forms and availability', async ({
  page,
  context
}) => {
  const checkGeometry = async (boxes) => {
    const styles = await boxes.evaluateAll((nodes) =>
      nodes.map((node) => {
        const bounds = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return { width: bounds.width, height: bounds.height, repeat: style.backgroundRepeat };
      })
    );
    expect(styles.length).toBeGreaterThan(0);
    for (const style of styles) {
      expect(style.width).toBe(18);
      expect(style.height).toBe(18);
      expect(style.repeat).toBe('no-repeat');
    }
  };
  await loginStaff(page, '20261003');
  const mine = await dutyPage(page, '我的值班');
  await mine.getByRole('button', { name: '修改通常时间', exact: true }).click();
  await mine.getByRole('checkbox', { name: '周一', exact: true }).check();
  await checkGeometry(mine.locator('input[type="checkbox"]:checked'));
  await expect(mine.locator('.duty-availability label').first()).toHaveText('周日');
  await mine.getByRole('button', { name: '取消', exact: true }).click();
  const manager = await context.newPage();
  await loginStaff(manager);
  const people = await staffPage(manager, '人员管理');
  await people.getByRole('button', { name: '新增人员', exact: true }).click();
  const dialog = manager.getByRole('dialog', { name: '新增人员', exact: true });
  await dialog.getByRole('checkbox', { name: '交流维修', exact: true }).check();
  await checkGeometry(dialog.locator('input[type="checkbox"]:checked'));
});

test('select popovers match their trigger and options do not inherit form button borders', async ({
  page
}) => {
  await loginStaff(page);
  const people = await staffPage(page, '人员管理');
  await people.getByRole('button', { name: '新增人员', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增人员', exact: true });
  const select = dialog.getByRole('combobox', { name: '学院', exact: true });
  await select.click();
  const popover = dialog.locator('.workspace-control-popover');
  await expect(popover).toBeVisible();
  const triggerBounds = await select.boundingBox();
  const bounds = await popover.boundingBox();
  expect(Math.abs(bounds.width - triggerBounds.width)).toBeLessThan(2);
  const styles = await popover.getByRole('option').evaluateAll((nodes) =>
    nodes.map((node) => ({
      border: getComputedStyle(node).borderTopWidth,
      height: node.getBoundingClientRect().height
    }))
  );
  for (const style of styles) {
    expect(style.border).toBe('0px');
    expect(style.height).toBe(44);
  }
});

test('Sunday begins the selected week without changing its roster identifier', async ({ page }) => {
  await loginStaff(page);
  const planner = await dutyPage(page, '安排下周');
  const week = planner.getByRole('textbox', { name: '所在周', exact: true });
  await week.fill('2026-11-15');
  await planner.getByRole('button', { name: '选择所在周', exact: true }).click();
  const calendar = page.getByRole('dialog', { name: '选择所在周', exact: true });
  await expect(calendar.locator('.workspace-calendar-weekdays > span').first()).toHaveText('日');
  await expect(calendar.locator('[data-day="2026-11-15"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(calendar.locator('[data-day="2026-11-21"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(calendar.locator('[data-day="2026-11-22"]')).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  const response = page.waitForResponse(
    (response) =>
      response.url().includes('/api/rosters/campus-week') &&
      new URL(response.url()).searchParams.get('weekStart') === '2026-11-23'
  );
  await calendar.locator('[data-day="2026-11-22"]').click();
  expect((await response).ok()).toBe(true);
  await expect(week).toHaveValue('2026-11-22');
});

test('statistics help overlays the page without moving data cards', async ({ page }) => {
  await loginStaff(page);
  const statistics = await staffPage(page, '统计分析');
  const cards = statistics.locator('.report-metrics');
  await expect(cards).toBeVisible();
  const before = await cards.boundingBox();
  const hint = statistics.getByRole('button', { name: '统计口径', exact: true });
  await hint.focus();
  await expect(page.getByRole('tooltip')).toContainText('不代表值班考勤');
  expect((await cards.boundingBox()).y).toBe(before.y);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

test('record actions stay inside the page and selecting a summary preserves its geometry', async ({
  page
}) => {
  await loginStaff(page);
  const records = await staffPage(page, '预约记录');
  await records.locator('.workspace-more-actions > summary').click();
  const menu = records.locator('.workspace-more-action-list');
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  const heading = await records.locator('.workspace-heading').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(heading.x - 1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(heading.x + heading.width + 1);
  await page.keyboard.press('Escape');
  const slot = records.locator('.records-slot').first();
  const select = slot.locator('.records-slot-main');
  await expect(select).toBeEnabled();
  const before = await slot.boundingBox();
  await select.click();
  await expect(select).toHaveAttribute('aria-pressed', 'true');
  const after = await slot.boundingBox();
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
  expect(await select.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
    'rgba(0, 0, 0, 0)'
  );
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

test('admin task toolbars fit the viewport without overlapping controls', async ({
  page
}, testInfo) => {
  await loginStaff(page);
  for (const entry of [
    '今日工作',
    '预约记录',
    '人员管理',
    '预约配置',
    '统计分析',
    '系统权限',
    '个人中心'
  ]) {
    await staffPage(page, entry);
    if (entry === '人员管理') {
      const destination = await navigationEntry(page, '今日工作');
      await page.getByRole('combobox', { name: '筛选成员状态', exact: true }).click();
      await destination.focus();
      await destination.press('Enter');
      await expect(page.getByRole('listbox')).toHaveCount(0);
      await staffPage(page, entry);
    }
    await expect(page.getByRole('heading', { name: entry, exact: true })).toBeVisible();
    const geometry = await page.getByRole('main').evaluate((main) => {
      const problems = [];
      const visible = (node) => {
        const details = node.closest('details');
        return (
          node.getClientRects().length &&
          !node.closest('[hidden]') &&
          getComputedStyle(node).visibility === 'visible' &&
          (!details || details.open || !!node.closest('summary'))
        );
      };
      for (const toolbar of main.querySelectorAll(
        '.workspace-heading-actions,.field-actions,.workspace-panel-actions,.roster-modal-actions,.duty-toolbar,.capacity-context'
      )) {
        if (!visible(toolbar)) continue;
        const buttons = [...toolbar.querySelectorAll('button')].filter(visible);
        for (let index = 0; index < buttons.length; index++) {
          const bounds = buttons[index].getBoundingClientRect();
          if (bounds.x < 0 || bounds.right > innerWidth + 1)
            problems.push(`outside viewport: ${buttons[index].textContent.trim()}`);
          for (const other of buttons.slice(index + 1)) {
            const peer = other.getBoundingClientRect();
            if (
              Math.min(bounds.right, peer.right) - Math.max(bounds.x, peer.x) > 1 &&
              Math.min(bounds.bottom, peer.bottom) - Math.max(bounds.y, peer.y) > 1
            )
              problems.push('overlap');
          }
        }
      }
      return { problems, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    expect(geometry, entry).toEqual({ problems: [], overflow: false });
    await page.screenshot({ path: testInfo.outputPath(`${entry}.png`), fullPage: true });
  }
});

test('nested task layouts keep control heights, row alignment and parent bounds at every breakpoint', async ({
  page
}) => {
  await loginStaff(page);
  for (const width of [1440, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const entry of [
      '人员管理',
      '统计分析',
      '系统权限',
      '今日值班',
      '安排下周',
      '我的值班',
      '统计与历史',
      '账号列表',
      '激活审核',
      '加入资格'
    ]) {
      if (['今日值班', '安排下周', '我的值班', '统计与历史'].includes(entry))
        await dutyPage(page, entry);
      else if (['账号列表', '激活审核', '加入资格'].includes(entry)) {
        const people = await staffPage(page, '人员管理');
        await people.getByRole('button', { name: '激活与账号', exact: true }).click();
        await people
          .getByRole('navigation', { name: '账号管理功能', exact: true })
          .getByRole('button', { name: entry, exact: true })
          .click();
      } else {
        const main = await staffPage(page, entry);
        if (entry === '人员管理')
          await main.getByRole('button', { name: '人员列表', exact: true }).click();
      }
      const problems = await page.getByRole('main').evaluate((main) => {
        const errors = [];
        const composite =
          '.workspace-date-field,.workspace-time-field,.workspace-select,.workspace-campus-scope,.workspace-refresh-control,.workspace-more-actions';
        const groups =
          '.workspace-heading-actions,.duty-toolbar,.report-controls,.members-filter-grid,.members-list-actions,.report-filters,.permission-tools,.duty-checkin-actions,.accounts-section-heading,.workspace-panel-actions';
        for (const group of main.querySelectorAll(groups)) {
          if (!group.getClientRects().length || group.closest('[hidden]')) continue;
          const parent = group.getBoundingClientRect();
          const nodes = [
            ...group.querySelectorAll(
              `${composite},button,input:not([type="checkbox"],[type="radio"],[type="hidden"])`
            )
          ].filter(
            (node) =>
              node.getClientRects().length &&
              !node.closest('[hidden],[aria-hidden="true"]') &&
              !node.parentElement.closest(composite) &&
              !node.closest('.workspace-help-hint')
          );
          const controls = nodes.map((node) => ({
            name: node.getAttribute('aria-label') || node.textContent.trim(),
            bounds: node.getBoundingClientRect()
          }));
          for (let index = 0; index < controls.length; index++) {
            const { name, bounds } = controls[index];
            if (Math.abs(bounds.height - 44) > 1) errors.push(`${name}: height ${bounds.height}`);
            if (bounds.left < parent.left - 1 || bounds.right > parent.right + 1)
              errors.push(`${name}: exceeds parent`);
            for (const peer of controls.slice(index + 1)) {
              const overlap =
                Math.min(bounds.bottom, peer.bounds.bottom) - Math.max(bounds.top, peer.bounds.top);
              if (overlap > Math.min(bounds.height, peer.bounds.height) / 2) {
                if (Math.abs(bounds.top - peer.bounds.top) > 1)
                  errors.push(`${name}/${peer.name}: uneven row`);
                if (
                  Math.min(bounds.right, peer.bounds.right) -
                    Math.max(bounds.left, peer.bounds.left) >
                  1
                )
                  errors.push(`${name}/${peer.name}: overlap`);
              }
            }
          }
        }
        return errors;
      });
      expect(problems, `${entry} at ${width}px`).toEqual([]);
      if (entry === '统计分析' && width < 768) {
        const date = await page
          .getByRole('textbox', { name: '查看单日', exact: true })
          .boundingBox();
        expect(date.width).toBeGreaterThanOrEqual(190);
      }
    }
  }
});

test('work actions, attendance panels and notice tools use available parent space', async ({
  page
}) => {
  await loginStaff(page);
  for (const width of [1920, 1280, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 1080 });
    const today = await staffPage(page, '今日工作');
    const scope = await today.getByRole('group', { name: '接待校区', exact: true }).boundingBox();
    const shortcuts = await today.locator('.attendance-shortcuts').boundingBox();
    expect(shortcuts.y - scope.y - scope.height).toBeGreaterThanOrEqual(16);
    if (width >= 1280) {
      const tops = await today
        .locator('.today-toolbar > .field-actions > button')
        .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
    }
    const schedule = await dutyPage(page, '我的值班');
    const history = await schedule.locator('.attendance-history > .field-card').boundingBox();
    const container = await schedule.locator('.attendance-history').boundingBox();
    expect(Math.abs(history.width - container.width)).toBeLessThanOrEqual(1);
    const configuration = await staffPage(page, '预约配置');
    await configuration.getByRole('button', { name: '校区公告', exact: true }).click();
    const refresh = configuration.getByRole('button', { name: '刷新公告', exact: true });
    await expect(
      configuration
        .locator('.booking-rule-card')
        .getByRole('button', { name: '刷新公告', exact: true })
    ).toHaveCount(1);
    if (width >= 1280) {
      const refreshBounds = await refresh.boundingBox();
      const createBounds = await configuration
        .getByRole('button', { name: '新增公告', exact: true })
        .boundingBox();
      expect(Math.abs(refreshBounds.y - createBounds.y)).toBeLessThanOrEqual(1);
    }
    const overflow = await configuration.evaluate(
      (node) => node.scrollWidth > node.clientWidth + 1
    );
    expect(overflow).toBe(false);
  }
});

test('mobile task controls have deliberate rows and compact work shortcuts', async ({ page }) => {
  await loginStaff(page);
  for (const width of [320, 375, 430, 600]) {
    await page.setViewportSize({ width, height: 900 });
    const attendance = await dutyPage(page, '今日值班');
    const date = await attendance
      .getByRole('textbox', { name: '值班日期', exact: true })
      .boundingBox();
    const today = await attendance.getByRole('button', { name: '今天', exact: true }).boundingBox();
    expect(Math.abs(date.y - today.y)).toBeLessThanOrEqual(1);
    const refresh = await attendance
      .getByRole('button', { name: '刷新值班', exact: true })
      .boundingBox();
    const code = await attendance
      .getByRole('button', { name: '展示签到码', exact: true })
      .boundingBox();
    const add = await attendance
      .getByRole('button', { name: '补录其他人员', exact: true })
      .boundingBox();
    expect(Math.abs(refresh.width - 44)).toBeLessThanOrEqual(1);
    expect(
      Math.max(refresh.y, code.y, add.y) - Math.min(refresh.y, code.y, add.y)
    ).toBeLessThanOrEqual(1);
    expect(code.x - refresh.x - refresh.width).toBeGreaterThanOrEqual(8);
    expect(add.x - code.x - code.width).toBeGreaterThanOrEqual(8);
    const work = await staffPage(page, '今日工作');
    for (const card of await work.locator('.attendance-quick-action').all()) {
      const bounds = await card.boundingBox();
      expect(bounds.height).toBeLessThanOrEqual(100);
      const button = await card.getByRole('button').boundingBox();
      expect(button.x + button.width).toBeLessThanOrEqual(bounds.x + bounds.width - 12);
    }
    const planner = await dutyPage(page, '安排下周');
    const week = await planner.getByRole('textbox', { name: '所在周', exact: true }).boundingBox();
    expect(week.width).toBeGreaterThanOrEqual(160);
    const report = await dutyPage(page, '统计与历史');
    const campus = report.getByRole('button', { name: '全部授权校区', exact: true });
    expect(await campus.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  }
});

test('mobile editors keep search, form spacing and all availability days usable', async ({
  page
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await loginStaff(page);
  const planner = await dutyPage(page, '安排下周');
  await planner.getByRole('button', { name: '选择人员', exact: true }).first().click();
  const picker = page.getByRole('dialog');
  const search = picker.getByRole('searchbox', { name: '搜索人员', exact: true });
  expect((await search.boundingBox()).width).toBeGreaterThanOrEqual(220);
  await search.fill('周宁');
  await expect(picker.getByText('周宁 20261003', { exact: true })).toBeVisible();
  await picker.getByRole('button', { name: '关闭', exact: true }).click();
  const today = await dutyPage(page, '今日值班');
  await today.getByRole('button', { name: '补录其他人员', exact: true }).click();
  const form = page.getByRole('dialog', { name: '补记漏签', exact: true });
  const labels = await form.locator('.attendance-edit-fields > label').evaluateAll((nodes) =>
    nodes.map((node) => {
      const bounds = node.getBoundingClientRect();
      return { top: bounds.top, bottom: bounds.bottom };
    })
  );
  expect(labels[1].top - labels[0].bottom).toBeGreaterThanOrEqual(16);
  await page.keyboard.press('Escape');
  const mine = await dutyPage(page, '我的值班');
  await mine.getByRole('button', { name: '修改通常时间', exact: true }).click();
  for (const campus of await mine.locator('.duty-availability > div').all()) {
    await expect(campus.locator('input[type="checkbox"]')).toHaveCount(7);
    const bounds = await campus.boundingBox();
    for (const label of await campus.locator('label').all()) {
      const box = await label.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
  for (const unit of await mine.locator('.duty-hours small').all()) {
    const height = await unit.evaluate((node) => ({
      actual: node.getBoundingClientRect().height,
      line: parseFloat(getComputedStyle(node).lineHeight)
    }));
    expect(height.actual).toBeLessThanOrEqual(height.line + 1);
  }
});
