import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

// Keep this suite's login limits independent from the other browser suites.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '192.0.2.91' } });
test.beforeEach(async ({context},info)=>{
  // Each independent scenario gets its own rate-limit bucket. Production
  // throttling stays enabled, including the tests that exercise it explicitly.
  let hash=0;for(const char of info.title) hash=(Math.imul(hash,31)+char.charCodeAt(0))>>>0;
  await context.setExtraHTTPHeaders({'CF-Connecting-IP':`198.18.${(hash>>>8)&255}.${hash&255}`});
});

test.skip(
  process.env.E2E_FIELD !== "true",
  "Runs against the isolated field-workflow fixture",
);
async function login(page, account) {
  await page.goto("/staff/");
  await page
    .locator("#login-form")
    .getByLabel("学号", { exact: true })
    .fill(account);
  await page
    .locator("#login-form")
    .getByLabel("密码", { exact: true })
    .fill(account === 'root001' ? process.env.E2E_ROOT_PASSWORD : "StaffTest!2026");
  await page.getByRole("button", { name: "进入系统" }).click();
  await expect(page.locator(".field-app:not(.workspace-bootstrap)")).toBeVisible();
}
async function api(request, path, token, body, method = body ? "POST" : "GET") {
  const response = await request.fetch(path, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    ...(body ? { data: body } : {}),
  });
  const value = await response.json();
  expect(response.ok(), JSON.stringify(value)).toBeTruthy();
  return value;
}
async function recordFixture(request, token, studentId) {
  return api(request, '/api/scan/onsite', token, { requestId: crypto.randomUUID(), registrationFlow: 'frontdesk', campus: '南湖', name: '记录测试同学', studentId, social: 'record-test', deviceType: '笔记本电脑', brand: '联想', deviceModel: 'ThinkPad Records', warranty: '否', faultType: '系统问题', signature: [Array.from({ length: 10 }, (_,i) => [0.1 + i * 0.05, 0.2 + i * 0.03])] });
}

test('member qualification and roster import panels preserve drafts and fit staff viewports',async({page})=>{
  await login(page,'root001');
  const sidebar=page.locator('.field-sidebar');
  const group=sidebar.getByRole('button',{name:'平台管理',exact:true});
  if(await group.getAttribute('aria-expanded')==='false') await group.click();
  await sidebar.getByRole('button',{name:'成员管理',exact:true}).click();
  await page.getByRole('button',{name:'编辑成员与权限',exact:true}).first().click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'工作资格',exact:true}).click();
  await dialog.getByRole('combobox',{name:'工作资格',exact:true}).selectOption('exchange');
  await expect(dialog.getByLabel('已核验该成员通过维修培训')).toBeVisible();
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const box=await dialog.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width+1);
    await page.screenshot({path:`output/field-workflow/member-qualification-${width}.png`,fullPage:true});
  }
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  await expect(dialog.getByText('放弃未保存的修改？',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'返回继续编辑',exact:true}).click();
  await expect(dialog.getByRole('combobox',{name:'工作资格',exact:true})).toHaveValue('exchange');
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  await dialog.getByRole('button',{name:'放弃修改并关闭',exact:true}).click();
  await page.getByRole('button',{name:'导入名单',exact:true}).click();
  await dialog.getByRole('combobox',{name:'名单类型',exact:true}).selectOption('exchange');
  await expect(dialog.getByText('核验培训通过后',{exact:false})).toBeVisible();
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();
});

