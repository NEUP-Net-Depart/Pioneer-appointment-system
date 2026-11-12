import { test, expect } from './support/fixtures.mjs';

const correlation = '12345678-1234-4234-8234-123456789abc';

test('telemetry captures real interactions and failures without private inputs or recursive requests', async ({
  page,
  context
}) => {
  const batches = [];
  await page.route('**/telemetry-config.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'window.pioneerTelemetry = {enabled:true,interactions:true,release:"abcdef12"};'
    })
  );
  await page.route('**/api/telemetry', async (route) => {
    batches.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '我的预约', exact: true }).click();
  await page.getByRole('button', { name: '已有预约？通过私人查询链接查看' }).click();
  await page
    .locator('#private-link-input')
    .fill('https://app.test/#appointment=PRIVATE-STUDENT-ID&access=SECRET-TOKEN');
  await page.locator('#private-link-input').blur();
  const missing = await page
    .locator('button, a, input, select, textarea, form, details, summary')
    .evaluateAll((nodes) =>
      nodes.filter((node) => !node.hasAttribute('data-track')).map((node) => node.tagName)
    );
  expect(missing).toEqual([]);
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      headers: { 'X-Request-ID': correlation },
      body: JSON.stringify({ error: 'private@example.com', code: 'SERVICE_UNAVAILABLE' })
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
    const error = new TypeError('PRIVATE-NAME private@example.com SECRET-TOKEN SN123456');
    error.stack = 'TypeError: SECRET-TOKEN\n at https://app.test/user/main.js:12:3';
    window.dispatchEvent(new ErrorEvent('error', { error }));
    window.dispatchEvent(new ErrorEvent('error', { error }));
  });
  await context.clock.fastForward(31000);
  await expect
    .poll(
      () => batches.flatMap((batch) => batch.events).filter((e) => e.name === 'client.error').length
    )
    .toBe(1);
  await context.clock.fastForward(31000);
  await expect
    .poll(() => batches.flatMap((batch) => batch.events).some((e) => e.name === 'ui.change'))
    .toBe(true);
  const events = batches.flatMap((batch) => batch.events);
  expect(events.some((e) => e.name === 'ui.click')).toBe(true);
  expect(events.some((e) => e.name === 'page.view' && e.view === 'student.lookup')).toBe(true);
  expect(
    events.some((e) => e.name === 'flow.result' && e.requestId === correlation && e.status === 503)
  ).toBe(true);
  for (const secret of [
    'PRIVATE-STUDENT-ID',
    'PRIVATE-NAME',
    'private@example.com',
    'SECRET-TOKEN',
    'SN123456'
  ])
    expect(JSON.stringify(events)).not.toContain(secret);
  expect(events.filter((e) => e.name === 'client.error')[0].frames).toBe('user/main.js:12:3');
  for (const batch of batches) {
    expect(batch.events.length).toBeLessThanOrEqual(20);
    expect(Buffer.byteLength(JSON.stringify(batch))).toBeLessThanOrEqual(16384);
  }
  // Once the transport fails, it drops the batch instead of reporting itself.
  await page.unroute('**/api/telemetry');
  let failed = 0;
  await page.route('**/api/telemetry', (route) => {
    failed++;
    return route.abort();
  });
  await page.getByRole('button', { name: '预约维修', exact: true }).click();
  await context.clock.fastForward(31000);
  await expect.poll(() => failed).toBe(1);
  await context.clock.fastForward(61000);
  expect(failed).toBe(1);
});

test('staff bundle records dialogs, lazy pages and request correlation without account data', async ({
  page,
  context
}) => {
  const { loginStaff, staffPage } = await import('./support/staff.mjs');
  const batches = [];
  await page.route('**/telemetry-config.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'window.pioneerTelemetry={enabled:true,interactions:true,release:"abcdef12"};'
    })
  );
  await page.route('**/api/telemetry', (route) => {
    batches.push(route.request().postDataJSON());
    return route.fulfill({ status: 204 });
  });
  await loginStaff(page, '20261003', 'StaffTest!2026');
  await staffPage(page, '今日工作');
  await page.getByRole('button', { name: '查询保修', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '查询设备保修', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('序列号 / S/N / Service Tag').fill('PRIVATE-SERIAL-123');
  await dialog.getByLabel('序列号 / S/N / Service Tag').blur();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toBeHidden();
  await staffPage(page, '我的值班');
  await context.clock.fastForward(31000);
  await expect
    .poll(() =>
      batches.flatMap((b) => b.events).some((e) => e.name === 'ui.dialog' && e.result === 'closed')
    )
    .toBe(true);
  const events = batches.flatMap((b) => b.events);
  expect(events.some((e) => e.name === 'ui.dialog' && e.result === 'open')).toBe(true);
  expect(
    events.some(
      (e) => e.name === 'flow.result' && e.status === 200 && /^[a-f\d-]{36}$/.test(e.requestId)
    )
  ).toBe(true);
  for (const secret of ['20261003', 'StaffTest!2026', 'PRIVATE-SERIAL-123'])
    expect(JSON.stringify(events)).not.toContain(secret);
});

