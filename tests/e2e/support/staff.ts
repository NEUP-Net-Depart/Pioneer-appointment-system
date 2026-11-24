import { signatureFixture } from '../../fixtures/signature.ts';
import { expect, type Locator, type Page } from '@playwright/test';
import { STAFF_PASSWORD } from '../../fixtures/workflow-seed.ts';
import { present } from '../../helpers/present.ts';
import type { FieldWorkflow } from '../../../src/services/field-workflow.ts';
import type { StaffService } from '../../../src/services/staff-platform.ts';
import type { onsiteBookingInput } from '../../../src/lib/validation.ts';

export type FieldOrder = Awaited<ReturnType<FieldWorkflow['detail']>>;
export type StaffResult<K extends keyof StaffService> = Awaited<ReturnType<StaffService[K]>>;

export async function chooseOption(page: Page, control: Locator, value: string) {
  await control.click();
  await page.locator(`[role="option"][data-value=${JSON.stringify(value)}]`).click();
}

export async function loginStaff(
  page: import('@playwright/test').Page,
  account = 'root001',
  password = account === 'root001' ? process.env.E2E_ROOT_PASSWORD : STAFF_PASSWORD
) {
  await page.goto('/staff/');
  await page.locator('#login-id').fill(account);
  await page.locator('#login-password').fill(present(password, 'E2E staff password must be set'));
  await page.getByRole('button', { name: '进入系统' }).click();
  await expect(page.locator('#login-id')).toBeHidden();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.locator('.field-sidebar [aria-current="page"]')).toHaveCount(1);
}

// Only this helper knows how desktop groups and mobile navigation expose pages.
// Returning the entry also lets draft-guard tests handle confirmation explicitly.
export async function navigationEntry(page: Page, label: string | RegExp) {
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
    const toggle = group.locator('h2 button, h3 button').first();
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
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

export async function staffPage(page: Page, label: string | RegExp) {
  await (await navigationEntry(page, label)).click();
  const selected = page
    .getByRole('navigation', { name: '岗位工作导航', exact: true, includeHidden: true })
    .getByRole('button', { name: label, exact: true, includeHidden: true });
  await expect(selected).toHaveAttribute('aria-current', 'page');
  const content = page.getByRole('main');
  await expect(content).toBeVisible();
  return content;
}

export async function dutyPage(page: import('@playwright/test').Page, tab: string) {
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

export async function staffApi<T = unknown>(page: Page, path: string, data: object | null, method = 'POST'): Promise<T> {
  const token = await page.evaluate(() => sessionStorage.getItem('pioneerToken'));
  const response = await page.request.fetch(path, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    ...(data ? { data } : {})
  });
  const body: T = await response.json();
  expect(response.ok(), `${method} ${path}: ${JSON.stringify(body)}`).toBeTruthy();
  return body;
}

export function onsiteOrder(page: Page, values: Partial<ReturnType<typeof onsiteBookingInput>> = {}) {
  return staffApi<FieldOrder>(page, '/api/scan/onsite', {
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
    signature: signatureFixture(),
    ...values
  });
}

// Arrange a roster through the real API without depending on the planner UI.
export async function publishDuty(
  page: Page,
  { weekStart, businessDate = weekStart, memberId = 'member-20261003', campusId = 'campus-nanhu' }:
    { weekStart: string; businessDate?: string; memberId?: string; campusId?: string }
) {
  const current = await staffApi<StaffResult<'campusWeek'>>(
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
