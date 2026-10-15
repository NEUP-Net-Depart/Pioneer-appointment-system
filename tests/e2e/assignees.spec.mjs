import { test, expect } from '@playwright/test';

const people = [
  { account: '20266001', name: '张三' }, { account: '20266002', name: '张三' },
  { account: '20266003', name: '李四' }, { account: '20266004', name: '' }
];
const appointment = patch => ({
  id: 'reserve020261012-61', revision: 0, name: '机主同学', studentId: '20260061',
  campus: '南湖', date: '2026-10-12', timeSlot: '19:00–20:00', status: 'completed',
  outcome: 'legacy_unknown', assignedTo: people[0].account, assignedToName: people[0].name,
  deviceType: '笔记本电脑', brand: '联想', deviceModel: 'ThinkPad', warranty: '否',
  repairNote: '历史维修说明', startedAt: null, completedAt: null, expiresAt: '2026-10-12T13:30:00Z', ...patch
});
async function mockStaff(page, items = [appointment()], candidates = people) {
  const submissions = [], searches = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
    value: async () => { throw new DOMException('Denied', 'NotAllowedError'); }
  }));
  const user = { token: 'assignee-test-only', account: 'testadmin', name: '测试管理员', role: 'admin', authorizedCampuses: ['南湖', '浑南'] };
  await page.route('**/api/auth/login', route => route.fulfill({ json: user }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: user }));
  await page.route('**/api/scan/config', route => route.fulfill({ json: { enabled: true } }));
  await page.route('**/api/scan/current*', route => route.fulfill({ json: { items: [], pending: null } }));
  await page.route('**/api/scan/resolve', route => route.fulfill({ json: items.find(item => item.id === route.request().postDataJSON().id) }));
  await page.route('**/api/appointments/overview', route => route.fulfill({ json: {
    dates: ['2026-10-12'], campuses: user.authorizedCampuses, items: [], updatedAt: '2026-10-12T02:00:00Z'
  } }));
  await page.route('**/api/appointments?*', route => route.fulfill({ json: {
    items, counts: { all: items.length, completed: items.length }, filteredCounts: { all: items.length, completed: items.length }
  } }));
  await page.route('**/api/appointments/*/attachments', route => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/staff/assignees?*', route => {
    searches.push(new URL(route.request().url()).searchParams.get('campus'));
    return route.fulfill({ json: { items: candidates } });
  });
  await page.route('**/api/appointments/*/status', route => {
    const body = route.request().postDataJSON(); submissions.push(body);
    const item = items.find(item => route.request().url().includes('/'+item.id+'/'));
    Object.assign(item, { assignedTo: body.assignedTo, assignedToName: candidates.find(person => person.account === body.assignedTo)?.name || '', revision: item.revision + 1 });
    return route.fulfill({ json: item });
  });
  await page.goto('/staff/');
  await page.locator('#login-id').fill(user.account); await page.locator('#login-password').fill('assignee-test-only');
  await page.locator('#login-form button').click(); await expect(page.locator('#app-shell')).toBeVisible();
  return { submissions, searches, errors };
}
async function openCorrection(page, id = 'reserve020261012-61') {
  await page.locator(`[data-detail="${id}"]`).click();
  await page.locator('#correction-panel summary').click();
  await expect(page.locator('#correction-assigned')).toBeVisible();
}
async function submitCorrection(page) {
  await page.locator('#correction-reason').fill('管理员核对维修记录后修正人员关联');
  page.once('dialog', dialog => dialog.accept()); await page.locator('#apply-correction').click();
  await expect(page.locator('#detail-modal')).toBeHidden();
}

