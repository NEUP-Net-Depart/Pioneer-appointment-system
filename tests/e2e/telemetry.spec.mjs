import { test, expect } from './support/fixtures.mjs';
import { collectTelemetry, readyTelemetry, sendPending } from './support/telemetry.mjs';

// Use a visitor UA so the real SDK's bot filter does not discard headless-browser events.
test.use({
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
});

const correlation = '12345678-1234-4234-8234-123456789abc';

test('student SDK captures navigation, autocapture, replay and correlated exceptions without duplicate collection', async ({
  page,
  context
}) => {
  const events = await collectTelemetry(page);
  await page.goto('/');
  await readyTelemetry(page);
  await page.getByRole('button', { name: '我的预约', exact: true }).click();
  await page.getByRole('button', { name: '预约维修', exact: true }).click();
  await page.getByRole('button', { name: '我的预约', exact: true }).click();
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      headers: { 'X-Request-ID': correlation },
      body: JSON.stringify({ error: 'Unavailable', code: 'SERVICE_UNAVAILABLE' })
    })
  );
  const result = await page.evaluate(async () => {
    const { apiJson } = await import('/shared/api.js');
    try {
      await apiJson('/api/auth/me');
    } catch (error) {
      return { status: error.status, id: error.requestId };
    }
  });
  expect(result).toEqual({ status: 503, id: correlation });
  await page.evaluate(() => {
    const error = new TypeError('Example runtime failure');
    window.dispatchEvent(new ErrorEvent('error', { error }));
    window.dispatchEvent(new ErrorEvent('error', { error }));
  });
  await sendPending(context);
  await expect.poll(() => events().filter((e) => e.name === '$exception').length).toBe(2);
  expect(
    events().some(
      (e) => e.name === '$exception' && e.requestId === correlation && e.errorCode === 'HTTP_ERROR'
    )
  ).toBe(true);
  expect(
    events().some(
      (e) => e.name === 'flow.result' && e.requestId === correlation && e.status === 503
    )
  ).toBe(true);
  expect(
    events()
      .filter((e) => e.name === 'app.view')
      .map((e) => e.view)
  ).toEqual(['student.booking', 'student.lookup', 'student.booking', 'student.lookup']);
  expect(events().some((e) => e.name === '$autocapture')).toBe(true);
  await expect.poll(() => events().some((e) => e.name === '$snapshot')).toBe(true);
});

test('staff SDK records dialogs and lazy pages and isolates shared-device identities on logout', async ({
  page,
  context
}) => {
  const { loginStaff, staffPage } = await import('./support/staff.mjs');
  const events = await collectTelemetry(page);
  await loginStaff(page);
  await readyTelemetry(page);
  const distinct = await page.evaluate(async () =>
    (await import('/assets/posthog.js')).default.get_distinct_id()
  );
  expect(distinct).toMatch(/^staff:/);
  await staffPage(page, '人员管理');
  await page.getByRole('button', { name: '新增人员', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增人员', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await staffPage(page, '统计分析');
  await sendPending(context);
  for (const result of ['open', 'closed'])
    expect(events().some((e) => e.name === 'ui.dialog' && e.result === result)).toBe(true);
  expect(events().some((e) => e.name === 'app.view' && e.view.startsWith('staff.'))).toBe(true);
  const logout = page.getByRole('button', { name: '退出登录', exact: true });
  if (!(await logout.isVisible()))
    await page
      .getByRole('navigation', { name: '手机岗位导航', exact: true })
      .getByRole('button', { name: '我的', exact: true })
      .click();
  await logout.click();
  await expect(page.getByLabel('密码', { exact: true })).toBeVisible();
  const after = await page.evaluate(async () =>
    (await import('/assets/posthog.js')).default.get_distinct_id()
  );
  expect(after).not.toBe(distinct);
  expect(after).not.toMatch(/^staff:/);
});

test('API timeouts are exceptions while deliberate cancellation stays a separate outcome', async ({
  page,
  context
}) => {
  const events = await collectTelemetry(page);
  await page.goto('/');
  await readyTelemetry(page);
  const cancelled = await page.evaluate(async () => {
    const { apiJson } = await import('/shared/api.js');
    const controller = new AbortController();
    controller.abort();
    try {
      await apiJson('/api/auth/me', { signal: controller.signal });
    } catch (error) {
      window.dispatchEvent(
        new PromiseRejectionEvent('unhandledrejection', {
          promise: Promise.resolve(),
          reason: error
        })
      );
      return error.name;
    }
  });
  expect(cancelled).toBe('AbortError');
  let pending;
  await page.route('**/api/auth/me', (route) => {
    pending = route;
  });
  await page.evaluate(() => {
    window.telemetryPending = import('/shared/api.js').then(({ apiJson }) =>
      apiJson('/api/auth/me', { timeoutMs: 100 }).catch((error) => error.name)
    );
  });
  await expect.poll(() => !!pending).toBe(true);
  await context.clock.fastForward(200);
  expect(await page.evaluate(() => window.telemetryPending)).toBe('AbortError');
  await sendPending(context);
  await expect.poll(() => events().some((e) => e.errorCode === 'REQUEST_TIMEOUT')).toBe(true);
  expect(events().some((e) => e.result === 'cancelled')).toBe(true);
  expect(events().filter((e) => e.name === '$exception')).toHaveLength(1);
});

test('blocked SDK leaves student navigation operational', async ({ page }) => {
  await collectTelemetry(page);
  await page.route('**/assets/posthog.js', (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: '我的预约', exact: true }).click();
  await expect(page.getByRole('button', { name: '已有预约？通过私人查询链接查看' })).toBeVisible();
  await page.getByRole('button', { name: '预约维修', exact: true }).click();
  await expect(page.locator('#booking-form')).toBeVisible();
});

async function expectControlIds(page) {
  const missing = await page
    .locator(
      'button,a,input,select,textarea,form,dialog,[role="dialog"],[role="listbox"],[role="tooltip"],[role="spinbutton"]'
    )
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => !node.getAttribute('data-track'))
        .map((node) => node.outerHTML.slice(0, 120))
    );
  expect(missing).toEqual([]);
}

