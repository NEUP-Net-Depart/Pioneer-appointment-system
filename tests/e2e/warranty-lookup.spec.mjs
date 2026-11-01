import { test, expect } from '@playwright/test';
import { mockStaff, loginStaff } from './support/staff.mjs';

async function fixture(page, { item, camera = 'denied', captcha = false, huawei = false } = {}) {
  await page.addInitScript(({camera}) => {
    window.warrantyCameraRequests = 0;
    window.warrantyStreams = [];
    navigator.mediaDevices.enumerateDevices = async () => [];
    navigator.mediaDevices.getUserMedia = async () => {
      window.warrantyCameraRequests++;
      if (camera === 'denied') throw new DOMException('Denied', 'NotAllowedError');
      if (camera === 'pending') await new Promise(resolve => { window.allowWarrantyCamera = resolve; });
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      canvas.getContext('2d').fillRect(0, 0, 64, 64);
      const stream = canvas.captureStream(1); window.warrantyStreams.push(stream); return stream;
    };
  }, { camera });
  const session = await mockStaff(page, { role: 'technician', contexts: [{ id: 'repair', label: '维修工作台' }], permissions: { 'repair.summary.read': true, 'repair.start': true } });
  if (item) {
    session.home.pendingRepair = item;
    await page.route('**/api/field/appointments/' + item.id, route => route.fulfill({ json: item }));
  }
  await page.route('**/api/warranty/providers', route => route.fulfill({ json: { providers: ['asus','acer','lenovo','hp','dell','msi','apple','xiaomi','huawei','mechrevo'].map(id => ({ id, available: id === 'lenovo' || (captcha && id === 'acer') || (huawei && id === 'huawei'), mode: ['acer','huawei'].includes(id) ? 'captcha' : 'automatic', message: id === 'lenovo' ? '已接通联想中国官方服务接口' : '尚未接通自动查询接口', ...(id === 'huawei' ? { captchaOrigin: process.env.WARRANTY_CAPTCHA_ORIGIN } : {}) })) } }));
  await page.route('**/api/warranty/query', route => route.fulfill({ json: { brand: 'lenovo', serial: route.request().postDataJSON().serial, outcome: 'found', status: 'in_warranty', checkedAt: '2026-10-26T08:00:00Z', source: { name: '联想中国官方服务', url: 'https://consumerservice.lenovo.com.cn/deviceGuarantee.html' }, note: '项目状态按原厂服务日期计算。', services: [{ name: '整机有限保修（测试模拟）', category: '基础服务', start: '2025-10-26', end: '2027-10-26', status: 'in_warranty' }] } }));
  await loginStaff(page);
}
async function openLookup(page) {
  await page.getByRole('button', { name: '查询保修', exact: true }).click();
  return page.getByRole('dialog', { name: '查询设备保修', exact: true });
}
async function imageCode(page, value, format = 'QRCode') {
  const bytes = await page.evaluate(async ({value, format}) => {
    const writer = await import('/vendor/zxing-writer.js');
    writer.prepareZXingModule({ overrides: { locateFile: () => '/vendor/zxing_writer.wasm' } });
    const result = await writer.writeBarcode(value, { format, scale: 6, ...(format === 'QRCode' ? { options: 'ecLevel=M' } : {}) });
    if (result.error || !result.image) throw new Error('Fixture barcode could not be generated: ' + result.error);
    return Array.from(new Uint8Array(await result.image.arrayBuffer()));
  }, { value, format });
  return { name: 'device-label.png', mimeType: 'image/png', buffer: Buffer.from(bytes) };
}

