import { test, expect } from '@playwright/test';
import { mockStaff } from './support/staff.mjs';
import { dateKey } from '../../shared/time.js';

function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

for (const width of [320, 390, 768, 1440]) test(`workspace shell is stable while identity and field are delayed at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const session = await mockStaff(page, { contexts: [{ id: 'repair', label: '维修工作台' }] });
  session.home.businessDate = dateKey();
  session.home.updatedAt = new Date().toISOString();
  const identity = gate(), home = gate();
  await page.addInitScript(() => sessionStorage.setItem('pioneerToken', 'test-session'));
  await page.route('**/api/auth/me', async route => {
    await identity.promise;
    await route.fulfill({ json: session.profile });
  });
  let reads = 0;
  await page.route('**/api/field/home*', async route => {
    reads++;
    await home.promise;
    await route.fulfill({ json: session.home });
  });
  try {
    await page.goto('/staff/');
    await expect(page.locator('.field-app')).toBeVisible();
    if (width >= 900) await expect(page.locator('.field-brand')).toBeVisible();
    await expect(page.getByRole('heading', { name: '今日工作', exact: true })).toBeVisible();
    await expect(page.locator('.workspace-bootstrap')).toHaveCount(0);
    await expect(page.locator('.field-sidebar button').filter({ hasText: '成员管理' })).toHaveCount(0);
    await page.evaluate(() => {
      window.originalWorkspace = document.querySelector('.field-app');
      window.dispatchEvent(new CustomEvent('staff-request-navigation', { detail: 'members' }));
    });
    await expect(page.locator('.members-workspace')).toHaveCount(0);
    expect(reads).toBe(0);
    identity.release();
    await expect.poll(() => reads).toBe(1);
    // A slow field request cannot block an independently authorized page.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('staff-request-navigation', { detail: 'settings' })));
    await expect(page.getByRole('heading', { name: '账号安全', exact: true })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('staff-request-navigation', { detail: 'workbench' })));
    home.release();
    await expect(page.getByRole('heading', { name: '维修工作台', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '扫描维修码', exact: true })).toBeVisible();
    expect(reads).toBe(1);
    expect(await page.evaluate(() => window.originalWorkspace === document.querySelector('.field-app'))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/issue-73/workspace-${width}.png`, fullPage: true });
  } finally {
    identity.release(); home.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('field failure stays local and a retry recovers without replacing the shell', async ({ page }) => {
  const session = await mockStaff(page, { contexts: [{ id: 'repair', label: '维修工作台' }] });
  let failed = true;
  await page.addInitScript(() => sessionStorage.setItem('pioneerToken', 'test-session'));
  await page.route('**/api/field/home*', route => failed ? route.fulfill({ status: 503, json: { error: '工作台暂时不可用' } }) : route.fulfill({ json: session.home }));
  await page.goto('/staff/');
  await expect(page.getByRole('alert')).toHaveText('工作台暂时不可用');
  await page.evaluate(() => { window.originalWorkspace = document.querySelector('.field-app'); });
  await page.locator('.field-sidebar').getByRole('button', { name: '账号安全', exact: true }).click();
  await expect(page.getByRole('heading', { name: '账号安全', exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('staff-request-navigation', { detail: 'workbench' })));
  failed = false;
  await page.getByRole('button', { name: '重新加载工作区', exact: true }).click();
  await expect(page.getByRole('heading', { name: '维修工作台', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.originalWorkspace === document.querySelector('.field-app'))).toBe(true);
});

test('identity timeout has a local retry and never exposes privileged entries', async ({ page }) => {
  await page.clock.install();
  const session = await mockStaff(page);
  const stalled = gate();
  let pending = true, reads = 0;
  await page.addInitScript(() => sessionStorage.setItem('pioneerToken', 'test-session'));
  await page.route('**/api/auth/me', async route => {
    reads++;
    if (pending) await stalled.promise;
    await route.fulfill({ json: session.profile });
  });
  try {
    await page.goto('/staff/');
    await expect.poll(() => reads).toBe(1);
    await page.clock.fastForward(15001);
    await expect(page.getByRole('alert')).toHaveText('会话验证超时，请检查网络后重试');
    await expect(page.locator('.field-sidebar').getByRole('button', { name: '成员管理', exact: true })).toHaveCount(0);
    pending = false;
    stalled.release();
    await page.getByRole('button', { name: '重新加载工作区', exact: true }).click();
    await expect(page.getByRole('heading', { name: '个人中心', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    stalled.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('a missing lazy module fails inside its page and leaves other navigation usable', async ({ page }) => {
  await mockStaff(page);
  await page.addInitScript(() => sessionStorage.setItem('pioneerToken', 'test-session'));
  await page.route('**/staff/assets/Accounts-*.js', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/staff/');
  await expect(page.locator('.field-content')).toBeVisible();
  await page.locator('.field-sidebar').getByRole('button', { name: '账号管理', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('此页面暂时无法加载，请刷新后重试。');
  await page.locator('.field-sidebar').getByRole('button', { name: '账号安全', exact: true }).click();
  await expect(page.getByRole('heading', { name: '账号安全', exact: true })).toBeVisible();
});