for (const account of ['20261001', '20261002']) test(`ordinary staff ${account} cannot see or force open management workspaces`, async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': account === '20261001' ? '192.0.2.71' : '192.0.2.72' });
  // A cached or inconsistent navigation list must never override effective permissions.
  await page.route('**/api/field/home', async route => {
    const response = await route.fetch();
    const home = await response.json();
    await route.fulfill({ response, json: { ...home, navigation: [...(home.navigation || []),
      { id: 'members', label: '成员管理' }, { id: 'roles', label: '授权管理' }] } });
  });
  await login(page, account);
  const managementReads = [];
  page.on('request', req => { if (/^\/api\/(members|roles|users|stats|slot-capacities|staff-whitelist|activation-requests)(?:\/|$)/.test(new URL(req.url()).pathname)) managementReads.push(req.url()); });
  const sidebar = page.locator('.field-sidebar');
  for (const label of ['成员管理','授权管理','账号管理','预约配置','统计分析','维修排班管理','办公排班管理','请假审批','现场管理']) await expect(sidebar.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  for (const view of ['members','permissions','users','stats','capacity','roster-manage','office-roster','leave-review']) {
    await page.evaluate(view => window.dispatchEvent(new CustomEvent('staff-navigate', { detail: view })), view);
    await expect(page.locator('.workspace-route:not([hidden])')).toHaveAttribute('data-route', 'workbench');
  }
  expect(managementReads).toEqual([]);
  // Verify backend enforcement independently of the hidden menus and route guards.
  const token = await page.evaluate(() => sessionStorage.getItem('pioneerToken'));
  for (const path of ['/api/members', '/api/roles', '/api/permissions']) {
    const response = await page.request.get(path, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status(), path).toBe(403);
  }
  const mutation = await page.request.patch('/api/members/member-20261003', {
    headers: { Authorization: `Bearer ${token}` }, data: { name: '禁止越权修改', revision: 0 }
  });
  expect(mutation.status()).toBe(403);
  await mkdir('output/field-workflow', { recursive: true });
  await page.screenshot({ path: `output/field-workflow/access-${account}-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '更多', exact: true }).click();
  const entries = page.getByRole('dialog', { name: '工作入口', exact: true });
  for (const label of ['成员管理','授权管理','账号管理','预约配置','统计分析','维修排班管理','办公排班管理']) await expect(entries.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  await page.screenshot({ path: `output/field-workflow/access-${account}-mobile.png`, fullPage: true });
  await entries.getByRole('button', { name: '关闭', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await sidebar.getByRole('button', { name: '账号安全', exact: true }).click();
  await expect(page.getByRole('heading', { name: '账号安全', exact: true })).toBeVisible();
  await expect(page.locator('.capacity-editor')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();
  for (const label of ['成员管理','授权管理','账号管理','预约配置','统计分析']) await expect(page.locator('.field-sidebar').getByRole('button', { name: label, exact: true })).toHaveCount(0);
});

for (const capability of [
  { code: 'settings.manage', group: '业务管理', label: '预约配置', view: 'capacity', selector: '.capacity-editor', endpoint: '/api/slot-capacities' },
  { code: 'members.manage', group: '平台管理', label: '成员管理', view: 'members', selector: '.members-workspace', endpoint: '/api/members' },
]) test(`revoking ${capability.code} closes its open workspace and blocks stale credentials`, async ({ page, request }) => {
  // Install before app startup so the shell's existing interval is controlled.
  await page.clock.install();
  await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': '192.0.2.73' });
  const admin = await api(request, '/api/auth/login', '', { account: 'root001', password: process.env.E2E_ROOT_PASSWORD });
  const member = await api(request, '/api/members/member-20261003', admin.token);
  const role = await api(request, '/api/roles', admin.token, { code: 'browser_scope_' + Date.now(), name: '浏览器范围测试', grants: [{ permissionCode: capability.code, scope: { campusIds: ['campus-nanhu'] }, conditions: [] }] });
  try {
    await api(request, '/api/members/member-20261003/roles', admin.token, { revision: member.member.revision, bindings: [...member.bindings, { roleId: role.id, scope: { campusIds: ['campus-nanhu'] }, effectiveFrom: '2026-01-01' }] }, 'PUT');
    await login(page, '20261003');
    const sidebar = page.locator('.field-sidebar');
    const business = sidebar.getByRole('button', { name: capability.group, exact: true });
    if (await business.getAttribute('aria-expanded') === 'false') await business.click();
    await sidebar.getByRole('button', { name: capability.label, exact: true }).click();
    await expect(page.locator(capability.selector)).toBeVisible();
    const staleToken = await page.evaluate(() => sessionStorage.getItem('pioneerToken'));
    expect((await page.request.get(capability.endpoint, { headers: { Authorization: `Bearer ${staleToken}` } })).status()).toBe(200);
    await api(request, `/api/roles/${role.id}`, admin.token, { revision: role.revision, grants: [] }, 'PATCH');
    // Revocation is enforced by the server immediately, before the shell's next refresh.
    expect((await page.request.get(capability.endpoint, { headers: { Authorization: `Bearer ${staleToken}` } })).status()).toBe(401);
    const staleWrite = await page.request.patch('/api/members/member-20261002', {
      headers: { Authorization: `Bearer ${staleToken}` }, data: { name: '禁止撤权后修改', revision: 0 }
    });
    expect(staleWrite.status()).toBe(401);
    await page.clock.fastForward(31000);
    await expect(page.locator('#login-view')).toBeVisible();
    await expect(page.locator('#staff-platform-root')).toBeEmpty();
    await page.clock.resume();
    await login(page, '20261003');
    await expect(page.locator('.field-sidebar').getByRole('button', { name: capability.label, exact: true })).toHaveCount(0);
    await page.evaluate(view => window.dispatchEvent(new CustomEvent('staff-navigate', { detail: view })), capability.view);
    await expect(page.locator(capability.selector)).toHaveCount(0);
    const currentToken = await page.evaluate(() => sessionStorage.getItem('pioneerToken'));
    expect((await page.request.get(capability.endpoint, { headers: { Authorization: `Bearer ${currentToken}` } })).status()).toBe(403);
  } finally {
    const latest = await api(request, '/api/members/member-20261003', admin.token);
    await api(request, '/api/members/member-20261003/roles', admin.token, { revision: latest.member.revision, bindings: member.bindings }, 'PUT');
  }
});

test('platform startup errors never reveal old pages or start legacy record refreshes', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': '192.0.2.50' });
  let contextFails = true, homeFails = true, legacyReads = 0;
  page.on('request', req => { if (req.method() === 'GET' && /^\/api\/appointments(?:\?|\/overview)/.test(new URL(req.url()).pathname + new URL(req.url()).search)) legacyReads++; });
  await page.route('**/api/auth/me', route => contextFails ? route.fulfill({ status: 503, json: { error: '初始化权限失败' } }) : route.continue());
  await page.route('**/api/field/home*', route => homeFails ? route.fulfill({ status: 503, json: { error: '初始化工作台失败' } }) : route.continue());
  await page.goto('/staff/');
  await page.locator('#login-id').fill('root001');
  await page.locator('#login-password').fill(process.env.E2E_ROOT_PASSWORD);
  await page.getByRole('button', { name: '进入系统' }).click();
  await expect(page.locator('.workspace-bootstrap')).toContainText('初始化权限失败');
  await expect(page.locator('#management-header')).toBeHidden();
  await expect(page.locator('#staff-view')).toBeHidden();
  contextFails = false;
  await page.getByRole('button', { name: '重新加载工作区' }).click();
  await expect(page.locator('.workspace-bootstrap')).toContainText('初始化工作台失败');
  expect(legacyReads).toBe(0);
  homeFails = false;
  await page.getByRole('button', { name: '重新加载工作区' }).click();
  await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();
  await expect(page.locator('.workspace-bootstrap')).toHaveCount(0);
  expect(legacyReads).toBe(0);
});

test("reception layout remains usable at desktop, phone and narrow-phone widths", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, "20261001");
  await mkdir("output/field-workflow", { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("heading", { name: "接待台", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `output/field-workflow/desk-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "展示签到码", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("img", { name: "工作人员到岗签到码" }),
    ).toBeVisible();
    expect(
      await page
        .getByRole("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.getByRole("button", { name: "关闭", exact: true }).click();
  }
  expect(errors).toEqual([]);
});

test("technician completes a real intake and repair; drafts survive reload and camera stays opt-in", async ({
  page,
  request,
}) => {
  const office = await request
    .post("/api/auth/login", {
      data: { account: "20261001", password: "StaffTest!2026" },
    })
    .then((r) => r.json());
  const tech = await request
    .post("/api/auth/login", {
      data: { account: "20261002", password: "StaffTest!2026" },
    })
    .then((r) => r.json());
  const home = await api(request, "/api/field/home", office.token);
  const event = await api(request, "/api/attendance/events", office.token, {
    type: "duty",
    businessDate: home.businessDate,
    campusId: "campus-nanhu",
    requestId: crypto.randomUUID(),
  });
  const credential = await api(
    request,
    `/api/attendance/events/${event.id}/token`,
    office.token,
    { revision: event.revision },
  );
  await api(request, "/api/attendance/check-ins", tech.token, {
    token: credential.token,
    requestId: crypto.randomUUID(),
  });
  const signature = [
    Array.from({ length: 10 }, (_, i) => [0.1 + i * 0.05, 0.2 + i * 0.03]),
  ];
  const order = await api(request, "/api/scan/onsite", office.token, {
    requestId: crypto.randomUUID(),
    registrationFlow: "frontdesk",
    campus: "南湖",
    name: "浏览器机主",
    studentId: "20305001",
    social: "test-contact",
    deviceType: "笔记本电脑",
    brand: "联想",
    deviceModel: "ThinkPad UI",
    warranty: "否",
    faultType: "系统问题",
    signature,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "20261002");
  await expect(
    page.getByRole("button", { name: "扫描维修码", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "预约编号", exact: true })
    .fill(order.id);
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("型号", { exact: true })).toHaveValue(
    "ThinkPad UI",
  );
  const photo = {
    name: "device.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Hf8AAAAASUVORK5CYII=",
      "base64",
    ),
  };
  await page.getByLabel("设备正面照片", { exact: true }).setInputFiles(photo);
  await page.getByLabel("设备背面照片", { exact: true }).setInputFiles(photo);
  await page.getByRole("button", { name: "确认开始维修", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "当前维修", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "维修说明", exact: true })
    .fill("浏览器测试：排查驱动并完成验证");
  await page.reload();
  await page.getByRole("button", { name: "继续维修", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("textbox", { name: "维修说明", exact: true }),
  ).toHaveValue("浏览器测试：排查驱动并完成验证");
  await page.getByLabel("修复成功", { exact: true }).check();
  await page.getByRole("button", { name: "提交维修结果", exact: true }).click();
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "维修记录已提交", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回工作台", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "扫描维修码", exact: true }),
  ).toBeVisible();
});

test("duty lead transfers a real repair and recipient completes it", async ({
  page,
  request,
}) => {
  const session = async (account) =>
    (
      await request.post("/api/auth/login", {
        data: { account, password: "StaffTest!2026" },
      })
    ).json();
  const office = await session("20261001"),
    tech = await session("20261002"),
    next = await session("20261003");
  const lead = await session('20261004');
  const home = await api(request, "/api/field/home", office.token);
  const credential = await api(
    request,
    `/api/attendance/events/${home.event.id}/token`,
    office.token,
    { revision: home.event.revision },
  );
  await api(request, "/api/attendance/check-ins", next.token, {
    token: credential.token,
    requestId: crypto.randomUUID(),
  });
  await api(request,'/api/attendance/check-ins',lead.token,{token:credential.token,requestId:crypto.randomUUID()});
  await api(request,'/api/attendance/check-ins',tech.token,{token:credential.token,requestId:crypto.randomUUID()});
  const order = await api(request, "/api/scan/onsite", office.token, {
    requestId: crypto.randomUUID(),
    registrationFlow: "frontdesk",
    campus: "南湖",
    name: "交接机主",
    studentId: "20305002",
    social: "local-contact",
    deviceType: "笔记本电脑",
    brand: "联想",
    deviceModel: "ThinkPad 交接",
    warranty: "否",
    faultType: "系统问题",
    signature: [
      Array.from({ length: 10 }, (_, i) => [0.1 + i * 0.05, 0.2 + i * 0.03]),
    ],
  });
  const photos = [];
  for (const side of ["front", "back"])
    photos.push(
      await api(
        request,
        `/api/appointments/${order.id}/attachments`,
        tech.token,
        {
          filename: `${side}.png`,
          mimeType: "image/png",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Hf8AAAAASUVORK5CYII=",
          purpose: `intake_${side}`,
        },
      ),
    );
  await api(
    request,
    `/api/appointments/${order.id}/status`,
    tech.token,
    {
      status: "in_progress",
      revision: order.revision,
      frontPhotoId: photos[0].id,
      backPhotoId: photos[1].id,
      verification: {
        brand: "联想",
        model: "ThinkPad 交接",
        warranty: "expired",
        liquidMetal: "no",
        note: "",
      },
      requestId: crypto.randomUUID(),
    },
    "PATCH",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, "20261004");
  await page
    .getByRole("navigation", { name: "岗位工作导航" })
    .getByRole("button", { name: "现场管理", exact: true })
    .click();
  await page.locator(".field-order").filter({ hasText: order.id }).click();
  await page
    .getByRole("button", { name: "转交其他维修人员", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "接手人员", exact: true })
    .selectOption("20261003");
  await page
    .getByLabel("交接原因", { exact: true })
    .fill("由下一班同事继续处理");
  await page.getByRole("button", { name: "确认转交", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("维修人员：周宁");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(
    page.locator(".field-order").filter({ hasText: order.id }),
  ).toContainText("周宁");
  await page.screenshot({
    path: "output/field-workflow/operations-1440.png",
    fullPage: true,
  });
  expect(
    (await api(request, "/api/field/home", tech.token)).currentRepair,
  ).toBeNull();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await login(page, "20261003");
  await page.getByRole("button", { name: "继续维修", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "维修说明", exact: true })
    .fill("交接后完成驱动修复与测试");
  await page.getByLabel("修复成功", { exact: true }).check();
  await page.getByRole("button", { name: "提交维修结果", exact: true }).click();
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "维修记录已提交", exact: true }),
  ).toBeVisible();
  expect((await api(request, "/api/field/home", next.token)).state).toBe(
    "available",
  );
});

test("field polling pauses when hidden and scanner releases every acquired track", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    window.fieldCameraStreams = [];
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      canvas.getContext("2d").fillRect(0, 0, 64, 64);
      const stream = canvas.captureStream(1);
      window.fieldCameraStreams.push(stream);
      return stream;
    };
  });
  let reads = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/field/home")) reads++;
  });
  await login(page, "20261002");
  await expect(
    page.getByRole("button", { name: "扫描维修码", exact: true }),
  ).toBeVisible();
  const initial = reads;
  await page.clock.fastForward(30000);
  await expect.poll(() => reads).toBeGreaterThan(initial);
  await page.getByRole("button", { name: "扫描维修码", exact: true }).click();
  expect(await page.evaluate(() => window.fieldCameraStreams.length)).toBe(0);
  await page.getByRole("button", { name: "开启摄像头", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.fieldCameraStreams.length))
    .toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const before = reads;
  await page.clock.fastForward(60000);
  expect(reads).toBe(before);
  expect(
    await page.evaluate(() =>
      window.fieldCameraStreams.every((s) =>
        s.getTracks().every((t) => t.readyState === "ended"),
      ),
    ),
  ).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => reads).toBeGreaterThan(before);
  expect(await page.evaluate(() => window.fieldCameraStreams.length)).toBe(1);
  await page.getByRole("button", { name: "开启摄像头", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.fieldCameraStreams.length))
    .toBe(2);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  expect(
    await page.evaluate(() =>
      window.fieldCameraStreams.every((s) =>
        s.getTracks().every((t) => t.readyState === "ended"),
      ),
    ),
  ).toBe(true);
});

