import { expect } from '@playwright/test';

export async function loginStaff(page, account = 'root001', password = 'test-password') {
  await page.goto('/staff/');
  await page.locator('#login-id').fill(account); await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: '进入系统' }).click();
  await expect(page.locator('.field-content')).toBeVisible();
}
// Closed groups keep their entries mounted; open the parent before using the entry.
export async function navigationEntry(sidebar, label) {
  const target = sidebar.getByRole('button', { name: label, exact: true, includeHidden: true });
  await expect(target).toHaveCount(1);
  if (!await sidebar.isVisible()) {
    const page = sidebar.page();
    await page.getByRole('navigation', { name: '手机岗位导航' }).getByRole('button', { name: '更多', exact: true }).click();
    return page.getByRole('dialog', { name: '工作入口' }).getByRole('button', { name: label, exact: true });
  }
  const group = sidebar.locator('.workspace-nav-group').filter({ has: sidebar.page().getByRole('button', { name: label, exact: true, includeHidden: true }) });
  const toggle = group.getByRole('button', { expanded: false });
  if (await toggle.count()) await toggle.click();
  await expect(group.locator('.workspace-nav-items')).toBeVisible();
  return target;
}
export async function staffPage(page, label) {
  if (label === '激活与账号') {
    await staffPage(page, '人员管理');
    await page.getByRole('navigation', { name: '人员管理功能' }).getByRole('button', { name: label, exact: true }).click();
    return;
  }
  if ((await page.locator('.field-sidebar').isVisible())) await (await navigationEntry(page.locator('.field-sidebar'), label)).click();
  else {
    await page.getByRole('navigation', { name: '手机岗位导航' }).getByRole('button', { name: '更多' }).click();
    await page.getByRole('dialog', { name: '工作入口' }).getByRole('button', { name: new RegExp(label) }).click();
  }
  const discard = page.getByRole('button', { name: '丢弃并切换', exact: true });
  if (await discard.isVisible()) await discard.click();
  await expect(page.locator('.field-sidebar').getByRole('button', { name: label, exact: true, includeHidden: true })).toHaveAttribute('aria-current', 'page');
  if (label === '人员管理') {
    const tab = page.getByRole('navigation', { name: '人员管理功能' }).getByRole('button', { name: '人员列表', exact: true });
    if (await tab.isVisible()) await tab.click();
  }

}
