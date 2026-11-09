import { test, expect } from './support/fixtures.mjs';
import { dutyPage, loginStaff, staffPage } from './support/staff.mjs';

test.beforeEach(async ({ context }, testInfo) => {
  const base = process.env.E2E_BASE_URL;
  if (base && ['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
    await context.setExtraHTTPHeaders({
      'CF-Connecting-IP': testInfo.project.name === 'webkit-mobile' ? '192.0.2.4' : '192.0.2.3'
    });
});

test('capacity inputs stay mounted and animate fetched values', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.capacityAnimations = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (this.matches('.capacity-template input[data-motion-value="field"]'))
        window.capacityAnimations.push(this.value);
      return animate.call(this, frames, options);
    };
  });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/slot-capacities', async (route) => {
    await gate;
    await route.continue();
  });
  await loginStaff(page, 'root001', process.env.E2E_ROOT_PASSWORD);
  await staffPage(page, '预约配置');
  const selector =
    testInfo.project.name === 'webkit-mobile'
      ? '.capacity-mobile-inputs input'
      : '.capacity-sheet-desktop tbody input';
  const input = page.locator(selector).first();
  let handle, before;
  try {
    await expect(input).toBeVisible();
    await expect(input).toBeDisabled();
    await expect(input).toHaveValue('');
    handle = await input.elementHandle();
    before = await input.boundingBox();
  } finally {
    release();
  }
  await expect(input).toBeEnabled();
  expect(await handle.evaluate((node) => node.isConnected)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.capacityAnimations.length)).toBeGreaterThan(0);
  const after = await input.boundingBox();
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
});

test('planner keeps real dates, controls and empty-shift geometry while data loads', async ({
  page
}, testInfo) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/rosters/campus-week?*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await gate;
    await route.fulfill({
      json: {
        ...data,
        paused: [],
        rosters: data.rosters.map((row) => ({ ...row, assignments: [] }))
      }
    });
  });
  await loginStaff(page, 'root001', process.env.E2E_ROOT_PASSWORD);
  await staffPage(page, '值班');
  await page
    .getByRole('navigation', { name: '值班任务' })
    .getByRole('button', { name: '安排下周', exact: true })
    .click();
  const form = page.locator('.duty-planner > form');
  const controls = page.locator('.duty-add-person');
  let grid;
  let before;
  try {
    await expect(form).toHaveAttribute('aria-busy', 'true');
    await expect(controls).toHaveCount(8);
    for (const date of await page.locator('.duty-day-column header > span').allTextContents())
      expect(date).toMatch(/^\d{2}-\d{2}$/);
    await expect(page.locator('.duty-planner .loading-line')).toHaveCount(0);
    before = await controls.first().boundingBox();
    grid = await page.locator('.duty-week-grid').elementHandle();
    await page.screenshot({ path: testInfo.outputPath('planner-pending.png'), fullPage: true });
  } finally {
    release();
  }
  await expect(form).toHaveAttribute('aria-busy', 'false');
  expect(await grid.evaluate((element) => element.isConnected)).toBe(true);
  const after = await controls.first().boundingBox();
  for (const dimension of ['x', 'y', 'width', 'height'])
    expect(
      Math.abs(after[dimension] - before[dimension]),
      `planner ${dimension}`
    ).toBeLessThanOrEqual(1);
  await expect(controls.first()).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('planner-ready.png'), fullPage: true });
});

