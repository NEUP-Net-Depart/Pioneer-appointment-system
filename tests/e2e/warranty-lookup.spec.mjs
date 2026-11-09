import { test, expect } from './support/fixtures.mjs';
import { readFile } from 'node:fs/promises';
import { loginStaff, staffPage } from './support/staff.mjs';

async function fixture(page, { captcha = false, huawei = false } = {}) {
  await page.addInitScript(() => {
    window.warrantyCameraRequests = 0;
    navigator.mediaDevices.enumerateDevices = async () => [];
    navigator.mediaDevices.getUserMedia = async () => {
      window.warrantyCameraRequests++;
      throw new DOMException('Denied', 'NotAllowedError');
    };
  });
  await page.route('**/api/warranty/providers', (route) =>
    route.fulfill({
      json: {
        providers: [
          'asus',
          'acer',
          'lenovo',
          'hp',
          'dell',
          'msi',
          'apple',
          'xiaomi',
          'huawei',
          'mechrevo'
        ].map((id) => ({
          id,
          available: id === 'lenovo' || (captcha && id === 'acer') || (huawei && id === 'huawei'),
          mode: ['acer', 'huawei'].includes(id) ? 'captcha' : 'automatic',
          message: id === 'lenovo' ? '已接通联想中国官方服务接口' : '尚未接通自动查询接口',
          ...(id === 'huawei' ? { captchaOrigin: process.env.WARRANTY_CAPTCHA_ORIGIN } : {})
        }))
      }
    })
  );
  await page.route('**/api/warranty/query', (route) =>
    route.fulfill({
      json: {
        brand: 'lenovo',
        serial: route.request().postDataJSON().serial,
        outcome: 'found',
        status: 'in_warranty',
        checkedAt: '2026-10-26T08:00:00Z',
        source: {
          name: '联想中国官方服务',
          url: 'https://consumerservice.lenovo.com.cn/deviceGuarantee.html'
        },
        note: '项目状态按原厂服务日期计算。',
        services: [
          {
            name: '整机有限保修（测试模拟）',
            category: '基础服务',
            start: '2025-10-26',
            end: '2027-10-26',
            status: 'in_warranty'
          }
        ]
      }
    })
  );
  await loginStaff(page, '20261003', 'StaffTest!2026');
  await staffPage(page, '今日工作');
}
async function openLookup(page) {
  await page.getByRole('button', { name: '查询保修', exact: true }).click();
  return page.getByRole('dialog', { name: '查询设备保修', exact: true });
}
async function openCapture(dialog) {
  await dialog.getByRole('button', { name: '打开摄像头识别设备标签' }).click();
}
async function openOcr(dialog) {
  await openCapture(dialog);
  await dialog
    .getByRole('group', { name: '识别方式' })
    .getByRole('button', { name: 'OCR' })
    .click();
}
async function imageCode(page, value) {
  const bytes = await page.evaluate(async (value) => {
    const writer = await import('/vendor/zxing-writer.js');
    writer.prepareZXingModule({ overrides: { locateFile: () => '/vendor/zxing_writer.wasm' } });
    const result = await writer.writeBarcode(value, {
      format: 'Code128',
      scale: 6
    });
    if (result.error || !result.image)
      throw new Error('Fixture barcode could not be generated: ' + result.error);
    return Array.from(new Uint8Array(await result.image.arrayBuffer()));
  }, value);
  return { name: 'device-label.png', mimeType: 'image/png', buffer: Buffer.from(bytes) };
}

test('an album barcode supplies the serial for an explicit warranty query', async ({ page }) => {
  await fixture(page);
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('lenovo');
  await dialog
    .getByLabel('从相册导入设备标签', { exact: true })
    .setInputFiles(await imageCode(page, 'AB0OI12'));
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue(
    'AB0OI12'
  );
  await expect(dialog.getByRole('region', { name: '原厂查询结果' })).toContainText('AB0OI12');
  await expect(dialog.locator('video')).toHaveCount(0);
  expect(await page.evaluate(() => window.warrantyCameraRequests)).toBe(0);
});

const captchaImage =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
test('denied camera access keeps manual entry usable and closing clears serial input', async ({
  page
}) => {
  await fixture(page);
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('msi');
  await openCapture(dialog);
  await expect(dialog).toContainText('摄像头未能开启');
  await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('TEST1234');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await openLookup(page);
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue('');
});

test('Acer waits for a human CAPTCHA answer then shows the factory response on this page', async ({
  page
}) => {
  await fixture(page, { captcha: true });
  let challengeCount = 0;
  const submissions = [];
  await page.route('**/api/warranty/challenge', (route) => {
    challengeCount++;
    return route.fulfill({
      json: {
        brand: 'acer',
        serial: route.request().postDataJSON().serial,
        image: captchaImage,
        token: 'mock-encrypted-challenge-' + challengeCount,
        expiresAt: new Date(Date.now() + 180000).toISOString()
      }
    });
  });
  await page.route('**/api/warranty/query', (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        brand: 'acer',
        serial: 'TEST1234',
        outcome: 'found',
        status: 'unknown',
        checkedAt: new Date().toISOString(),
        source: { name: 'Acer 中国官方服务' },
        note: '模拟原厂回包，仅供流程测试。',
        services: [
          {
            name: '标准保修期：2025-01-01 至 2027-01-01',
            category: 'Acer 原厂保修信息',
            start: '',
            end: '',
            status: 'unknown'
          }
        ]
      }
    });
  });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('acer');
  await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('TEST1234');
  await dialog.getByRole('button', { name: '获取原厂验证码', exact: true }).click();
  await expect(dialog.getByRole('group', { name: '原厂人工验证' })).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'Acer 原厂验证码，请人工阅读' })).toHaveAttribute(
    'src',
    captchaImage
  );
  await expect(dialog.getByRole('button', { name: '提交验证码并查询' })).toBeDisabled();
  expect(submissions).toHaveLength(0);
  await dialog.getByRole('button', { name: '重新获取验证码', exact: true }).click();
  await expect(dialog.getByLabel('原厂验证码', { exact: true })).toHaveValue('');
  expect(challengeCount).toBe(2);
  await dialog.getByLabel('原厂验证码', { exact: true }).fill('HUMAN');
  await dialog.getByRole('button', { name: '提交验证码并查询', exact: true }).click();
  await expect(dialog.getByRole('region', { name: '原厂查询结果' })).toContainText('2027-01-01');
  await expect(dialog.getByRole('group', { name: '原厂人工验证' })).toHaveCount(0);
  expect(submissions).toEqual([
    {
      brand: 'acer',
      serial: 'TEST1234',
      captchaToken: 'mock-encrypted-challenge-2',
      captchaAnswer: 'HUMAN'
    }
  ]);
  expect(await page.evaluate(() => Object.values(sessionStorage).join(' '))).not.toContain(
    'mock-encrypted-challenge'
  );
});