test('the staff shortcut includes ten official entries and fits phone/tablet/desktop screens', async ({ page }) => {
  await fixture(page);
  const dialog = await openLookup(page);
  expect(await page.evaluate(() => window.warrantyCameraRequests)).toBe(0);
  await expect(dialog.getByLabel('设备品牌').locator('option')).toHaveCount(11);
  for (const [id, host] of [['asus','www.asus.com.cn'],['acer','www.acer.com.cn'],['lenovo','consumerservice.lenovo.com.cn'],['hp','support.hp.com'],['dell','www.dell.com'],['msi','account.msi.com'],['apple','checkcoverage.apple.com'],['xiaomi','www.mi.com'],['huawei','consumer.huawei.com'],['mechrevo','www.mechrevo.com']]) {
    await dialog.getByLabel('设备品牌').selectOption(id);
    await dialog.getByText('查看官方消费者渠道', { exact: true }).click();
    const link = dialog.getByRole('link', { name: '打开官方保修入口 ↗' });
    expect(new URL(await link.getAttribute('href')).hostname).toBe(host);
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
    await dialog.getByText('查看官方消费者渠道', { exact: true }).click();
  }
  await expect(dialog).toContainText('网页本身不是 SN 查询表');
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    const box = await dialog.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: `output/field-workflow/warranty-${width}.png` });
  }
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('button', { name: '查询保修', exact: true })).toBeFocused();
});

test('an order preselects its brand and adopts only the explicitly confirmed warranty field', async ({ page }) => {
  const item = { id: 'reserve020261015-47', revision: 1, brand: '联想', deviceModel: 'ThinkPad T14', campus: '南湖', date: '2026-10-15', timeSlot: '19:00–19:30', status: 'booked', canStart: true, canReturn: true, reception: { state: 'assigned', ticket: { number: 47, date: '2026-10-15' } } };
  await fixture(page, { item });
  await page.getByRole('button', { name: '核对设备并接手', exact: true }).click();
  const repair = page.getByRole('dialog', { name: '确认接手', exact: true, includeHidden: true });
  await repair.getByText('更正核验信息', { exact: true }).click();
  await expect(repair.getByRole('combobox', { name: '保修情况', exact: true })).toHaveValue('unknown');
  await repair.getByRole('checkbox', { name: /^我已当面核对/ }).check();
  await repair.getByRole('button', { name: '查询保修', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '查询设备保修', exact: true });
  await expect(dialog.getByLabel('设备品牌')).toHaveValue('lenovo');
  const writes = []; page.on('request', req => { if (req.method() !== 'GET') writes.push(req.url()); });
  const serial = dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true });
  await serial.fill('TEST0O1I2345');
  await dialog.getByRole('button', { name: '查询原厂保修', exact: true }).click();
  await expect(dialog.getByRole('region', { name: '原厂查询结果' })).toContainText('整机有限保修（测试模拟）');
  expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key) || '{}').verification?.warranty, 'field:member-root001:' + item.id)).toBe('unknown');
  await dialog.getByRole('button', { name: '采用此保修情况' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(repair.getByRole('combobox', { name: '保修情况', exact: true })).toHaveValue('in_warranty');
  await expect(repair.getByRole('checkbox', { name: /^我已当面核对/ })).not.toBeChecked();
  expect(writes).toHaveLength(1);
  expect(new URL(writes[0]).pathname).toBe('/api/warranty/query');
  expect(await page.evaluate(() => Object.values(sessionStorage).join(' '))).not.toContain('TEST0O1I2345');
});

for (const format of ['QRCode', 'Code128']) test(`album decoding reads a real ${format} device label and automatically queries the manufacturer`, async ({ page }) => {
  await fixture(page);
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('lenovo');
  await dialog.getByRole('button', { name: '扫描机身条码 / 二维码' }).click();
  await dialog.locator('.field-scanner input[type=file]').setInputFiles(await imageCode(page, 'AB0OI12', format));
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue('AB0OI12');
  await expect(dialog.getByRole('region', { name: '原厂查询结果' })).toContainText('AB0OI12');
  await expect(dialog.locator('video')).toHaveCount(0);
  expect(await page.evaluate(() => window.warrantyCameraRequests)).toBe(0);
});

test('scanning a customer credential or URL cannot resolve orders, navigate, or fill a serial', async ({ page }) => {
  await fixture(page);
  const writes = []; page.on('request', req => { if (req.method() !== 'GET') writes.push(req.url()); });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('huawei');
  await dialog.getByRole('button', { name: '扫描机身条码 / 二维码' }).click();
  for (const value of ['reserve020261015-47.abc123456789', 'https://example.invalid/#private-token']) {
    await dialog.locator('.field-scanner input[type=file]').setInputFiles(await imageCode(page, value));
    await expect(dialog).toContainText('未找到明确的设备序列号');
    await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue('');
  }
  expect(writes).toEqual([]);
  expect(new URL(page.url()).pathname).toBe('/staff/');
});