test("shared QR writer works under the customer page security policy", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { qrImage } = await import("/shared/zxing.js");
    const blob = await qrImage("local-qr-regression");
    return { type: blob.type, size: blob.size };
  });
  expect(result.type).toBe("image/png");
  expect(result.size).toBeGreaterThan(0);
});


test("unified scanner previews attendance and resolves repairs without committing either action", async ({ page, request }) => {
  const office = await request.post('/api/auth/login', { data: { account: '20261001', password: 'StaffTest!2026' } }).then(r => r.json());
  const home = await api(request, '/api/field/home', office.token);
  const event = await api(request, '/api/attendance/events', office.token, { type: 'duty', businessDate: home.businessDate, campusId: 'campus-nanhu', requestId: crypto.randomUUID() });
  const credential = await api(request, `/api/attendance/events/${event.id}/token`, office.token, { revision: event.revision });
  const registered = await api(request, '/api/scan/onsite', office.token, {
    requestId: crypto.randomUUID(), registrationFlow: 'frontdesk', campus: '南湖',
    name: '扫码边界测试', studentId: '20305009', social: 'local-test', deviceType: '笔记本电脑',
    brand: '联想', deviceModel: 'ThinkPad QR', warranty: '否', faultType: '系统问题',
    signature: [Array.from({ length: 10 }, (_, i) => [0.1 + i * 0.05, 0.2 + i * 0.03])]
  });
  const order = await api(request, `/api/field/appointments/${registered.id}`, office.token);
  await login(page, '20261003');
  const myGroup = page.locator('.field-sidebar').getByRole('button', { name: '我的', exact: true }).first();
  if (await myGroup.getAttribute('aria-expanded') === 'false') await myGroup.click();
  await page.locator('.field-sidebar').getByRole('button', { name: '个人中心', exact: true }).click();
  await page.getByRole('button', { name: '到岗签到', exact: true }).click();
  const writes = [];
  page.on('request', request => {
    if (request.method() !== 'GET' && /\/api\/(attendance\/check-ins|field\/appointments)/.test(request.url())) writes.push(request.url());
  });
  async function uploadQr(value) {
    const bytes = await page.evaluate(async text => {
      const { qrImage } = await import('/shared/zxing.js');
      return Array.from(new Uint8Array(await (await qrImage(text)).arrayBuffer()));
    }, value);
    await page.getByRole('dialog').locator('input[type=file]').setInputFiles({ name: 'code.png', mimeType: 'image/png', buffer: Buffer.from(bytes) });
  }
  await uploadQr(credential.token);
  await expect(page.getByRole('dialog', { name: '确认到岗签到' })).toBeVisible();
  expect(writes).toEqual([]);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '到岗签到', exact: true }).click();
  await uploadQr(order.repairCode);
  await expect(page.getByRole('dialog')).not.toHaveAccessibleName('扫一扫');
  await expect(page.getByRole('dialog')).not.toHaveAccessibleName('确认到岗签到');
  await expect(page.getByRole('dialog')).toContainText(order.id);
  expect(writes).toEqual([]);
  await expect(page.locator('.field-sidebar').getByRole('button', { name: '扫码维修', exact: true })).toHaveCount(0);
});


