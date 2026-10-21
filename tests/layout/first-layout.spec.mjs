/* global window, document, requestAnimationFrame, innerWidth, getComputedStyle */
import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function gate() {
  let release;
  const promise = new Promise(done => { release = done; });
  return { promise, release };
}
async function frames(page) {
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
}

// Every paint is sampled, including the authenticated bootstrap before APIs finish.
function observeLayout() {
  window.__firstLayout = [];
  function sample() {
    const app = document.querySelector('.field-app');
    const main = app?.querySelector(':scope > main');
    if (main && main.getClientRects().length) {
      const sidebar = app.querySelector(':scope > .field-sidebar');
      const rect = node => {
        const box = node.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      };
      window.__firstLayout.push({
        time: performance.now(), bootstrap: app.classList.contains('workspace-bootstrap'),
        main: rect(main), sidebar: sidebar && getComputedStyle(sidebar).display !== 'none' ? rect(sidebar) : null,
        grid: getComputedStyle(app).gridTemplateColumns, viewport: innerWidth,
        documentWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
      });
    }
    requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
}

const scenarios = [
  { name: 'cold-session', account: 'root001' },
  { name: 'hard-refresh', account: 'root001', reload: true },
  { name: 'slow-css-and-session', account: 'root001', css: true },
  { name: 'uncached-css-technician', account: '20261002', css: true, reload: true },
  { name: 'signed-out' },
  { name: 'expired-session', expired: true },
];

for (const scenario of scenarios) test(scenario.name, async ({ page, context, request }, info) => {
  const directory = resolve('output/first-layout', process.env.LAYOUT_PHASE || 'regression', info.project.name, scenario.name);
  await mkdir(directory, { recursive: true });
  const headers = { 'CF-Connecting-IP': `198.18.${['chromium', 'firefox', 'webkit'].indexOf(info.project.use.browserName) * 2 + (info.project.use.viewport.width > 767 ? 1 : 0)}.${scenarios.indexOf(scenario) + 1}` };
  await context.setExtraHTTPHeaders(headers);
  let token = scenario.expired ? 'expired-layout-session' : '';
  if (scenario.account) {
    const response = await request.post('/api/auth/login', { headers, data: { account: scenario.account, password: scenario.account === 'root001' ? process.env.E2E_ROOT_PASSWORD : 'StaffTest!2026' } });
    expect(response.ok(), await response.text()).toBe(true);
    token = (await response.json()).token;
  }
  await page.addInitScript(value => {
    if (value && !sessionStorage.getItem('pioneerToken')) sessionStorage.setItem('pioneerToken', value);
  }, token);
  await page.addInitScript(observeLayout);
  const auth = gate(), home = gate(), css = gate(), cssRequested = gate();
  let hold = !scenario.reload;
  const cssTiming = [];
  await page.route('**/api/auth/me', async route => {
    if (hold) await auth.promise;
    await route.continue();
  });
  await page.route('**/api/field/home', async route => {
    if (hold) await home.promise;
    await route.continue();
  });
  if (scenario.css) await page.route('**/*.css', async route => {
    cssTiming.push({ path: new URL(route.request().url()).pathname, event: 'requested', at: Date.now() });
    if (hold) { cssRequested.release(); await css.promise; }
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'cache-control': 'no-store' } });
    cssTiming.push({ path: new URL(route.request().url()).pathname, event: 'released', at: Date.now() });
  });
  try {
    await page.goto('/staff/', { waitUntil: 'commit' });
    if (scenario.reload) {
      await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();
      hold = true;
      // Routing disables the HTTP cache in all three engines. Reload therefore fetches CSS again.
      await page.reload({ waitUntil: 'commit' });
    }
    if (scenario.css) {
      await cssRequested.promise;
      // A blocking stylesheet can suspend rAF and screenshots until it arrives.
      // Inspect the DOM while it is withheld, then sample every paint after release.
      const pending = await page.evaluate(() => ({ ready: document.readyState, rendered: !!document.querySelector('.field-app, #login-id') }));
      expect(pending.rendered, 'The module must not render before its blocking CSS').toBe(false);
      cssTiming.push({ event: 'dom-before-css', ...pending });
      css.release();
    }
    if (scenario.account || scenario.expired) {
      await expect(page.locator('.workspace-bootstrap')).toBeVisible();
      await frames(page);
      await page.screenshot({ path: resolve(directory, 'session-pending.png') });
      auth.release();
      if (scenario.account) {
        await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource').some(entry => entry.name.includes('/api/auth/me')))).toBe(true);
        await frames(page);
        await page.screenshot({ path: resolve(directory, 'home-pending.png') });
      }
      home.release();
    }
    if (scenario.account) await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();
    else await expect(page.locator('#login-id')).toBeVisible();
    await frames(page);
    await page.screenshot({ path: resolve(directory, 'ready.png') });
    const result = await page.evaluate(() => ({ frames: window.__firstLayout, resources: performance.getEntriesByType('resource').map(({ name, startTime, responseEnd, transferSize }) => ({ path: new URL(name).pathname, startTime, responseEnd, transferSize })) }));
    await writeFile(resolve(directory, 'measurements.json'), JSON.stringify({ browser: context.browser().version(), scenario, cssTiming, ...result }, null, 2));
    if (scenario.account) {
      expect(result.frames.some(frame => frame.bootstrap), 'Must observe a real pending bootstrap').toBe(true);
      expect(result.frames.some(frame => !frame.bootstrap), 'Must observe the loaded workspace').toBe(true);
    }
    for (const frame of result.frames) {
      const mobile = frame.viewport < 768;
      expect.soft(frame.main.width, JSON.stringify(frame)).toBeGreaterThan(frame.viewport * (mobile ? 0.95 : 0.7));
      expect.soft(frame.documentWidth, JSON.stringify(frame)).toBeLessThanOrEqual(frame.viewport + 1);
      if (mobile) expect.soft(frame.sidebar).toBeNull();
      else {
        expect.soft(frame.sidebar, 'Desktop sidebar must occupy its column on the first paint').not.toBeNull();
        expect.soft(frame.main.x).toBeCloseTo(216, 0);
        if (frame.sidebar) expect.soft(frame.sidebar.width).toBeCloseTo(216, 0);
      }
    }
  } finally { auth.release(); home.release(); css.release(); }
});