test('denied camera access keeps manual entry usable and closing clears serial input', async ({ page }) => {
  await fixture(page);
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('msi');
  await dialog.getByRole('button', { name: '扫描机身条码 / 二维码' }).click();
  await dialog.getByRole('button', { name: '开启摄像头', exact: true }).click();
  await expect(dialog).toContainText('摄像头未能开启');
  await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('TEST1234');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await openLookup(page);
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue('');
});

test('hidden staff routes release the warranty camera and returning does not duplicate camera listeners', async ({ page }) => {
  await fixture(page, { camera: 'running' });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('asus');
  await dialog.getByRole('button', { name: '扫描机身条码 / 二维码' }).click();
  await dialog.getByRole('button', { name: '开启摄像头', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.warrantyStreams.length)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('staff-request-navigation', { detail: 'settings' })));
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.warrantyStreams[0].getTracks()[0].readyState)).toBe('ended');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('staff-request-navigation', { detail: 'scene:repair' })));
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => window.warrantyCameraRequests)).toBe(1);
  await dialog.getByRole('button', { name: '开启摄像头', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.warrantyStreams.length)).toBe(2);
  await dialog.getByRole('button', { name: '切换镜头', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.warrantyStreams.length)).toBe(3);
  expect(await page.evaluate(() => window.warrantyCameraRequests)).toBe(3);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  expect(await page.evaluate(() => window.warrantyStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
});

for (const camera of ['running', 'pending']) test(`warranty camera tracks are released after closing with ${camera} permission`, async ({ page }) => {
  await fixture(page, { camera });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('asus');
  await dialog.getByRole('button', { name: '扫描机身条码 / 二维码' }).click();
  await dialog.getByRole('button', { name: '开启摄像头', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.warrantyCameraRequests)).toBe(1);
  if (camera === 'running') await expect.poll(() => page.evaluate(() => window.warrantyStreams.length)).toBe(1);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  if (camera === 'pending') await page.evaluate(() => window.allowWarrantyCamera());
  await expect.poll(() => page.evaluate(() => window.warrantyStreams[0]?.getTracks()[0].readyState)).toBe('ended');
  await expect(page.locator('video')).toHaveCount(0);
});

test('not-found, timeout and unsupported brands cannot be adopted as expired', async ({ page }) => {
  await fixture(page);
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('lenovo');
  await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('TEST1234');
  await page.route('**/api/warranty/query', route => route.fulfill({ json: { brand: 'lenovo', serial: 'TEST1234', outcome: 'not_found', status: 'unknown', checkedAt: '2026-10-26T08:00:00Z', source: { name: '联想中国官方服务' }, services: [] } }));
  await dialog.getByRole('button', { name: '查询原厂保修', exact: true }).click();
  await expect(dialog).toContainText('查无资料不代表已过保');
  await expect(dialog.getByRole('button', { name: '采用此保修情况' })).toHaveCount(0);
  await page.route('**/api/warranty/query', route => route.fulfill({ status: 502, json: { error: '原厂查询超时，请重试。', code: 'WARRANTY_TIMEOUT' } }));
  await dialog.getByRole('button', { name: '查询原厂保修', exact: true }).click();
  await expect(dialog).toContainText('原厂查询超时');
  await expect(dialog.getByRole('region', { name: '原厂查询结果' })).toHaveCount(0);
  await dialog.getByLabel('设备品牌').selectOption('asus');
  await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('TEST1234');
  await expect(dialog).toContainText('ASUS 消费者保修查询');
  await expect(dialog.getByRole('button', { name: '查询原厂保修', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '复制序列号并前往官网', exact: true })).toBeEnabled();
});

