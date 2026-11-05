import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { mockStaff, loginStaff } from './support/staff.mjs';

async function fixture(page, { camera = 'denied', captcha = false, huawei = false } = {}) {
  const ocrImage =
    camera === 'ocr-label'
      ? (
          await readFile(new URL('../fixtures/warranty-serial-label.png', import.meta.url))
        ).toString('base64')
      : null;
  await page.addInitScript(
    ({ camera, ocrImage }) => {
      window.warrantyCameraRequests = 0;
      window.warrantyStreams = [];
      navigator.mediaDevices.enumerateDevices = async () =>
        camera === 'single'
          ? [{ kind: 'videoinput', deviceId: 'rear' }]
          : ['multi', 'switch-fail'].includes(camera)
            ? [
                { kind: 'videoinput', deviceId: 'rear' },
                { kind: 'videoinput', deviceId: 'front' }
              ]
            : [];
      navigator.mediaDevices.getUserMedia = async ({ video } = {}) => {
        window.warrantyCameraRequests++;
        if (camera === 'denied') throw new DOMException('Denied', 'NotAllowedError');
        if (camera === 'switch-fail' && video?.deviceId?.exact === 'front')
          throw new DOMException('Camera unavailable', 'NotReadableError');
        if (camera === 'pending')
          await new Promise((resolve) => {
            window.allowWarrantyCamera = resolve;
          });
        if (camera === 'ocr-label') {
          const bytes = Uint8Array.from(atob(ocrImage), (character) => character.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
          const surface = document.createElement('canvas');
          surface.width = 1200;
          surface.height = 700;
          const drawing = surface.getContext('2d');
          drawing.fillStyle = 'white';
          drawing.fillRect(0, 0, surface.width, surface.height);
          drawing.translate(surface.width, 0);
          drawing.scale(-1, 1);
          drawing.drawImage(bitmap, 220, 160, 760, 380);
          bitmap.close();
          const stream = surface.captureStream(1);
          window.warrantyStreams.push(stream);
          return stream;
        }
        if (camera.startsWith('barcode')) {
          const writer = await import('/vendor/zxing-writer.js');
          writer.prepareZXingModule({
            overrides: { locateFile: () => '/vendor/zxing_writer.wasm' }
          });
          const surface = document.createElement('canvas');
          surface.width = camera === 'barcode' ? 256 : camera === 'barcode-tongfang' ? 600 : 1920;
          surface.height = camera === 'barcode' ? 256 : camera === 'barcode-tongfang' ? 600 : 1080;
          const drawing = surface.getContext('2d');
          drawing.fillStyle = '#fff';
          drawing.fillRect(0, 0, surface.width, surface.height);
          const values =
            camera === 'barcode-multiple'
              ? ['https://example.invalid/#other', 'AB0OI12']
              : camera === 'barcode-ambiguous'
                ? ['AB0OI12', 'XYZ98765']
                : camera === 'barcode-invalid'
                  ? ['https://example.invalid/#other']
                  : camera === 'barcode-tongfang'
                    ? ['http://qr.i-tongfang.com:8080/default.aspx?qr=424090A32499430244']
                    : ['AB0OI12'];
          for (const [index, value] of values.entries()) {
            const barcode = await writer.writeBarcode(value, {
              format: 'QRCode',
              scale: 6,
              options: 'ecLevel=M'
            });
            const bitmap = await createImageBitmap(barcode.image);
            if (camera === 'barcode' || camera === 'barcode-tongfang')
              drawing.drawImage(
                bitmap,
                (surface.width - bitmap.width) / 2,
                (surface.height - bitmap.height) / 2
              );
            else if (camera === 'barcode-small') drawing.drawImage(bitmap, 910, 500, 100, 100);
            else drawing.drawImage(bitmap, 200 + index * 650, 300, 240, 240);
            bitmap.close();
          }
          const stream = surface.captureStream(1);
          window.warrantyStreams.push(stream);
          return stream;
        }
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        canvas.getContext('2d').fillRect(0, 0, 64, 64);
        const stream = canvas.captureStream(1);
        if (['front', 'single', 'multi', 'switch-fail'].includes(camera))
          Object.defineProperty(stream.getVideoTracks()[0], 'getSettings', {
            value: () => ({
              facingMode:
                camera === 'front' || video?.deviceId?.exact === 'front' ? 'user' : 'environment',
              deviceId: camera === 'front' ? 'front' : video?.deviceId?.exact || 'rear'
            })
          });
        window.warrantyStreams.push(stream);
        return stream;
      };
    },
    { camera, ocrImage }
  );
  await mockStaff(page, {
    role: 'technician',
    contexts: [{ id: 'repair', label: '维修工作台' }],
    permissions: { 'repair.summary.read': true, 'repair.start': true }
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
  await loginStaff(page);
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
async function imageCode(page, value, format = 'QRCode', mirrored = false) {
  const bytes = await page.evaluate(
    async ({ value, format, mirrored }) => {
      const writer = await import('/vendor/zxing-writer.js');
      writer.prepareZXingModule({ overrides: { locateFile: () => '/vendor/zxing_writer.wasm' } });
      const result = await writer.writeBarcode(value, {
        format,
        scale: 6,
        ...(format === 'QRCode' ? { options: 'ecLevel=M' } : {})
      });
      if (result.error || !result.image)
        throw new Error('Fixture barcode could not be generated: ' + result.error);
      if (!mirrored) return Array.from(new Uint8Array(await result.image.arrayBuffer()));
      const bitmap = await createImageBitmap(result.image);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      context.setTransform(-1, 0, 0, 1, canvas.width, 0);
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    { value, format, mirrored }
  );
  return { name: 'device-label.png', mimeType: 'image/png', buffer: Buffer.from(bytes) };
}

test('the staff shortcut includes ten official entries and fits phone/tablet/desktop screens', async ({
  page
}) => {
  await fixture(page);
  const dialog = await openLookup(page);
  expect(await page.evaluate(() => window.warrantyCameraRequests)).toBe(0);
  await expect(dialog.getByLabel('设备品牌').locator('option')).toHaveCount(11);
  for (const [id, host] of [
    ['asus', 'www.asus.com.cn'],
    ['acer', 'www.acer.com.cn'],
    ['lenovo', 'consumerservice.lenovo.com.cn'],
    ['hp', 'support.hp.com'],
    ['dell', 'www.dell.com'],
    ['msi', 'account.msi.com'],
    ['apple', 'checkcoverage.apple.com'],
    ['xiaomi', 'www.mi.com'],
    ['huawei', 'consumer.huawei.com'],
    ['mechrevo', 'www.mechrevo.com']
  ]) {
    await dialog.getByLabel('设备品牌').selectOption(id);
    await expect(dialog.getByRole('region', { name: '查验步骤' })).toBeVisible();
    const link = dialog.getByRole('link', { name: '打开官方保修入口 ↗' });
    expect(new URL(await link.getAttribute('href')).hostname).toBe(host);
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
  }
  await expect(dialog).toContainText('网页本身不是 SN 查询表');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    const box = await dialog.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: `output/field-workflow/warranty-${width}.png` });
  }
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('button', { name: '查询保修', exact: true })).toBeFocused();
});

test('the camera has one launch, in-place mode switching, and one close control', async ({
  page
}) => {
  await fixture(page, { camera: 'running' });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('asus');
  const launch = dialog.getByRole('button', { name: '打开摄像头识别设备标签' });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const original = await launch.boundingBox();
    await launch.click();
    await expect(dialog.getByLabel('摄像头预览')).toBeVisible();
    await expect(dialog.locator('.field-scanner[data-mode="device"] .field-actions')).toHaveCount(
      0
    );
    expect(await launch.boundingBox()).toEqual(original);
    await dialog
      .getByRole('group', { name: '识别方式' })
      .getByRole('button', { name: 'OCR' })
      .click();
    await expect(dialog.locator('.field-scanner[data-mode="photo"]')).toBeVisible();
    await expect(dialog.getByRole('button', { name: '拍摄识别' })).toBeVisible();
    expect(await launch.boundingBox()).toEqual(original);
    await dialog.getByRole('button', { name: '收起' }).click();
    await expect(dialog.getByLabel('摄像头预览')).toHaveCount(0);
    expect(await launch.boundingBox()).toEqual(original);
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await launch.click();
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByLabel('从相册选择').click();
  expect((await chooser).isMultiple()).toBe(false);
  await dialog.getByRole('button', { name: '收起' }).click();
  await expect(dialog.getByLabel('摄像头预览')).toHaveCount(0);
});


for (const [format, mirrored] of [
  ['QRCode', false],
  ['Code128', false],
  ['Code128', true]
])
  test(`album decoding reads a real ${mirrored ? 'mirrored ' : ''}${format} device label for review before querying`, async ({
    page
  }) => {
    await fixture(page);
    const dialog = await openLookup(page);
    await dialog.getByLabel('设备品牌').selectOption('lenovo');
    await dialog
      .getByLabel('从相册导入设备标签', { exact: true })
      .setInputFiles(await imageCode(page, 'AB0OI12', format, mirrored));
    await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue(
      'AB0OI12'
    );
    await expect(dialog.getByRole('region', { name: '原厂查询结果' })).toContainText('AB0OI12');
    await expect(dialog.locator('video')).toHaveCount(0);
    expect(await page.evaluate(() => window.warrantyCameraRequests)).toBe(0);
  });

test('the top album action stops an open camera after reading a barcode', async ({ page }) => {
  await fixture(page, { camera: 'running' });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('lenovo');
  await openCapture(dialog);
  await expect.poll(() => page.evaluate(() => window.warrantyStreams.length)).toBe(1);
  await dialog
    .getByLabel('从相册导入设备标签', { exact: true })
    .setInputFiles(await imageCode(page, 'AB0OI12'));
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue(
    'AB0OI12'
  );
  await expect(dialog.locator('.warranty-capture')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.warrantyStreams[0].getTracks()[0].readyState))
    .toBe('ended');
});

