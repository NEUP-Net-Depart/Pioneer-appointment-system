import { test, expect } from '@playwright/test';
import { mockStaff, loginStaff, staffPage } from './support/staff.mjs';
import { TIME_SLOTS } from '../../shared/constants.js';

for (const width of [320, 390, 768, 1440]) test(`member detail renders actual labeled fields before its response at ${width}px`, async ({ page }) => {
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
    await staffPage(page, '人员管理');
    await page.getByRole('button', { name: '人员详情' }).click();
    const dialog = page.getByRole('dialog', { name: member.name });
    await expect(dialog.getByRole('heading', { name: member.name, exact: true })).toBeVisible();
    const nameField = dialog.getByLabel('姓名', { exact: true });
    await expect(nameField).toHaveValue(member.name);
    await expect(nameField).toBeDisabled();
    await expect(dialog.getByRole('combobox', { name: '所属校区', exact: true })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: '成员状态', exact: true })).toBeVisible();
    await expect(dialog.locator('.workspace-skeleton, .workspace-content-skeleton')).toHaveCount(0);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    const heading = await dialog.getByRole('heading', { name: member.name, exact: true }).boundingBox();
    await dialog.screenshot({ path: `output/issue-73/member-detail-pending-${width}.png` });
    release();
    await expect(nameField).toBeEnabled();
    await expect(nameField).toHaveValue(member.name);
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
  await staffPage(page, '人员管理');
  await page.getByRole('button', { name: '人员详情' }).click();
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
    await expect(panel.locator('.workspace-data-pending').first()).toBeVisible();
    await expect(panel.locator('.service-day-grid').getByText('正常', { exact: true })).toHaveCount(0);
    expect(await panel.evaluate(node => node.innerText.includes('正在读取维修安排'))).toBe(false);
    release();
    await expect(panel.locator('.field-notice')).toBeVisible();
    await expect(panel.locator('[aria-busy="true"].workspace-data-pending')).toHaveCount(0);
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
    await expect(dialog.getByRole('heading', { name: '客户与设备', exact: true })).toBeVisible();
    await expect(dialog).toContainText(item.name);
    await expect(dialog).toContainText(item.deviceModel);
    await expect(dialog).toContainText('接待与维修记录');
    await expect(dialog.getByText('故障描述', { exact: true })).toBeVisible();
    await expect(dialog.locator('.workspace-skeleton, .workspace-content-skeleton')).toHaveCount(0);
    await expect(dialog).toContainText(item.id);
    releaseRepair();
    await expect(dialog.getByRole('button', { name: '重新读取工单' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: '客户与设备', exact: true })).toBeVisible();
    fail = false;
    await dialog.getByRole('button', { name: '重新读取工单' }).click();
    await expect(dialog).toContainText(item.name);
    await dialog.locator('summary').filter({ hasText: '附件与设备照片' }).click();
    const attachmentValue = dialog.getByLabel('附件正在读取', { exact: true });
    await expect(attachmentValue).toBeVisible();
    expect(await attachmentValue.innerText()).toBe('—');
    releaseAttachments();
    await expect(dialog).toContainText('暂无可用附件');
    await expect(attachmentValue).toHaveCount(0);
  } finally { releaseRepair(); releaseAttachments(); await page.unrouteAll({ behavior: 'wait' }); }
});


