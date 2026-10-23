import { test, expect } from '@playwright/test';
test.skip(process.env.E2E_FIELD !== 'true', 'Uses the disposable field fixture');
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '198.18.61.74' } });
async function api(request, path, token, body, method = body ? 'POST' : 'GET') {
  const r = await request.fetch(path, {
    method,
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    ...(body ? { data: body } : {})
  });
  const v = await r.json();
  expect(r.ok(), JSON.stringify(v)).toBeTruthy();
  return v;
}
test('office schedules a customer followup once after a lost response without receiving future customer details', async ({
  page,
  request,
  browser
}) => {
  test.setTimeout(120000);
  const office = await api(request, '/api/auth/login', null, {
    account: '20261001',
    password: 'StaffTest!2026'
  });
  const tech = await api(request, '/api/auth/login', null, {
    account: '20261002',
    password: 'StaffTest!2026'
  });
  const root = await api(request, '/api/auth/login', null, {
    account: 'root001',
    password: process.env.E2E_ROOT_PASSWORD
  });
  const home = await api(request, '/api/field/home', office.token);
  const credential = await api(
    request,
    `/api/attendance/events/${home.event.id}/token`,
    office.token,
    { revision: home.event.revision }
  );
  await api(request, '/api/attendance/check-ins', tech.token, {
    token: credential.token,
    requestId: crypto.randomUUID()
  });
  const order = await api(request, '/api/scan/onsite', office.token, {
    requestId: crypto.randomUUID(),
    registrationFlow: 'frontdesk',
    campus: '南湖',
    name: '返修回执验收',
    studentId: '20306174',
    social: 'followup-check',
    deviceType: '笔记本电脑',
    brand: '联想',
    deviceModel: '回执验收设备',
    warranty: '否',
    faultType: '系统问题',
    signature: [Array.from({ length: 10 }, (_, i) => [0.1 + i * 0.05, 0.2 + i * 0.03])]
  });
  const photo =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Hf8AAAAASUVORK5CYII=';
  const photos = {};
  for (const side of ['front', 'back'])
    photos[side] = (
      await api(request, `/api/appointments/${order.id}/attachments`, tech.token, {
        filename: side + '.png',
        mimeType: 'image/png',
        data: photo,
        purpose: 'intake_' + side
      })
    ).id;
  const item = await api(
    request,
    `/api/appointments/${order.id}/status`,
    tech.token,
    {
      requestId: crypto.randomUUID(),
      status: 'in_progress',
      revision: order.revision,
      frontPhotoId: photos.front,
      backPhotoId: photos.back,
      verification: {
        brand: '联想',
        model: '回执验收设备',
        warranty: 'expired',
        liquidMetal: 'no',
        note: '设备已核对'
      }
    },
    'PATCH'
  );
  await api(
    request,
    `/api/appointments/${order.id}/status`,
    tech.token,
    {
      requestId: crypto.randomUUID(),
      status: 'completed',
      revision: item.revision,
      outcome: 'repaired',
      repairNote: '完成初次维修，测试返修反馈'
    },
    'PATCH'
  );
  const credentialLink = await api(
    request,
    `/api/appointments/${order.id}/credential`,
    root.token,
    { identityVerified: true, reason: '已核验测试机主身份，生成本次测试私人链接' }
  );
  const guest = await browser.newPage({
    baseURL: process.env.E2E_BASE_URL,
    viewport: { width: 390, height: 900 }
  });
  try {
    await guest.goto(
      '/#' + new URLSearchParams({ appointment: order.id, access: credentialLink.accessToken })
    );
    const history = guest.locator('.repair-history-section');
    await expect(history.locator('.repair-round-result')).toHaveText('修复成功');
    await history
      .getByRole('textbox', { name: '返修情况', exact: true })
      .fill('修复后相同故障再次出现，请安排复查');
    await history.getByRole('button', { name: '提交返修申请', exact: true }).click();
    await expect(history).toContainText('返修申请已提交');
    await page.addInitScript(() => {
      const NativeDate = Date;
      globalThis.Date = class extends NativeDate {
        constructor(...args) {
          super(...(args.length ? args : ['2026-10-15T02:00:00Z']));
        }
        static now() {
          return Date.parse('2026-10-15T02:00:00Z');
        }
      };
    });
    await page.goto('/staff/');
    await page.locator('#login-form').getByLabel('学号', { exact: true }).fill('20261001');
    await page.locator('#login-form').getByLabel('密码', { exact: true }).fill('StaffTest!2026');
    await page.getByRole('button', { name: /进入系统/ }).click();
    await page
      .getByRole('navigation', { name: '岗位工作导航' })
      .getByRole('button', { name: '预约记录', exact: true })
      .click();
    const card = page.locator('.followup-card').filter({ hasText: order.id });
    await card.getByRole('button', { name: '安排返修', exact: true }).click();
    await card.getByLabel('维修日期', { exact: true }).fill('2026-10-19');
    await card.getByRole('combobox', { name: '时段', exact: true }).selectOption('19:00–19:30');
    const requests = [],
      responses = [];
    let dropped = false;
    await page.route('**/api/repair-followups/*/decision', async (route) => {
      requests.push(route.request().postDataJSON());
      const result = await route.fetch();
      expect(result.ok()).toBeTruthy();
      responses.push(await result.json());
      if (!dropped) {
        dropped = true;
        await route.abort('connectionfailed');
      } else await route.fulfill({ response: result });
    });
    await card.getByRole('button', { name: '确认安排返修', exact: true }).click();
    await expect(card).toHaveCount(0);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
    expect(responses[1].idempotent).toBe(true);
    expect(responses[0].appointment).toEqual(responses[1].appointment);
    expect(Object.keys(responses[0].appointment).sort()).toEqual(
      ['id', 'campus', 'date', 'timeSlot', 'status'].sort()
    );
    const forbidden = await request.get('/api/field/appointments/' + responses[0].appointment.id, {
      headers: { Authorization: 'Bearer ' + office.token }
    });
    expect(forbidden.status()).toBe(403);
    await page.reload();
    await page
      .getByRole('navigation', { name: '岗位工作导航' })
      .getByRole('button', { name: '预约记录', exact: true })
      .click();
    await expect(page.locator('.followup-card').filter({ hasText: order.id })).toHaveCount(0);
    await guest.reload();
    await expect(history).toContainText(responses[0].appointment.id);
    await expect(history).toContainText('已安排维修');
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
  } finally {
    await guest.close();
  }
});
