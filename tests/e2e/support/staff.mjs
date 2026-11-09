import { expect } from '@playwright/test';
import { STAFF_PASSWORD } from '../../fixtures/workflow-seed.mjs';

export async function loginStaff(
  page,
  account = 'root001',
  password = account === 'root001' ? process.env.E2E_ROOT_PASSWORD : STAFF_PASSWORD
) {
  await page.goto('/staff/');
  await page.locator('#login-id').fill(account);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: '进入系统' }).click();
  await expect(page.locator('#login-id')).toBeHidden();
  await expect(page.getByRole('main')).toBeVisible();
}

// Only this helper knows how desktop groups and mobile navigation expose pages.
// Returning the entry also lets draft-guard tests handle confirmation explicitly.
export async function navigationEntry(page, label) {
  const desktop = page.getByRole('navigation', {
    name: '岗位工作导航',
    exact: true,
    includeHidden: true
  });
  const target = desktop.getByRole('button', { name: label, exact: true, includeHidden: true });
  await expect(target).toHaveCount(1);
  if (await desktop.isVisible()) {
    const group = desktop
      .locator('section')
      .filter({ has: page.getByRole('button', { name: label, exact: true, includeHidden: true }) });
    const toggle = group.getByRole('button', { expanded: false });
    if (await toggle.count()) await toggle.click();
    await expect(target).toBeVisible();
    return target;
  }
  const mobile = page.getByRole('navigation', { name: '手机岗位导航', exact: true });
  const primary = mobile.getByRole('button', { name: label, exact: true });
  if (await primary.isVisible()) return primary;
  await mobile.getByRole('button', { name: '更多', exact: true }).click();
  return page
    .getByRole('dialog', { name: '工作入口', exact: true })
    .getByRole('button', { name: label, exact: true });
}

export async function staffPage(page, label) {
  await (await navigationEntry(page, label)).click();
  const selected = page
    .getByRole('navigation', { name: '岗位工作导航', exact: true, includeHidden: true })
    .getByRole('button', { name: label, exact: true, includeHidden: true });
  await expect(selected).toHaveAttribute('aria-current', 'page');
  const content = page.getByRole('main');
  await expect(content).toBeVisible();
  return content;
}

export async function dutyPage(page, tab) {
  const content = await staffPage(page, /^(我的)?值班$/);
  const task = content
    .getByRole('navigation', { name: '值班任务', exact: true })
    .getByRole('button', { name: tab, exact: true });
  await task.click();
  await expect(task).toHaveAttribute('aria-pressed', 'true');
  const panel = content.getByRole('region', { name: tab, exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

export async function staffApi(page, path, data, method = 'POST') {
  const token = await page.evaluate(() => sessionStorage.getItem('pioneerToken'));
  const response = await page.request.fetch(path, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    ...(data ? { data } : {})
  });
  const body = await response.json();
  expect(response.ok(), `${method} ${path}: ${JSON.stringify(body)}`).toBeTruthy();
  return body;
}

export function onsiteOrder(page, values = {}) {
  return staffApi(page, '/api/scan/onsite', {
    requestId: crypto.randomUUID(),
    campus: '南湖',
    studentId: '20269981',
    name: '现场测试同学',
    social: 'test-contact',
    deviceType: '笔记本',
    brand: '联想',
    deviceModel: '',
    warranty: '不清楚',
    faultType: '系统',
    signature: [Array.from({ length: 12 }, (_, i) => [0.1 + i * 0.05, 0.2 + i * 0.03])],
    ...values
  });
}

// Arrange a roster through the real API without depending on the planner UI.
export async function publishDuty(
  page,
  { weekStart, businessDate = weekStart, memberId = 'member-20261003', campusId = 'campus-nanhu' }
) {
  const current = await staffApi(
    page,
    `/api/rosters/campus-week?${new URLSearchParams({ campusId, weekStart })}`,
    null,
    'GET'
  );
  return staffApi(
    page,
    '/api/rosters/campus-week',
    {
      campusId,
      weekStart,
      sourceVersion: current.sourceVersion,
      requestId: crypto.randomUUID(),
      rosters: current.rosters.map((row) => ({
        ...row,
        assignments:
          row.dutyType === 'repair'
            ? [{ memberId, businessDate, startAt: '19:00', endAt: '21:00' }]
            : []
      }))
    },
    'PUT'
  );
}
