import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');

async function harness(page, { intake = false } = {}) {
  const staff = await readFile('dist/staff/index.html', 'utf8');
  const modal = staff.slice(staff.indexOf('  <div class="modal-backdrop" id="intake-modal"'), staff.indexOf('  <div class="modal-backdrop" id="detail-modal"'));
  await page.route('**/__photo-test', route => route.fulfill({
    contentType: 'text/html',
    body: `<html><head><meta charset="utf-8"><link rel="stylesheet" href="/shared/styles.css"></head><body>${modal}<div id="toast"></div><script src="/assets/vendor/load-image.all.min.js"></script></body></html>`
  }));
  await page.goto('/__photo-test');
  await page.waitForFunction(() => typeof window.loadImage === 'function' && typeof window.loadImage.orientation === 'boolean');
  if (intake) await page.evaluate(async () => {
    const { initIntake } = await import('/staff/intake.js');
    window.photoStarts = [];
    window.photoIntake = initIntake(async (item, photos) => {
      if (window.photoStartFailures > 0) { window.photoStartFailures--; throw new Error('模拟签到失败'); }
      window.photoStarts.push({ item, photos });
    });
    window.photoIntake.open({ id: 'photo-test', faultType: '蓝屏' });
  });
}

// EXIF APP1 segment with one Orientation entry in a big-endian TIFF IFD.
function exifJpeg(bytes, orientation) {
  const segment = Buffer.from('ffe100224578696600004d4d002a00000008000101120003000000010001000000000000', 'hex');
  segment.writeUInt16BE(orientation, 28);
  return Buffer.concat([bytes.subarray(0, 2), segment, bytes.subarray(2)]).toString('base64');
}

test('all eight EXIF orientations produce upright JPEG pixels without a second rotation', async ({ page }) => {
  await harness(page);
  const base = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 40;
    const ctx = canvas.getContext('2d');
    for (const [index, color] of ['#ff0000', '#00ff00', '#0000ff', '#ffff00'].entries()) {
      ctx.fillStyle = color; ctx.fillRect(index % 2 * 40, Math.floor(index / 2) * 20, 40, 20);
    }
    return canvas.toDataURL('image/jpeg', 1).split(',')[1];
  });
  const corners = [[0, 1, 2, 3], [1, 0, 3, 2], [3, 2, 1, 0], [2, 3, 0, 1], [0, 2, 1, 3], [2, 0, 3, 1], [3, 1, 2, 0], [1, 3, 0, 2]];
  for (let orientation = 1; orientation <= 8; orientation++) {
    const result = await page.evaluate(async base64 => {
      const { compressImage } = await import('/shared/image-compress.js');
      const file = new File([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], 'camera.jpg', { type: 'image/jpeg' });
      const result = await compressImage(file);
      const url = URL.createObjectURL(result.file), image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const palette = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
      const pixels = [[.25, .25], [.75, .25], [.25, .75], [.75, .75]].map(([x, y]) => {
        const rgb = ctx.getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1).data;
        const distances = palette.map(color => color.reduce((sum, channel, index) => sum + (channel - rgb[index]) ** 2, 0));
        return distances.indexOf(Math.min(...distances));
      });
      URL.revokeObjectURL(url);
      return { width: image.width, height: image.height, pixels, warning: result.warning };
    }, exifJpeg(Buffer.from(base, 'base64'), orientation));
    expect(result.warning).toBe('');
    expect([result.width, result.height]).toEqual(orientation >= 5 ? [40, 80] : [80, 40]);
    expect(result.pixels, `EXIF ${orientation}`).toEqual(corners[orientation - 1]);
  }
});

