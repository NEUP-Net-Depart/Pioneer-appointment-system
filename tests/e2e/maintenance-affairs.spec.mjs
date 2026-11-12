import { test, expect } from './support/fixtures.mjs';
import { loginStaff, staffPage, dutyPage } from './support/staff.mjs';
test.use({ workflowTime: '2026-10-15T11:10:00Z' });

test('dual appointments offer office availability and direct attendance without a roster', async ({
  page
}) => {
  await loginStaff(page, '20261002');
  await staffPage(page, '今日工作');
  await expect(page.getByRole('button', { name: '展示签到码', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '到岗签到', exact: true }).click();
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await expect(page.getByRole('region', { name: '工作视窗' }).getByText('已签到', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '展示签到码', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '展示签到码', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '展示签到码' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  const personal = await dutyPage(page, '我的值班');
  await expect(personal.getByRole('button', { name: '修改通常时间', exact: true })).toBeEnabled();
  await personal.getByRole('button', { name: '修改通常时间', exact: true }).click();
  await personal.getByRole('checkbox', { name: '周一', exact: true }).check();
  await personal.getByRole('button', { name: '保存空闲', exact: true }).click();
  await expect(personal.getByRole('button', { name: '修改通常时间', exact: true })).toBeVisible();
  await staffPage(page, '今日工作');
  await expect(page.getByText('今日无排班', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '扫码', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /空闲维修人员/ }).click();
  const people = page.getByRole('region', { name: '值班人员', exact: true });
  await expect(people).toBeVisible();
  await expect(people.getByText('陈宇', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '补录其他人员', exact: true })).toHaveCount(0);
  await expect(people.getByRole('button', { name: '修正时间', exact: true })).toHaveCount(0);
});

test('planner retries a stale draft without losing its manual addition', async ({
  page,
  context
}) => {
  await loginStaff(page, '20261001');
  const planner = await dutyPage(page, '安排下周');
  await planner.getByRole('button', { name: '选择人员', exact: true }).first().click();
  const picker = page.getByRole('dialog');
  await picker.getByRole('checkbox', { name: /周宁/ }).check();
  await picker.getByRole('button', { name: '完成选择', exact: true }).click();
  const otherPage = await context.newPage();
  await loginStaff(otherPage, '20261001');
  const otherPlanner = await dutyPage(otherPage, '安排下周');
  await otherPlanner.getByRole('button', { name: '选择人员', exact: true }).nth(1).click();
  const otherPicker = otherPage.getByRole('dialog');
  await otherPicker.getByRole('checkbox', { name: /林悦/ }).check();
  await otherPicker.getByRole('button', { name: '完成选择', exact: true }).click();
  await otherPlanner.getByRole('button', { name: /发布/ }).click();
  await expect(otherPlanner.getByText('维修和办公班表已发布，签到已自动准备')).toBeVisible();
  await planner.getByRole('button', { name: /发布/ }).click();
  await expect(planner.getByRole('alert')).toBeVisible();
  await planner.getByRole('button', { name: '重试读取', exact: true }).click();
  await expect(planner.getByRole('alert')).toHaveCount(0);
  await expect(planner.locator('.duty-assignee').filter({ hasText: '周宁' })).toHaveCount(1);
  await expect(planner.locator('.duty-assignee').filter({ hasText: '林悦' })).toHaveCount(1);
  await planner.getByRole('button', { name: /发布/ }).click();
  await expect(planner.getByText('维修和办公班表已发布，签到已自动准备')).toBeVisible();
});
