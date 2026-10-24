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
test('followup permissions, public history, duplicate prevention and appointment times survive a lost scheduling response', async ({
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
  const completed = await api(
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
  const internalReason = '内部核查：原记录录入人员的处理情况，学生不应看到';
  await api(request, `/api/appointments/${order.id}/correction`, root.token, {
    revision: completed.revision,
    repairNote: '完成初次维修，测试返修反馈',
    correctionReason: internalReason
  }, 'PATCH');
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
    await expect(history).not.toContainText(internalReason);
    await expect(guest.locator('#detail-summary')).toContainText('现场临时登记');
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
    await expect(page.locator('.followup-receipt')).toContainText('返修已安排');
    await expect(page.locator('.followup-receipt')).toContainText('2026-10-19');
    await expect(page.getByRole('button',{name:'打开返修工单',exact:true})).toHaveCount(0);
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
    await expect(history).toContainText('返修预约 · 19:00–19:30');
    await expect(history.getByRole('button', { name: '提交返修申请', exact: true })).toHaveCount(0);
    await expect(history).toContainText('返修处理中');
    const childCredential = await api(request, `/api/appointments/${responses[0].appointment.id}/credential`, root.token, {
      identityVerified: true, reason: '已核验测试机主身份，检查返修单日期时段展示'
    });
    await guest.goto('/#' + new URLSearchParams({ appointment: responses[0].appointment.id, access: childCredential.accessToken }));
    await expect(guest.locator('#detail-summary')).toContainText('返修预约 · 19:00–19:30');
    await expect(guest.locator('#detail-summary')).not.toContainText('现场临时登记');
    await guest.getByRole('button', { name: '取消预约', exact: true }).click();
    await expect(guest.locator('#cancel-confirmation')).toContainText('返修预约 · 19:00–19:30');
    await guest.getByRole('button', { name: '确认取消', exact: true }).click();
    await expect(guest.locator('#detail-summary')).toContainText('已取消');
    await guest.locator('#back-to-appointments').click();
    await expect(guest.locator('.student-record').filter({ hasText: '返修预约 · 19:00–19:30' })).toHaveCount(1);
    await guest.goto('/#' + new URLSearchParams({ appointment: order.id, access: credentialLink.accessToken }));
    await expect(history.getByRole('button', { name: '提交返修申请', exact: true })).toBeVisible();
    await history.getByRole('textbox', {name:'返修情况',exact:true}).fill('改为今天到场返修，验证现场排队');
    await history.getByRole('button', {name:'提交返修申请',exact:true}).click();
    await expect(history).toContainText('返修申请已提交');
    await expect(history.getByRole('button',{name:'提交返修申请',exact:true})).toHaveCount(0);
    const nextPending=(await api(request,'/api/repair-followups?status=pending',office.token)).items.find(row=>row.appointment.id===order.id).followup;
    const sameDay=await api(request,`/api/repair-followups/${nextPending.id}/decision`,office.token,{
      action:'schedule',requestId:crypto.randomUUID(),revision:nextPending.revision,date:'2026-10-15',timeSlot:'19:30–20:00'
    });
    async function receiveChild() {
      const child=await api(request,`/api/field/appointments/${sameDay.appointmentId}`,office.token);
      const ids=[];
      for(const side of ['front','back'])ids.push((await api(request,`/api/appointments/${child.id}/attachments`,office.token,{
        filename:side+'.png',mimeType:'image/png',data:photo,purpose:'intake_'+side
      })).id);
      return api(request,`/api/appointments/${child.id}/reception`,office.token,{
        action:'receive',revision:child.revision,requestId:crypto.randomUUID(),frontPhotoId:ids[0],backPhotoId:ids[1],
        verification:{brand:'联想',model:'返修现场核验',warranty:'expired',liquidMetal:'no',note:'核验完成'}
      });
    }
    const arrived=await receiveChild();
    await guest.reload();
    const queue=guest.locator('#detail-queue');
    await expect(queue.getByRole('heading',{name:'返修现场排队',exact:true})).toBeVisible();
    await expect(queue).toContainText(sameDay.appointmentId);
    await expect(queue).toContainText(String(arrived.reception.ticket.number).padStart(3,'0')+'号');
    await expect(queue.locator('.customer-queue > div').nth(1).locator('strong')).toHaveText('1 位');
    for(const width of [320,390,768,1440]) {
      await guest.setViewportSize({width,height:900});
      expect(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await guest.setViewportSize({width:390,height:900});
    await queue.getByRole('button',{name:'临时离开，退出排队',exact:true}).click();
    await guest.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await expect(queue.locator('[data-queue-confirm]')).toBeVisible();
    await expect(queue.getByRole('button',{name:'确认退出排队',exact:true})).toBeFocused();
    const exits=[];
    await guest.route('**/repair-followups/*/queue-exit',async route=>{
      exits.push(route.request().postDataJSON());
      if(exits.length===1){const result=await route.fetch();expect(result.ok()).toBeTruthy();return route.abort('connectionfailed');}
      return route.continue();
    });
    await queue.getByRole('button',{name:'确认退出排队',exact:true}).click();
    await expect(queue.getByRole('heading',{name:'已退出现场排队',exact:true})).toBeVisible();
    expect(exits).toHaveLength(2);expect(exits[0]).toEqual(exits[1]);
    const rejoined=await receiveChild();
    expect(rejoined.reception.ticket.number).toBeGreaterThan(arrived.reception.ticket.number);
    await guest.reload();
    await expect(queue).toContainText(String(rejoined.reception.ticket.number).padStart(3,'0')+'号');
    await queue.getByRole('button',{name:'临时离开，退出排队',exact:true}).click();
    await queue.getByRole('button',{name:'确认退出排队',exact:true}).click();
    await expect(queue.getByRole('heading',{name:'已退出现场排队',exact:true})).toBeVisible();
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
  } finally {
    await guest.close();
  }
});
