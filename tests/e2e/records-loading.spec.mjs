import { test, expect } from './support/fixtures.mjs';
import { dutyPage, loginStaff, staffPage } from './support/staff.mjs';

test('records initialize the service date, restore filters and append pages', async ({ page }) => {
  let releaseOverview;
  const gate = new Promise((resolve) => {
    releaseOverview = resolve;
  });
  const requests = [];
  const slots = ['19:00–19:30', '19:30–20:00', '20:00–20:30', '20:30–21:00'];
  const items = ['南湖', '浑南'].flatMap((campus) =>
    ['2026-10-15', '2026-10-19'].flatMap((date) =>
      slots.map((timeSlot) => ({
        campus,
        date,
        timeSlot,
        capacity: 3,
        occupied: 1,
        remaining: 2,
        booked: 1,
        inProgress: 0,
        paused: date === '2026-10-15'
      }))
    )
  );
  await page.route('**/api/appointments/overview', async (route) => {
    await gate;
    await route.fulfill({
      json: {
        dates: ['2026-10-15', '2026-10-19'],
        campuses: ['南湖', '浑南'],
        items,
        week: {
          start: '2026-10-12',
          end: '2026-10-18',
          items: items.filter((row) => row.date === '2026-10-15')
        },
        updatedAt: '2026-10-15T02:00:00Z'
      }
    });
  });
  await page.route('**/api/appointments?*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.searchParams);
    const start = Number(url.searchParams.get('cursor') || 0);
    const length = Math.min(30, 120 - start);
    await route.fulfill({
      json: {
        items: Array.from({ length }, (_, index) => ({
          id: `record-${start + index}`,
          name: `预约同学${start + index}`,
          studentId: String(20260000 + start + index),
          date: url.searchParams.get('date') || '2026-10-19',
          timeSlot: slots[0],
          campus: '南湖',
          status: 'booked',
          brand: '联想',
          faultType: '系统',
          deviceType: '笔记本'
        })),
        nextCursor: start + length < 120 ? String(start + length) : null
      }
    });
  });
  await loginStaff(page, 'root001', process.env.E2E_ROOT_PASSWORD);
  await staffPage(page, '预约记录');
  try {
    await expect(page.locator('.records-table-wrap tbody tr')).toHaveCount(0);
    expect(requests).toHaveLength(0);
  } finally {
    releaseOverview();
  }
  await expect(page.getByText('预约同学0', { exact: true })).toBeVisible();
  expect(requests[0].get('date')).toBe('2026-10-19');
  const periods = page.locator('.records-periods');
  await expect(periods.getByRole('button', { name: '10/19 周一' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  const campus = page.locator('.records-campus').filter({ hasText: '南湖校区' });
  const slot = campus.locator('.records-slot').first();
  await slot.getByRole('button', { name: /待接收/ }).click();
  await expect(slot.getByRole('button', { name: /待接收/ })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect.poll(() => requests.at(-1).get('status')).toBe('booked');
  const requestsBeforeReset = requests.length;
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await expect(page.getByText('预约同学0', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(requestsBeforeReset);
  expect(requests.at(-1).get('date')).toBe('2026-10-19');
  await expect(slot.getByRole('button', { name: /待接收/ })).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await page.locator('.records-load-sentinel').scrollIntoViewIfNeeded();
  await expect.poll(() => requests.some((params) => !!params.get('cursor'))).toBe(true);
  await expect(page.getByText('预约同学0', { exact: true })).toHaveCount(1);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(page.locator('.records-table-wrap tbody tr')).toHaveCount(60);
});

test('personal schedule stays editable while hours and invitations are pending', async ({
  page
}) => {
  let releaseHours;
  const gate = new Promise((resolve) => {
    releaseHours = resolve;
  });
  await page.route('**/api/rosters/covers', async (route) => {
    await gate;
    await route.fulfill({ json: { items: [] } });
  });
  await page.route('**/api/me/volunteer-summary', async (route) => {
    await gate;
    await route.fulfill({
      json: {
        monthHours: 2,
        totalHours: 24,
        settings: { hoursPerCount: 2, countMode: 'weekly', mergeLeaders: true }
      }
    });
  });
  await loginStaff(page, '20261003', 'StaffTest!2026');
  await dutyPage(page, '我的值班');
  try {
    await expect(page.getByRole('button', { name: '修改通常时间', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '修改通常时间', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存空闲', exact: true })).toBeEnabled();
  } finally {
    releaseHours();
  }
  await expect(page.locator('.duty-hours')).toContainText('24');
});

test('members paginate, search remotely, filter complete data and clear revoked access', async ({
  page
}) => {
  const requests = [];
  let refreshed = false;
  let denied = false;
  const member = (index) => ({
    memberId: `paged-${index}`,
    name: `分页成员${index}`,
    status: index === 101 ? 'inactive' : 'active',
    homeCampusId: index === 101 ? 'campus-hunnan' : 'campus-nanhu',
    identities: [],
    studentId: `student-${index}`
  });
  await page.route('**/api/members?*', async (route) => {
    if (denied) {
      await route.fulfill({ status: 403, json: { error: '人员读取权限已变更' } });
      return;
    }
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    const items = params.get('q')
      ? [member(150)]
      : params.get('cursor')
        ? [member(101)]
        : refreshed
          ? [member(2)]
          : Array.from({ length: 100 }, (_, index) => member(index));
    await route.fulfill({
      json: {
        items,
        nextCursor: !params.get('q') && !params.get('cursor') && !refreshed ? 'page-2' : null
      }
    });
  });
  await loginStaff(page, 'root001', process.env.E2E_ROOT_PASSWORD);
  await staffPage(page, '人员管理');
  await expect(page.locator('.members-results .react-row:not(.react-row-head)')).toHaveCount(100);
  await page.getByLabel('搜索成员').fill('跨页部门');
  await expect(page.getByText('分页成员150', { exact: true })).toBeVisible();
  expect(requests.at(-1).get('q')).toBe('跨页部门');
  const beforeReturn = requests.length;
  await page.getByLabel('搜索成员').fill('');
  await expect(page.locator('.members-results .react-row:not(.react-row-head)')).toHaveCount(100);
  expect(requests).toHaveLength(beforeReturn);
  expect(requests.some((params) => params.has('cursor'))).toBe(false);
  await page.locator('.members-list-footer').scrollIntoViewIfNeeded();
  await expect(page.locator('.members-results .react-row:not(.react-row-head)')).toHaveCount(101);
  expect(requests.at(-1).get('cursor')).toBe('page-2');
  const completeReads = requests.length;
  await page.getByLabel('筛选成员状态').selectOption('inactive');
  await expect(page.getByText('分页成员101', { exact: true })).toBeVisible();
  await expect(page.locator('.members-results .react-row:not(.react-row-head)')).toHaveCount(1);
  await page.getByLabel('筛选成员校区').selectOption('campus-nanhu');
  await expect(page.getByRole('heading', { name: '没有找到成员' })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.locator('.members-results .react-row:not(.react-row-head)')).toHaveCount(101);
  expect(requests).toHaveLength(completeReads);
  refreshed = true;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.locator('.members-results .react-row:not(.react-row-head)')).toHaveCount(1);
  await expect(page.getByText('分页成员0', { exact: true })).toHaveCount(0);
  denied = true;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.locator('.members-results .react-row:not(.react-row-head)')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('人员读取权限已变更');
});

test('refresh keeps loaded pages usable and preserves them on failure', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let phase = 'initial';
  let pendingTail = false;
  const member = (index, updated = false) => ({
    memberId: `cache-${index}`,
    name: `${updated ? '已更新' : '缓存成员'}${index}`,
    status: 'active',
    homeCampusId: 'campus-nanhu',
    identities: []
  });
  await page.route('**/api/members?*', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (phase === 'failed') {
      await route.fulfill({ status: 503, json: { error: '暂时无法同步' } });
      return;
    }
    if (phase === 'refresh' && params.get('cursor')) {
      pendingTail = true;
      await gate;
    }
    const updated = phase === 'refresh';
    await route.fulfill({
      json: {
        items: params.get('cursor')
          ? [member(updated ? 102 : 101, updated)]
          : Array.from({ length: 100 }, (_, index) => member(index, updated)),
        nextCursor: params.get('cursor') ? null : 'tail'
      }
    });
  });
  await loginStaff(page, 'root001', process.env.E2E_ROOT_PASSWORD);
  await staffPage(page, '人员管理');
  const rows = page.locator('.members-results .react-row:not(.react-row-head)');
  await expect(rows).toHaveCount(100);
  await page.locator('.members-list-footer').scrollIntoViewIfNeeded();
  await expect(rows).toHaveCount(101);
  phase = 'refresh';
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  try {
    await expect.poll(() => pendingTail).toBe(true);
    await expect(rows).toHaveCount(101);
    await expect(page.getByText('缓存成员0', { exact: true })).toHaveCount(1);
    await expect(page.getByText('已更新0', { exact: true })).toHaveCount(0);
    await expect(page.locator('.members-results')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByLabel('搜索成员')).toBeEnabled();
    await expect(rows.first().getByRole('button', { name: '人员详情' })).toBeEnabled();
  } finally {
    release();
  }
  await expect(page.getByText('已更新102', { exact: true })).toHaveCount(1);
  await expect(page.getByText('缓存成员101', { exact: true })).toHaveCount(0);
  await expect(rows).toHaveCount(101);
  phase = 'failed';
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('暂时无法同步');
  await expect(rows).toHaveCount(101);
  await expect(page.locator('.members-results')).toHaveAttribute('aria-busy', 'false');
});

test('cancelled pagination does not leave a cached view busy or let late results replace its filter', async ({
  page
}) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let tailReads = 0;
  const member = (index) => ({
    memberId: `cancel-${index}`,
    name: `取消测试${index}`,
    status: 'active',
    identities: []
  });
  await page.route('**/api/members?*', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('cursor')) {
      tailReads++;
      await gate;
    }
    await route.fulfill({
      json: {
        items: params.get('q')
          ? [member(200)]
          : params.get('cursor')
            ? [member(101)]
            : Array.from({ length: 100 }, (_, index) => member(index)),
        nextCursor: params.get('q') || params.get('cursor') ? null : 'tail'
      }
    });
  });
  await loginStaff(page, 'root001', process.env.E2E_ROOT_PASSWORD);
  await staffPage(page, '人员管理');
  const rows = page.locator('.members-results .react-row:not(.react-row-head)');
  const search = page.getByLabel('搜索成员');
  await expect(rows).toHaveCount(100);
  await search.fill('已缓存筛选');
  await expect(rows).toHaveCount(1);
  await search.fill('');
  await expect(rows).toHaveCount(100);
  await page.locator('.members-list-footer').scrollIntoViewIfNeeded();
  try {
    await expect.poll(() => tailReads).toBe(1);
    await search.fill('已缓存筛选');
    await expect(rows).toHaveCount(1);
    await expect(page.getByText('取消测试200', { exact: true })).toBeVisible();
    await search.fill('');
    await expect(rows).toHaveCount(100);
    await expect(page.locator('.members-list-footer')).toHaveAttribute('aria-busy', 'false');
    expect(tailReads).toBe(1);
  } finally {
    release();
  }
  await page.locator('.members-list-footer').scrollIntoViewIfNeeded();
  await expect.poll(() => tailReads).toBe(2);
  await expect(rows).toHaveCount(101);
});

test('schedule reuses weeks and keeps the draft revision during background updates', async ({
  page
}) => {
  let changed = false;
  let initialRevision;
  let updated = false;
  let submitted;
  let availabilityReads = 0;
  let summaryReads = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/me/volunteer-summary') summaryReads++;
  });
  await page.route('**/api/me/availability?*', async (route) => {
    availabilityReads++;
    const response = await route.fetch();
    const data = await response.json();
    initialRevision ??= data.usual.revision;
    if (changed) {
      data.usual.revision = initialRevision + 100;
    }
    await route.fulfill({ json: data });
    if (changed) updated = true;
  });
  await page.route('**/api/me/availability', async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: {} });
  });
  await loginStaff(page, '20261003', 'StaffTest!2026');
  await dutyPage(page, '我的值班');
  const edit = page.getByRole('button', { name: '修改通常时间', exact: true });
  await expect(edit).toBeEnabled();
  const summaryBefore = summaryReads;
  await page.getByRole('button', { name: '下周', exact: true }).click();
  await expect.poll(() => availabilityReads).toBe(2);
  await expect(edit).toBeEnabled();
  await page.getByRole('button', { name: '本周', exact: true }).click();
  await expect(edit).toBeEnabled();
  expect(availabilityReads).toBe(2);
  expect(summaryReads).toBe(summaryBefore);
  await edit.click();
  await page.locator('.duty-availability input').first().click();
  changed = true;
  await page.clock.fastForward(31000);
  await expect.poll(() => updated).toBe(true);
  await page.getByRole('button', { name: '保存空闲', exact: true }).click();
  await expect.poll(() => submitted?.revision).toBe(initialRevision);
  await expect(edit).toBeVisible();
  await page.unrouteAll({ behavior: 'wait' });
});

