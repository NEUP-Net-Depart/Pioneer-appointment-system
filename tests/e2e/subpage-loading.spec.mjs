import { test, expect } from '@playwright/test';
import { mockStaff, loginStaff, staffPage } from './support/staff.mjs';
import { TIME_SLOTS } from '../../shared/constants.js';

for (const width of [320, 390, 768, 1440]) test(`member detail keeps context and local loading geometry at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 950 });
  await mockStaff(page);
  const member = { memberId: 'member-loading', name: '详情测试人员', homeCampusId: 'campus-nanhu', status: 'active', revision: 0 };
  await page.route('**/api/members?*', route => route.fulfill({ json: { items: [member] } }));
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/members/member-loading', async route => {
    await pending;
    await route.fulfill({ json: { member, bindings: [], actions: { edit: true } } });
  });
  try {
    await loginStaff(page);
    await staffPage(page, '成员管理');
    await page.getByRole('button', { name: '编辑成员与权限' }).click();
    const dialog = page.getByRole('dialog', { name: member.name });
    await expect(dialog.getByRole('heading', { name: member.name, exact: true })).toBeVisible();
    const skeleton = dialog.getByRole('status', { name: '正在读取成员资料' });
    await expect(skeleton).toBeVisible();
    expect(await skeleton.innerText()).toBe('');
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    const heading = await dialog.getByRole('heading', { name: member.name, exact: true }).boundingBox();
    await dialog.screenshot({ path: `output/issue-73/member-detail-pending-${width}.png` });
    release();
    await expect(skeleton).toHaveCount(0);
    await expect(dialog.getByLabel('姓名', { exact: true })).toHaveValue(member.name);
    const after = await dialog.getByRole('heading', { name: member.name, exact: true }).boundingBox();
    expect(after.x).toBe(heading.x);
    expect(after.y).toBe(heading.y);
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('failed member detail stops loading and retries in the same panel', async ({ page }) => {
  await mockStaff(page);
  const member = { memberId: 'member-retry', name: '重试测试人员', status: 'active', homeCampusId: 'campus-nanhu', revision: 0 };
  await page.route('**/api/members?*', route => route.fulfill({ json: { items: [member] } }));
  let failed = true;
  await page.route('**/api/members/member-retry', route => failed
    ? route.fulfill({ status: 503, json: { error: { message: '暂时无法读取资料' } } })
    : route.fulfill({ json: { member, bindings: [], actions: { edit: true } } }));
  await loginStaff(page);
  await staffPage(page, '成员管理');
  await page.getByRole('button', { name: '编辑成员与权限' }).click();
  const dialog = page.getByRole('dialog', { name: member.name });
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.locator('.workspace-content-skeleton')).toHaveCount(0);
  failed = false;
  await dialog.getByRole('button', { name: '重新读取成员资料' }).click();
  await expect(dialog.getByLabel('姓名', { exact: true })).toHaveValue(member.name);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('pause dates do not claim normal service before their data arrives', async ({ page }) => {
  await mockStaff(page);
  await page.route('**/api/slot-capacities', route => route.fulfill({ json: { items: [1,2,3,4].flatMap(weekday => TIME_SLOTS.map(timeSlot => ({ campus: '南湖', weekday, timeSlot, capacity: 5, revision: 0 }))) } }));
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/service-days?*', async route => {
    await pending;
    await route.fulfill({ status: 503, json: { error: { message: '安排读取暂时失败' } } });
  });
  try {
    await loginStaff(page);
    await staffPage(page, '预约配置');
    await page.getByRole('button', { name: '暂停日期', exact: true }).click();
    const panel = page.locator('.service-day-editor');
    await expect(panel.locator('.workspace-skeleton-inline').first()).toBeVisible();
    await expect(panel.locator('.service-day-grid').getByText('正常', { exact: true })).toHaveCount(0);
    expect(await panel.evaluate(node => node.innerText.includes('正在读取维修安排'))).toBe(false);
    release();
    await expect(panel.locator('.field-notice')).toBeVisible();
    await expect(panel.locator('.workspace-skeleton-inline')).toHaveCount(0);
    await expect(panel.locator('.service-day-grid').getByText('正常', { exact: true })).toHaveCount(0);
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});


test('repair and attachment details load locally and a failed repair can be retried', async ({ page }) => {
  await mockStaff(page);
  const item = { id: 'reserve020261024-01', name: '加载测试客户', date: '2026-10-24', campus: '南湖', status: 'completed', deviceModel: 'ThinkPad', revision: 0, canReadDetails: true, outcome: 'repaired', repairNote: '已完成测试维修' };
  await page.route('**/api/appointments?*', route => route.fulfill({ json: { items: [item] } }));
  let releaseRepair, releaseAttachments;
  const repairPending = new Promise(resolve => { releaseRepair = resolve; });
  const attachmentsPending = new Promise(resolve => { releaseAttachments = resolve; });
  let fail = true;
  await page.route(`**/api/field/appointments/${item.id}`, async route => {
    await repairPending;
    await route.fulfill(fail ? { status: 503, json: { error: { message: '工单读取暂时失败' } } } : { json: item });
  });
  await page.route(`**/api/appointments/${item.id}/attachments`, async route => {
    await attachmentsPending;
    await route.fulfill({ json: { items: [] } });
  });
  try {
    await loginStaff(page);
    await staffPage(page, '预约记录');
    await page.getByRole('button', { name: '查看详情', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const skeleton = dialog.getByRole('status', { name: '正在读取工单', exact: true });
    await expect(skeleton).toBeVisible();
    await expect(dialog).toContainText(item.id);
    expect(await skeleton.innerText()).toBe('');
    releaseRepair();
    await expect(dialog.getByRole('button', { name: '重新读取工单' })).toBeVisible();
    await expect(skeleton).toHaveCount(0);
    fail = false;
    await dialog.getByRole('button', { name: '重新读取工单' }).click();
    await expect(dialog).toContainText(item.name);
    await dialog.locator('summary').filter({ hasText: '附件与设备照片' }).click();
    const attachmentSkeleton = dialog.getByRole('status', { name: '正在读取附件', exact: true });
    await expect(attachmentSkeleton).toBeVisible();
    expect(await attachmentSkeleton.innerText()).toBe('');
    releaseAttachments();
    await expect(dialog).toContainText('暂无可用附件');
    await expect(attachmentSkeleton).toHaveCount(0);
  } finally { releaseRepair(); releaseAttachments(); await page.unrouteAll({ behavior: 'wait' }); }
});

