import { test, expect } from '@playwright/test';

const photo = { name: 'device.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64') };
const password = 'workbench-e2e-password';
const fixture = { account: '99123456', name: '维修测试员', role: 'technician', homeCampus: '南湖', authorizedCampuses: ['南湖'], token: 'local-ui-test' };
async function login(page, account = fixture.account, pass = password) {
  await page.goto('/staff/');
  await page.locator('#login-id').fill(account); await page.locator('#login-password').fill(pass);
  await page.locator('#login-form button').click();
  await expect(page.locator('#app-shell')).toBeVisible();
}
async function cameraDenied(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => { throw new DOMException('Denied', 'NotAllowedError'); } });
  });
}
async function mockSession(page, { role = 'technician', enabled = true } = {}) {
  const user = { ...fixture, role };
  await page.route('**/api/auth/login', route => route.fulfill({ json: user }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: user }));
  await page.route('**/api/scan/config', route => route.fulfill({ json: { enabled } }));
  await page.route('**/api/scan/current*', route => route.fulfill({ json: { items: [], pending: null, registration: null } }));
}
async function fits(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const controls = await page.locator('#scan-home button:visible, #workbench-header button:visible, .scan-image-label:visible').evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return { width: box.width, height: box.height }; }));
  expect(controls.every(box => box.width >= 44 && box.height >= 44)).toBe(true);
}
for (const width of [320, 375, 390, 430]) test(`workbench keeps scanning, fallbacks and personal actions reachable at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 740 });
  await cameraDenied(page); await mockSession(page); await login(page);
  await expect(page.locator('#scan-home')).toBeVisible();
  await expect(page.locator('#management-header')).toBeHidden();
  await expect(page.getByText('未获得相机权限', { exact: true })).toHaveCount(0);
  await expect(page.locator('#scan-onsite')).toBeVisible(); await fits(page);
  await expect(page.getByText('今日值班', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `output/playwright/workbench-home-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: '个人中心', exact: true }).click();
  await expect(page.locator('#workbench-profile-dialog')).toBeVisible();
  await expect(page.locator('#workbench-admin')).toBeHidden();
  await expect(page.getByText('我的签到记录', { exact: true })).toHaveCount(0);
  await expect(page.locator('#workbench-profile-close')).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(page.locator('#workbench-logout')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.locator('#workbench-profile-close')).toBeFocused();
  await page.screenshot({ path: `output/playwright/workbench-profile-${width}.png`, fullPage: true });
  await page.keyboard.press('Escape'); await expect(page.locator('#workbench-profile')).toBeFocused();
  await page.getByRole('button', { name: '手动输入编号', exact: true }).click();
  await expect(page.locator('#scan-number')).toBeFocused();
  await page.setViewportSize({ width, height: 360 }); // Layout under a reduced visual viewport.
  await page.locator('#scan-number').fill('reserve020261013-01');
  await expect(page.getByRole('button', { name: '查询工单' })).toBeVisible(); await fits(page);
  expect(await page.locator('#scan-number').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
  await page.getByRole('button', { name: '返回扫码', exact: true }).click();
  await page.getByRole('button', { name: '个人中心', exact: true }).click();
  await page.getByRole('button', { name: '修改密码与账号安全' }).click();
  await expect(page.locator('#password-form')).toBeVisible();
  await expect(page.locator('#capacity-settings')).toBeHidden();
  await expect(page.locator('#management-header')).toBeHidden();
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await expect(page.locator('#scan-home')).toBeVisible();
});

for (const strictFacing of [true, false]) test(`camera prefers the rear lens, switches facing and falls back when exact facing is ${strictFacing ? 'supported' : 'unsupported'}`, async ({ page }) => {
  await mockSession(page);
  await page.addInitScript(supported => {
    window.cameraRequests = [];
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { value: async () => [] });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async constraints => {
      window.cameraRequests.push(constraints);
      if (!supported && constraints.video.facingMode.exact) throw new DOMException('Facing mode unavailable', 'OverconstrainedError');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      canvas.getContext('2d').fillRect(0, 0, 64, 64);
      return canvas.captureStream(1);
    } });
  }, strictFacing);
  await login(page);
  await expect(page.locator('.scanner-frame')).toHaveAttribute('data-camera-state', 'running');
  expect(await page.evaluate(() => window.cameraRequests.map(request => request.video.facingMode))).toEqual(strictFacing ? [{ exact: 'environment' }] : [{ exact: 'environment' }, { ideal: 'environment' }]);
  await page.locator('#scan-switch-camera').click();
  await expect(page.locator('.scanner-frame')).toHaveAttribute('data-camera-state', 'running');
  expect(await page.evaluate(() => window.cameraRequests.map(request => request.video.facingMode))).toEqual(strictFacing ? [{ exact: 'environment' }, { exact: 'user' }] : [{ exact: 'environment' }, { ideal: 'environment' }, { exact: 'user' }, { ideal: 'user' }]);
});