test('a Mechrevo Tongfang QR extracts its serial from the qr parameter in album and live camera', async ({
  page
}) => {
  await fixture(page, { camera: 'barcode-tongfang' });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('mechrevo');
  const raw = 'http://qr.i-tongfang.com:8080/default.aspx?qr=424090A32499430244';
  await dialog
    .getByLabel('从相册导入设备标签', { exact: true })
    .setInputFiles(await imageCode(page, raw));
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue(
    '424090A32499430244'
  );
  await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('');
  await openCapture(dialog);
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue(
    '424090A32499430244'
  );
});

test('the top album action falls back to OCR and keeps recognized text after closing the camera', async ({
  page
}) => {
  test.setTimeout(90000);
  await fixture(page, { camera: 'running' });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('asus');
  await openCapture(dialog);
  await expect.poll(() => page.evaluate(() => window.warrantyStreams.length)).toBe(1);
  const bytes = await readFile(new URL('../fixtures/warranty-serial-label.png', import.meta.url));
  await dialog.getByLabel('从相册导入设备标签', { exact: true }).setInputFiles({
    name: 'serial-label.png',
    mimeType: 'image/png',
    buffer: bytes
  });
  await expect(dialog.getByRole('button', { name: '采用 ABC23456789' })).toBeVisible({
    timeout: 60000
  });
  await expect(dialog.getByLabel('相册识别结果')).toContainText('ABC23456789');
  await expect(dialog.locator('.warranty-capture')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.warrantyStreams[0].getTracks()[0].readyState))
    .toBe('ended');
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue('');
});

