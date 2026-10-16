import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

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
  await expect(page.locator(".field-app")).toBeVisible();
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
  await page.locator('.field-sidebar').getByRole('button', { name: '我的', exact: true }).first().click();
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
  await expect(page.getByRole('heading', { name:'我的工作', exact:true })).toBeVisible();
  await expect(page.locator('.field-sidebar').getByRole('button', { name:'接待台', exact:true })).toHaveCount(0);
  await expect(page.getByRole('button', { name:'展示签到码', exact:true })).toHaveCount(0);
  // The scene change starts a home reconciliation. Let intercepted responses
  // finish before Playwright disposes the request context at test teardown.
  await page.unrouteAll({ behavior: 'wait' });
});

test('management keeps its shell and readable results during refresh at all widths', async ({ page }) => {
  await login(page, 'root001');
  const sidebar = page.locator('.field-sidebar');
  await sidebar.evaluate(node => { node.dataset.identity = 'persistent'; });
  await sidebar.getByRole('button', { name: '平台管理', exact: true }).click();
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
  await sidebar.getByRole('button', { name: '授权管理', exact: true }).click();
  await expect(page.getByRole('heading', { name: '权限身份', exact: true })).toBeVisible();
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

test('statistics uses the workspace region without reviving the legacy page', async ({ page }) => {
  await login(page, 'root001');
  const sidebar = page.locator('.field-sidebar');
  const reports = sidebar.getByRole('button', { name: '数据与审计', exact: true });
  if (await reports.getAttribute('aria-expanded') === 'false') await reports.click();
  await sidebar.getByRole('button', { name: '统计分析', exact: true }).click();
  await expect(page.getByRole('heading', { name: '维修统计', exact: true })).toBeVisible();
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