test('camera pauses for the personal center and scanned images open grouped device details', async ({ page }) => {
  await mockSession(page);
  await page.addInitScript(() => {
    window.cameraStreams = [];
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      canvas.getContext('2d').fillRect(0, 0, 64, 64);
      const stream = canvas.captureStream(1); window.cameraStreams.push(stream); return stream;
    } });
  });
  const id = 'reserve020261013-01';
  await page.route('**/api/scan/resolve', route => route.fulfill({ json: { id, status: 'booked', revision: 0, campus: '南湖', date: '2026-10-13', timeSlot: '19:00–19:30', brand: '联想', deviceModel: 'ThinkPad T14', deviceType: '笔记本电脑', warranty: '否', faultType: '蓝屏', issue: '启动后蓝屏', source: 'booking' } }));
  await login(page);
  await expect(page.locator('.scanner-frame')).toHaveAttribute('data-camera-state', 'running');
  await page.getByRole('button', { name: '个人中心', exact: true }).click();
  expect(await page.evaluate(() => window.cameraStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  await page.getByRole('button', { name: '关闭个人中心' }).click();
  await expect(page.locator('.scanner-frame')).toHaveAttribute('data-camera-state', 'running');
  const png = await page.evaluate(async code => {
    const { qrImage } = await import('/shared/zxing.js');
    return [...new Uint8Array(await (await qrImage(code)).arrayBuffer())];
  }, id + '.012345abcdef');
  await page.locator('#scan-image').setInputFiles({ name: 'repair-code.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await expect(page.locator('#scan-detail')).toBeVisible();
  await expect(page.locator('.scan-device-card')).toContainText('ThinkPad T14');
  await expect(page.locator('#scan-intake-form')).toBeVisible();
  expect(await page.evaluate(() => window.cameraStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
});

test('camera closes manually and releases tracks on navigation, background, pagehide and logout', async ({ page }) => {
  await mockSession(page);
  await page.addInitScript(() => {
    window.cameraStreams = [];
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      canvas.getContext('2d').fillRect(0, 0, 64, 64);
      const stream = canvas.captureStream(1);
      window.cameraStreams.push(stream); return stream;
    } });
  });
  const running = () => expect(page.locator('.scanner-frame')).toHaveAttribute('data-camera-state', 'running');
  const released = async () => {
    await expect(page.locator('.scanner-frame')).toHaveAttribute('data-camera-state', 'idle');
    expect(await page.evaluate(() => window.cameraStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
    expect(await page.locator('#scan-video').evaluate(video => video.srcObject === null)).toBe(true);
  };
  await login(page); await running();
  await page.getByRole('button', { name: '关闭摄像头', exact: true }).click(); await released();
  await expect(page.locator('#scan-switch-camera')).toBeDisabled();
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
  await released();
  await page.getByRole('button', { name: '手动输入编号', exact: true }).click();
  await page.getByRole('button', { name: '返回扫码', exact: true }).click(); await released();
  await page.getByRole('button', { name: '开启摄像头', exact: true }).click(); await running();
  await page.getByRole('button', { name: '手动输入编号', exact: true }).click(); await released();
  await page.getByRole('button', { name: '返回扫码', exact: true }).click(); await running();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await released();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await running();
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await released();
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await running();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await released();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await released();
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow'))); await running();
  await page.getByRole('button', { name: '个人中心', exact: true }).click(); await released();
  await page.locator('#workbench-logout').click(); await released();
});

test('late camera permission cannot reopen a closed camera or an inactive scan page', async ({ page }) => {
  await mockSession(page);
  await page.addInitScript(() => {
    window.cameraStreams = [];
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => new Promise(resolve => {
      window.grantCamera = () => {
        const stream = document.createElement('canvas').captureStream(1);
        window.cameraStreams.push(stream); resolve(stream);
      };
    }) });
  });
  await login(page);
  await expect(page.locator('.scanner-frame')).toHaveAttribute('data-camera-state', 'opening');
  await page.getByRole('button', { name: '关闭摄像头', exact: true }).click();
  await page.evaluate(() => window.grantCamera());
  await expect.poll(() => page.evaluate(() => window.cameraStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  await page.getByRole('button', { name: '开启摄像头', exact: true }).click();
  await expect(page.locator('.scanner-frame')).toHaveAttribute('data-camera-state', 'opening');
  await page.getByRole('button', { name: '手动输入编号', exact: true }).click();
  await page.evaluate(() => window.grantCamera());
  await expect.poll(() => page.evaluate(() => window.cameraStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  expect(await page.locator('#scan-video').evaluate(video => video.srcObject === null)).toBe(true);
});

test('onsite intake, offline drafts, relogin recovery and completion retain the real repair workflow', async ({ page, request, context }) => {
  test.setTimeout(90000);
  const account = String(980000000 + Math.floor(Math.random() * 999999));
  const headers = { 'CF-Connecting-IP': '198.51.100.191' };
  const rootResponse = await request.post('/api/auth/login', { headers, data: { account: 'root001', password: process.env.E2E_ROOT_PASSWORD } });
  expect(rootResponse.ok()).toBe(true); const root = await rootResponse.json();
  const adminHeaders = { ...headers, Authorization: `Bearer ${root.token}` };
  expect((await request.post('/api/staff-whitelist/import', { headers: adminHeaders, data: { csv: `studentId,expectedName\n${account},扫码测试员`, expectedRole: 'technician', authorizedCampuses: ['南湖'] } })).ok()).toBe(true);
  const application = await (await request.post('/api/activation', { headers, data: { studentId: account, name: '扫码测试员', homeCampus: '南湖', password } })).json();
  expect((await request.post('/api/activation-requests/review', { headers: adminHeaders, data: { ids: [application.id], status: 'approved', identityVerified: true } })).ok()).toBe(true);
  await page.setExtraHTTPHeaders(headers); await page.setViewportSize({ width: 390, height: 844 }); await cameraDenied(page);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await login(page, account); await page.getByRole('button', { name: '临时维修登记', exact: true }).click();
  const form = page.locator('#scan-onsite-form');
  for (const [name, value] of Object.entries({ studentId: account + '1', name: '设备测试同学', college: '计算机学院', phone: '13800138000', social: '12345678901', brand: '联想', deviceModel: 'ThinkPad T14', serial: 'LOCAL-ONLY', issue: '开机蓝屏', note: '已备份数据' })) await form.locator(`[name=${name}]`).fill(value);
  await form.locator('[name=warranty]').selectOption('否'); await form.locator('[name=faultType]').selectOption('蓝屏');
  await form.locator('[name=agreement]').check(); await page.locator('#onsite-signature').scrollIntoViewIfNeeded();
  const box = await page.locator('#onsite-signature').boundingBox();
  await page.mouse.move(box.x + 20, box.y + 25); await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 60, { steps: 12 }); await page.mouse.move(box.x + 45, box.y + 110, { steps: 12 }); await page.mouse.up();
  await form.getByRole('button', { name: '登记并查看工单' }).click();
  await expect(page.locator('#scan-detail')).toBeVisible();
  await expect(page.locator('#scan-detail-info')).toContainText('现场临时登记');
  const id = await page.locator('.scan-order-code').textContent();
  await page.screenshot({ path: 'output/playwright/workbench-intake-390.png', fullPage: true });
  for (const side of ['front', 'back']) await page.locator('#scan-' + side).setInputFiles({ ...photo, name: side + '.png' });
  await page.getByRole('button', { name: '确认照片并开始维修' }).click();
  await expect(page.locator('#scan-result-form')).toBeVisible();
  const token = await page.evaluate(() => sessionStorage.getItem('pioneerToken'));
  for (const path of ['/api/stats/summary', '/api/users', '/api/slot-capacities']) expect((await request.get(path, { headers: { ...headers, Authorization: `Bearer ${token}` } })).status()).toBe(403);
  await context.setOffline(true); await page.locator('#scan-note').fill('已检查内存接触，复测正常。'); await page.locator('#scan-outcome').selectOption('repaired');
  await context.setOffline(false);
  await page.reload(); await expect(page.locator('#scan-result-form')).toBeVisible(); await expect(page.locator('#scan-note')).toHaveValue('已检查内存接触，复测正常。');
  await page.getByRole('button', { name: '个人中心', exact: true }).click(); await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.locator('#login-view')).toBeVisible(); await login(page, account);
  await expect(page.locator('#scan-result-form')).toBeVisible(); await expect(page.locator('.scan-order-code')).toHaveText(id);
  await expect(page.locator('#scan-note')).toHaveValue('已检查内存接触，复测正常。');
  await page.screenshot({ path: 'output/playwright/workbench-result-390.png', fullPage: true });
  await page.getByRole('button', { name: '完成并返回扫码' }).click(); await expect(page.locator('#scan-home')).toBeVisible();
  // Staff authentication is intentionally separate from the student's private
  // appointment token, so verify the completed onsite record through the
  // authenticated management list endpoint.
  const completed = (await (await request.get('/api/appointments?q=' + encodeURIComponent(id), { headers: adminHeaders })).json()).items.find(item => item.id === id);
  expect(completed.status).toBe('completed'); expect(completed.outcome).toBe('repaired'); expect(completed.college).toBe('计算机学院'); expect(completed.serial).toBe('LOCAL-ONLY');
  expect(errors).toEqual([]);
});

test('admins keep their management navigation and the feature flag restores the legacy technician interface', async ({ page }) => {
  await cameraDenied(page); await mockSession(page, { role: 'admin' });
  await page.route('**/api/appointments?*', route => route.fulfill({ json: { items: [], counts: {}, filteredCounts: {} } }));
  await page.route('**/api/appointments/overview*', route => route.fulfill({ json: { campuses: [] } }));
  await login(page);
  await expect(page.locator('#management-header')).toBeVisible();
  for (const name of ['维修后台', '统计分析', '账号管理', '个人设置']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '扫码维修', exact: true }).click();
  await expect(page.locator('#management-header')).toBeHidden();
  await page.getByRole('button', { name: '个人中心', exact: true }).click();
  await page.getByRole('button', { name: '返回管理后台', exact: true }).click();
  await expect(page.locator('#management-header')).toBeVisible(); await expect(page.locator('#staff-view')).toBeVisible();
  await page.unroute('**/api/scan/config'); await page.route('**/api/scan/config', route => route.fulfill({ json: { enabled: false } }));
  await page.unroute('**/api/auth/me'); await page.route('**/api/auth/me', route => route.fulfill({ json: fixture }));
  await page.reload(); await expect(page.locator('#staff-view')).toBeVisible();
  await expect(page.locator('[data-view-link=scan]')).toBeHidden(); await expect(page.locator('[data-view-link=stats]')).toBeHidden();
});

for (const width of [320,1440]) test(`manual search waits for two digits and opens only matching candidates at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:800});
  await cameraDenied(page); await mockSession(page);
  const queries=[];
  const id='reserve020261015-01';
  await page.route('**/api/appointments/*/attachments', route=>route.fulfill({json:{items:[]}}));
  await page.route('**/api/scan/search',async route=>{
    const {q}=route.request().postDataJSON(); queries.push(q);
    await route.fulfill({json:{items:['01','1015-01'].includes(q) ? [{id,campus:'南湖',date:'2026-10-15',timeSlot:'19:00–19:30',status:'booked'}] : [],hasMore:false}});
  });
  await page.route('**/api/scan/resolve',route=>route.fulfill({json:{id,status:'cancelled',campus:'南湖',timeSlot:'19:00–19:30'}}));
  await login(page); await page.locator('#scan-manual').click();
  await page.locator('#scan-number').fill('0');
  await page.waitForTimeout(400);
  expect(queries).toEqual([]); await expect(page.locator('#scan-number-suggestions')).toBeHidden();
  await page.locator('#scan-number').fill('reserve01');
  await expect(page.locator('.scan-number-suggestion')).toHaveCount(1);
  expect(queries).toEqual(['01']);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#scan-number').fill('9999');
  await expect(page.locator('#scan-number-message')).toContainText('没有匹配');
  await expect(page.locator('#scan-number-suggestions')).toBeHidden();
  await page.locator('#scan-number').fill('01');
  await expect(page.locator('.scan-number-suggestion')).toHaveCount(1);
  await page.locator('#scan-number').fill('1015-01');
  await expect(page.locator('.scan-number-suggestion')).toContainText('2026-10-15');
  await expect(page.locator('#scan-number-message')).toContainText('可见预约');
  await page.locator('#scan-number').press('ArrowDown');
  await expect(page.locator('.scan-number-suggestion')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#scan-detail')).toBeVisible();
});
