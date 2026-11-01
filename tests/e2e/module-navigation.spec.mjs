import { test, expect } from '@playwright/test';
import { mockStaff, loginStaff } from './support/staff.mjs';

function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

for (const width of [320, 390, 768, 1440]) test(`slow page code preserves real content without a skeleton at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await mockStaff(page);
  const code = gate(), data = gate();
  let codeRequested = false, dataRequested = false;
  await page.route('**/staff/assets/Statistics-*.js', async route => {
    codeRequested = true;
    await code.promise;
    await route.continue();
  });
  await page.route('**/api/stats/summary*', async route => {
    dataRequested = true;
    await data.promise;
    await route.fulfill({ json: { total: 3, completed: 1, daily: {}, faults: {}, campuses: {}, technicians: {} } });
  });
  try {
    await loginStaff(page);
    const original = await page.locator('.workspace-route[data-route="workbench"]').elementHandle();
    await page.evaluate(() => {
      window.skeletonAppeared = false;
      new MutationObserver(() => {
        if (document.querySelector('.workspace-route:not([hidden]) .workspace-skeleton')) window.skeletonAppeared = true;
      }).observe(document.body, { childList: true, subtree: true });
      window.dispatchEvent(new CustomEvent('staff-request-navigation', { detail: 'stats' }));
    });
    await expect.poll(() => codeRequested).toBe(true);
    await expect(page.getByRole('status').filter({ hasText: '正在打开统计分析' })).toBeVisible();
    expect(await original.isVisible()).toBe(true);
    expect(dataRequested).toBe(false);
    await page.screenshot({ path: `output/issue-73/code-pending-${width}.png` });
    code.release();
    await expect(page.getByRole('heading', { name: '统计分析', exact: true })).toBeVisible();
    await expect.poll(() => dataRequested).toBe(true);
    await expect(page.locator('.workspace-navigation-status')).toHaveCount(0);
    expect(await page.evaluate(() => window.skeletonAppeared)).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    data.release();
  } finally {
    code.release(); data.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('preparing an authorized page on focus loads code without requesting its data', async ({ page }) => {
  await mockStaff(page);
  let codeReads = 0, dataReads = 0;
  page.on('requestfinished', request => {
    if (/\/Statistics-[^/]+\.js/.test(request.url())) codeReads++;
    if (request.url().includes('/api/stats/summary')) dataReads++;
  });
  await loginStaff(page);
  await page.locator('.field-sidebar').getByRole('button', { name: '统计分析', exact: true }).focus();
  await expect.poll(() => codeReads).toBe(1);
  expect(dataReads).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('staff-request-navigation', { detail: 'stats' })));
  await expect(page.getByRole('heading', { name: '统计分析', exact: true })).toBeVisible();
  await expect.poll(() => dataReads).toBe(1);
  expect(codeReads).toBe(1);
  await expect(page.locator('.workspace-skeleton')).toHaveCount(0);
});

test('a late code response cannot override the most recent navigation', async ({ page }) => {
  await mockStaff(page);
  const code = gate();
  let requested = false;
  await page.route('**/staff/assets/People-*.js', async route => {
    requested = true;
    await code.promise;
    await route.continue();
  });
  try {
    await loginStaff(page);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('staff-request-navigation', { detail: 'users' })));
    await expect.poll(() => requested).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('staff-request-navigation', { detail: 'settings' })));
    await expect(page.getByRole('heading', { name: '账号安全', exact: true })).toBeVisible();
    code.release();
    await expect(page.locator('.workspace-navigation-status')).toHaveCount(0);
    await expect(page.locator('[data-route="members"]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '账号安全', exact: true })).toBeVisible();
  } finally {
    code.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('editing while code is loading still triggers the navigation guard before switching',async({page})=>{
  await mockStaff(page);
  const code=gate();let requested=false;
  await page.route('**/staff/assets/Statistics-*.js',async route=>{requested=true;await code.promise;await route.continue();});
  try {
    await loginStaff(page);
    await page.evaluate(()=>{
      window.editingDuringLoad=false;
      window.addEventListener('staff-before-navigation',event=>{
        if(!window.editingDuringLoad)return;
        event.preventDefault();event.detail.editors.push({save:async()=>false,discard(){window.editingDuringLoad=false;}});
      });
      window.dispatchEvent(new CustomEvent('staff-request-navigation',{detail:'stats'}));
    });
    await expect.poll(()=>requested).toBe(true);
    await page.evaluate(()=>{window.editingDuringLoad=true;});
    code.release();
    const guard=page.getByRole('dialog',{name:'有未保存的调整',exact:true});
    await expect(guard).toBeVisible();
    await expect(page.locator('[data-route="workbench"]')).toBeVisible();
    await expect(page.locator('[data-route="stats"]')).toHaveCount(0);
    await guard.getByRole('button',{name:'留在当前页面',exact:true}).click();
    await expect(guard).toHaveCount(0);
    expect(await page.evaluate(()=>window.editingDuringLoad)).toBe(true);
  } finally {code.release();await page.unrouteAll({behavior:'wait'});}
});