test('large camera photos shrink below 2 MB with a longest side of at most 2560 px', async ({ page }) => {
  await harness(page);
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 3300; canvas.height = 2200;
    const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(canvas.width, canvas.height);
    let seed = 1234;
    for (let i = 0; i < pixels.data.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels.data[i + channel] = seed >>> 24; }
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const original = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 1));
    const file = new File([original], 'camera.jpg', { type: 'image/jpeg' });
    const stages = [];
    const { compressImage } = await import('/shared/image-compress.js');
    const result = await compressImage(file, { onProgress: stage => stages.push(stage) });
    const url = URL.createObjectURL(result.file), image = new Image();
    await new Promise(resolve => { image.onload = resolve; image.src = url; });
    URL.revokeObjectURL(url);
    return { originalSize: file.size, size: result.file.size, width: image.width, height: image.height, warning: result.warning, stages };
  });
  expect(result.originalSize).toBeGreaterThan(2 * 1024 * 1024);
  expect(result.size).toBeLessThanOrEqual(2 * 1024 * 1024);
  expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(2560);
  expect(result.width / result.height).toBeCloseTo(1.5, 2);
  expect(result.warning).toBe('');
  expect(result.stages.at(-1).value).toBe(100);
  expect(result.stages.some(stage => stage.label.includes('第 2 次'))).toBe(true);
});

test('missing MIME, absent bitmap/toBlob/File APIs and transparent PNGs are handled', async ({ page }) => {
  await harness(page);
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 4000; canvas.height = 1000;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 2000, 1000);
    const original = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const file = new File([original], 'camera', { type: '' });
    window.createImageBitmap = undefined;
    Blob.prototype.arrayBuffer = undefined;
    HTMLCanvasElement.prototype.toBlob = undefined;
    window.File = function () { throw new Error('File constructor unsupported'); };
    const { compressImage } = await import('/shared/image-compress.js');
    const result = await compressImage(file);
    const url = URL.createObjectURL(result.file), image = new Image();
    await new Promise(resolve => { image.onload = resolve; image.src = url; });
    const preview = document.createElement('canvas'); preview.width = image.width; preview.height = image.height;
    const previewCtx = preview.getContext('2d'); previewCtx.drawImage(image, 0, 0);
    const white = [...previewCtx.getImageData(image.width - 10, 10, 1, 1).data];
    URL.revokeObjectURL(url);
    return { name: result.file.name, type: result.file.type, width: image.width, height: image.height, white, warning: result.warning };
  });
  expect(result).toEqual({ name: 'camera.jpg', type: 'image/jpeg', width: 2560, height: 640, white: [255, 255, 255, 255], warning: '' });
});

test('the size target stays soft and never inflates small images or needlessly reduces quality', async ({ page }) => {
  await harness(page);
  const results = await page.evaluate(async base64 => {
    const { compressImage } = await import('/shared/image-compress.js');
    const file = new File([Uint8Array.from(atob(base64), char => char.charCodeAt(0)), new Uint8Array(3 * 1024 * 1024)], 'camera.png', { type: 'image/png' });
    const originalToBlob = HTMLCanvasElement.prototype.toBlob, outcomes = [];
    try {
      for (const sizes of [[.6], [1.7, 1.2], [1.7, .8], [1.7, 1.6]]) {
        const qualities = []; let call = 0;
        HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
          qualities.push(quality); callback(new Blob([new Uint8Array(Math.round(sizes[call++] * 1024 * 1024))], { type }));
        };
        const result = await compressImage(file);
        outcomes.push({ size: result.file.size / 1024 / 1024, qualities, warning: result.warning });
      }
    } finally { HTMLCanvasElement.prototype.toBlob = originalToBlob; }
    return outcomes;
  }, png.toString('base64'));
  for (const [index, size] of [.6, 1.2, 1.7, 1.7].entries()) {
    expect(results[index].size).toBeCloseTo(size, 5);
    expect(results[index].qualities).toEqual(index === 0 ? [.85] : [.85, .8]);
    expect(results[index].warning).toBe('');
  }
});

