import { test, expect } from '@playwright/test';
import { mockStaff, loginStaff, staffPage } from './support/staff.mjs';

for (const role of ['technician', 'admin', 'superadmin']) test(`account and invitation role options follow backend rules for ${role}`, async ({ page }) => {
  await mockStaff(page, { account: 'manager001', role, campuses: ['南湖'], permissions: { 'accounts.manage': true } });
  const writes = [];
  const account = { account: '20269990', name: '普通成员', role: 'technician', homeCampus: '南湖', authorizedCampuses: ['南湖'], status: 'enabled', actions: { edit: true, changeStatus: true, resetPassword: true } };
  await page.route('**/api/users', route => route.fulfill({ json: { items: [account] } }));
  await page.route('**/api/users/20269990', route => {
    writes.push({ path: '/api/users/20269990', body: route.request().postDataJSON() });
    return route.fulfill({ json: account });
  });
  await page.route('**/api/staff-whitelist/import', route => {
    writes.push({ path: '/api/staff-whitelist/import', body: route.request().postDataJSON() });
    return route.fulfill({ json: { imported: ['20269991'], skipped: [] } });
  });
  await loginStaff(page, 'manager001');
  await staffPage(page, '账号管理');
  await page.getByRole('button', { name: '管理账号', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '管理账号 · 普通成员' });
  const types = editor.getByLabel('基础账号类型');
  await expect(types).toHaveValue('technician');
  await expect(types.locator('option')).toHaveText(['维修人员', '管理员']);
  await editor.getByLabel('姓名', { exact: true }).fill('更新后的成员');
  await editor.getByRole('button', { name: '保存账号', exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(writes[0]).toEqual({ path: '/api/users/20269990', body: { name: '更新后的成员', role: 'technician', homeCampus: '南湖', authorizedCampuses: ['南湖'], status: 'enabled' } });

  await page.getByRole('button', { name: '加入资格', exact: true }).click();
  await page.getByRole('button', { name: '导入名单', exact: true }).click();
  const importer = page.getByRole('dialog', { name: '导入加入名单' });
  await expect(importer.getByLabel('默认角色')).toHaveValue('technician');
  await expect(importer.getByLabel('默认角色').locator('option')).toHaveText(['维修人员']);
  const csv = 'studentId,expectedName\n20269991,受邀成员';
  await importer.getByLabel('或粘贴 CSV').fill(csv);
  await importer.getByRole('button', { name: '导入名单', exact: true }).click();
  await expect(importer).toHaveCount(0);
  expect(writes[1]).toEqual({ path: '/api/staff-whitelist/import', body: { csv, expectedRole: 'technician', authorizedCampuses: ['南湖'] } });
});