test('an unreadable album image resumes the previously open camera', async ({ page }) => {
  test.setTimeout(90000);
  await fixture(page, { camera: 'running' });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('asus');
  await openCapture(dialog);
  await expect.poll(() => page.evaluate(() => window.warrantyStreams.length)).toBe(1);
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 100;
    canvas.getContext('2d').fillStyle = '#fff';
    canvas.getContext('2d').fillRect(0, 0, 200, 100);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await dialog.getByLabel('从相册导入设备标签', { exact: true }).setInputFiles({
    name: 'blank.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64')
  });
  await expect(dialog).toContainText('未识别到编码或文字', { timeout: 60000 });
  await expect(dialog.getByLabel('摄像头预览')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.warrantyStreams.length)).toBe(2);
  await expect
    .poll(() => page.evaluate(() => window.warrantyStreams[1].getTracks()[0].readyState))
    .toBe('live');
});

test('opening one camera automatically reads a device barcode without choosing a mode', async ({
  page
}) => {
  await fixture(page, { camera: 'barcode' });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('lenovo');
  await openCapture(dialog);
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue(
    'AB0OI12'
  );
  await expect(dialog.getByRole('region', { name: '原厂查询结果' })).toContainText('AB0OI12');
  await expect(dialog.locator('.warranty-capture')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.warrantyStreams[0].getTracks()[0].readyState))
    .toBe('ended');
});

test('device scanning finds the S/N beside an unrelated QR code', async ({ page }) => {
  await fixture(page, { camera: 'barcode-multiple' });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('lenovo');
  await openCapture(dialog);
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue(
    'AB0OI12'
  );
});