test('changing the serial cancels an old request and clears its result', async ({ page }) => {
  await fixture(page);
  let release;
  await page.route('**/api/warranty/query', async route => {
    await new Promise(resolve => { release = resolve; });
    await route.fulfill({ json: { serial: 'OLD1234', outcome: 'found', status: 'expired', checkedAt: '2026-10-26T08:00:00Z', source: { name: '联想中国官方服务' }, services: [] } }).catch(() => {});
  });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('lenovo');
  const input = dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true });
  await input.fill('OLD1234');
  await dialog.getByRole('button', { name: '查询原厂保修', exact: true }).click();
  await expect.poll(() => typeof release).toBe('function');
  await input.fill('NEW1234');
  release();
  await expect(dialog.getByRole('region', { name: '原厂查询结果' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '查询原厂保修', exact: true })).toBeEnabled();
});

const captchaImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
test('Acer waits for a human CAPTCHA answer then shows the factory response on this page', async ({ page }) => {
  await fixture(page, { captcha: true });
  let challengeCount = 0;
  const submissions = [];
  await page.route('**/api/warranty/challenge', route => {
    challengeCount++;
    return route.fulfill({ json: { brand: 'acer', serial: route.request().postDataJSON().serial, image: captchaImage, token: 'mock-encrypted-challenge-' + challengeCount, expiresAt: new Date(Date.now() + 180000).toISOString() } });
  });
  await page.route('**/api/warranty/query', route => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: { brand: 'acer', serial: 'TEST1234', outcome: 'found', status: 'unknown', checkedAt: new Date().toISOString(), source: { name: 'Acer 中国官方服务' }, note: '模拟原厂回包，仅供流程测试。', services: [{ name: '标准保修期：2025-01-01 至 2027-01-01', category: 'Acer 原厂保修信息', start: '', end: '', status: 'unknown' }] } });
  });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('acer');
  await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('TEST1234');
  await dialog.getByRole('button', { name: '获取原厂验证码', exact: true }).click();
  await expect(dialog.getByRole('group', { name: '原厂人工验证' })).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'Acer 原厂验证码，请人工阅读' })).toHaveAttribute('src', captchaImage);
  await expect(dialog.getByRole('button', { name: '提交验证码并查询' })).toBeDisabled();
  expect(submissions).toHaveLength(0);
  await dialog.getByRole('button', { name: '重新获取验证码', exact: true }).click();
  await expect(dialog.getByLabel('原厂验证码', { exact: true })).toHaveValue('');
  expect(challengeCount).toBe(2);
  await dialog.getByLabel('原厂验证码', { exact: true }).fill('HUMAN');
  await dialog.getByRole('button', { name: '提交验证码并查询', exact: true }).click();
  await expect(dialog.getByRole('region', { name: '原厂查询结果' })).toContainText('2027-01-01');
  await expect(dialog.getByRole('group', { name: '原厂人工验证' })).toHaveCount(0);
  expect(submissions).toEqual([{ brand: 'acer', serial: 'TEST1234', captchaToken: 'mock-encrypted-challenge-2', captchaAnswer: 'HUMAN' }]);
  expect(await page.evaluate(() => Object.values(sessionStorage).join(' '))).not.toContain('mock-encrypted-challenge');
});

test('changing serial or brand discards the previous human challenge and an invalid answer offers a new one', async ({ page }) => {
  await fixture(page, { captcha: true });
  await page.route('**/api/warranty/challenge', route => route.fulfill({ json: { brand: 'acer', serial: route.request().postDataJSON().serial, image: captchaImage, token: 'mock-token', expiresAt: new Date(Date.now() + 180000).toISOString() } }));
  await page.route('**/api/warranty/query', route => route.fulfill({ status: 422, json: { code: 'WARRANTY_CAPTCHA_INVALID', error: 'Acer 验证码不正确或已失效，请获取新验证码。' } }));
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('acer');
  const serial = dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true });
  await serial.fill('TEST1234');
  await dialog.getByRole('button', { name: '获取原厂验证码', exact: true }).click();
  await dialog.getByLabel('原厂验证码', { exact: true }).fill('HUMAN');
  await dialog.getByRole('button', { name: '提交验证码并查询', exact: true }).click();
  await expect(dialog).toContainText('验证码不正确或已失效');
  await expect(dialog.getByRole('group', { name: '原厂人工验证' })).toHaveCount(0);
  await dialog.getByRole('button', { name: '获取原厂验证码', exact: true }).click();
  await expect(dialog.getByRole('group', { name: '原厂人工验证' })).toBeVisible();
  await serial.fill('OTHER1234');
  await expect(dialog.getByRole('group', { name: '原厂人工验证' })).toHaveCount(0);
  await dialog.getByRole('button', { name: '获取原厂验证码', exact: true }).click();
  await expect(dialog.getByRole('group', { name: '原厂人工验证' })).toBeVisible();
  await dialog.getByLabel('设备品牌').selectOption('lenovo');
  await expect(dialog.getByRole('group', { name: '原厂人工验证' })).toHaveCount(0);
});