test('compression failures allow only supported originals below the hard limit; HEIC never falls back', async ({ page }) => {
  await harness(page);
  const result = await page.evaluate(async base64 => {
    const { compressImage } = await import('/shared/image-compress.js');
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    HTMLCanvasElement.prototype.toBlob = function (callback) { callback(null); };
    const small = await compressImage(new File([bytes], 'camera.png', { type: '' }));
    const errors = [];
    for (const file of [
      new File([bytes, new Uint8Array(2 * 1024 * 1024)], 'big.png', { type: 'image/png' }),
      new File(['\x00\x00\x00\x18ftypheic\x00\x00\x00\x00heic'], 'camera.heic', { type: '' }),
      new File(['not an image'], 'photo.png', { type: 'image/png' }),
    ]) {
      try { await compressImage(file); errors.push('accepted'); } catch (error) { errors.push(error.message); }
    }
    return { type: small.file.type, size: small.file.size, warning: small.warning, errors };
  }, png.toString('base64'));
  expect(result.type).toBe('image/png'); expect(result.size).toBe(png.length);
  expect(result.warning).toContain('压缩失败'); expect(result.warning).toContain('将上传原图');
  expect(result.errors[0]).toContain('原图超过 2 MB');
  expect(result.errors[1]).toContain('HEIC/HEIF'); expect(result.errors[1]).toContain('转为 JPG');
  expect(result.errors[2]).toContain('照片格式不支持');
});

test('replacing a photo after a partial upload clears its old attachment ID and reuses the unchanged side', async ({ page }) => {
  const uploads = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await harness(page, { intake: true });
  let failBack = true;
  await page.route('**/api/appointments/photo-test/attachments', async route => {
    const body = route.request().postDataJSON(); uploads.push(body);
    if (body.purpose === 'intake_back' && failBack) {
      failBack = false; await route.fulfill({ status: 500, json: { error: '模拟上传失败' } });
    } else await route.fulfill({ status: 201, json: { id: body.filename, size: png.length } });
  });
  const select = (side, name) => page.locator('#intake-' + side).setInputFiles({ name, mimeType: '', buffer: png });
  await select('front', 'old-front.png');
  await expect(page.locator('#intake-front-meta')).toContainText('已上传');
  await select('back', 'back.png');
  await expect(page.locator('#intake-front-progress')).toHaveJSProperty('value', 100);
  await expect(page.locator('#intake-front-preview')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('模拟上传失败');
  await expect(page.locator('#intake-back-meta')).toContainText('上传失败');
  await expect(page.locator('#intake-back-preview')).toBeVisible();
  expect(await page.evaluate(() => window.photoStarts)).toEqual([]);
  await select('front', 'new-front.png');
  await page.locator('#confirm-intake').click();
  await expect(page.locator('#intake-modal')).toBeHidden();
  expect(await page.evaluate(() => window.photoStarts[0].photos)).toEqual({ frontPhotoId: 'new-front.png', backPhotoId: 'back.png' });
  expect(uploads.map(body => [body.filename, body.mimeType]).sort()).toEqual([
    ['old-front.png', 'image/png'], ['back.png', 'image/png'], ['new-front.png', 'image/png'], ['back.png', 'image/png']
  ].sort());
  expect(errors).toEqual([]);

  // Both photos upload, but starting fails. Replacing only the back must
  // upload that photo again and retain the unchanged front's attachment ID.
  await page.evaluate(() => {
    window.photoIntake.open({ id: 'photo-test' });
    window.photoStartFailures = 1;
  });
  await select('front', 'front2.png'); await select('back', 'back2.png');
  await page.locator('#confirm-intake').click();
  await expect(page.locator('#toast')).toContainText('模拟签到失败');
  await select('back', 'new-back2.png');
  await page.locator('#confirm-intake').click();
  await expect(page.locator('#intake-modal')).toBeHidden();
  expect(await page.evaluate(() => window.photoStarts[1].photos)).toEqual({ frontPhotoId: 'front2.png', backPhotoId: 'new-back2.png' });
  expect(uploads.slice(4).map(body => body.filename).sort()).toEqual(['front2.png', 'back2.png', 'new-back2.png'].sort());
});

test('stale compression results cannot replace the latest preview or resurrect a closed intake', async ({ page }) => {
  await harness(page, { intake: true });
  const uploads = [];
  await page.route('**/api/appointments/photo-test/attachments', route => {
    const body = route.request().postDataJSON(); uploads.push(body);
    return route.fulfill({ status: 201, json: { id: body.filename } });
  });
  await page.evaluate(() => {
    const original = window.loadImage;
    window.loadImage = function (file, callback, options) {
      return original(file, (image, data) => {
        if (file.name === 'old.png') window.releaseOldPhoto = () => callback(image, data);
        else callback(image, data);
      }, options);
    };
    window.loadImage.scale = original.scale;
  });
  await page.locator('#intake-front').setInputFiles({ name: 'old.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => typeof window.releaseOldPhoto === 'function');
  await page.locator('#intake-front').setInputFiles({ name: 'latest.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('#intake-front-meta')).toContainText('已上传');
  const url = await page.locator('#intake-front-preview').getAttribute('src');
  await page.evaluate(() => window.releaseOldPhoto());
  await expect(page.locator('#intake-front-preview')).toHaveAttribute('src', url);
  await page.evaluate(() => { delete window.releaseOldPhoto; });
  await page.locator('#intake-front').setInputFiles({ name: 'old.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => typeof window.releaseOldPhoto === 'function');
  await page.locator('#cancel-intake').click();
  await page.evaluate(() => window.releaseOldPhoto());
  await expect(page.locator('#intake-front-preview')).toBeHidden();
  await expect(page.locator('#intake-front-preview')).not.toHaveAttribute('src');
  await expect(page.locator('#intake-front-meta')).toHaveText('');
  expect(uploads.map(file => file.filename)).toEqual(['latest.png']);
});

async function scanHarness(page) {
  const item = { id: 'photo-test', status: 'booked', revision: 0, campus: '南湖', date: '2026-10-14', timeSlot: '19:00–19:30', brand: '联想', deviceModel: 'ThinkPad', deviceType: '笔记本电脑', faultType: '蓝屏', source: 'booking' };
  const user = { account: 'photo-staff', name: '照片测试员', role: 'technician', authorizedCampuses: ['南湖'], token: 'photo-session' };
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => { throw new DOMException('Denied', 'NotAllowedError'); } });
  });
  await page.route('**/api/auth/login', route => route.fulfill({ json: user }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: user }));
  await page.route('**/api/scan/config', route => route.fulfill({ json: { enabled: true } }));
  await page.route('**/api/scan/current*', route => route.fulfill({ json: { items: [], pending: item } }));
  await page.route('**/api/scan/resolve', route => route.fulfill({ json: item }));
  const uploads = [], starts = [], controls = { failBack: false, failStart: false };
  await page.route('**/api/appointments/photo-test/attachments', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: { items: [] } }); return; }
    const input = route.request().postDataJSON();
    const record = { ...input, id: input.filename + '-' + (uploads.length + 1) }; uploads.push(record);
    if (controls.failBack && input.purpose === 'intake_back') {
      controls.failBack = false; await route.fulfill({ status: 500, json: { error: '模拟上传失败' } });
    } else await route.fulfill({ status: 201, json: { id: record.id } });
  });
  await page.route('**/api/appointments/photo-test/status', async route => {
    starts.push(route.request().postDataJSON());
    if (controls.failStart) {
      controls.failStart = false; await route.fulfill({ status: 500, json: { error: '模拟签到失败' } });
    } else await route.fulfill({ json: { ...item, status: 'in_progress', assignedTo: user.account } });
  });
  await page.goto('/staff/');
  await page.locator('#login-id').fill(user.account); await page.locator('#login-password').fill('photo-test-password');
  await page.locator('#login-form button').click();
  await expect(page.locator('#scan-intake-form')).toBeVisible();
  return { uploads, starts, controls, user };
}