test('search distinguishes duplicate names and keyboard selection submits only the account', async ({ page }) => {
  const state = await mockStaff(page);
  await page.locator('[data-detail]').click();
  await expect(page.locator('#detail-assigned')).toHaveValue('张三（20266001）');
  expect(state.searches).toEqual([]);
  await page.locator('#correction-panel summary').click();
  const input = page.getByRole('combobox', { name: '维修人员', exact: true });
  await expect(input).toHaveValue('张三（20266001）');
  await input.click(); await expect(page.locator('#correction-assignee-options').getByRole('option')).toHaveCount(4);
  expect(state.searches).toEqual(['南湖']);
  await expect(page.locator('#correction-assignee-options').getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await input.fill('张三'); await expect(page.locator('#correction-assignee-options').getByRole('option')).toHaveText(['张三（20266001）', '张三（20266002）']);
  await input.press('ArrowDown'); await input.press('End');
  await expect(input).toHaveAttribute('aria-activedescendant', 'correction-assignee-option-1');
  await input.press('Enter'); await expect(input).toHaveValue('张三（20266002）');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await input.press('Tab'); await expect(page.getByRole('button', { name: '清空维修人员' })).toBeFocused();
  await input.fill('66003'); await expect(page.locator('#correction-assignee-options').getByRole('option')).toHaveText(['李四（20266003）']);
  await input.press('ArrowDown'); await input.press('Enter');
  await input.fill('任意手动输入'); await expect(page.locator('#correction-assignee-options').getByRole('option')).toHaveCount(0);
  await input.press('Escape'); await expect(input).toHaveValue('李四（20266003）');
  await expect(page.locator('#detail-modal')).toBeVisible();
  await input.click(); await input.press('ArrowUp'); await input.press('Enter');
  await expect(input).toHaveValue('20266004');
  await input.fill('66002'); await input.press('ArrowDown'); await input.press('Enter');
  await submitCorrection(page);
  expect(state.submissions[0]).toMatchObject({ action: 'correct', assignedTo: '20266002' });
  expect(state.submissions[0].assignedToName).toBeUndefined(); expect(state.errors).toEqual([]);
});

test('a historical assignee remains selected until explicitly cleared or replaced', async ({ page }) => {
  const state = await mockStaff(page, [appointment({ assignedTo: '20265999', assignedToName: '' })]);
  await openCorrection(page);
  await expect(page.locator('#correction-assigned')).toHaveValue('20265999');
  await expect(page.locator('#correction-assignee-state')).toContainText('可保留历史关联');
  await page.locator('#correction-assigned').fill('没有匹配结果');
  await page.locator('#correction-assigned').press('Tab');
  await expect(page.locator('#correction-assigned')).toHaveValue('20265999');
  await submitCorrection(page); expect(state.submissions[0].assignedTo).toBe('20265999');
  await openCorrection(page); await page.getByRole('button', { name: '清空维修人员' }).click();
  await expect(page.locator('#correction-assigned')).toHaveValue('');
  await submitCorrection(page); expect(state.submissions[1].assignedTo).toBe('');
  await openCorrection(page); await page.locator('#correction-assigned').fill('66002');
  await page.locator('#correction-assignee-options').getByRole('option', { name: '张三（20266002）', exact: true }).click();
  await submitCorrection(page); expect(state.submissions[2].assignedTo).toBe('20266002');
  expect(state.errors).toEqual([]);
});

test('candidate loading failures can be retried without losing the current association', async ({ page }) => {
  const state = await mockStaff(page);
  await page.route('**/api/staff/assignees?*', route => route.fulfill({ status: 503, json: { error: '暂时不可用' } }));
  await openCorrection(page);
  await expect(page.locator('#correction-assignee-state')).toContainText('当前关联已保留');
  await expect(page.locator('#correction-assigned')).toHaveValue('张三（20266001）');
  await page.route('**/api/staff/assignees?*', route => route.fulfill({ json: { items: people } }));
  await page.getByRole('button', { name: '重试读取人员' }).click();
  await expect(page.getByRole('button', { name: '重试读取人员' })).toBeHidden();
  await page.locator('#correction-assigned').click(); await expect(page.locator('#correction-assignee-options').getByRole('option')).toHaveCount(4);
  await submitCorrection(page); expect(state.submissions[0].assignedTo).toBe('20266001');
  expect(state.errors).toEqual([]);
});

test('late responses from a previous appointment cannot replace the next campus candidates', async ({ page }) => {
  const north = appointment({ id: 'reserve120261012-62', campus: '浑南', assignedTo: '20266999', assignedToName: '北区人员' });
  const state = await mockStaff(page, [appointment(), north]);
  let pending;
  await page.route('**/api/staff/assignees?*', route => {
    const campus = new URL(route.request().url()).searchParams.get('campus');
    if (campus === '南湖') { pending = route; return; }
    return route.fulfill({ json: { items: [{ account: north.assignedTo, name: north.assignedToName }] } });
  });
  await openCorrection(page); await expect.poll(() => Boolean(pending)).toBe(true);
  await page.locator('#close-detail').click(); await openCorrection(page, north.id);
  await page.locator('#correction-assigned').click();
  await expect(page.locator('#correction-assignee-options').getByRole('option')).toHaveText(['北区人员（20266999）']);
  const response = page.waitForResponse(response => response.url().includes('/api/staff/assignees?campus=%E5%8D%97%E6%B9%96'));
  await pending.fulfill({ json: { items: people } }); await (await response).finished();
  await page.locator('#correction-assigned').fill('张三'); await expect(page.locator('#correction-assignee-options').getByRole('option')).toHaveCount(0);
  await page.locator('#correction-assigned').press('Escape');
  await expect(page.locator('#correction-assigned')).toHaveValue('北区人员（20266999）');
  expect(state.errors).toEqual([]);
});

for (const width of [320, 390, 768]) {
  test(`touch selection and clearing fit a ${width}px screen`, async ({ browser }) => {
    const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, viewport: { width, height: 900 }, hasTouch: true });
    const page = await context.newPage();
    try {
      const state = await mockStaff(page); await openCorrection(page);
      const input = page.locator('#correction-assigned');
      await input.tap(); await input.fill('张三');
      await page.locator('#correction-assignee-options').getByRole('option', { name: '张三（20266002）', exact: true }).tap();
      await expect(input).toHaveValue('张三（20266002）');
      await page.getByRole('button', { name: '清空维修人员' }).tap(); await expect(input).toHaveValue('');
      await input.fill('66003'); await page.locator('#correction-assignee-options').getByRole('option', { name: '李四（20266003）' }).tap();
      await expect(input).toHaveValue('李四（20266003）');
      await input.tap(); await input.fill('张三');
      await page.locator('#correction-assignee-picker').scrollIntoViewIfNeeded();
      const box = await page.locator('#correction-assignee-picker').boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(await page.locator('.detail-modal').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await page.locator('#correction-assignee-options').getByRole('option').first().evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: `output/playwright/assignee-picker-${width}.png`, animations: 'disabled' });
      await input.press('Escape'); await submitCorrection(page);
      expect(state.submissions[0].assignedTo).toBe('20266003'); expect(state.errors).toEqual([]);
    } finally { await context.close(); }
  });
}