test('API timeouts are errors while deliberate cancellation is a separate outcome', async ({
  page,
  context
}) => {
  const batches = [];
  await page.route('**/telemetry-config.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'window.pioneerTelemetry={enabled:true,interactions:true};'
    })
  );
  await page.route('**/api/telemetry', (route) => {
    batches.push(route.request().postDataJSON());
    return route.fulfill({ status: 204 });
  });
  await page.goto('/');
  const cancelled = await page.evaluate(async () => {
    const { apiJson } = await import('/shared/api.js');
    const controller = new AbortController();
    controller.abort();
    try {
      await apiJson('/api/auth/me', { signal: controller.signal });
    } catch (error) {
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
  await context.clock.fastForward(31000);
  await expect
    .poll(() => batches.flatMap((b) => b.events).some((e) => e.errorCode === 'REQUEST_TIMEOUT'))
    .toBe(true);
  await context.clock.fastForward(31000);
  await expect
    .poll(() => batches.flatMap((b) => b.events).some((e) => e.result === 'cancelled'))
    .toBe(true);
  expect(batches.flatMap((b) => b.events).filter((e) => e.name === 'client.error')).toHaveLength(1);
});

async function collectTelemetry(page) {
  const batches = [];
  await page.route('**/telemetry-config.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'window.pioneerTelemetry={enabled:true,interactions:true,release:"abcdef12"};'
    })
  );
  await page.route('**/api/telemetry', (route) => {
    batches.push(route.request().postDataJSON());
    return route.fulfill({ status: 204 });
  });
  return () => batches.flatMap((batch) => batch.events);
}
async function sendPending(context) {
  for (let index = 0; index < 3; index++) await context.clock.fastForward(31000);
}
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

test('portalled selections report a single keyboard commit and retain source IDs without search values', async ({
  page,
  context
}) => {
  const { loginStaff, staffPage } = await import('./support/staff.mjs');
  const events = await collectTelemetry(page);
  await loginStaff(page);
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
  expect(JSON.stringify(events())).not.toContain('private@example.com');
  expect(JSON.stringify(events())).not.toContain('SECRET-TOKEN');
  expect(JSON.stringify(events())).not.toContain('计算机');
});

test('calendar, help and time gestures retain their field context and bound gesture counts', async ({
  page,
  context
}) => {
  const { loginStaff, staffPage } = await import('./support/staff.mjs');
  const events = await collectTelemetry(page);
  await loginStaff(page);
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

test('combined membership submission records rejection and one successful request without member identifiers', async ({
  page,
  context
}) => {
  const { chooseOption, loginStaff, staffPage } = await import('./support/staff.mjs');
  const events = await collectTelemetry(page);
  await loginStaff(page);
  const people = await staffPage(page, '人员管理');
  await people.getByRole('button', { name: '新增人员', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新增人员', exact: true });
  await create.getByLabel('学号', { exact: true }).fill('20269909');
  await create.getByLabel('姓名', { exact: true }).fill('组合埋点隐私测试');
  await create.getByRole('button', { name: '新增人员', exact: true }).click();
  await expect(create).toBeHidden();
  await sendPending(context);
  await people
    .locator('.react-row')
    .filter({ hasText: '组合埋点隐私测试' })
    .getByRole('button')
    .click();
  await page.getByRole('dialog').getByRole('button', { name: '任职与身份', exact: true }).click();
  const membership = page.getByRole('dialog').locator('.member-memberships');
  await membership.getByRole('button', { name: '新增任职', exact: true }).click();
  await membership.getByRole('button', { name: '保存任职', exact: true }).click();
  await expect(membership.getByRole('status')).toContainText('请选择正式部门或至少一种独立身份');
  await chooseOption(
    page,
    membership.getByRole('combobox', { name: '正式部门 / 组织', exact: true }),
    'dept-network'
  );
  await membership.getByRole('checkbox', { name: '交流维修', exact: true }).check();
  await membership.getByRole('checkbox', { name: '维修事务', exact: true }).check();
  const responsePromise = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      /\/api\/members\/[^/]+\/memberships$/.test(new URL(r.url()).pathname)
  );
  await membership.getByRole('button', { name: '保存任职', exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const requestId = response.headers()['x-request-id'];
  expect(requestId).toBeTruthy();
  await expect(membership.locator('form')).toHaveCount(0);
  await sendPending(context);
  await expect
    .poll(() =>
      events()
        .filter((e) => e.name === 'flow.result' && e.requestId === requestId)
        .reduce((n, e) => n + e.count, 0)
    )
    .toBe(1);
  expect(
    events().some(
      (e) =>
        e.name === 'flow.result' &&
        e.control === 'staff.membermemberships.form.2' &&
        e.result === 'rejected'
    )
  ).toBe(true);
  for (const secret of [
    '20269909',
    '组合埋点隐私测试',
    'dept-network',
    new URL(response.url()).pathname.split('/')[3]
  ])
    expect(JSON.stringify(events())).not.toContain(secret);
});