test('a mechanical-revolution S/N advances to the existing miniapp copy step', async ({ page }) => {
  await fixture(page, { camera: 'barcode' });
  const writes = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/warranty/query')) writes.push(request.url());
  });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('mechrevo');
  await openCapture(dialog);
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue(
    'AB0OI12'
  );
  await expect(dialog.getByRole('button', { name: '复制序列号，前往微信查询' })).toBeEnabled();
  await expect(dialog).toContainText('已识别并填入序列号');
  expect(writes).toEqual([]);
});

test('device scanning reads a small centered S/N QR in a full HD camera frame', async ({
  page
}) => {
  await fixture(page, { camera: 'barcode-small' });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('lenovo');
  await openCapture(dialog);
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue(
    'AB0OI12'
  );
});

test('an ASUS support QR supplies its path serial without mistaking the model for S/N', async ({
  page
}) => {
  await fixture(page);
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('asus');
  await openCapture(dialog);
  const base64 = await page.evaluate(async () => {
    const writer = await import('/vendor/zxing-writer.js');
    writer.prepareZXingModule({ overrides: { locateFile: () => '/vendor/zxing_writer.wasm' } });
    const code = await writer.writeBarcode('https://qs.asus.com/TEST12345678', {
      format: 'QRCode',
      scale: 6,
      options: 'ecLevel=M'
    });
    const bitmap = await createImageBitmap(code.image);
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 660;
    const drawing = canvas.getContext('2d');
    drawing.fillStyle = '#eeeeee';
    drawing.fillRect(0, 0, canvas.width, canvas.height);
    drawing.drawImage(bitmap, 760, 260, 180, 180);
    bitmap.close();
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await dialog.getByLabel('选择设备标签图片').setInputFiles({
    name: 'asus-label.png',
    mimeType: 'image/png',
    buffer: Buffer.from(base64, 'base64')
  });
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue(
    'TEST12345678'
  );
});

test('device scanning asks which S/N to use when multiple plausible codes are visible', async ({
  page
}) => {
  await fixture(page, { camera: 'barcode-ambiguous' });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('lenovo');
  await openCapture(dialog);
  await expect(dialog.getByRole('button', { name: '采用 AB0OI12' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '采用 XYZ98765' })).toBeVisible();
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: '采用 XYZ98765' }).click();
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue(
    'XYZ98765'
  );
});

test('an unrelated live QR gives feedback without filling the S/N', async ({ page }) => {
  await fixture(page, { camera: 'barcode-invalid' });
  const copies = [];
  await page.exposeFunction('recordScannedText', (value) => copies.push(value));
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (value) => window.recordScannedText(value) }
    })
  );
  await page.setViewportSize({ width: 320, height: 720 });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('lenovo');
  await openCapture(dialog);
  await expect(dialog).toContainText('已扫到二维码，结果见下方');
  await expect(dialog.getByLabel('扫码结果')).toContainText('https://example.invalid/#other');
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(dialog.getByRole('button', { name: '复制扫码内容' })).toBeInViewport({
    ratio: 0.95
  });
  await page.screenshot({ path: 'output/field-workflow/warranty-scan-unmatched-320.png' });
  await dialog.getByRole('button', { name: '复制扫码内容' }).click();
  expect(copies).toEqual(['https://example.invalid/#other']);
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue('');
});

test('mirrored label text is recognized without changing the preview setting', async ({ page }) => {
  test.setTimeout(90000);
  await fixture(page);
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('asus');
  await openOcr(dialog);
  const source = await readFile(new URL('../fixtures/warranty-serial-label.png', import.meta.url));
  const bytes = await page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    context.setTransform(-1, 0, 0, 1, canvas.width, 0);
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, Array.from(source));
  await dialog.getByLabel('选择设备标签照片', { exact: true }).setInputFiles({
    name: 'mirrored-label.png',
    mimeType: 'image/png',
    buffer: Buffer.from(bytes)
  });
  await expect(dialog.getByRole('button', { name: '采用 ABC23456789' })).toBeVisible({
    timeout: 60000
  });
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: '采用 ABC23456789' }).click();
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue(
    'ABC23456789',
    { timeout: 60000 }
  );
});