test('duty metrics retain original typography and left alignment across loading', async ({
  page
}, testInfo) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/attendance/day?*', async (route) => {
    await gate;
    await route.continue();
  });
  await loginStaff(page, 'root001', process.env.E2E_ROOT_PASSWORD);
  await staffPage(page, '值班');
  const metrics = page.locator('.duty-day .duty-metrics');
  let element;
  let before;
  try {
    await expect(metrics.locator('[aria-busy="true"]')).toHaveCount(3);
    before = await metrics.boundingBox();
    element = await metrics.elementHandle();
  } finally {
    release();
  }
  await expect(metrics.locator('[aria-busy="true"]')).toHaveCount(0);
  await metrics.evaluate(async (node) => {
    await Promise.allSettled(
      node.getAnimations({ subtree: true }).map((animation) => animation.finished)
    );
  });
  expect(await element.evaluate((node) => node.isConnected)).toBe(true);
  const after = await metrics.boundingBox();
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
  const styles = await metrics
    .locator('strong')
    .first()
    .evaluate((strong) => {
      const number = strong.querySelector('.animated-value-content');
      const value = getComputedStyle(number),
        original = getComputedStyle(strong);
      return {
        fontSize: value.fontSize,
        originalSize: original.fontSize,
        color: value.color,
        originalColor: original.color,
        weight: value.fontWeight,
        originalWeight: original.fontWeight,
        offset: Math.abs(number.getBoundingClientRect().left - strong.getBoundingClientRect().left)
      };
    });
  expect(styles.fontSize).toBe(testInfo.project.name === 'webkit-mobile' ? '30px' : '36px');
  expect(styles.fontSize).toBe(styles.originalSize);
  expect(styles.color).toBe(styles.originalColor);
  expect(styles.weight).toBe(styles.originalWeight);
  expect(styles.offset).toBeLessThanOrEqual(1);
  await metrics.screenshot({ path: testInfo.outputPath('duty-metrics.png') });
});

test('numeric badges reveal their first value, stay centered across digit lengths and respect reduced motion', async ({
  page
}) => {
  await page.addInitScript(() => {
    window.numericMotions = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (this.matches('[data-value-motion="number"]') && this.closest('.data-count-badge'))
        window.numericMotions.push({ value: this.textContent, frames, duration: options.duration });
      return animate.call(this, frames, options);
    };
  });
  let count = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/field/board*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await gate;
    await route.fulfill({
      json: {
        ...data,
        pendingCoverInvitations: 0,
        repairs: [],
        pendingPhotos: [],
        appointments: Array.from({ length: count }, (_, index) => ({
          id: `count-${index}`,
          status: 'booked',
          date: data.businessDate,
          name: '测试工单',
          brand: '联想',
          timeSlot: '19:00–19:30',
          faultType: '系统'
        }))
      }
    });
  });
  await loginStaff(page, 'root001', process.env.E2E_ROOT_PASSWORD);
  await staffPage(page, '今日工作');
  const badge = page.locator('.today-orders').first().locator('.data-count-badge');
  try {
    await expect(badge.locator('[aria-busy="true"]')).toHaveCount(1);
    expect(
      await badge.locator('.data-value-loading').evaluate((node) => ({
        background: getComputedStyle(node).backgroundColor,
        text: node.textContent
      }))
    ).toEqual({ background: 'rgba(0, 0, 0, 0)', text: '' });
  } finally {
    release();
  }
  await expect(badge).toHaveText('0');
  const first = await page.evaluate(() =>
    window.numericMotions.find((motion) => motion.value === '0')
  );
  expect(first.duration).toBe(240);
  expect(first.frames.every((frame) => frame.opacity === undefined)).toBe(true);
  expect(first.frames[0].transform).toBe('translateY(1em)');
  let width;
  for (const next of [0, 9, 10, 100]) {
    if (next !== 0) {
      count = next;
      await page.locator('.field-content .field-footer button').click();
      await expect(badge).toHaveText(String(next));
    }
    await badge.evaluate(async (element) => {
      await Promise.allSettled(
        element.getAnimations({ subtree: true }).map((animation) => animation.finished)
      );
    });
    const geometry = await badge.evaluate((element) => {
      const outer = element.getBoundingClientRect();
      const inner = element.querySelector('.animated-value-content').getBoundingClientRect();
      return {
        width: outer.width,
        x: Math.abs(outer.x + outer.width / 2 - inner.x - inner.width / 2),
        y: Math.abs(outer.y + outer.height / 2 - inner.y - inner.height / 2)
      };
    });
    width ??= geometry.width;
    expect(geometry.width).toBeCloseTo(width, 1);
    expect(geometry.x).toBeLessThanOrEqual(1);
    expect(geometry.y).toBeLessThanOrEqual(1);
  }
  const motions = await page.evaluate(() => window.numericMotions.length);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  count = 11;
  await page.locator('.field-content .field-footer button').click();
  await expect(badge).toHaveText('11');
  expect(await page.evaluate(() => window.numericMotions.length)).toBe(motions);
});