async function intakeEntry(page, entry) {
  if (entry === 'scanner') {
    const { starts } = await scanHarness(page);
    return { prefix: 'scan', meta: 'state', confirm: page.getByRole('button', { name: '确认照片并开始维修' }),
      readStarts: async () => starts, completed: page.locator('#scan-result-form') };
  }
  await harness(page, { intake: true });
  return { prefix: 'intake', meta: 'meta', confirm: page.locator('#confirm-intake'),
    readStarts: () => page.evaluate(() => window.photoStarts.map(start => start.photos)), completed: page.locator('#intake-modal') };
}

for (const entry of ['modal', 'scanner']) {
  test(`${entry} uploads each selected photo immediately and confirmation joins pending uploads without duplicates`, async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const { prefix, meta, confirm, readStarts, completed } = await intakeEntry(page, entry);
    const uploads = [], release = {};
    await page.route('**/api/appointments/photo-test/attachments', async route => {
      if (route.request().method() !== 'POST') { await route.fulfill({ json: { items: [] } }); return; }
      const body = route.request().postDataJSON(); uploads.push(body);
      await new Promise(resolve => { release[body.purpose] = resolve; });
      await route.fulfill({ status: 201, json: { id: body.filename } });
    });
    await page.locator('#'+prefix+'-front').setInputFiles({ name: 'front.png', mimeType: '', buffer: png });
    await expect.poll(() => uploads.length).toBe(1);
    await expect(page.locator('#'+prefix+'-front-'+meta)).toContainText('正在上传');
    expect(await readStarts()).toEqual([]);
    await page.locator('#'+prefix+'-back').setInputFiles({ name: 'back.png', mimeType: '', buffer: png });
    await expect.poll(() => uploads.length).toBe(2);
    await confirm.click(); await expect(confirm).toBeDisabled();
    expect(await readStarts()).toEqual([]);
    release.intake_front();
    await expect(page.locator('#'+prefix+'-front-'+meta)).toContainText('已上传');
    expect(await readStarts()).toEqual([]);
    release.intake_back();
    if (entry === 'modal') await expect(completed).toBeHidden(); else await expect(completed).toBeVisible();
    expect(await readStarts()).toHaveLength(1);
    expect((await readStarts())[0]).toMatchObject({ frontPhotoId: 'front.png', backPhotoId: 'back.png' });
    expect(uploads).toHaveLength(2); expect(errors).toEqual([]);
  });

  test(`${entry} ignores an old upload that finishes after its photo is replaced`, async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const { prefix, meta, confirm, readStarts, completed } = await intakeEntry(page, entry);
    const uploads = []; let releaseOld;
    await page.route('**/api/appointments/photo-test/attachments', async route => {
      if (route.request().method() !== 'POST') { await route.fulfill({ json: { items: [] } }); return; }
      const body = route.request().postDataJSON(); uploads.push(body);
      if (body.filename === 'old-front.png') await new Promise(resolve => { releaseOld = resolve; });
      await route.fulfill({ status: 201, json: { id: body.filename } });
    });
    const select = (side, name) => page.locator('#'+prefix+'-'+side).setInputFiles({ name, mimeType: '', buffer: png });
    await select('front', 'old-front.png');
    await expect.poll(() => typeof releaseOld).toBe('function');
    await select('front', 'new-front.png');
    await expect(page.locator('#'+prefix+'-front-'+meta)).toContainText('已上传');
    await select('back', 'back.png');
    await expect(page.locator('#'+prefix+'-back-'+meta)).toContainText('已上传');
    const preview = await page.locator('#'+prefix+'-front-preview').getAttribute('src');
    const oldResponse = page.waitForResponse(response => response.request().method() === 'POST'
      && response.url().endsWith('/attachments') && response.request().postDataJSON().filename === 'old-front.png');
    releaseOld(); await (await oldResponse).finished();
    await expect(page.locator('#'+prefix+'-front-preview')).toHaveAttribute('src', preview);
    await confirm.click();
    if (entry === 'modal') await expect(completed).toBeHidden(); else await expect(completed).toBeVisible();
    expect((await readStarts())[0]).toMatchObject({ frontPhotoId: 'new-front.png', backPhotoId: 'back.png' });
    expect(uploads).toHaveLength(3); expect(errors).toEqual([]);
  });
}