test('OCR exposes unmatched text for copying without filling an uncertain serial', async ({
  page
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 320, height: 700 });
  await fixture(page);
  const copied = [];
  await page.exposeFunction('recordOcrCopy', (value) => copied.push(value));
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (value) => window.recordOcrCopy(value) }
    })
  );
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('asus');
  await openOcr(dialog);
  const source = await readFile(new URL('../fixtures/warranty-serial-label.png', import.meta.url));
  const base64 = await page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width - 230;
    canvas.height = bitmap.height;
    canvas
      .getContext('2d')
      .drawImage(bitmap, 230, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL('image/png').split(',')[1];
  }, Array.from(source));
  await dialog.getByLabel('选择设备标签照片', { exact: true }).setInputFiles({
    name: 'unlabelled-text.png',
    mimeType: 'image/png',
    buffer: Buffer.from(base64, 'base64')
  });
  await expect(dialog.getByRole('button', { name: '复制识别内容' })).toBeVisible({
    timeout: 60000
  });
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: '复制识别内容' }).click();
  expect(copied[0]).toContain('ABC23456789');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('automatic OCR recognizes a mirrored live label without pressing the shutter', async ({
  page
}) => {
  test.setTimeout(90000);
  await fixture(page, { camera: 'ocr-label' });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('asus');
  await openOcr(dialog);
  await expect(dialog.getByRole('button', { name: '采用 ABC23456789' })).toBeVisible({
    timeout: 60000
  });
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: '采用 ABC23456789' }).click();
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue(
    'ABC23456789',
    { timeout: 60000 }
  );
  await expect(dialog.locator('.warranty-capture')).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.warrantyStreams.every((stream) =>
        stream.getTracks().every((track) => track.readyState === 'ended')
      )
    )
  ).toBe(true);
});

test('scanning a customer credential or URL cannot resolve orders, navigate, or fill a serial', async ({
  page
}) => {
  await fixture(page);
  const writes = [];
  page.on('request', (req) => {
    if (req.method() !== 'GET') writes.push(req.url());
  });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('huawei');
  for (const value of [
    'reserve020261015-47.abc123456789',
    'https://example.invalid/#private-token'
  ]) {
    await dialog
      .getByLabel('从相册导入设备标签', { exact: true })
      .setInputFiles(await imageCode(page, value));
    await expect(dialog).toContainText('扫到编码，但未识别为序列号');
    await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue('');
  }
  expect(writes).toEqual([]);
  expect(new URL(page.url()).pathname).toBe('/staff/');
});

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


test('a single camera cannot be switched away from its working preview', async ({ page }) => {
  await fixture(page, { camera: 'single' });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('asus');
  await openCapture(dialog);
  await expect(dialog.getByRole('button', { name: '切换镜头' })).toBeDisabled();
  expect(await page.evaluate(() => window.warrantyCameraRequests)).toBe(1);
  await expect(dialog.locator('.warranty-ocr video')).toHaveJSProperty('paused', false);
});

test('a failed lens switch restores the previous working camera', async ({ page }) => {
  await fixture(page, { camera: 'switch-fail' });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('asus');
  await openCapture(dialog);
  await expect(dialog.getByRole('button', { name: '切换镜头' })).toBeEnabled();
  await dialog.getByRole('button', { name: '切换镜头' }).click();
  await expect(dialog).toContainText('切换失败，已恢复原镜头。');
  await expect(dialog.locator('.warranty-ocr video')).toHaveJSProperty('paused', false);
  expect(await page.evaluate(() => window.warrantyCameraRequests)).toBe(3);
  await expect
    .poll(() => page.evaluate(() => window.warrantyStreams.at(-1).getTracks()[0].readyState))
    .toBe('live');
});

for (const camera of ['running', 'pending'])
  test(`warranty camera tracks are released after closing with ${camera} permission`, async ({
    page
  }) => {
    await fixture(page, { camera });
    const dialog = await openLookup(page);
    await dialog.getByLabel('设备品牌').selectOption('asus');
    await openCapture(dialog);
    await expect.poll(() => page.evaluate(() => window.warrantyCameraRequests)).toBe(1);
    if (camera === 'running')
      await expect.poll(() => page.evaluate(() => window.warrantyStreams.length)).toBe(1);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    if (camera === 'pending') await page.evaluate(() => window.allowWarrantyCamera());
    await expect
      .poll(() => page.evaluate(() => window.warrantyStreams[0]?.getTracks()[0].readyState))
      .toBe('ended');
    await expect(page.locator('video')).toHaveCount(0);
  });