test('records prioritize overview, synchronize filters and append pages without replacing visible rows', async ({
  page
}, testInfo) => {
  if (testInfo.project.name === 'webkit-mobile')
    await page.setViewportSize({ width: 320, height: 740 });
  await page.clock.install({ time: new Date('2026-10-15T02:00:00Z') });
  let releaseOverview;
  const gate = new Promise((resolve) => {
    releaseOverview = resolve;
  });
  let pages = 0;
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
    pages++;
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
  let panelTop;
  try {
    await expect(page.locator('.records-overview-disclosure')).toHaveAttribute('open', '');
    await expect(page.locator('.records-campus')).toHaveCount(2);
    await expect(page.locator('.record-loading-row')).toHaveCount(0);
    await expect(page.locator('.records-table-wrap tbody tr')).toHaveCount(0);
    expect(pages).toBe(0);
    panelTop = (await page.locator('.records-panel').boundingBox()).y;
    await page.screenshot({ path: testInfo.outputPath('records-pending.png'), fullPage: false });
  } finally {
    releaseOverview();
  }
  await expect(page.getByText('预约同学0', { exact: true })).toBeVisible();
  expect(
    Math.abs((await page.locator('.records-panel').boundingBox()).y - panelTop)
  ).toBeLessThanOrEqual(4);
  expect(requests[0].get('date')).toBe('2026-10-19');
  expect(requests[0].get('limit')).toBe('30');
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
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: testInfo.outputPath('records-overview.png'), fullPage: false });
  await page.locator('.records-load-sentinel').scrollIntoViewIfNeeded();
  await expect.poll(() => requests.some((params) => !!params.get('cursor'))).toBe(true);
  await expect(page.getByText('预约同学0', { exact: true })).toHaveCount(1);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(page.locator('.records-table-wrap tbody tr')).toHaveCount(60);
  const loadedRequests = requests.length;
  await page.clock.fastForward(31000);
  expect(requests).toHaveLength(loadedRequests);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('today keeps the same real sections and geometry while board data is pending', async ({
  page
}, testInfo) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/field/board*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await gate;
    await route.fulfill({
      json: {
        ...data,
        appointments: [],
        repairs: [],
        pendingPhotos: [],
        pendingCoverInvitations: 0
      }
    });
  });
  await loginStaff(page, 'root001', process.env.E2E_ROOT_PASSWORD);
  await staffPage(page, '今日工作');
  const selectors = ['.today-tools', '.today-work', '.attendance-shortcuts'];
  const boxes = [];
  const elements = [];
  try {
    await expect(page.locator('.today-orders[aria-busy="true"]').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: '当日工作', exact: true })).toHaveCount(0);
    await expect(page.getByText('今日没有待接收工单', { exact: true })).not.toBeVisible();
    for (const selector of selectors) {
      boxes.push(await page.locator(selector).boundingBox());
      elements.push(await page.locator(selector).elementHandle());
    }
    await page.screenshot({ path: testInfo.outputPath('today-pending.png'), fullPage: true });
  } finally {
    release();
  }
  await expect(page.locator('.field-content')).toHaveAttribute('aria-busy', 'false');
  const updated = page.locator('.field-content .field-footer .data-value-text');
  await expect(updated).toBeVisible();
  expect(
    await updated.evaluate((element) => {
      const text = element.getBoundingClientRect(),
        frame = element.parentElement.getBoundingClientRect();
      return text.top >= frame.top && text.bottom <= frame.bottom + 1;
    })
  ).toBe(true);
  for (const [index, selector] of selectors.entries()) {
    expect(await elements[index].evaluate((element) => element.isConnected)).toBe(true);
    const after = await page.locator(selector).boundingBox();
    for (const dimension of ['x', 'y', 'width', 'height'])
      expect(
        Math.abs(after[dimension] - boxes[index][dimension]),
        `${selector} ${dimension}`
      ).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: testInfo.outputPath('today-ready.png'), fullPage: true });
});