test('release settings render the real explanation and field before data, then fill in place', async ({ page }) => {
  await mockStaff(page);
  await page.route('**/api/slot-capacities', route => route.fulfill({ json: { items: [1,2,3,4].flatMap(weekday => TIME_SLOTS.map(timeSlot => ({ campus: '南湖', weekday, timeSlot, capacity: 5, revision: 0 }))) } }));
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/booking-settings/manage?*', async route => {
    await pending;
    await route.fulfill({ json: { settings: { releaseTime: '11:30', revision: 0 }, notices: [], suspensions: [] } });
  });
  try {
    await loginStaff(page);
    await staffPage(page, '预约配置');
    await page.getByRole('button', { name: '放号时间', exact: true }).click();
    const panel = page.locator('.booking-settings-editor').filter({ visible: true });
    await expect(panel.getByRole('heading', { name: '每日放号', exact: true })).toBeVisible();
    await expect(panel).toContainText('放号前可约当天至后两天');
    const input = panel.getByLabel('放号时间（北京时间）');
    await expect(input).toBeVisible();
    await expect(input).toBeDisabled();
    await expect(input).toHaveValue('');
    await expect(panel.getByRole('button', { name: '保存放号时间' })).toBeDisabled();
    await expect(panel.locator('.workspace-skeleton, .workspace-content-skeleton')).toHaveCount(0);
    await input.evaluate(node => { window.releaseInput = node; });
    release();
    await expect(input).toHaveValue('11:30');
    await expect(input).toBeEnabled();
    expect(await input.evaluate(node => node === window.releaseInput)).toBe(true);
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('capacity and statistics show their real sections while only values wait', async ({ page }) => {
  await mockStaff(page);
  await page.route('**/api/slot-capacities', route => route.fulfill({ json: { items: [1,2,3,4].flatMap(weekday => TIME_SLOTS.map(timeSlot => ({ campus: '南湖', weekday, timeSlot, capacity: 5, revision: 0 }))) } }));
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/slot-capacities/actual?*', async route => {
    await pending;
    const query = new URL(route.request().url()).searchParams;
    await route.fulfill({ json: { campus: query.get('campus'), date: query.get('date'), source: 'template', staffing: { repair: 7, office: 1 }, items: TIME_SLOTS.map(timeSlot => ({ timeSlot, capacity: 12, occupied: 3 })) } });
  });
  await page.route('**/api/stats/summary*', async route => {
    await pending;
    await route.fulfill({ json: { total: 0, completed: 0, daily: {}, faults: {}, campuses: {}, technicians: {} } });
  });
  try {
    await loginStaff(page);
    await staffPage(page, '预约配置');
    await page.getByRole('button', { name: '日期实际容量', exact: true }).click();
    const panel = page.locator('.capacity-actual');
    await expect(panel.getByRole('table', { name: '各时段预约名额' })).toBeVisible();
    await expect(panel.locator('tbody tr')).toHaveCount(TIME_SLOTS.length);
    await expect(panel.getByRole('columnheader', { name: '已占用' })).toBeVisible();
    await expect(panel.getByRole('heading', { name: '工作人员', exact: true })).toBeVisible();
    await expect(panel.locator('.workspace-skeleton, .workspace-content-skeleton')).toHaveCount(0);
    await staffPage(page, '统计分析');
    for (const name of ['每日服务', '故障分类', '校区分布', '维修人员工作量']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.locator('.report-grid .workspace-skeleton')).toHaveCount(0);
    release();
    await expect(page.locator('.report-grid')).toContainText('当前范围没有预约');
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('front desk keeps personnel labels without reporting zero while its board is pending', async ({ page }) => {
  const session = await mockStaff(page, { contexts: [{ id: 'desk', label: '现场工作台' }] });
  delete session.home.staffPresence;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/field/board*', async route => {
    await pending;
    await route.fulfill({ json: { ...session.home, staffPresence: [{ memberId: 'technician-pending', name: '到岗人员', account: '20261002', department: '硬件部', state: 'available', canReceive: true, scheduledRepair: true, signedInAt: '2026-10-24T02:00:00Z', scheduled: true, identities: [] }] } });
  });
  try {
    await loginStaff(page);
    const summary = page.locator('.field-person-summary');
    await expect(summary).toBeVisible();
    await expect(summary.getByLabel('可接单人数正在读取')).toHaveText('—');
    await expect(summary).toContainText('已到岗');
    await expect(page.getByRole('heading', { name: '现场人员', exact: true })).toBeVisible();
    await expect(page.locator('.field-people .workspace-skeleton')).toHaveCount(0);
    release();
    await expect(page.locator('.field-people-list')).toContainText('到岗人员');
    await expect(summary).toContainText('可接单 1 人');
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});