test('photo OCR opens the camera directly, mirrors the front preview and releases it after capture', async ({
  page
}) => {
  test.setTimeout(90000);
  await fixture(page, { camera: 'front' });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('asus');
  let fileChoosers = 0;
  page.on('filechooser', () => fileChoosers++);
  await openOcr(dialog);
  await expect.poll(() => page.evaluate(() => window.warrantyCameraRequests)).toBe(2);
  await expect(dialog.locator('.warranty-ocr video')).toHaveAttribute('data-mirrored', 'true');
  await expect(dialog.getByRole('button', { name: '镜像预览' })).toHaveCount(0);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: `output/field-workflow/warranty-photo-${width}.png` });
  }
  await dialog.getByRole('button', { name: '拍摄识别', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.warrantyStreams.at(-1).getTracks()[0].readyState))
    .toBe('live');
  await expect(dialog).toContainText('未识别到文字', { timeout: 60000 });
  await dialog.getByRole('button', { name: '收起' }).click();
  await expect
    .poll(() => page.evaluate(() => window.warrantyStreams.at(-1).getTracks()[0].readyState))
    .toBe('ended');
  expect(fileChoosers).toBe(0);
  await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('MANUAL1234');
  await expect(dialog.getByRole('button', { name: '复制序列号并前往官网' })).toBeEnabled();
});

test('leaving recognition restores manual serial entry', async ({ page }) => {
  await fixture(page, { camera: 'running' });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('asus');
  await openOcr(dialog);
  await dialog.getByRole('button', { name: '拍摄识别', exact: true }).click();
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '收起' }).click();
  await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('TEST1234');
  await expect(dialog.getByRole('button', { name: '复制序列号并前往官网' })).toBeEnabled();
});

test('not-found, timeout and unsupported brands cannot be adopted as expired', async ({ page }) => {
  await fixture(page);
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('lenovo');
  await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('TEST1234');
  await page.route('**/api/warranty/query', (route) =>
    route.fulfill({
      json: {
        brand: 'lenovo',
        serial: 'TEST1234',
        outcome: 'not_found',
        status: 'unknown',
        checkedAt: '2026-10-26T08:00:00Z',
        source: { name: '联想中国官方服务' },
        services: []
      }
    })
  );
  await dialog.getByRole('button', { name: '查询原厂保修', exact: true }).click();
  await expect(dialog).toContainText('查无资料不代表已过保');
  await expect(dialog.getByRole('button', { name: '填入此保修情况' })).toHaveCount(0);
  await page.route('**/api/warranty/query', (route) =>
    route.fulfill({
      status: 502,
      json: { error: '原厂查询超时，请重试。', code: 'WARRANTY_TIMEOUT' }
    })
  );
  await dialog.getByRole('button', { name: '查询原厂保修', exact: true }).click();
  await expect(dialog).toContainText('原厂查询超时');
  await expect(dialog.getByRole('region', { name: '原厂查询结果' })).toHaveCount(0);
  await dialog.getByLabel('设备品牌').selectOption('asus');
  await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('TEST1234');
  await expect(dialog).toContainText('ASUS 消费者保修查询');
  await expect(dialog.getByRole('button', { name: '查询原厂保修', exact: true })).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: '复制序列号并前往官网', exact: true })
  ).toBeEnabled();
});