test('an expired reception permission removes its scene and returns to personal work', async ({ page }) => {
  await login(page, '20261001');
  await expect(page.getByRole('heading', { name: '接待台', exact: true })).toBeVisible();
  await page.route('**/api/field/board*', route => route.fulfill({ status:403, contentType:'application/json', body:JSON.stringify({error:'当前没有该校区的现场岗位权限'}) }));
  await page.route('**/api/field/home*', async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      status: response.status(),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...data, contexts:[], capability:{ ...data.capability, 'onsite.frontdesk.create':false, 'repair.transfer':false } }),
    });
  });
  await page.locator('.field-footer').getByRole('button', { name:'刷新', exact:true }).click();
  await expect(page.getByRole('heading', { name:'个人中心', exact:true })).toBeVisible();
  await expect(page.locator('.field-sidebar').getByRole('button', { name:'接待台', exact:true })).toHaveCount(0);
  await expect(page.getByRole('button', { name:'展示签到码', exact:true })).toHaveCount(0);
  // The scene change starts a home reconciliation. Let intercepted responses
  // finish before Playwright disposes the request context at test teardown.
  await page.unrouteAll({ behavior: 'wait' });
});

test('all workspaces share title geometry and scrollable navigation across screen sizes', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': '192.0.2.177' });
  await login(page, 'root001');
  const entries = [
    ['维修工作台', '维修工作台'], ['接待台', '接待台'], ['现场管理', '现场管理'],
    ['个人中心', '个人中心'], ['预约记录', '预约记录'], ['班次与排班', '我的值班安排'],
    ['本人签到记录', '本人签到记录'], ['账号安全', '账号安全'], ['成员管理', '成员管理'],
    ['授权管理', '授权管理'], ['账号管理', '账号管理'], ['维修排班管理', '维修排班管理'],
    ['办公排班管理', '办公排班管理'], ['请假审批', '请假审批'], ['预约配置', '预约配置'], ['统计分析', '统计分析'],
  ];
  await mkdir('output/field-workflow/ui-consistency', { recursive: true });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    let reference;
    for (const [label, title] of entries) {
      if (width < 768 && label === '个人中心') await page.getByRole('navigation', { name: '手机岗位导航' }).getByRole('button', { name: '我的', exact: true }).click();
      else if (width < 768) {
        await page.getByRole('button', { name: '更多', exact: true }).click();
        await page.getByRole('dialog', { name: '工作入口', exact: true }).getByRole('button', { name: label, exact: true }).click();
      } else {
        const nav = page.locator('.field-sidebar');
        const target = nav.getByRole('button', { name: label, exact: true });
        if (!await target.isVisible()) {
          const group = nav.locator('.workspace-nav-group').filter({ has: target });
          await group.getByRole('button', { expanded: false }).click();
        }
        await target.click();
      }
      const route = page.locator('.workspace-page:not([hidden])');
      const heading = route.getByRole('heading', { name: title, exact: true, level: 1 });
      await expect(heading).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      const geometry = await heading.evaluate(node => {
        const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        return { x: rect.x, y: rect.y, size: style.fontSize, line: style.lineHeight, font: style.fontFamily, weight: style.fontWeight };
      });
      if (!reference) reference = geometry;
      expect(geometry, `${width}px ${label}`).toEqual(reference);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px ${label} overflow`).toBe(true);
      expect(await route.locator('main').count()).toBe(0);
      if (width === 768 && ['接待台', '现场管理'].includes(label)) {
        const customer = route.locator('.field-order > span:first-child').first();
        if (await customer.count()) expect((await customer.boundingBox()).width, 'customer identity stays readable beside the sidebar').toBeGreaterThan(120);
      }
      await page.screenshot({ path: `output/field-workflow/ui-consistency/${title}-${width}.png`, fullPage: true });
    }
    if (width >= 768) {
      const nav = page.locator('.field-sidebar > nav');
      expect(await nav.evaluate(node => getComputedStyle(node).scrollbarWidth)).toBe('none');
      await page.setViewportSize({ width, height: 500 });
      await nav.evaluate(node => { node.scrollTop = node.scrollHeight; });
      expect(await nav.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
      const bottomEntry = nav.getByRole('button', { name: '统计分析', exact: true });
      await bottomEntry.focus();
      await expect(bottomEntry).toBeInViewport();
      await expect(page.locator('.field-sidebar-bottom')).toBeInViewport();
      await page.setViewportSize({ width, height: 900 });
    }
  }
});

test('member detail keeps its header fixed while long forms scroll and restores focus', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': '192.0.2.178' });
  await login(page, 'root001');
  await page.locator('.field-sidebar').getByRole('button', { name: '成员管理', exact: true }).click();
  const opener = page.locator('.members-results .react-row').filter({ hasText: '陈宇' }).getByRole('button', { name: '编辑成员与权限' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: '陈宇', exact: true });
  await dialog.getByRole('button', { name: '角色授权', exact: true }).click();
  await dialog.getByRole('button', { name: '添加角色', exact: true }).click();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 650 });
    const header = dialog.locator(':scope > header');
    const body = dialog.locator('.workspace-dialog-body');
    const before = await header.boundingBox();
    await body.evaluate(node => { node.scrollTop = node.scrollHeight; });
    expect(await body.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    expect(await header.boundingBox()).toEqual(before);
    await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeInViewport();
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await body.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: `output/field-workflow/ui-consistency/成员详情滚动-${width}.png` });
  }
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await dialog.getByRole('button', { name: '放弃修改并关闭', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('management keeps its shell and readable results during refresh at all widths', async ({ page }) => {
  await login(page, 'root001');
  const sidebar = page.locator('.field-sidebar');
  await sidebar.evaluate(node => { node.dataset.identity = 'persistent'; });
  const managementGroup = sidebar.getByRole('button', { name: '平台管理', exact: true });
  if (await managementGroup.getAttribute('aria-expanded') === 'false') await managementGroup.click();
  await sidebar.getByRole('button', { name: '成员管理', exact: true }).click();
  await expect(page.locator('.react-member-identity').first()).toBeVisible();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/api/members?**', async route => { await held; await route.continue(); });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.locator('.members-results')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.react-member-identity').first()).toBeVisible();
  release();
  await expect(page.locator('.members-results')).toHaveAttribute('aria-busy', 'false');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/field-workflow/members-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const memberRow = page.locator('.members-results .react-row').filter({ hasText: '陈宇' });
  await memberRow.getByRole('button', { name: '编辑成员与权限' }).click();
  const memberDialog = page.getByRole('dialog', { name: '陈宇', exact: true });
  const memberName = memberDialog.getByLabel('姓名', { exact: true });
  await memberName.fill('陈宇测试草稿');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('staff-navigate', { detail: 'settings' })));
  await expect(memberDialog).toBeHidden();
  await sidebar.getByRole('button', { name: '成员管理', exact: true }).click();
  await expect(memberName).toHaveValue('陈宇测试草稿');
  await memberDialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(memberDialog.getByRole('heading', { name: '放弃未保存的修改？' })).toBeVisible();
  await memberDialog.getByRole('button', { name: '返回继续编辑' }).click();
  await memberDialog.getByRole('button', { name: '角色授权', exact: true }).click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await memberDialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: `output/field-workflow/member-detail-${width}.png`, animations: 'disabled' });
  }
  await memberDialog.getByRole('button', { name: '关闭', exact: true }).click();
  await memberDialog.getByRole('button', { name: '放弃修改并关闭' }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await sidebar.getByRole('button', { name: '授权管理', exact: true }).click();
  await expect(page.getByRole('heading', { name: '授权管理', exact: true })).toBeVisible();
  await expect(sidebar).toHaveAttribute('data-identity', 'persistent');
  await expect(sidebar.getByRole('button', { name: '平台管理', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('查找权限')).toBeVisible();
  await page.getByLabel('查找权限').fill('不存在的功能');
  await expect(page.getByText('没有匹配的权限，请调整筛选条件。')).toBeVisible();
  await page.getByLabel('查找权限').fill('');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.react-permission').first().evaluate(node => node.getBoundingClientRect().height)).toBeLessThan(180);
    expect(await page.locator('.react-permission input').first().evaluate(node => node.getBoundingClientRect().width)).toBeLessThan(24);
    await page.screenshot({ path: `output/field-workflow/permissions-${width}.png`, fullPage: true });
  }
});

test('switching work modules retains local filters and pauses the hidden board', async ({ page }) => {
  await page.clock.install();
  let boardReads = 0;
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/field/board') boardReads += 1;
  });
  await login(page, '20261001');
  await expect(page.getByRole('heading', { name: '接待台', exact: true })).toBeVisible();
  const search = page.getByRole('textbox', { name: '搜索当日预约' });
  await search.fill('ThinkPad');
  const mine = page.locator('.field-sidebar').getByRole('button', { name: '我的', exact: true });
  if (await mine.getAttribute('aria-expanded') === 'false') await mine.click();
  await page.locator('.field-sidebar').getByRole('button', { name: '班次与排班', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的值班安排' })).toBeVisible();
  const pausedAt = boardReads;
  await page.clock.fastForward(60000);
  expect(boardReads).toBe(pausedAt);
  await page.locator('.field-sidebar').getByRole('button', { name: '接待台', exact: true }).click();
  await expect(search).toHaveValue('ThinkPad');
  await expect.poll(() => boardReads).toBeGreaterThan(pausedAt);
});

test('personal attendance loads older pages without replacing existing facts and retries in place', async ({ page }) => {
  let failOlder = true;
  const first = {id:'attendance-current',businessDate:'2026-10-15',occurredAt:'2026-10-15T10:00:00.000Z',type:'duty',campusId:'campus-nanhu',nonScheduled:false};
  const older = {...first,id:'attendance-older',businessDate:'2026-10-14',occurredAt:'2026-10-14T10:00:00.000Z'};
  await page.route('**/api/me/attendance*', route => {
    const isOlder = new URL(route.request().url()).searchParams.has('cursor');
    return isOlder && failOlder ? route.fulfill({status:503,json:{error:'历史记录暂时不可用'}})
      : route.fulfill({json:{items:[isOlder ? older : first],nextCursor:isOlder ? null : 'older-cursor'}});
  });
  await login(page,'20261002');
  const sidebar = page.locator('.field-sidebar');
  await sidebar.getByRole('button',{name:'本人签到记录',exact:true}).click();
  const history = page.locator('.attendance-history');
  await expect(history.locator('li')).toHaveCount(1);
  await history.getByRole('button',{name:'加载更早的签到',exact:true}).click();
  await expect(history).toContainText('历史记录暂时不可用');
  await expect(history.locator('li')).toHaveCount(1);
  failOlder = false;
  await history.getByRole('button',{name:'加载更早的签到',exact:true}).click();
  await expect(history.locator('li')).toHaveCount(2);
  await expect(history.locator('li').first()).toContainText('2026-10-15');
  await expect(history.getByRole('button',{name:'加载更早的签到',exact:true})).toHaveCount(0);
  for (const width of [320,390,1440]) {
    await page.setViewportSize({width,height:900});
    expect(await history.evaluate(element => element.scrollWidth<=element.clientWidth)).toBeTruthy();
    await mkdir('output/field-workflow',{recursive:true});
    await page.screenshot({path:`output/field-workflow/attendance-history-${width}.png`,fullPage:true});
  }
});

test('security and business settings have separate workflows and consistent page headings', async ({ page }) => {
  // Compare settled layout coordinates, not the transient 4px route-entry
  // translation; retain the same strict alignment check on every platform.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page, 'root001');
  const sidebar = page.locator('.field-sidebar');
  async function open(group, name) {
    await page.setViewportSize({ width: 1440, height: 900 });
    const toggle = sidebar.getByRole('button', { name: group, exact: true });
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    await sidebar.getByRole('button', { name, exact: true }).click();
  }
  await open('我的', '账号安全');
  const heading = page.getByRole('heading', { name: '账号安全', exact: true });
  await expect(heading).toBeVisible();
  const position = await heading.boundingBox();
  await expect(page.locator('#capacity-settings')).toBeHidden();
  const currentPassword = page.locator('.settings-workspace').getByLabel('当前密码', { exact: true });
  await currentPassword.fill('unsaved-secret');
  await page.getByRole('button', { name: '撤销所有登录会话', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '撤销所有登录会话？' })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await open('业务管理', '预约配置');
  await expect(page.locator('.capacity-sheet-desktop input').first()).toBeVisible();
  await expect(currentPassword).toBeHidden();
  await open('我的', '账号安全');
  await expect(currentPassword).toHaveValue('');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/field-workflow/security-${width}.png`, fullPage: true });
  }
  await open('今日工作', '预约记录');
  const records = page.getByRole('heading', { name: '预约记录', exact: true, level: 1 });
  await expect(records).toBeVisible();
  const recordsPosition = await records.boundingBox();
  expect(Math.abs(position.x - recordsPosition.x)).toBeLessThan(2);
  expect(Math.abs(position.y - recordsPosition.y)).toBeLessThan(2);
  for (const [group, entry, title] of [['我的', '班次与排班', '我的值班安排'], ['值班管理', '维修排班管理', '维修排班管理']]) {
    await open(group, entry);
    const headingPosition = await page.getByRole('heading', { name: title, exact: true, level: 1 }).boundingBox();
    expect(Math.abs(position.x - headingPosition.x)).toBeLessThan(2);
    expect(Math.abs(position.y - headingPosition.y)).toBeLessThan(2);
  }
  await open('今日工作', '预约记录');
  await expect(page.getByRole('button', { name: '导出全部可见记录' })).toBeVisible();
  await open('我的', '账号安全');
  const settings = page.locator('.settings-workspace');
  let passwordWrites = 0;
  await page.route('**/api/auth/password', async route => {
    passwordWrites++;
    expect(route.request().postDataJSON()).toEqual({ currentPassword: 'wrong-password', newPassword: 'NewPassword123' });
    await route.fulfill({ status: 400, json: { error: '当前密码不正确' } });
  });
  await currentPassword.fill('wrong-password');
  await settings.getByLabel('新密码', { exact: true }).fill('NewPassword123');
  await settings.getByLabel('确认新密码', { exact: true }).fill('Different123');
  await settings.getByRole('button', { name: '修改密码并退出' }).click();
  await expect(settings.getByText('两次新密码不一致，请重新确认。')).toBeVisible();
  expect(passwordWrites).toBe(0);
  await settings.getByLabel('确认新密码', { exact: true }).fill('NewPassword123');
  await settings.getByRole('button', { name: '修改密码并退出' }).click();
  await expect(settings.getByText('当前密码不正确')).toBeVisible();
  expect(passwordWrites).toBe(1);
  const oldToken = await page.evaluate(() => sessionStorage.getItem('pioneerToken'));
  await settings.getByRole('button', { name: '撤销所有登录会话' }).click();
  await page.getByRole('button', { name: '确认撤销并退出' }).click();
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.getByText('所有登录会话已撤销，请重新登录。')).toBeVisible();
  const revoked = await page.request.get('/api/auth/me', { headers: { Authorization: `Bearer ${oldToken}` } });
  expect(revoked.status()).toBe(401);
});