test('Huawei isolates its manual widget and ignores forged messages before querying the factory', async ({ page }) => {
  await fixture(page, { huawei: true });
  const origin = process.env.WARRANTY_CAPTCHA_ORIGIN;
  expect(origin).toBeTruthy();
  await page.route(origin + '/index.html', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><meta charset="utf-8"><body><p>模拟原厂滑块，只用于自动化测试</p><button id="wrong">模拟错误会话</button><button id="human">模拟人工完成</button><script>
    let packet;window.addEventListener('message',event=>{if(event.source===parent&&event.data.kind==='start'){packet=event.data;document.body.dataset.packet=JSON.stringify(packet);}});
    parent.postMessage({channel:'pioneer-warranty',kind:'ready'},'*');
    document.getElementById('wrong').onclick=()=>parent.postMessage({channel:'pioneer-warranty',kind:'proof',nonce:'wrong',proof:'mock-human-proof'},'*');
    document.getElementById('human').onclick=()=>parent.postMessage({channel:'pioneer-warranty',kind:'proof',nonce:packet.config.nonce,proof:'mock-human-proof'},'*');
  </script></body></html>` }));
  const requests = [];
  await page.route('**/api/warranty/challenge', route => route.fulfill({ json: { brand: 'huawei', serial: 'TEST12345678', token: 'mock-private-encrypted-session', expiresAt: new Date(Date.now() + 180000).toISOString(), widget: { origin, type: 2, lang: 'zh-CN', challenge: 'mock-challenge', hcg: 'mock-hcg', hct: 'mock-hct', nonce: 'mock-nonce' } } }));
  await page.route('**/api/warranty/query', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { brand: 'huawei', serial: 'TEST12345678', outcome: 'found', status: 'unknown', services: [], source: { name: '华为中国官方服务' }, checkedAt: new Date().toISOString(), note: '模拟回包，未验证真实设备。' } });
  });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('huawei');
  await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('TEST12345678');
  await dialog.getByRole('button', { name: '获取原厂验证码', exact: true }).click();
  const widget = page.frameLocator('iframe[title="华为原厂人工滑块验证"]');
  await expect(widget.getByRole('button', { name: '模拟人工完成' })).toBeVisible();
  await expect.poll(() => widget.locator('body').getAttribute('data-packet')).toContain('mock-challenge');
  const packet = await widget.locator('body').getAttribute('data-packet');
  expect(packet).not.toContain('TEST12345678');
  expect(packet).not.toContain('mock-private-encrypted-session');
  await page.evaluate(() => window.postMessage({ channel: 'pioneer-warranty', kind: 'proof', nonce: 'mock-nonce', proof: 'mock-forged-proof' }, '*'));
  await widget.getByRole('button', { name: '模拟错误会话' }).click();
  expect(requests).toHaveLength(0);
  await widget.getByRole('button', { name: '模拟人工完成' }).click();
  await expect(dialog.getByRole('region', { name: '原厂查询结果' })).toContainText('华为中国官方服务');
  expect(requests).toEqual([{ brand: 'huawei', serial: 'TEST12345678', captchaToken: 'mock-private-encrypted-session', captchaProof: 'mock-human-proof' }]);
  await expect(dialog.locator('iframe')).toHaveCount(0);
});

test('the real isolated verifier loads its SDK and bridge under both CSP policies', async ({ page, request }) => {
  await fixture(page, { huawei: true });
  const origin = process.env.WARRANTY_CAPTCHA_ORIGIN;
  const violations = [];
  page.on('console', message => { if (/Content Security Policy|frame-ancestors/i.test(message.text())) violations.push(message.text()); });
  const response = await request.get(origin + '/index.html');
  expect(response.headers()['content-security-policy']).toContain('frame-ancestors ' + new URL(page.url()).origin);
  expect(response.headers()['x-frame-options']).toBeUndefined();
  await page.route('https://contentcenter-drcn.dbankcdn.cn/**/captcha.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.initHuaweiCaptcha = (options, ready, success) => {
      setTimeout(ready, 0);
      return { popupShow() {
        const button = document.createElement('button'); button.textContent = '模拟人工完成';
        button.onclick = () => success({ resultCode: 0, validate: 'mock-human-proof' });
        document.body.append(button);
      }, destroy() {} };
    };` }));
  await page.route('**/api/warranty/challenge', route => route.fulfill({ json: { brand: 'huawei', serial: 'TEST12345678', token: 'mock-session', expiresAt: new Date(Date.now() + 180000).toISOString(), widget: { origin, type: 2, lang: 'zh-CN', challenge: 'mock-challenge', hcg: 'mock-hcg', hct: 'mock-hct', nonce: 'mock-nonce' } } }));
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('huawei');
  await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('TEST12345678');
  await dialog.getByRole('button', { name: '获取原厂验证码', exact: true }).click();
  const widget = page.frameLocator('iframe[title="华为原厂人工滑块验证"]');
  await widget.getByRole('button', { name: '模拟人工完成' }).click();
  await expect(dialog.getByRole('region', { name: '原厂查询结果' })).toBeVisible();
  expect(violations).toEqual([]);
});