test('changing the serial cancels an old request and clears its result', async ({ page }) => {
  await fixture(page);
  let release;
  await page.route('**/api/warranty/query', async (route) => {
    await new Promise((resolve) => {
      release = resolve;
    });
    await route
      .fulfill({
        json: {
          serial: 'OLD1234',
          outcome: 'found',
          status: 'expired',
          checkedAt: '2026-10-26T08:00:00Z',
          source: { name: '联想中国官方服务' },
          services: []
        }
      })
      .catch(() => {});
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

const captchaImage =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
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

test('changing serial or brand discards the previous human challenge and an invalid answer offers a new one', async ({
  page
}) => {
  await fixture(page, { captcha: true });
  await page.route('**/api/warranty/challenge', (route) =>
    route.fulfill({
      json: {
        brand: 'acer',
        serial: route.request().postDataJSON().serial,
        image: captchaImage,
        token: 'mock-token',
        expiresAt: new Date(Date.now() + 180000).toISOString()
      }
    })
  );
  await page.route('**/api/warranty/query', (route) =>
    route.fulfill({
      status: 422,
      json: {
        code: 'WARRANTY_CAPTCHA_INVALID',
        error: 'Acer 验证码不正确或已失效，请获取新验证码。'
      }
    })
  );
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

test('Huawei isolates its manual widget and ignores forged messages before querying the factory', async ({
  page
}) => {
  await fixture(page, { huawei: true });
  const origin = process.env.WARRANTY_CAPTCHA_ORIGIN;
  expect(origin).toBeTruthy();
  await page.route(origin + '/index.html', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><meta charset="utf-8"><body><p>模拟原厂滑块，只用于自动化测试</p><button id="wrong">模拟错误会话</button><button id="human">模拟人工完成</button><script>
    let packet;window.addEventListener('message',event=>{if(event.source===parent&&event.data.kind==='start'){packet=event.data;document.body.dataset.packet=JSON.stringify(packet);}});
    parent.postMessage({channel:'pioneer-warranty',kind:'ready'},'*');
    document.getElementById('wrong').onclick=()=>parent.postMessage({channel:'pioneer-warranty',kind:'proof',nonce:'wrong',proof:'mock-human-proof'},'*');
    document.getElementById('human').onclick=()=>parent.postMessage({channel:'pioneer-warranty',kind:'proof',nonce:packet.config.nonce,proof:'mock-human-proof'},'*');
  </script></body></html>`
    })
  );
  const requests = [];
  await page.route('**/api/warranty/challenge', (route) =>
    route.fulfill({
      json: {
        brand: 'huawei',
        serial: 'TEST12345678',
        token: 'mock-private-encrypted-session',
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
  await page.route('**/api/warranty/query', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        brand: 'huawei',
        serial: 'TEST12345678',
        outcome: 'found',
        status: 'unknown',
        services: [],
        source: { name: '华为中国官方服务' },
        checkedAt: new Date().toISOString(),
        note: '模拟回包，未验证真实设备。'
      }
    });
  });
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('huawei');
  await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('TEST12345678');
  await dialog.getByRole('button', { name: '获取原厂验证码', exact: true }).click();
  const widget = page.frameLocator('iframe[title="华为原厂人工滑块验证"]');
  await expect(widget.getByRole('button', { name: '模拟人工完成' })).toBeVisible();
  await expect
    .poll(() => widget.locator('body').getAttribute('data-packet'))
    .toContain('mock-challenge');
  const packet = await widget.locator('body').getAttribute('data-packet');
  expect(packet).not.toContain('TEST12345678');
  expect(packet).not.toContain('mock-private-encrypted-session');
  await page.evaluate(() =>
    window.postMessage(
      {
        channel: 'pioneer-warranty',
        kind: 'proof',
        nonce: 'mock-nonce',
        proof: 'mock-forged-proof'
      },
      '*'
    )
  );
  await widget.getByRole('button', { name: '模拟错误会话' }).click();
  expect(requests).toHaveLength(0);
  await widget.getByRole('button', { name: '模拟人工完成' }).click();
  await expect(dialog.getByRole('region', { name: '原厂查询结果' })).toContainText(
    '华为中国官方服务'
  );
  expect(requests).toEqual([
    {
      brand: 'huawei',
      serial: 'TEST12345678',
      captchaToken: 'mock-private-encrypted-session',
      captchaProof: 'mock-human-proof'
    }
  ]);
  await expect(dialog.locator('iframe')).toHaveCount(0);
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
  expect(response.headers()['content-security-policy']).toContain(
    'frame-ancestors ' + new URL(page.url()).origin
  );
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

test('missing or mismatched runtime origins explicitly disable Huawei instead of creating a blocked iframe', async ({
  page
}) => {
  await fixture(page);
  for (const captchaOrigin of [
    '',
    'https://wrong-verifier.example.org',
    new URL(page.url()).origin
  ]) {
    await page.route('**/api/warranty/providers', (route) =>
      route.fulfill({
        json: {
          providers: [
            {
              id: 'huawei',
              available: true,
              mode: 'captcha',
              captchaOrigin,
              message: '模拟运行期配置'
            }
          ]
        }
      })
    );
    const dialog = await openLookup(page);
    await dialog.getByLabel('设备品牌').selectOption('huawei');
    await expect(dialog).toContainText('华为验证配置错误，请联系维护人员。');
    await expect(dialog.getByRole('button', { name: '获取原厂验证码', exact: true })).toHaveCount(
      0
    );
    await expect(dialog.locator('iframe')).toHaveCount(0);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  }
});


test('a blocked new tab offers a direct safe link without navigating the workbench', async ({
  page,
  context
}) => {
  await fixture(page);
  await page.evaluate(() => {
    window.open = () => null;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => {} }
    });
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
  await context.route('https://support.hp.com/cn-zh/check-warranty', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Official fixture</h1>' })
  );
  const popup = page.waitForEvent('popup');
  await link.click();
  const official = await popup;
  await expect(official).toHaveURL('https://support.hp.com/cn-zh/check-warranty');
  expect(new URL(page.url()).pathname).toBe('/staff/');
  await expect(dialog).toBeVisible();
  await official.close();
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

test('a blocked clipboard keeps manual copy on the current page before opening the official page', async ({
  page,
  context
}) => {
  await fixture(page);
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException('Denied', 'NotAllowedError');
        }
      }
    })
  );
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('asus');
  await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('TEST12345678');
  await dialog.getByRole('button', { name: '复制序列号并前往官网', exact: true }).click();
  await expect.poll(() => context.pages().length).toBe(1);
  await expect(dialog).toContainText('浏览器未允许复制');
  expect(new URL(page.url()).pathname).toBe('/staff/');
  await expect(
    dialog.getByRole('button', { name: '手动复制后打开官网', exact: true })
  ).toBeEnabled();
  expect(
    await dialog
      .getByLabel('序列号 / S/N / Service Tag', { exact: true })
      .evaluate((input) => input.value.slice(input.selectionStart, input.selectionEnd))
  ).toBe('TEST12345678');
  const url = 'https://www.asus.com.cn/support/warranty-status-inquiry/?sn=TEST12345678';
  await context.route(url, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Official fixture</h1>' })
  );
  const popup = page.waitForEvent('popup');
  await dialog.getByRole('button', { name: '手动复制后打开官网', exact: true }).click();
  const official = await popup;
  await expect(official).toHaveURL(url);
  await expect(dialog).toBeVisible();
  await official.close();
});

test('remaining consumer channels copy the serial and keep the workbench while opening their destination', async ({
  page,
  context
}) => {
  await fixture(page);
  const copies = [];
  await page.exposeFunction('recordConsumerCopy', (value) => copies.push(value));
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (value) => window.recordConsumerCopy(value) }
    })
  );
  // The current document loaded before the init script was added.
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (value) => window.recordConsumerCopy(value) }
    })
  );
  const destinations = [
    ['hp', 'https://support.hp.com/cn-zh/check-warranty', 'HP 消费者保修查询'],
    ['dell', 'https://www.dell.com/support/home/zh-cn', 'Dell 消费者支持与保修'],
    ['msi', 'https://account.msi.com/zh-Hans/services/warranty-book', 'MSI 消费者保修信息查询'],
    ['apple', 'https://checkcoverage.apple.com/?locale=zh_CN', 'Apple 保障状态查询'],
    ['xiaomi', 'https://www.mi.com/service/aftersale/front', '小米商城消费者售后']
  ];
  for (const [brand, url, title] of destinations) {
    await test.step(brand, async () => {
      const dialog = await openLookup(page);
      await dialog.getByLabel('设备品牌').selectOption(brand);
      await expect(dialog).toContainText(title);
      await expect(dialog).not.toContainText('API 授权');
      await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('TEST12345678');
      await context.route(url, (route) =>
        route.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: '<meta charset="utf-8"><h1>模拟原厂消费者页面</h1>'
        })
      );
      const popup = page.waitForEvent('popup');
      await dialog.getByRole('button', { name: '复制序列号并前往官网', exact: true }).click();
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

test('WeChat channel copies the serial without opening an unrelated webpage', async ({ page }) => {
  await fixture(page);
  const copies = [];
  await page.exposeFunction('recordConsumerCopy', (value) => copies.push(value));
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (value) => window.recordConsumerCopy(value) }
    })
  );
  const dialog = await openLookup(page);
  await dialog.getByLabel('设备品牌').selectOption('mechrevo');
  await dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true }).fill('TEST12345678');
  await dialog.getByRole('button', { name: '复制序列号，前往微信查询', exact: true }).click();
  await expect(dialog).toContainText('序列号已复制');
  expect(new URL(page.url()).pathname).toBe('/staff/');
  expect(copies).toEqual(['TEST12345678']);
});