test('appointment details, scan records and workload show names with accounts and retain fallback labels', async ({ page }) => {
  const items = [appointment(), appointment({ id: 'reserve020261012-62', assignedTo: '20266002' }),
    appointment({ id: 'reserve020261012-63', assignedTo: '20265999', assignedToName: '' })];
  const state = await mockStaff(page, items);
  await page.route('**/api/stats/summary?*', route => route.fulfill({ json: {
    total: 3, completed: 3, daily: {}, faults: {}, campuses: {}, technicians: {
      '20266001': { assignedToName: '张三', started: 2, completed: 2 },
      '20266002': { assignedToName: '张三', started: 1, completed: 1 },
      '20265999': { assignedToName: '', started: 1, completed: 1 }
    }
  } }));
  await page.locator('[data-view-link=stats]').click();
  await expect(page.locator('.workload-row strong')).toHaveText(['张三（20266001）', '20265999', '张三（20266002）']);
  await page.locator('[data-view-link=staff]').click();
  for (const [index, label] of ['张三（20266001）', '张三（20266002）', '20265999'].entries()) {
    await page.locator(`[data-detail="${items[index].id}"]`).click();
    await expect(page.locator('#detail-assigned')).toHaveValue(label); await page.locator('#close-detail').click();
  }
  await page.locator('[data-view-link=scan]').click();
  for (const [index, label] of ['张三（20266001）', '张三（20266002）', '20265999'].entries()) {
    await page.getByRole('button', { name: '手动输入编号', exact: true }).click();
    await page.locator('#scan-number').fill(items[index].id); await page.getByRole('button', { name: '查询工单', exact: true }).click();
    await expect(page.locator('#scan-detail-info')).toContainText(label); await page.locator('#scan-detail-back').click();
  }
  expect(state.errors).toEqual([]);
});