test('members append real rows below the existing toolbar without a separate loading card', async ({
  page
}, testInfo) => {
  let release;
  let memberRequests = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/members') memberRequests += 1;
  });
  await page.route('**/api/members?*', async (route) => {
    await gate;
    await route.continue();
  });
  await loginStaff(page, 'root001', process.env.E2E_ROOT_PASSWORD);
  await staffPage(page, '人员管理');
  let toolbar;
  let before;
  try {
    await expect(page.locator('.members-results')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('.members-results > .workspace-data-value')).toHaveCount(0);
    await expect(page.locator('.members-results .react-row:not(.react-row-head)')).toHaveCount(0);
    expect((await page.locator('.members-results').boundingBox()).height).toBeLessThan(100);
    toolbar = await page.locator('.members-tools').elementHandle();
    before = await page.locator('.members-tools').boundingBox();
  } finally {
    release();
  }
  await expect(page.locator('.members-results')).toHaveAttribute('aria-busy', 'false');
  expect(await toolbar.evaluate((element) => element.isConnected)).toBe(true);
  expect(
    Math.abs((await page.locator('.members-tools').boundingBox()).height - before.height)
  ).toBeLessThanOrEqual(1);
  await expect(
    page.locator('.members-results .react-row:not(.react-row-head)').first()
  ).toBeVisible();
  const requestsBeforeFilter = memberRequests;
  await page.getByLabel('成员状态').selectOption('active');
  await expect(page.locator('.members-results')).toHaveAttribute('aria-busy', 'false');
  await page.waitForTimeout(250);
  expect(memberRequests).toBe(requestsBeforeFilter);
  await page.screenshot({ path: testInfo.outputPath('members-ready.png'), fullPage: false });
});

test('personal schedule becomes usable before cumulative hours finish', async ({
  page
}, testInfo) => {
  await page.clock.install({ time: new Date('2026-10-15T02:00:00Z') });
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
    await expect(page.locator('.duty-hours [aria-busy="true"]')).toHaveCount(3);
    await page.screenshot({
      path: testInfo.outputPath('schedule-hours-pending.png'),
      fullPage: false
    });
  } finally {
    releaseHours();
  }
  await expect(page.locator('.duty-hours')).toContainText('24');
});

