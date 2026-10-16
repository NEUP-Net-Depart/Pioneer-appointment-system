import { test, expect } from '@playwright/test';

async function expandGroup(page, name) {
  const group = page.locator('.field-sidebar').getByRole('button', { name, exact: true }).first();
  if (await group.getAttribute('aria-expanded') === 'false') await group.click();
}

test.skip(process.env.E2E_FIELD !== 'true', 'Uses the isolated staff fixture');

test('member reaches roster from My, chooses named shifts and can use narrow screens', async ({ page }) => {
  await page.goto('/staff/');
  await page.locator('#login-form').getByLabel('学号', { exact: true }).fill('20261002');
  await page.locator('#login-form').getByLabel('密码', { exact: true }).fill('StaffTest!2026');
  await page.getByRole('button', { name: '进入系统' }).click();
  await expect(page.locator('.field-app')).toBeVisible();
  await expect(page.locator('.field-sidebar').getByRole('button', { name: '成员管理', exact: true })).toHaveCount(0);
  await expect(page.locator('.field-sidebar').getByRole('button', { name: '授权管理', exact: true })).toHaveCount(0);
  await expandGroup(page, '我的');
  await page.locator('.field-sidebar').getByRole('button', { name: '个人中心', exact: true }).click();
  await page.getByRole('button', { name: '我的班次与申请' }).click();
  await expect(page.getByRole('heading', { name: '我的值班安排' })).toBeVisible();
  await page.getByRole('button', { name: '发起换班', exact: true }).first().click();
  await expect(page.getByLabel('希望调换到')).toBeEnabled();
  await expect(page.getByLabel('希望调换到').locator('option')).not.toHaveCount(1);
  await expect(page.getByLabel('希望调换到')).toContainText('周宁');
  await expect(page.getByLabel('对方成员 ID')).toHaveCount(0);
  await expect(page.getByLabel('对方班次版本')).toHaveCount(0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByLabel('希望调换到')).toBeVisible();
  }
});


test('manager restores a saved draft, adjusts a member and cannot publish missing leadership', async ({ page, request }) => {
  await page.goto('/staff/');
  await page.locator('#login-form').getByLabel('学号', { exact: true }).fill('root001');
  await page.locator('#login-form').getByLabel('密码', { exact: true }).fill(process.env.E2E_ROOT_PASSWORD);
  await page.getByRole('button', { name: '进入系统' }).click();
  async function openManager() {
    await expect(page.locator('.field-app')).toBeVisible();
    await expandGroup(page, '我的');
  await page.locator('.field-sidebar').getByRole('button', { name: '个人中心', exact: true }).click();
    await page.getByRole('button', { name: '我的班次与申请' }).click();
    await expandGroup(page, '值班管理');
    await page.getByRole('button', { name: '维修排班管理', exact: true }).click();
  }
  await openManager();
  await page.getByRole('button', { name: '新建收集任务' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('周一日期').fill('2026-10-19');
  await dialog.getByLabel('开始', { exact: true }).fill('18:00');
  await dialog.getByLabel('结束', { exact: true }).fill('19:00');
  await dialog.getByLabel('填报截止').fill('2026-10-18T18:00');
  const createdResponse = page.waitForResponse(response => response.url().endsWith('/api/roster-tasks') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: '创建收集任务', exact: true }).click();
  const response = await createdResponse;
  expect(response.ok()).toBe(true);
  const task = await response.json();
  await expect(dialog).toHaveCount(0);
  const login = await request.post('/api/auth/login', { data: { account: '20261002', password: 'StaffTest!2026' } });
  const technician = await login.json();
  for (const businessDate of ['2026-10-19', '2026-10-20']) {
    const saved = await request.put(`/api/roster-tasks/${task.id}/availability`, { headers: { Authorization: `Bearer ${technician.token}` }, data: { businessDate, campusId: 'campus-nanhu', startAt: '18:00', endAt: '19:00' } });
    expect(saved.ok(), await saved.text()).toBe(true);
  }
  await page.getByRole('button', { name: '生成草稿', exact: true }).click();
  const member = page.getByLabel('安排陈宇', { exact: true });
  await expect(member).toBeVisible();
  await member.selectOption('2026-10-20:campus-nanhu:18:00:19:00');
  await page.locator('.field-sidebar').getByRole('button', { name: '预约记录', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '有未保存的调整' })).toBeVisible();
  await page.getByRole('button', { name: '留在当前页面', exact: true }).click();
  await expect(member).toHaveValue('2026-10-20:campus-nanhu:18:00:19:00');
  await page.getByRole('button', { name: '保存并校验', exact: true }).click();
  await expect(page.getByText('调整已保存，已重新校验。')).toBeVisible();
  await expect(page.getByRole('button', { name: '预览并发布' })).toBeDisabled();
  await page.getByLabel('锁定安排', { exact: true }).check();
  await page.getByRole('button', { name: '保存并校验', exact: true }).click();
  await expect(page.getByText('调整已保存，已重新校验。')).toBeVisible();
  await page.getByRole('button', { name: '重新生成草稿', exact: true }).click();
  await expect(page.getByText('草稿已保存。请核对人员安排和覆盖提示。')).toBeVisible();
  await page.reload();
  await openManager();
  await expect(page.getByLabel('安排陈宇', { exact: true })).toHaveValue('2026-10-20:campus-nanhu:18:00:19:00');
  await page.locator('.field-sidebar').evaluate(node => { node.dataset.persisted = 'yes'; });
  const navigation = await page.locator('.field-sidebar nav button').allTextContents();
  await page.locator('.field-sidebar').getByRole('button', { name: '预约记录', exact: true }).click();
  expect((await page.locator('.field-sidebar nav button').allTextContents()).map(text => text.replace(/[−+]/g, ''))).toEqual(navigation.map(text => text.replace(/[−+]/g, '')));
  await expect(page.locator('.records-workspace')).toBeVisible();
  await expect(page.locator('[data-view=staff]')).toBeHidden();
  await expect(page.locator('#management-header')).toBeHidden();
  await expandGroup(page, '我的');
  await page.locator('.field-sidebar').getByRole('button', { name: '账号安全', exact: true }).click();
  await expect(page.getByRole('heading', { name: '账号安全', exact: true })).toBeVisible();
  await expect(page.locator('[data-view=settings]')).toBeHidden();
  await expect(page.locator('.field-sidebar')).toHaveAttribute('data-persisted', 'yes');
  await page.locator('.field-sidebar').getByRole('button', { name: '班次与排班', exact: true }).click();
  await expandGroup(page, '值班管理');
  await page.locator('.field-sidebar').getByRole('button', { name: '维修排班管理', exact: true }).click();
  await expect(page.getByLabel('安排陈宇', { exact: true })).toHaveValue('2026-10-20:campus-nanhu:18:00:19:00');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/field-workflow/planner-${width}.png`, fullPage: true });
  }
});