test('missing or mismatched runtime origins explicitly disable Huawei instead of creating a blocked iframe', async ({ page }) => {
  await fixture(page);
  for (const captchaOrigin of ['', 'https://wrong-verifier.example.org', new URL(page.url()).origin]) {
    await page.route('**/api/warranty/providers', route => route.fulfill({ json: { providers: [{ id: 'huawei', available: true, mode: 'captcha', captchaOrigin, message: '模拟运行期配置' }] } }));
    const dialog = await openLookup(page);
    await dialog.getByLabel('设备品牌').selectOption('huawei');
    await expect(dialog).toContainText('华为验证配置错误，请联系维护人员。');
    await expect(dialog.getByRole('button', { name: '获取原厂验证码', exact: true })).toHaveCount(0);
    await expect(dialog.locator('iframe')).toHaveCount(0);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  }
});

test('official navigation reserves its tab before an asynchronous copy and preserves unuploaded repair photos', async ({ page, context }) => {
  const item = { id: 'reserve020261015-48', revision: 1, brand: '惠普', deviceModel: 'Test laptop', campus: '南湖', date: '2026-10-15', timeSlot: '19:00–19:30', status: 'booked', canStart: true };
  await fixture(page, { item });
  await page.getByRole('button', { name: '核对设备并接手', exact: true }).click();
  const repair = page.getByRole('dialog', { name: '现场核验', exact: true, includeHidden: true });
  await repair.getByLabel('核验说明（选填）').fill('待核对原厂保修，保留照片');
  await repair.getByLabel('设备正面照片', { exact: true }).setInputFiles({ name: 'unuploaded-front.png', mimeType: 'image/png', buffer: Buffer.from(captchaImage.split(',')[1], 'base64') });
  const preview = repair.getByRole('img', { name: '设备正面照片', exact: true });
  await expect(preview).toHaveAttribute('src', /^blob:/);
  const photoUrl = await preview.getAttribute('src');
  const originalUrl = page.url(), writes = [];
  page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => new Promise(resolve => { window.finishWarrantyCopy = resolve; }) } }));
  await repair.getByRole('button', { name: '查询保修', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '查询设备保修', exact: true });
  await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('TEST12345678');
  const destination = 'https://support.hp.com/cn-zh/check-warranty';
  await context.route(destination, route => route.fulfill({ contentType: 'text/html', body: '<h1>Official fixture</h1>' }));
  const popup = page.waitForEvent('popup');
  await dialog.getByRole('button', { name: '复制序列号并前往官网', exact: true }).click();
  const official = await popup;
  expect(official.url()).toBe('about:blank');
  expect(await official.evaluate(() => window.opener)).toBeNull();
  await page.evaluate(() => window.finishWarrantyCopy());
  await expect(official).toHaveURL(destination);
  await official.close();
  await expect(page).toHaveURL(originalUrl);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(preview).toHaveAttribute('src', photoUrl);
  await expect(repair.getByLabel('核验说明（选填）')).toHaveValue('待核对原厂保修，保留照片');
  expect(await repair.getByLabel('设备正面照片', { exact: true }).evaluate(input => input.files[0].name)).toBe('unuploaded-front.png');
  expect(writes).toEqual([]);
});