test('capacity workspace preserves drafts, reconciles conflicts and supports mobile and desktop editing', async ({ page, request }) => {
  await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': '192.0.2.49' });
  await login(page, 'root001');
  const sidebar = page.locator('.field-sidebar');
  await sidebar.getByRole('button', { name: '预约配置', exact: true }).click();
  const editor = page.locator('.capacity-editor');
  const input = editor.locator('.capacity-sheet-desktop input').first();
  await expect(input).toBeVisible();
  await expect(page.locator('#capacity-settings')).toBeHidden();
  const token = await page.evaluate(() => sessionStorage.getItem('pioneerToken'));
  const original = (await api(request, '/api/slot-capacities', token)).items;
  const first = original.find(item => item.campus === '南湖' && item.weekday === 1 && item.timeSlot === '19:00–19:30');
  let writes = 0;
  page.on('request', req => { if (req.method() === 'PATCH' && req.url().endsWith('/api/slot-capacities')) writes++; });
  try {
    await input.fill('8');
    await expect(editor.getByText('1 项待保存', { exact: true })).toBeVisible();
    await sidebar.getByRole('button', { name: '账号安全', exact: true }).click();
    await page.getByRole('button', { name: '保留草稿并切换', exact: true }).click();
    await expect(page.getByRole('heading', { name: '账号安全', exact: true })).toBeVisible();
    // A preserved draft still protects against leaving/reloading the browser,
    // even when its workspace is hidden.
    expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false);
    await sidebar.getByRole('button', { name: '预约配置', exact: true }).click();
    await expect(input).toHaveValue('8');
    await api(request, '/api/slot-capacities', token, { items: [{ ...first, capacity: 9 }] }, 'PATCH');
    await editor.getByRole('button', { name: '读取最新配置', exact: true }).click();
    await expect(editor.getByRole('region', { name: '配置冲突' })).toContainText('最新值 9');
    await expect(input).toHaveValue('8');
    await expect(editor.getByRole('button', { name: '预览并保存' })).toBeDisabled();
    await editor.getByRole('button', { name: '保留我的修改', exact: true }).click();
    await editor.getByRole('button', { name: '预览并保存' }).click();
    const confirm = page.getByRole('button', { name: '确认保存全部修改' });
    // A second click while the first write is pending must not repeat it.
    await page.route('**/api/slot-capacities', async route => { if (route.request().method() === 'PATCH') await new Promise(resolve => setTimeout(resolve, 200)); await route.continue(); });
    await confirm.click();
    await expect(editor.getByText(/已保存 1 项/)).toBeVisible();
    expect(writes).toBe(1);
    await input.fill('11');
    const cell = editor.locator('[data-row="0"][data-col="0"]');
    await cell.focus(); await page.keyboard.press('Escape');
    await editor.getByRole('button', { name: '复制选区', exact: true }).click();
    await editor.getByRole('button', { name: '浑南校区', exact: true }).click();
    await editor.getByRole('button', { name: '粘贴', exact: true }).click();
    await expect(editor.locator('.capacity-sheet-desktop input').first()).toHaveValue('11');
    await editor.getByRole('button', { name: '放弃修改', exact: true }).click();
    await page.getByRole('button', { name: '确认放弃修改', exact: true }).click();
    await editor.getByRole('button', { name: '南湖校区', exact: true }).click();
    const handle = editor.getByRole('button', { name: '拖动复制选区人数' });
    const start = await handle.boundingBox(), end = await editor.locator('[data-row="1"][data-col="0"]').boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 6 }); await page.mouse.up();
    await expect(editor.locator('[data-row="1"][data-col="0"] input')).toHaveValue('8');
    await editor.getByRole('button', { name: '撤销上一步', exact: true }).click();
    await expect(editor.locator('[data-row="1"][data-col="0"] input')).toHaveValue('5');
    // Touch layouts use a vertical four-slot editor and keep the same draft.
    await page.setViewportSize({ width: 390, height: 900 });
    await editor.locator('.capacity-mobile-inputs input').first().fill('7');
    await editor.getByRole('button', { name: '周二', exact: true }).click();
    await editor.locator('.capacity-mobile-inputs input').first().fill('6');
    for (const width of [390, 320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `output/field-workflow/capacity-${width}.png`, fullPage: true });
    }
    await editor.getByRole('button', { name: '放弃修改', exact: true }).click();
    await page.getByRole('button', { name: '确认放弃修改', exact: true }).click();
    await editor.getByRole('button', { name: '日期实际容量', exact: true }).click();
    await editor.getByLabel('查看日期', { exact: true }).fill('2026-10-15');
    await expect(editor.getByRole('heading', { name: '工作人员', exact: true })).toBeVisible();
    await expect(editor.locator('.capacity-staffing')).toContainText('3 人');
    await expect(editor.locator('.capacity-staffing')).toContainText('1 人');
    await expect(editor.locator('.capacity-actual-slots article')).toHaveCount(4);
    await page.screenshot({ path: 'output/field-workflow/capacity-actual-1440.png', fullPage: true });
  } finally {
    const current = (await api(request, '/api/slot-capacities', token)).items;
    const updates = current.filter(item => original.find(old => old.campus === item.campus && old.weekday === item.weekday && old.timeSlot === item.timeSlot)?.capacity !== item.capacity).map(item => ({ ...item, capacity: original.find(old => old.campus === item.campus && old.weekday === item.weekday && old.timeSlot === item.timeSlot).capacity }));
    if (updates.length) await api(request, '/api/slot-capacities', token, { items: updates }, 'PATCH');
  }
});