test('logout and authorization changes discard private rows and late responses in the same app', async ({
  page
}) => {
  let phase = 'initial',
    revoked = false,
    slowRequest,
    release,
    delivered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const completion = new Promise((resolve) => {
    delivered = resolve;
  });
  await page.route('**/api/members?*', async (route) => {
    const slow = phase === 'slow';
    const name = phase === 'new' ? '新会话成员' : '旧会话私有成员';
    if (slow) {
      slowRequest = route.request();
      await gate;
    }
    try {
      await route.fulfill({
        json: {
          items: [{ memberId: name, name, status: 'active', identities: [] }],
          nextCursor: null
        }
      });
    } finally {
      if (slow) delivered();
    }
  });
  for (const pattern of ['**/api/auth/me', '**/api/field/home*'])
    await page.route(pattern, async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      if (revoked) {
        data.authVersion++;
        data.permissions = {
          ...data.permissions,
          'members.manage': false,
          'accounts.manage': false
        };
      }
      await route.fulfill({ response, json: data });
    });
  await loginStaff(page, 'root001', process.env.E2E_ROOT_PASSWORD);
  await staffPage(page, '人员管理');
  await expect(page.getByText('旧会话私有成员', { exact: true })).toBeVisible();
  phase = 'slow';
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect.poll(() => !!slowRequest).toBe(true);
  try {
    await staffPage(page, '个人中心');
    await page
      .locator('.field-content')
      .getByRole('button', { name: '退出登录', exact: true })
      .click();
    await expect(page.locator('#login-id')).toBeVisible();
    await expect.poll(() => slowRequest.failure()).not.toBeNull();
    phase = 'new';
    // Keep the same document, account and authorization version: isolation must
    // come from the login lifecycle, not a reload or a different account key.
    await page.locator('#login-id').fill('root001');
    await page.locator('#login-password').fill(process.env.E2E_ROOT_PASSWORD);
    await page.getByRole('button', { name: '进入系统' }).click();
    await expect(page.getByRole('main')).toBeVisible();
    await staffPage(page, '人员管理');
    await expect(page.getByText('新会话成员', { exact: true })).toBeVisible();
  } finally {
    release();
  }
  await completion;
  await expect(page.getByText('旧会话私有成员', { exact: true })).toHaveCount(0);
  revoked = true;
  await page.clock.fastForward(31000);
  await expect(page.locator('.react-members-page')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '人员管理', exact: true, includeHidden: true })
  ).toHaveCount(0);
  await expect(page.getByText('新会话成员', { exact: true })).toHaveCount(0);
  await expect(page.locator('.field-content')).toBeVisible();
  await page.unrouteAll({ behavior: 'wait' });
});
