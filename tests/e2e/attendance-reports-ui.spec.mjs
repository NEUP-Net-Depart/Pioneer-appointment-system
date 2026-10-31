import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.skip(process.env.E2E_REPORT_DEMO !== 'true', 'Uses an isolated local report preview');

async function login(page, account) {
  await page.goto('/staff/');
  await page.locator('#login-form').getByLabel('学号', { exact: true }).fill(account);
  await page
    .locator('#login-form')
    .getByLabel('密码', { exact: true })
    .fill(account === 'root001' ? process.env.E2E_ROOT_PASSWORD : 'StaffTest!2026');
  await page.getByRole('button', { name: '进入系统' }).click();
  await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();
  await expect(page.locator('#toast')).not.toHaveClass(/show/);
}

test('report controls and self-service college fit across viewports', async ({ page }) => {
  test.setTimeout(120000);
  const folder = 'output/report-ui-review';
  await mkdir(folder, { recursive: true });
  await login(page, 'root001');
  await page
    .getByRole('navigation', { name: '岗位工作导航' })
    .getByRole('button', { name: '报表导出' })
    .click();
  await expect(page.getByRole('heading', { name: '报表导出' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '志愿登记表规则' })).toBeVisible();
  await expect(page.getByText(/4 周 · \d+ 条登记/)).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { name: '报表导出' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true
    );
    await page.screenshot({ path: `${folder}/volunteer-${width}.png`, animations: 'disabled' });
  }
  await page.getByRole('button', { name: '考勤记录', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.getByRole('heading', { name: '考勤记录规则' })).toBeVisible();
  await expect(page.getByText('按实际维修日期 · 每人每天一格')).toBeVisible();
  await page.screenshot({ path: `${folder}/matrix-390.png`, animations: 'disabled' });

  await page.evaluate(() => sessionStorage.clear());
  await login(page, '20261002');
  await page
    .getByRole('navigation', { name: '手机岗位导航' })
    .getByRole('button', { name: '我的' })
    .click();
  await expect(page.getByLabel('姓名')).toBeEnabled();
  await expect(page.getByRole('button', { name: /学院：/ })).toBeEnabled();
  await expect(page.locator('.personal-profile-grid output').first()).toHaveText('20261002');
  await expect(page.getByRole('button', { name: '保存资料' })).toHaveCount(0);
  const collegeButton = page.getByRole('button', { name: /学院：/ });
  const nextCollege = (await collegeButton.getAttribute('aria-label')).includes('理学院')
    ? '软件学院'
    : '理学院';
  await collegeButton.click();
  await page.getByRole('option', { name: nextCollege, exact: true }).click();
  await expect(page.getByRole('button', { name: '保存资料' })).toBeVisible();
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true
    );
    await page.screenshot({
      path: `${folder}/personal-dirty-${width}.png`,
      animations: 'disabled'
    });
  }
  await page.getByRole('button', { name: '保存资料' }).click();
  await expect(page.getByText('个人资料已保存')).toBeVisible();
  await expect(page.getByRole('button', { name: `学院：${nextCollege}` })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存资料' })).toHaveCount(0);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true
    );
    await page.screenshot({ path: `${folder}/personal-${width}.png`, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByLabel('姓名').fill('未保存的姓名');
  await page
    .getByRole('navigation', { name: '手机岗位导航' })
    .getByRole('button', { name: '维修' })
    .click();
  await expect(page.getByRole('dialog', { name: '有未保存的调整' })).toBeVisible();
  await page.getByRole('button', { name: '留在当前页面' }).click();
  await expect(page.getByLabel('姓名')).toHaveValue('未保存的姓名');
  await page
    .getByRole('navigation', { name: '手机岗位导航' })
    .getByRole('button', { name: '维修' })
    .click();
  await page.getByRole('button', { name: '丢弃并切换' }).click();
  await expect(page.getByRole('heading', { name: '维修工作台' })).toBeVisible();
});