test('account workspace imports, reviews and updates an account with server actions', async ({ page, request }) => {
  // Model an independent client for this workflow; do not exhaust the shared
  // local-IP login quota used by unrelated repair and scheduling scenarios.
  await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': '192.0.2.46' });
  await login(page, 'root001');
  await page.locator('.field-sidebar').getByRole('button', { name: '账号管理', exact: true }).click();
  const workspace = page.locator('.accounts-workspace');
  await expect(workspace.getByRole('heading', { name: '账号管理' })).toBeVisible();
  await expect(page.locator('#users-view')).toBeHidden();
  const protectedRow = workspace.locator('.account-row').filter({ hasText: 'root001' });
  await expect(protectedRow.getByText('系统保护账号')).toBeVisible();
  await expect(protectedRow.getByRole('button')).toHaveCount(0);
  await workspace.getByRole('button', { name: '加入资格', exact: true }).click();
  await workspace.getByRole('button', { name: '导入名单', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入加入名单' });
  await dialog.getByLabel('或粘贴 CSV').fill('studentId,expectedName\n20309991,周测试');
  await dialog.getByRole('button', { name: '导入名单', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(workspace.getByText('已导入 1 人，已有资格跳过 0 人。')).toBeVisible();
  const application = await request.post('/api/activation', { data: { studentId: '20309991', name: '周测试', homeCampus: '南湖', password: 'AccountTest!2026' } });
  expect(application.ok(), await application.text()).toBe(true);
  await workspace.getByRole('button', { name: '激活审核', exact: true }).click();
  await workspace.getByLabel('选择 20309991').check();
  await expect(workspace.getByRole('button', { name: '批准申请' })).toBeDisabled();
  await workspace.getByLabel('我已逐一核实选中申请的本人身份').check();
  await workspace.getByRole('button', { name: '批准申请' }).click();
  await expect(workspace.getByText('已处理 1 条申请。', { exact: true })).toBeVisible();
  await workspace.getByRole('button', { name: '账号列表', exact: true }).click();
  await workspace.getByLabel('查找账号').fill('20309991');
  const row = workspace.getByRole('region', { name: '工作人员账号列表' }).locator('.account-row').filter({ hasText: '20309991' });
  await row.getByRole('button', { name: '管理账号' }).click();
  const editor = page.getByRole('dialog', { name: '管理账号 · 周测试' });
  await editor.getByLabel('姓名', { exact: true }).fill('周测试更新');
  await editor.getByLabel('账号状态').selectOption('disabled');
  await editor.getByRole('button', { name: '保存账号' }).click();
  await expect(row).toContainText('周测试更新');
  await expect(row).toContainText('已停用');
  const denied = await request.post('/api/auth/login', { headers: { 'CF-Connecting-IP': '192.0.2.46' }, data: { account: '20309991', password: 'AccountTest!2026' } });
  expect(denied.status()).toBe(401);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const tabTops = await workspace.getByRole('navigation', { name: '账号管理功能' }).getByRole('button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().top));
    expect(Math.max(...tabTops) - Math.min(...tabTops)).toBeLessThan(1);
    await page.screenshot({ path: `output/field-workflow/accounts-${width}.png`, fullPage: true });
  }
});

test('records share filtering, responsive details and guarded record maintenance', async ({ page, request }) => {
  await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': '192.0.2.47' });
  await login(page, 'root001');
  const token = await page.evaluate(() => sessionStorage.getItem('pioneerToken'));
  const fixture = await recordFixture(request, token, '20309992');
  await page.locator('.field-sidebar').getByRole('button', { name: '预约记录', exact: true }).click();
  const workspace = page.locator('.records-workspace');
  await expect(workspace.getByRole('heading', { name: '预约记录', exact: true })).toBeVisible();
  await expect(page.locator('#staff-view')).toBeHidden();
  await expect(workspace.locator('.records-table tbody tr').first()).toBeVisible();
  await workspace.getByRole('button', { name: '状态，未排序；点击升序' }).click();
  await workspace.getByRole('button', { name: '校区，未排序；点击升序' }).click();
  await expect(workspace.locator('.records-result-meta')).toContainText('1. 状态↑ → 2. 校区↑');
  await workspace.getByRole('button', { name: '全部状态', exact: true }).click();
  const statusDialog = page.getByRole('dialog', { name: '状态筛选' });
  await statusDialog.getByRole('button', { name: '已取消' }).click();
  await statusDialog.getByRole('button', { name: '完成', exact: true }).click();
  await expect(workspace.locator('.records-table tbody tr')).toHaveCount(0);
  await workspace.getByRole('button', { name: '重置', exact: true }).click();
  await expect(workspace.locator('.records-table tbody tr').first()).toBeVisible();
  const overview = workspace.getByRole('region', { name: '近期预约概览' });
  await overview.locator('summary').click();
  await overview.getByRole('button', { name: '本周', exact: true }).click();
  const weeklyQuery = page.waitForRequest(value => { const url = new URL(value.url()); return url.pathname === '/api/appointments' && url.searchParams.get('campus') === '南湖' && url.searchParams.get('dateFrom') === '2026-10-12' && url.searchParams.get('timeSlot') === '19:00–19:30'; });
  await overview.locator('.records-campus').filter({ has: page.getByRole('button', { name: '南湖校区', exact: true }) }).getByRole('button', { name: /^19:00–19:30 / }).click();
  await weeklyQuery;
  await overview.locator('summary').click();
  await workspace.getByRole('button', { name: '重置', exact: true }).click();
  await expect(workspace.locator('.records-table tbody tr').first()).toBeVisible();
  const row = workspace.locator('.records-table tbody tr').filter({ hasText: fixture.id });
  const id = fixture.id;
  await row.getByRole('button', { name: '查看详情' }).click();
  const detail = page.getByRole('dialog').filter({ hasText: id });
  await expect(detail.getByRole('heading', { name: '记录管理', exact: true })).toBeVisible();
  await detail.getByText('附件与设备照片', { exact: true }).click();
  await expect(detail.getByText(/暂无可用附件|front|back/).first()).toBeVisible();
  await detail.getByRole('button', { name: '重发客户凭证', exact: true }).click();
  await detail.getByLabel('已人工核验客户本人身份').check();
  await detail.getByLabel('身份核验说明').fill('测试时已当面核验学生本人身份');
  await detail.getByRole('button', { name: '签发新凭证', exact: true }).click();
  await expect(detail.getByLabel('新私人链接')).toHaveValue(/appointment=.*access=/);
  await detail.getByRole('button', { name: '修正预约记录', exact: true }).click();
  const original = await api(request, `/api/field/appointments/${id}`, token);
  await detail.getByLabel('修正后状态').selectOption('cancelled');
  await detail.getByLabel('纠错原因').fill('测试客户重复登记，已核实申请取消');
  await detail.getByRole('button', { name: '核对修改', exact: true }).click();
  await detail.getByRole('button', { name: '确认修正记录', exact: true }).click();
  await expect(detail.getByText('预约记录已修正。')).toBeVisible();
  const corrected = await api(request, `/api/field/appointments/${id}`, token);
  expect(corrected.status).toBe('cancelled');
  expect(corrected.revision).toBeGreaterThan(original.revision);
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(workspace.locator('.records-table tbody tr').first()).toBeVisible();
    await page.screenshot({ path: `output/field-workflow/records-${width}.png`, fullPage: true });
  }
});

test('records keep rows and focus during delayed updates and pause while inactive', async ({ page, request }) => {
  await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': '192.0.2.48' });
  await login(page, 'root001');
  const token = await page.evaluate(() => sessionStorage.getItem('pioneerToken'));
  await recordFixture(request, token, '20309993');
  let reads = 0, release;
  const delayed = new Promise(resolve => { release = resolve; });
  await page.route('**/api/appointments?*', async route => {
    reads++;
    if (new URL(route.request().url()).searchParams.get('q') === 'temporary-query') {
      await delayed;
      await route.fulfill({ status: 503, json: { error: '暂时无法读取预约' } });
    } else await route.continue();
  });
  const sidebar = page.locator('.field-sidebar');
  await sidebar.getByRole('button', { name: '预约记录', exact: true }).click();
  const workspace = page.locator('.records-workspace');
  const first = workspace.locator('.records-table tbody tr').first();
  await expect(first).toBeVisible();
  const content = await first.textContent();
  const search = workspace.getByLabel('查找预约');
  const started = page.waitForRequest(value => value.url().includes('q=temporary-query'));
  await search.fill('temporary-query');
  await started;
  await expect(first).toHaveText(content);
  await expect(search).toBeFocused();
  release();
  await expect(workspace.getByText('暂时无法读取预约', { exact: true })).toBeVisible();
  await expect(first).toHaveText(content);
  await page.clock.install();
  await sidebar.getByRole('button', { name: '账号安全', exact: true }).click();
  const paused = reads;
  await page.clock.fastForward(61000);
  expect(reads).toBe(paused);
  await sidebar.getByRole('button', { name: '预约记录', exact: true }).click();
  await expect(search).toHaveValue('temporary-query');
  await expect.poll(() => reads).toBeGreaterThan(paused);
});

test('statistics uses the workspace region without reviving the legacy page', async ({ page }) => {
  await login(page, 'root001');
  const sidebar = page.locator('.field-sidebar');
  const reports = sidebar.getByRole('button', { name: '数据与审计', exact: true });
  if (await reports.getAttribute('aria-expanded') === 'false') await reports.click();
  await sidebar.getByRole('button', { name: '统计分析', exact: true }).click();
  await expect(page.getByRole('heading', { name: '统计分析', exact: true })).toBeVisible();
  await expect(page.locator('#stats-view')).toBeHidden();
  await expect(page.getByRole('combobox', { name: '统计范围' })).toBeVisible();
  const first = page.locator('.report-metrics .field-card').first();
  await expect(first).toBeVisible();
  const sidebarIdentity = await sidebar.evaluate(node => node.getBoundingClientRect().left);
  await page.getByRole('combobox', { name: '统计范围' }).selectOption('30');
  await expect(page.getByText('当前显示：最近 30 天')).toBeVisible();
  expect(await sidebar.evaluate(node => node.getBoundingClientRect().left)).toBe(sidebarIdentity);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/field-workflow/statistics-${width}.png`, fullPage: true });
  }
});
