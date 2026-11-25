import { present } from '../helpers/present.ts';
import { devices } from '@playwright/test';
import { test, expect } from './support/fixtures.ts';
import { loginStaff } from './support/staff.ts';

const installLabel = '安装到桌面';

async function openMore(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '更多', exact: true }).click();
  return page.getByRole('dialog', { name: '工作入口', exact: true });
}

test(
  'the Pages build serves a staff-only manifest and icons',
  { tag: '@smoke' },
  async ({ request }) => {
    const studentHtml = await (await request.get('/')).text();
    expect(studentHtml).not.toMatch(/rel="(?:manifest|apple-touch-icon)"/);

    const staffHtml = await (await request.get('/staff/')).text();
    const manifestPath = staffHtml.match(/rel="manifest" href="([^"]+)"/)?.[1];
    const touchIconPath = staffHtml.match(/rel="apple-touch-icon"[^>]* href="([^"]+)"/)?.[1];
    expect(manifestPath).toMatch(/^\/staff\//);
    expect(touchIconPath).toMatch(/^\/staff\//);

    const response = await request.get(present(manifestPath));
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toMatch(/^application\/manifest\+json\b/);
    const manifest = await response.json();
    expect(manifest).toMatchObject({
      id: '/staff/',
      start_url: '/staff/',
      scope: '/staff/',
      display: 'standalone'
    });
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
        expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
        expect.objectContaining({ sizes: '512x512', purpose: 'maskable' })
      ])
    );
    for (const icon of [...manifest.icons, { src: touchIconPath, sizes: '180x180' }]) {
      const url = new URL(icon.src, response.url());
      expect(url.pathname).toMatch(/^\/staff\//);
      const image = await request.get(url.href);
      expect(image.ok()).toBe(true);
      expect(image.headers()['content-type']).toMatch(/^image\/png\b/);
      const png = await image.body();
      expect(png.subarray(12, 16).toString()).toBe('IHDR');
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
    }
  }
);

test.describe('Android install entry', () => {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['Pixel 7'];
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });
  test(
    'uses the deferred prompt once and follows browser installation state',
    { tag: '@smoke' },
    async ({ browserName, page }) => {
      test.skip(browserName !== 'chromium');
      await page.addInitScript(() => {
        const matchMedia = window.matchMedia.bind(window);
        const displayMode: MediaQueryList = Object.assign(new EventTarget(), {
          matches: false, media: '(display-mode: standalone)', onchange: null,
          addListener() {}, removeListener() {}
        });
        window.matchMedia = (query) =>
          query === '(display-mode: standalone)' ? displayMode : matchMedia(query);
        window.addEventListener('test-display-mode-change', (event) => {
          if (!(event instanceof CustomEvent) || typeof event.detail !== 'boolean') throw new Error('Expected display mode change');
          Object.assign(displayMode, { matches: event.detail });
          displayMode.dispatchEvent(new Event('change'));
        });
        window.promptCalls = 0;
        window.addEventListener('load', () => {
          const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
            async prompt() {
              window.promptCalls++;
              return { outcome: 'dismissed' };
            }
          });
          window.dispatchEvent(event);
          window.installPromptDeferred = event.defaultPrevented;
        });
      });

      await loginStaff(page);
      expect(await page.evaluate(() => window.installPromptDeferred)).toBe(true);
      expect(await page.evaluate(() => window.promptCalls)).toBe(0);
      await expect(page.getByRole('dialog', { name: installLabel })).toHaveCount(0);

      const menu = await openMore(page);
      const install = menu.getByRole('button', { name: installLabel, exact: true });
      await install.click();
      expect(await page.evaluate(() => window.promptCalls)).toBe(1);
      await expect(install).toBeVisible();
      await install.click();
      const guide = page.getByRole('dialog', { name: installLabel, exact: true });
      await expect(guide).toContainText('在 Chrome 中打开当前页面');
      await guide.getByRole('button', { name: '关闭' }).click();
      await expect(guide).toHaveCount(0);

      await openMore(page);
      await page.evaluate(() =>
        window.dispatchEvent(new CustomEvent('test-display-mode-change', { detail: true }))
      );
      await expect(install).toHaveCount(0);
      await page.evaluate(() =>
        window.dispatchEvent(new CustomEvent('test-display-mode-change', { detail: false }))
      );
      await expect(install).toBeVisible();
      await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
      await expect(install).toHaveCount(0);
    }
  );
});

test(
  'iOS offers Safari instructions and hides the entry in a Home Screen app',
  { tag: '@mobile-smoke' },
  async ({ browserName, page }) => {
    test.skip(browserName !== 'webkit');
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', {
        value: sessionStorage.getItem('test-standalone') === 'true'
      });
    });
    await loginStaff(page);
    const menu = await openMore(page);
    const install = menu.getByRole('button', { name: installLabel, exact: true });
    await install.click();
    const guide = page.getByRole('dialog', { name: installLabel, exact: true });
    await expect(guide).toContainText('点按共享按钮，选择「添加到主屏幕」');
    await expect(guide).toContainText('作为网页 App 打开');

    await page.evaluate(() => sessionStorage.setItem('test-standalone', 'true'));
    await page.reload();
    await expect(page).toHaveURL(/\/staff\/$/);
    await expect(await openMore(page)).toBeVisible();
    await expect(install).toHaveCount(0);
  }
);