test('a blocked new tab offers a direct safe link without navigating the workbench', async ({ page, context }) => {
  await fixture(page);
  await page.evaluate(() => {
    window.open = () => null;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } });
  });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('hp');
  await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('TEST12345678');
  await dialog.getByRole('button', { name: '复制序列号并前往官网', exact: true }).click();
  await expect(dialog).toContainText('浏览器拦截了新标签页');
  const link = dialog.getByRole('link', { name: '在新标签页打开官网 ↗' });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
  await context.route('https://support.hp.com/cn-zh/check-warranty', route => route.fulfill({ contentType: 'text/html', body: '<h1>Official fixture</h1>' }));
  const popup = page.waitForEvent('popup');
  await link.click();
  const official = await popup;
  await expect(official).toHaveURL('https://support.hp.com/cn-zh/check-warranty');
  expect(new URL(page.url()).pathname).toBe('/staff/');
  await expect(dialog).toBeVisible();
  await official.close();
});

test('real local OCR reads a device label and opens the fixed official page in a separate tab', async ({ page, context }) => {
  test.setTimeout(90000);
  await fixture(page);
  const copies = [];
  await page.exposeFunction('recordWarrantyCopy', value => copies.push(value));
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: value => window.recordWarrantyCopy(value) } }));
  const writes = []; page.on('request', req => { if (req.method() === 'POST') writes.push(req.url()); });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('asus');
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 400;
    const context = canvas.getContext('2d'); context.fillStyle = 'white'; context.fillRect(0,0,1600,400); context.fillStyle = 'black'; context.font = 'bold 70px monospace'; context.fillText('S/N: ABC23456789', 70, 220);
    return Array.from(new Uint8Array(await (await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))).arrayBuffer()));
  });
  await dialog.getByLabel('选择序列号文字照片', { exact: true }).setInputFiles({ name: 'synthetic-device-label.png', mimeType: 'image/png', buffer: Buffer.from(bytes) });
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue('ABC23456789', { timeout: 60000 });
  await expect(dialog).toContainText('已填入候选序列号');
  expect(writes).toEqual([]);
  const originalUrl = page.url();
  await context.route('https://www.asus.com.cn/support/warranty-status-inquiry/?sn=ABC23456789', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<meta charset="utf-8"><h1>模拟 ASUS 官方查询页</h1>' }));
  const popup = page.waitForEvent('popup');
  await dialog.getByRole('button', { name: '复制序列号并前往官网', exact: true }).click();
  const official = await popup;
  await expect(official).toHaveURL('https://www.asus.com.cn/support/warranty-status-inquiry/?sn=ABC23456789');
  expect(await official.evaluate(() => window.opener)).toBeNull();
  expect(await official.evaluate(() => document.referrer)).toBe('');
  await expect(page).toHaveURL(originalUrl);
  await expect(dialog).toBeVisible();
  expect(copies).toEqual(['ABC23456789']);
  await official.close();
});

