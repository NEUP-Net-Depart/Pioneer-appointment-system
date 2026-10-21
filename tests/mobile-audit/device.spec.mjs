/* global document, window, HTMLMediaElement, innerHeight, requestAnimationFrame */
import { test, expect, login, navigate } from './support.mjs';
test.skip(process.env.E2E_FIELD !== 'true', 'Requires the disposable field fixture');

test('camera-fallback-switch-release-and-password-change', async ({ page, audit }, info) => {
  await login(page, '20261003');
  await navigate(page, '个人中心');
  const supported = await page.evaluate(() => typeof document.createElement('canvas').captureStream === 'function');
  test.skip(!supported, 'This engine cannot create a synthetic video track with canvas.captureStream');
  await page.evaluate(() => {
    // A plain object avoids engine-specific MediaDevices wrapper lifetimes.
    // This is an explicit synthetic adapter, never a claim about physical lenses.
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {} });
    window.__cameraAudit = { calls: [], streams: [], canvases: [], errors: [], mediaDevices: navigator.mediaDevices };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      return play.apply(this, args).catch(error => { window.__cameraAudit.errors.push({ name: error.name, message: error.message, muted: this.muted, playsInline: this.playsInline }); throw error; });
    };
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { configurable: true, value: async () => [
      { kind: 'videoinput', deviceId: 'audit-rear', label: 'Synthetic rear' },
      { kind: 'videoinput', deviceId: 'audit-front', label: 'Synthetic front' },
    ] });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async constraints => {
      window.__cameraAudit.calls.push(constraints);
      if (window.__cameraAudit.calls.length === 1) throw new DOMException('Synthetic strict facingMode unsupported', 'OverconstrainedError');
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      canvas.getContext('2d').fillRect(0, 0, 64, 64);
      const stream = canvas.captureStream(1);
      window.__cameraAudit.canvases.push(canvas);
      window.__cameraAudit.streams.push(stream);
      return stream;
    } });
  });
  async function openSyntheticCamera() {
    await page.bringToFront();
    // Install the synthetic source before starting it. Temporarily hide only the
    // document visibility signal so the component cannot race its auto-start.
    await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, value: true }));
    await page.getByRole('button', { name: '到岗签到', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '扫一扫', exact: true })).toBeVisible();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.getByRole('button', { name: '开启摄像头', exact: true }).click();
  }
  await openSyntheticCamera();
  await expect(page.getByRole('button', { name: '关闭摄像头', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__cameraAudit.streams.length)).toBe(1);
  expect(await page.evaluate(() => window.__cameraAudit.calls.slice(0, 2).map(call => call.video.facingMode))).toEqual([{ exact: 'environment' }, { ideal: 'environment' }]);
  await audit.capture('camera-synthetic-running');
  await page.getByRole('button', { name: '切换镜头', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__cameraAudit.streams.length)).toBe(2);
  expect(await page.evaluate(() => window.__cameraAudit.streams[0].getTracks().every(track => track.readyState === 'ended'))).toBe(true);
  await audit.capture('camera-synthetic-switch');
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  expect(await page.evaluate(() => window.__cameraAudit.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  await openSyntheticCamera();
  await expect.poll(() => page.evaluate(() => window.__cameraAudit.streams.length)).toBe(3);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  expect(await page.evaluate(() => window.__cameraAudit.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.getByRole('button', { name: '开启摄像头', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__cameraAudit.streams.length)).toBe(3);
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  audit.diagnostics.notes.push(await page.evaluate(() => ({ syntheticCameraVerified: true, constraints: window.__cameraAudit.calls, allTracksReleased: window.__cameraAudit.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')), noAutoRestart: window.__cameraAudit.streams.length === 3 })));
  await navigate(page, '账号安全');
  const size = info.project.use.viewport;
  await page.setViewportSize({ width: size.width, height: Math.min(size.height, 400) });
  // fill() can focus an offscreen control without scrolling. A real user first
  // reaches and taps it; use that action before judging viewport obstruction.
  await page.locator('[name=confirmPassword]').click();
  await page.locator('[name=confirmPassword]').fill('MobileAudit!2026');
  await expect(page.locator('[name=confirmPassword]')).toBeFocused();
  const focus = await page.locator('[name=confirmPassword]').evaluate(node => {
    const r = node.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { visible: node === top || node.contains(top), top: r.top, bottom: r.bottom, viewportHeight: innerHeight, coveringElement: top ? { tag: top.tagName, text: top.textContent.slice(0, 60), className: top.className } : null };
  });
  audit.diagnostics.notes.push({ reducedViewportFocus: focus });
  await audit.capture('keyboard-reduced-viewport', { viewportOnly: true });
  expect.soft(focus.visible, 'Focused password field should remain above the fixed navigation').toBe(true);
  await page.setViewportSize(size);
  for (const [oldPassword, newPassword] of [['StaffTest!2026', 'MobileAudit!2026'], ['MobileAudit!2026', 'StaffTest!2026']]) {
    await page.locator('[name=currentPassword]').fill(oldPassword);
    await page.locator('[name=newPassword]').fill(newPassword);
    await page.locator('[name=confirmPassword]').fill(newPassword);
    await page.getByRole('button', { name: '修改密码并退出', exact: true }).click();
    await expect(page.locator('#login-form')).toBeVisible();
    await page.locator('#login-id').fill('20261003');
    await page.locator('#login-password').fill(newPassword);
    await page.getByRole('button', { name: '进入系统' }).click();
    await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();
    await navigate(page, '账号安全');
  }
  await audit.capture('password-change-restored');
  audit.diagnostics.notes.push({ passwordChangedAndRestored: true });
});
