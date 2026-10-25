import { expect } from '@playwright/test';

export function staffSession({ account = 'root001', name = '平台测试管理员', role = 'superadmin', campuses = ['南湖', '浑南'], permissions, contexts = [] } = {}) {
  permissions ||= Object.fromEntries(['repair.summary.read', 'repair.start', 'repair.finish.own', 'repair.correct', 'repair.transfer', 'onsite.create', 'onsite.frontdesk.create', 'customer.identity.read', 'customer.contact.read', 'members.manage', 'roles.manage', 'statistics.read', 'accounts.manage', 'settings.manage', 'attendance.self', 'roster.read'].map(code => [code, true]));
  const navigation = [{ id: 'members' }, { id: 'roles' }, { id: 'rosters' }, { id: 'attendance' }];
  const profile = { account, name, role, memberId: `member-${account}`, status: 'enabled', authVersion: 1, authorizedCampuses: campuses, homeCampus: campuses[0], permissions, navigation };
  const home = { actor: { memberId: profile.memberId, name }, businessDate: '2026-10-15', authVersion: 1, campuses: campuses.map(campus => ({ id: campus === '南湖' ? 'campus-nanhu' : 'campus-hunnan', name: campus })), campusId: 'campus-nanhu', contexts, capability: permissions, permissions, navigation, state: 'available', reason: '', currentRepair: null, todayDuties: [], identities: [], updatedAt: '2026-10-15T02:00:00Z', appointments: [], staffPresence: [] };
  return { profile, home };
}
export async function mockStaff(page, options = {}) {
  const session = staffSession(options);
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/login') return route.fulfill({ json: { ...session.profile, token: 'test-session' } });
    if (path === '/api/auth/me') return route.fulfill({ json: session.profile });
    if (['/api/field/home','/api/field/board'].includes(path)) return route.fulfill({ json: session.home });
    if (path === '/api/appointments/overview') return route.fulfill({ json: { dates: [], campuses: session.profile.authorizedCampuses, items: [] } });
    if (path === '/api/stats/summary') return route.fulfill({ json: { total: 0, completed: 0, cancelled: 0, expired: 0, classified: 0, repaired: 0, daily: {}, faults: {}, campuses: {}, technicians: {} } });
    return route.fulfill({ json: { items: [], counts: {}, filteredCounts: {} } });
  });
  return session;
}
export async function loginStaff(page, account = 'root001', password = 'test-password') {
  await page.goto('/staff/');
  await page.locator('#login-id').fill(account); await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: '进入系统' }).click();
  await expect(page.locator('.field-content')).toBeVisible();
}
export async function staffPage(page, label) {
  if ((await page.locator('.field-sidebar').isVisible())) await page.locator('.field-sidebar').getByRole('button', { name: label, exact: true }).click();
  else {
    await page.getByRole('navigation', { name: '手机岗位导航' }).getByRole('button', { name: '更多' }).click();
    await page.getByRole('dialog', { name: '工作入口' }).getByRole('button', { name: new RegExp(label) }).click();
  }
  const keep = page.getByRole('button', { name: '保留草稿并切换', exact: true });
  if (await keep.isVisible()) await keep.click();
  await expect(page.locator('.field-sidebar').getByRole('button', { name: label, exact: true, includeHidden: true })).toHaveAttribute('aria-current', 'page');
}
