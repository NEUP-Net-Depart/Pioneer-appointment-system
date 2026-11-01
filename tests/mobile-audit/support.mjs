/* global document, window, getComputedStyle, innerWidth, innerHeight, visualViewport */
import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export { expect };
export const NOW = new Date('2026-10-15T02:00:00.000Z');
export const PHOTO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Hf8AAAAASUVORK5CYII=', 'base64');
export const evidenceRoot = resolve('output/mobile-audit/evidence');
let apiAddress = '198.18.0.77';
export const test = base.extend({
  audit: [async ({ page, context }, use, info) => {
    if (!process.env.E2E_BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.E2E_BASE_URL)) throw new Error('Audit is restricted to the disposable loopback E2E server');
    const hash = createHash('sha256').update(info.project.name + info.title).digest();
    apiAddress = `198.18.${hash[0]}.${hash[1]}`;
    await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': `198.19.${hash[0]}.${hash[1]}` });
    await page.clock.install({ time: NOW });
    const directory = resolve(evidenceRoot, info.project.name, info.title.replace(/[^a-zA-Z0-9-]/g, '-'));
    await mkdir(directory, { recursive: true });
    const diagnostics = { browserVersion: context.browser().version(), console: [], pageErrors: [], requests: [], responses: [], notes: [] };
    page.on('console', item => { if (['warning', 'error'].includes(item.type())) diagnostics.console.push({ type: item.type(), text: item.text() }); });
    page.on('pageerror', error => diagnostics.pageErrors.push(error.message));
    page.on('requestfailed', req => diagnostics.requests.push({ method: req.method(), path: new URL(req.url()).pathname, failure: req.failure()?.errorText }));
    page.on('response', res => { if (res.status() >= 400) diagnostics.responses.push({ method: res.request().method(), path: new URL(res.url()).pathname, status: res.status() }); });
    // No accidental cloud API or production requests, even if a page contains an external URL.
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return ['data:', 'blob:'].includes(url.protocol) || url.origin === process.env.E2E_BASE_URL ? route.continue() : route.abort('blockedbyclient');
    });
    const samples = [];
    const audit = {
      directory, samples, diagnostics,
      async capture(id, { axe = false, viewportOnly = false } = {}) {
        await page.evaluate(() => document.fonts.ready);
        const result = await page.evaluate(() => {
          const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]');
          const describe = el => ({ tag: el.tagName, id: el.id, class: typeof el.className === 'string' ? el.className : '', text: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 110) });
          const bounds = el => { const { x, y, width, height } = el.getBoundingClientRect(); return { x: +x.toFixed(2), y: +y.toFixed(2), width: +width.toFixed(2), height: +height.toFixed(2) }; };
          const dialog = [...document.querySelectorAll('[role=dialog],dialog[open]')].find(visible);
          const scope = dialog || document.querySelector('.workspace-route:not([hidden])') || document.querySelector('.view.is-active') || document.body;
          const controls = [...scope.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button]')].filter(el => visible(el) && !el.disabled);
          const smallTargets = controls.flatMap(el => {
            let target = el;
            if (el.matches('input[type=checkbox],input[type=radio]')) target = el.labels?.[0] || el;
            const box = bounds(target);
            return box.width > 0 && (box.width < 44 || box.height < 44) ? [{ ...describe(el), target: describe(target), ...box }] : [];
          });
          const inputs = [...scope.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([type=file]),select,textarea')].filter(visible);
          const criticalTargets = [...document.querySelectorAll('.field-mobile-tabs button, .field-bottom-nav button, .field-details > summary, .capacity-quick-tools > summary, .roster-collection > details > summary, .roster-audience > summary, .swap-coverage > summary, .workspace-help > summary, .field-file-button, .booking-campuses .booking-choice, .photo-card button, #refresh-my-appointments')].filter(el => visible(el) && !el.disabled).map(el => ({ ...describe(el), ...bounds(el) }));
          const overflowNodes = [...scope.querySelectorAll('*')].filter(el => visible(el) && el.getBoundingClientRect().width && (el.getBoundingClientRect().right > innerWidth + 1 || el.getBoundingClientRect().left < -1)).slice(0, 25).map(el => ({ ...describe(el), ...bounds(el), overflowX: getComputedStyle(el).overflowX }));
          const clipped = [...scope.querySelectorAll('button,label,h1,h2,h3,p,strong,td,th')].filter(el => visible(el) && el.scrollWidth > el.clientWidth + 2 && ['hidden', 'clip'].includes(getComputedStyle(el).overflowX)).slice(0, 20).map(el => ({ ...describe(el), ...bounds(el), scrollWidth: el.scrollWidth }));
          return {
            viewport: { width: innerWidth, height: innerHeight, visualHeight: visualViewport?.height }, documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), documentHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
            staff: document.body.classList.contains('staff-mode'), criticalTargets,
            smallTargets, smallInputs: inputs.filter(el => parseFloat(getComputedStyle(el).fontSize) < 16).map(el => ({ ...describe(el), fontSize: getComputedStyle(el).fontSize, ...bounds(el) })),
            overflowNodes, clipped, dialogs: [...document.querySelectorAll('dialog[open],[role=dialog]')].filter(visible).map(el => ({ ...describe(el), ...bounds(el), clientHeight: el.clientHeight, scrollHeight: el.scrollHeight })),
          };
        });
        if (axe) {
          const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
          result.axe = accessibility.violations.map(({ id, impact, description, helpUrl, nodes }) => ({ id, impact, description, helpUrl, nodes: nodes.map(({ target, html, failureSummary }) => ({ target, html, failureSummary })) }));
        }
        samples.push({ id, ...result });
        if (result.viewport.width < 768) {
          if (result.staff) expect.soft(result.smallInputs, `${id}: mobile text controls must use at least 16px`).toEqual([]);
          expect.soft(result.criticalTargets.filter(box => box.width < 44 || box.height < 44), `${id}: frequent touch controls must reach 44px`).toEqual([]);
        }
        if (result.axe) {
          expect.soft(result.axe.filter(item => ['color-contrast', 'aria-prohibited-attr'].includes(item.id)), `${id}: contrast and loading semantics`).toEqual([]);
        }
        await page.screenshot({ path: resolve(directory, `${id}.jpg`), type: 'jpeg', quality: 65, fullPage: !viewportOnly && result.documentHeight < 14000 });
        return result;
      },
      async captureFont200(id) {
        await page.evaluate(() => {
          window.__mobileAuditFonts = [...document.querySelectorAll('*')].map(node => ({ node, size: parseFloat(getComputedStyle(node).fontSize), value: node.style.fontSize, priority: node.style.getPropertyPriority('font-size') }));
          for (const { node, size } of window.__mobileAuditFonts) if (size) node.style.setProperty('font-size', `${size * 2}px`, 'important');
        });
        try { return await this.capture(`${id}-font200`, { viewportOnly: true }); }
        finally {
          await page.evaluate(() => {
            for (const { node, value, priority } of window.__mobileAuditFonts) {
              if (value) node.style.setProperty('font-size', value, priority);
              else node.style.removeProperty('font-size');
            }
            delete window.__mobileAuditFonts;
          });
        }
      },
    };
    try { await use(audit); }
    finally {
      if (!page.isClosed()) diagnostics.notes.push(await page.evaluate(() => ({ cameraFixture: window.__cameraAudit ? { calls: window.__cameraAudit.calls, errors: window.__cameraAudit.errors, streams: window.__cameraAudit.streams.map(stream => stream.getTracks().map(track => ({ kind: track.kind, state: track.readyState }))) } : null })).catch(() => ({ cameraFixture: 'unavailable' })));
      if (info.status !== info.expectedStatus && !page.isClosed()) await page.screenshot({ path: resolve(directory, 'failure.jpg'), type: 'jpeg', quality: 75, fullPage: false }).catch(() => {});
      await writeFile(resolve(directory, 'observations.json'), JSON.stringify({ project: info.project.name, test: info.title, status: info.status, samples, diagnostics }, null, 2) + '\n');
    }
  }, { auto: true }],
});
export async function api(request, path, token, data, method = data ? 'POST' : 'GET') {
  const response = await request.fetch(path, { method, headers: { Authorization: `Bearer ${token}`, 'CF-Connecting-IP': apiAddress }, ...(data ? { data } : {}) });
  const body = await response.json();
  expect(response.ok(), `${method} ${path}: ${JSON.stringify(body)}`).toBe(true);
  return body;
}
export async function loginApi(request, account = 'root001') {
  const response = await request.post('/api/auth/login', { headers: { 'CF-Connecting-IP': apiAddress }, data: { account, password: account === 'root001' ? process.env.E2E_ROOT_PASSWORD : 'StaffTest!2026' } });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
export async function login(page, account = 'root001') {
  await page.goto('/staff/');
  await page.locator('#login-id').fill(account);
  await page.locator('#login-password').fill(account === 'root001' ? process.env.E2E_ROOT_PASSWORD : 'StaffTest!2026');
  await page.getByRole('button', { name: '进入系统' }).click();
  await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();
}
export async function navigate(page, label) {
  if (label === '激活与账号') {
    await navigate(page, '人员管理');
    await page.getByRole('navigation', { name: '人员管理功能' }).getByRole('button', { name: label, exact: true }).click();
    return;
  }
  const sidebar = page.locator('.field-sidebar');
  if (await sidebar.isVisible()) {
    const target = sidebar.getByRole('button', { name: label, exact: true });
    if (!(await target.isVisible())) {
      for (const group of await sidebar.locator('button[aria-expanded=false]').all()) await group.click();
    }
    await target.click();
  } else {
    await page.getByRole('navigation', { name: '手机岗位导航' }).getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('dialog', { name: '工作入口', exact: true }).getByRole('button', { name: label, exact: true }).click();
  }
  await expect(page.locator('.workspace-route:not([hidden])')).toBeVisible();
  if (label === '人员管理') {
    const tab = page.getByRole('navigation', { name: '人员管理功能' }).getByRole('button', { name: '人员列表', exact: true });
    if (await tab.isVisible()) await tab.click();
  }
}
export async function draw(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width * .1, box.y + box.height * .2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .75, box.y + box.height * .45, { steps: 15 });
  await page.mouse.move(box.x + box.width * .3, box.y + box.height * .75, { steps: 15 });
  await page.mouse.up();
}
export async function orderFixture(request, officeToken, info) {
  const sid = `${info.project.name.replace(/\D/g, '')}${createHash('sha256').update(randomUUID()).digest().readUInt32BE()}`.slice(0, 20);
  return api(request, '/api/scan/onsite', officeToken, { requestId: randomUUID(), registrationFlow: 'frontdesk', campus: '南湖', name: '移动审查测试同学', studentId: sid, social: 'local-audit', deviceType: '笔记本电脑', brand: '联想', deviceModel: 'ThinkPad Mobile', warranty: '否', faultType: '系统问题', signature: [Array.from({ length: 10 }, (_, i) => [.1 + i * .05, .2 + i * .03])] });
}