test('portalled selections report one keyboard commit and retain source IDs', async ({
  page,
  context
}) => {
  const { loginStaff, staffPage } = await import('./support/staff.mjs');
  const events = await collectTelemetry(page);
  await loginStaff(page);
  await readyTelemetry(page);
  const people = await staffPage(page, '人员管理');
  await people.getByRole('button', { name: '新增人员', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增人员', exact: true });
  const college = dialog.getByRole('combobox', { name: '学院', exact: true });
  const id = await college.getAttribute('data-track');
  expect(id).toBeTruthy();
  await college.press('ArrowDown');
  const search = page.getByRole('searchbox', { name: '搜索学院', exact: true });
  await expect(search).toHaveAttribute('data-track', `${id}.search`);
  await search.fill('private@example.com SECRET-TOKEN');
  await search.fill('计算机');
  await search.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(college).toHaveText('计算机科学与工程学院');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await college.press('ArrowDown');
  await expect(page.getByRole('listbox')).toHaveAttribute('data-track', `${id}.panel`);
  await expectControlIds(page);
  await page.keyboard.press('Escape');
  await sendPending(context);
  await expect
    .poll(() =>
      events()
        .filter((e) => e.name === 'ui.change' && e.control === id)
        .reduce((n, e) => n + e.count, 0)
    )
    .toBe(1);
  for (const result of ['open', 'closed'])
    expect(
      events().some(
        (e) => e.name === 'ui.toggle' && e.control === `${id}.panel` && e.result === result
      )
    ).toBe(true);
});

test('calendar, help and time gestures retain their field context and bound gesture counts', async ({
  page,
  context
}) => {
  const { loginStaff, staffPage } = await import('./support/staff.mjs');
  const events = await collectTelemetry(page);
  await loginStaff(page);
  await readyTelemetry(page);
  const stats = await staffPage(page, '统计分析');
  const hint = stats.getByRole('button', { name: '统计口径', exact: true });
  const hintId = await hint.getAttribute('data-track');
  await hint.focus();
  await expect(page.getByRole('tooltip')).toHaveAttribute('data-track', `${hintId}.panel`);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  const date = stats.getByRole('textbox', { name: '查看单日', exact: true });
  const dateId = await date.getAttribute('data-track');
  await stats.locator(`[data-track="${dateId}.trigger"]`).click();
  const calendar = page.locator(`[role="dialog"][data-track="${dateId}.panel"]`);
  await expect(calendar).toHaveAttribute('data-track', `${dateId}.panel`);
  await calendar.locator('button[data-day]:not(:disabled)').nth(10).press('Enter');
  await sendPending(context);
  expect(events().some((e) => e.name === 'ui.change' && e.control === dateId)).toBe(true);
  for (const result of ['open', 'closed'])
    expect(
      events().some(
        (e) => e.name === 'ui.toggle' && e.control === `${hintId}.panel` && e.result === result
      )
    ).toBe(true);

  const configuration = await staffPage(page, '预约配置');
  await configuration.getByRole('button', { name: '放号时间', exact: true }).click();
  const field = page.getByLabel('放号时间（北京时间）', { exact: true });
  const id = await field.getAttribute('data-track');
  await page.getByRole('button', { name: '选择放号时间', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '选择放号时间', exact: true });
  await expect(dialog).toHaveAttribute('data-track', `${id}.panel`);
  await expectControlIds(page);
  const digit = dialog.getByRole('spinbutton', { name: '分钟个位', exact: true });
  await digit.focus();
  for (let index = 0; index < 8; index++) await page.keyboard.press('ArrowUp');
  await context.clock.fastForward(300);
  // A wheel burst is one adjustment even when it changes many draft digits.
  await digit.evaluate((node) => {
    for (let index = 0; index < 20; index++)
      node.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true }));
  });
  await context.clock.fastForward(300);
  const box = await digit.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 36, { steps: 12 });
  await page.mouse.up();
  await dialog.getByRole('button', { name: /^确定 / }).click();
  await sendPending(context);
  await expect
    .poll(() =>
      events()
        .filter((e) => e.name === 'ui.change' && e.control === `${id}.adjust`)
        .reduce((n, e) => n + e.count, 0)
    )
    .toBe(3);
  expect(
    events()
      .filter((e) => e.name === 'ui.change' && e.control === id)
      .reduce((n, e) => n + e.count, 0)
  ).toBe(1);
});