test('the real isolated verifier loads its SDK and bridge under both CSP policies', async ({
  page,
  request
}) => {
  await fixture(page, { huawei: true });
  const origin = process.env.WARRANTY_CAPTCHA_ORIGIN;
  const violations = [];
  page.on('console', (message) => {
    if (/Content Security Policy|frame-ancestors/i.test(message.text()))
      violations.push(message.text());
  });
  const response = await request.get(origin + '/index.html');
  const policy = response.headers()['content-security-policy'];
  const parents = policy.split(';')
    .find((value) => value.trim().startsWith('frame-ancestors '))
    .trim()
    .split(/\s+/)
    .slice(1);
  expect(parents).toContain(new URL(page.url()).origin);
  for (const parent of parents) {
    const allowed = new URL(parent);
    expect(allowed.protocol).toBe('http:');
    expect(allowed.hostname).toBe('127.0.0.1');
    expect(allowed.port).toMatch(/^\d+$/);
  }
  expect(response.headers()['x-frame-options']).toBeUndefined();
  await page.route('https://contentcenter-drcn.dbankcdn.cn/**/captcha.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
    window.initHuaweiCaptcha = (options, ready, success) => {
      setTimeout(ready, 0);
      return { popupShow() {
        const button = document.createElement('button'); button.textContent = '模拟人工完成';
        button.onclick = () => success({ resultCode: 0, validate: 'mock-human-proof' });
        document.body.append(button);
      }, destroy() {} };
    };`
    })
  );
  await page.route('**/api/warranty/challenge', (route) =>
    route.fulfill({
      json: {
        brand: 'huawei',
        serial: 'TEST12345678',
        token: 'mock-session',
        expiresAt: new Date(Date.now() + 180000).toISOString(),
        widget: {
          origin,
          type: 2,
          lang: 'zh-CN',
          challenge: 'mock-challenge',
          hcg: 'mock-hcg',
          hct: 'mock-hct',
          nonce: 'mock-nonce'
        }
      }
    })
  );
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('huawei');
  await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('TEST12345678');
  await dialog.getByRole('button', { name: '获取原厂验证码', exact: true }).click();
  const widget = page.frameLocator('iframe[title="华为原厂人工滑块验证"]');
  await widget.getByRole('button', { name: '模拟人工完成' }).click();
  await expect(dialog.getByRole('region', { name: '原厂查询结果' })).toBeVisible();
  expect(violations).toEqual([]);
});

test('real local OCR reads a device label and opens the fixed official page in a separate tab', async ({
  page,
  context
}) => {
  test.setTimeout(90000);
  await fixture(page);
  const copies = [];
  await page.exposeFunction('recordWarrantyCopy', (value) => copies.push(value));
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (value) => window.recordWarrantyCopy(value) }
    })
  );
  const writes = [];
  page.on('request', (req) => {
    if (req.method() === 'POST') writes.push(req.url());
  });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('asus');
  // Fixed pixels keep this real OCR regression independent of OS font rendering.
  const bytes = await readFile(new URL('../fixtures/warranty-serial-label.png', import.meta.url));
  await openOcr(dialog);
  await dialog
    .getByLabel('选择设备标签照片', { exact: true })
    .setInputFiles({ name: 'synthetic-device-label.png', mimeType: 'image/png', buffer: bytes });
  await expect(dialog.getByRole('button', { name: '采用 ABC23456789' })).toBeVisible({
    timeout: 60000
  });
  await dialog.getByRole('button', { name: '采用 ABC23456789' }).click();
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue(
    'ABC23456789',
    { timeout: 60000 }
  );
  await expect(dialog.locator('.warranty-capture')).toHaveCount(0);
  expect(writes).toEqual([]);
  const originalUrl = page.url();
  await context.route(
    'https://www.asus.com.cn/support/warranty-status-inquiry/?sn=ABC23456789',
    (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<meta charset="utf-8"><h1>模拟 ASUS 官方查询页</h1>'
      })
  );
  const popup = page.waitForEvent('popup');
  await dialog.getByRole('button', { name: '复制序列号并前往官网', exact: true }).click();
  const official = await popup;
  await expect(official).toHaveURL(
    'https://www.asus.com.cn/support/warranty-status-inquiry/?sn=ABC23456789'
  );
  expect(await official.evaluate(() => window.opener)).toBeNull();
  expect(await official.evaluate(() => document.referrer)).toBe('');
  await expect(page).toHaveURL(originalUrl);
  await expect(dialog).toBeVisible();
  expect(copies).toEqual(['ABC23456789']);
  await official.close();
});