test('closing intake ignores a pending upload when the same appointment is reopened', async ({ page }) => {
  await harness(page, { intake: true });
  let releaseOld;
  await page.route('**/api/appointments/photo-test/attachments', async route => {
    await new Promise(resolve => { releaseOld = resolve; });
    await route.fulfill({ status: 201, json: { id: 'old-photo' } });
  });
  await page.locator('#intake-front').setInputFiles({ name: 'old.png', mimeType: '', buffer: png });
  await expect.poll(() => typeof releaseOld).toBe('function');
  await page.locator('#cancel-intake').click();
  await page.evaluate(() => window.photoIntake.open({ id: 'photo-test' }));
  const oldResponse = page.waitForResponse(response => response.url().endsWith('/attachments'));
  releaseOld(); await (await oldResponse).finished();
  await expect(page.locator('#intake-front-meta')).toHaveText('');
  await expect(page.locator('#intake-front-preview')).toBeHidden();
  expect(await page.evaluate(() => window.photoStarts)).toEqual([]);
});

test('scanner intake compresses originals above 2 MB and replaces IDs after a partial upload', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const { uploads, starts, controls } = await scanHarness(page);
  controls.failBack = true;
  await page.locator('#scan-front').setInputFiles({ name: 'large-front.png', mimeType: '', buffer: Buffer.concat([png, Buffer.alloc(3 * 1024 * 1024)]) });
  await expect(page.locator('#scan-front-state')).toContainText('3.0 MB →');
  await expect(page.locator('#scan-front-state')).toContainText('已上传');
  await page.locator('#scan-back').setInputFiles({ name: 'back.png', mimeType: '', buffer: png });
  await expect(page.locator('#scan-front-progress')).toHaveJSProperty('value', 100);
  await expect(page.locator('#scan-front-preview')).toBeVisible();
  await expect(page.locator('#scan-front')).not.toHaveAttribute('capture');
  await expect(page.locator('#scan-back-state')).toContainText('上传失败，确认签到时重试');
  expect(starts).toEqual([]);
  expect(uploads[0].mimeType).toBe('image/jpeg'); expect(uploads[0].filename).toBe('large-front.jpg');
  expect(Buffer.from(uploads[0].data, 'base64').length).toBeLessThanOrEqual(2 * 1024 * 1024);
  await page.locator('#scan-front').setInputFiles({ name: 'new-front.png', mimeType: '', buffer: png });
  await page.getByRole('button', { name: '确认照片并开始维修' }).click();
  await expect(page.locator('#scan-result-form')).toBeVisible();
  expect(uploads.map(input => input.filename).sort()).toEqual(['large-front.jpg', 'back.png', 'new-front.png', 'back.png'].sort());
  expect(starts[0]).toMatchObject({ frontPhotoId: uploads.find(file => file.filename === 'new-front.png').id, backPhotoId: uploads.filter(file => file.filename === 'back.png').at(-1).id, status: 'in_progress' });
  expect(errors).toEqual([]);
});