test('members bound pagination, search beyond the first page and replace refreshed results', async ({
  page
}) => {
  const requests = [];
  let refreshed = false;
  let denied = false;
  const member = (index) => ({
    memberId: `paged-${index}`,
    name: `分页成员${index}`,
    status: 'active',
    homeCampusId: 'campus-nanhu',
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
  await page.waitForTimeout(300);
  expect(requests).toHaveLength(1);
  await page.getByLabel('搜索成员').fill('跨页部门');
  await expect(page.getByText('分页成员150', { exact: true })).toBeVisible();
  expect(requests.at(-1).get('q')).toBe('跨页部门');
  const beforeReturn = requests.length;
  await page.getByLabel('搜索成员').fill('');
  await expect(page.locator('.members-results .react-row:not(.react-row-head)')).toHaveCount(100);
  expect(requests).toHaveLength(beforeReturn);
  await page.locator('.members-list-footer').scrollIntoViewIfNeeded();
  await expect(page.locator('.members-results .react-row:not(.react-row-head)')).toHaveCount(101);
  expect(requests.at(-1).get('cursor')).toBe('page-2');
  refreshed = true;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.locator('.members-results .react-row:not(.react-row-head)')).toHaveCount(1);
  await expect(page.getByText('分页成员0', { exact: true })).toHaveCount(0);
  denied = true;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.locator('.members-results .react-row:not(.react-row-head)')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('人员读取权限已变更');
});

test('cached pages remain usable during background reconciliation and survive a failed refresh', async ({
  page
}) => {
  await page.clock.install({ time: new Date('2026-10-15T02:00:00Z') });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let phase = 'initial';
  let pendingTail = false;
  const requests = [];
  const member = (index, updated = false) => ({
    memberId: `cache-${index}`,
    name: `${updated ? '已更新' : '缓存成员'}${index}`,
    status: 'active',
    homeCampusId: 'campus-nanhu',
    identities: []
  });
  await page.route('**/api/members?*', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    if (phase === 'failed') {
      await route.fulfill({ status: 503, json: { error: '暂时无法同步' } });
      return;
    }
    if (params.get('q')) {
      await route.fulfill({ json: { items: [member(200)], nextCursor: null } });
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
  await page.getByLabel('搜索成员').fill('跨页');
  await expect(rows).toHaveCount(1);
  const beforeReturn = requests.length;
  await page.getByLabel('搜索成员').fill('');
  await expect(rows).toHaveCount(101);
  expect(requests).toHaveLength(beforeReturn);
  phase = 'refresh';
  await page.clock.fastForward(121000);
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
  await page.clock.install({ time: new Date('2026-10-15T02:00:00Z') });
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
  for (const date of [
    '2026-11-02',
    '2026-11-09',
    '2026-11-16',
    '2026-11-23',
    '2026-11-30',
    '2026-12-07',
    '2026-12-14',
    '2026-12-21'
  ]) {
    const before = availabilityReads;
    await page.locator('.duty-personal').getByLabel('所在周').fill(date);
    await expect.poll(() => availabilityReads).toBe(before + 1);
    await expect(edit).toBeEnabled();
    await expect(page.locator('.duty-today-card .data-pending-copy')).toHaveCount(0);
  }
  await page.getByRole('button', { name: '本周', exact: true }).click();
  await expect(edit).toBeEnabled();
  await edit.click();
  await page.locator('.duty-availability input').first().click();
  changed = true;
  await page.clock.fastForward(31000);
  await expect.poll(() => updated).toBe(true);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
  await page.getByRole('button', { name: '保存空闲', exact: true }).click();
  await expect.poll(() => submitted?.revision).toBe(initialRevision);
  await expect(edit).toBeVisible();
  await page.unrouteAll({ behavior: 'wait' });
});

test('logout and authorization changes discard private rows and late responses in the same app', async ({
  page
}) => {
  await page.clock.install();
  let phase = 'initial',
    revoked = false,
    reads = 0,
    release,
    delivered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const completion = new Promise((resolve) => {
    delivered = resolve;
  });
  await page.route('**/api/members?*', async (route) => {
    reads++;
    const slow = phase === 'slow';
    const name = phase === 'new' ? '新会话成员' : '旧会话私有成员';
    if (slow) await gate;
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
          'accounts.manage': false,
          'settings.manage': false
        };
      }
      await route.fulfill({ response, json: data });
    });
  await loginStaff(page, 'root001', process.env.E2E_ROOT_PASSWORD);
  await staffPage(page, '人员管理');
  await expect(page.getByText('旧会话私有成员', { exact: true })).toBeVisible();
  phase = 'slow';
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect.poll(() => reads).toBe(2);
  try {
    await staffPage(page, '个人中心');
    await page
      .locator('.field-content')
      .getByRole('button', { name: '退出登录', exact: true })
      .click();
    await expect(page.locator('#login-id')).toBeVisible();
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
  expect(reads).toBe(3);
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

test('notice content expands through intermediate layout heights without replacing controls', async ({
  page
}) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/booking-settings/manage?*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await gate;
    await route.fulfill({
      json: {
        ...data,
        notices: [
          {
            id: 'expansion-notice',
            title: '加载展开验证',
            content: '公告内容应随真实容器平滑展开。',
            enabled: true,
            startsAt: '2026-01-01T00:00:00Z',
            endsAt: '2027-01-01T00:00:00Z'
          }
        ],
        suspensions: []
      }
    });
  });
  await loginStaff(page, 'root001', process.env.E2E_ROOT_PASSWORD);
  await staffPage(page, '预约配置');
  await page.getByRole('button', { name: '校区公告', exact: true }).click();
  const card = page
    .locator('.booking-rule-card:visible')
    .filter({ has: page.getByRole('heading', { name: '校区公告', exact: true }) });
  const region = card.locator('.data-expansion');
  const button = card.getByRole('button', { name: '新增公告' });
  const control = await button.elementHandle();
  const before = await button.boundingBox();
  try {
    await expect(region).toHaveAttribute('aria-busy', 'true');
    expect((await region.boundingBox()).height).toBe(0);
    await region.evaluate((element) => {
      window.expansionHeights = [];
      const observe = new ResizeObserver(() =>
        window.expansionHeights.push(element.getBoundingClientRect().height)
      );
      observe.observe(element);
      window.expansionObserver = observe;
    });
  } finally {
    release();
  }
  await expect(button).toBeEnabled();
  await expect
    .poll(() =>
      region.evaluate((element) =>
        Math.abs(element.getBoundingClientRect().height - element.firstElementChild.scrollHeight)
      )
    )
    .toBeLessThan(1);
  const heights = await page.evaluate(() => {
    window.expansionObserver.disconnect();
    return window.expansionHeights;
  });
  const finalHeight = (await region.boundingBox()).height;
  expect(heights.some((height) => height > 1 && height < finalHeight - 1)).toBe(true);
  expect(await control.evaluate((element) => element.isConnected)).toBe(true);
  expect(Math.abs((await button.boundingBox()).y - before.y)).toBeLessThanOrEqual(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await region.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe(
    '0s'
  );
});