test('a blocked clipboard closes the reserved tab and keeps manual copy before opening the official page', async ({ page, context }) => {
  await fixture(page);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new DOMException('Denied', 'NotAllowedError'); } } }));
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('asus');
  await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('TEST12345678');
  const reserved = page.waitForEvent('popup');
  await dialog.getByRole('button', { name: '复制序列号并前往官网', exact: true }).click();
  await expect.poll(() => context.pages().length).toBe(1);
  expect((await reserved).isClosed()).toBe(true);
  await expect(dialog).toContainText('浏览器未允许复制');
  expect(new URL(page.url()).pathname).toBe('/staff/');
  await expect(dialog.getByRole('button', { name: '已手动复制，前往官网', exact: true })).toBeEnabled();
  expect(await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).evaluate(input => input.value.slice(input.selectionStart, input.selectionEnd))).toBe('TEST12345678');
  const url = 'https://www.asus.com.cn/support/warranty-status-inquiry/?sn=TEST12345678';
  await context.route(url, route => route.fulfill({ contentType: 'text/html', body: '<h1>Official fixture</h1>' }));
  const popup = page.waitForEvent('popup');
  await dialog.getByRole('button', { name: '已手动复制，前往官网', exact: true }).click();
  const official = await popup;
  await expect(official).toHaveURL(url);
  await expect(dialog).toBeVisible();
  await official.close();
});

test('remaining consumer channels copy the serial and keep the workbench while opening their destination', async ({ page, context }) => {
  await fixture(page);
  const copies = [];
  await page.exposeFunction('recordConsumerCopy', value => copies.push(value));
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: value => window.recordConsumerCopy(value) } }));
  // The current document loaded before the init script was added.
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: value => window.recordConsumerCopy(value) } }));
  const destinations = [
    ['hp', 'https://support.hp.com/cn-zh/check-warranty', 'HP 消费者保修查询'],
    ['dell', 'https://www.dell.com/support/home/zh-cn', 'Dell 消费者支持与保修'],
    ['msi', 'https://account.msi.com/zh-Hans/services/warranty-book', 'MSI 消费者保修信息查询'],
    ['apple', 'https://checkcoverage.apple.com/?locale=zh_CN', 'Apple 保障状态查询'],
    ['xiaomi', 'https://www.mi.com/service/aftersale/front', '小米商城消费者售后'],
    ['mechrevo', 'https://www.mechrevo.com/cn/policy', '机械革命服务小程序']
  ];
  for (const [brand, url, title] of destinations) {
    await test.step(brand, async () => {
      const dialog = await openLookup(page);
      await dialog.getByLabel('设备品牌').selectOption(brand);
      await expect(dialog).toContainText(title);
      await expect(dialog).not.toContainText('API 授权');
      await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('TEST12345678');
      await context.route(url, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<meta charset="utf-8"><h1>模拟原厂消费者页面</h1>' }));
      const popup = page.waitForEvent('popup');
      await dialog.getByRole('button', { name: brand === 'mechrevo' ? '复制序列号并查看小程序入口' : '复制序列号并前往官网', exact: true }).click();
      const official = await popup;
      await expect(official).toHaveURL(url);
      expect(copies.at(-1)).toBe('TEST12345678');
      expect(new URL(official.url()).searchParams.toString()).not.toContain('TEST12345678');
      expect(new URL(page.url()).pathname).toBe('/staff/');
      await official.close();
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    });
  }
  expect(copies).toHaveLength(destinations.length);
});

test('WeChat and account channels can copy without leaving the on-screen instructions', async ({ page }) => {
  await fixture(page);
  const copies = [];
  await page.exposeFunction('recordConsumerCopy', value => copies.push(value));
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: value => window.recordConsumerCopy(value) } }));
  const dialog = await openLookup(page);
  for (const brand of ['xiaomi', 'mechrevo']) {
    await dialog.getByLabel('设备品牌').selectOption(brand);
    await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('TEST12345678');
    await dialog.getByRole('button', { name: '只复制序列号，按上方步骤操作', exact: true }).click();
    await expect(dialog).toContainText('序列号已复制');
    expect(new URL(page.url()).pathname).toBe('/staff/');
  }
  expect(copies).toEqual(['TEST12345678', 'TEST12345678']);
});