test('scanner restores uploaded IDs after reload, rejects HEIC and reuses only the unchanged photo', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const { uploads, starts, controls, user } = await scanHarness(page);
  controls.failStart = true;
  for (const side of ['front', 'back']) await page.locator('#scan-' + side).setInputFiles({ name: side + '.png', mimeType: '', buffer: png });
  await page.getByRole('button', { name: '确认照片并开始维修' }).click();
  await expect(page.locator('#toast')).toContainText('模拟签到失败');
  await page.reload();
  await expect(page.locator('#scan-intake-form')).toBeVisible();
  for (const side of ['front', 'back']) {
    await expect(page.locator('#scan-' + side + '-state')).toContainText('照片已上传，可直接重试签到');
    expect(await page.locator('#scan-' + side).evaluate(input => input.files.length)).toBe(0);
  }
  await page.locator('#scan-back').setInputFiles({ name: 'back.heic', mimeType: '', buffer: Buffer.from('\x00\x00\x00\x18ftypheic\x00\x00\x00\x00heic', 'binary') });
  await expect(page.locator('#scan-back-state')).toContainText('HEIC/HEIF');
  await page.getByRole('button', { name: '确认照片并开始维修' }).click();
  await expect(page.locator('#toast')).toContainText('转为 JPG');
  expect(starts).toHaveLength(1); expect(uploads).toHaveLength(2);
  expect(await page.evaluate(account => JSON.parse(localStorage.getItem(`pioneerScan:${account}:photos:photo-test`)), user.account)).toEqual({ front: uploads[0].id });
  await page.locator('#scan-back').setInputFiles({ name: 'new-back.png', mimeType: '', buffer: png });
  await page.getByRole('button', { name: '确认照片并开始维修' }).click();
  await expect(page.locator('#scan-result-form')).toBeVisible();
  expect(uploads.map(input => input.filename)).toEqual(['front.png', 'back.png', 'new-back.png']);
  expect(starts[1]).toMatchObject({ frontPhotoId: uploads[0].id, backPhotoId: uploads[2].id });
  expect(errors).toEqual([]);
});
