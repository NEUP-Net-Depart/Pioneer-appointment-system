import {test, expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
test.skip(process.env.E2E_FIELD !== 'true', 'Uses the disposable field fixture');
test.use({extraHTTPHeaders:{'CF-Connecting-IP':'192.0.2.181'}});

test('active followups preserve QR, expose repair context and verify photos without leaving the handoff', async ({page,request,browser},testInfo) => {
  test.setTimeout(120000);
  const out='output/field-workflow/ui-refinements/'+testInfo.project.name; await mkdir(out,{recursive:true});
  async function api(path,token,body,method=body?'POST':'GET',guest=false) {
    const r=await request.fetch(path,{method,headers:token?{[guest?'X-Appointment-Token':'Authorization']:guest?token:'Bearer '+token}:{},...(body?{data:body}:{})});
    const value=await r.json();expect(r.ok(),JSON.stringify(value)).toBeTruthy();return value;
  }
  async function login(p,account){
    await p.goto('/staff/');
    await p.locator('#login-form').getByLabel('学号',{exact:true}).fill(account);
    await p.locator('#login-form').getByLabel('密码',{exact:true}).fill('StaffTest!2026');
    await p.getByRole('button',{name:'进入系统'}).click();
    await expect(p.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();
  }
  const office=await api('/api/auth/login',null,{account:'20261001',password:'StaffTest!2026'});
  const tech=await api('/api/auth/login',null,{account:'20261002',password:'StaffTest!2026'});
  const home=await api('/api/field/home',office.token);
  const code=await api(`/api/attendance/events/${home.event.id}/token`,office.token,{revision:home.event.revision});
  await api('/api/attendance/check-ins',tech.token,{token:code.token,requestId:crypto.randomUUID()});
  // Distinct image fixtures make swapped sides and broken previews visible in screenshots.
  const photoFixtures=await page.evaluate(()=>Object.fromEntries(['front','back'].map(side=>{
    const canvas=document.createElement('canvas');canvas.width=480;canvas.height=320;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#e6ebf0';ctx.fillRect(0,0,480,320);
    ctx.fillStyle='#253342';ctx.fillRect(60,40,360,210);
    ctx.fillStyle=side==='front'?'#7096b7':'#424e5c';ctx.fillRect(72,52,336,186);
    ctx.fillStyle='#a7b0ba';ctx.fillRect(40,250,400,18);
    ctx.fillStyle='white';ctx.font='24px sans-serif';ctx.fillText(side==='front'?'FRONT · T14':'BACK · T14',140,155);
    return [side,canvas.toDataURL('image/png').split(',')[1]];
  })));
  const photo=photoFixtures.front;
  const verification={brand:'联想',model:'现场核实型号 T14',warranty:'expired',liquidMetal:'no',note:'现场确认外壳有划痕'};
  async function create(studentId){return api('/api/scan/onsite',office.token,{
    requestId:crypto.randomUUID(),registrationFlow:'frontdesk',campus:'南湖',name:'联调审查客户',studentId,social:'local-review',deviceType:'笔记本电脑',brand:'联想',deviceModel:'客户原填型号 T480',warranty:'否',faultType:'系统问题',issue:'最初故障：开机黑屏',signature:[Array.from({length:10},(_,i)=>[.1+i*.05,.2+i*.03])]
  });}
  async function photos(id,token){const ids={};for(const side of ['front','back']) ids[side]=(await api(`/api/appointments/${id}/attachments`,token,{filename:side+'.png',mimeType:'image/png',data:photoFixtures[side],purpose:'intake_'+side})).id;return {frontPhotoId:ids.front,backPhotoId:ids.back};}
  async function receive(item){return api(`/api/appointments/${item.id}/reception`,office.token,{action:'receive',revision:item.revision,requestId:crypto.randomUUID(),verification,...await photos(item.id,office.token)});}
  const parent=await create('20307281');
  const started=await api(`/api/appointments/${parent.id}/status`,tech.token,{status:'in_progress',revision:parent.revision,requestId:crypto.randomUUID(),verification,...await photos(parent.id,tech.token)},'PATCH');
  const previousNote='上轮已更换内存并测试开机成功';
  await api(`/api/appointments/${parent.id}/status`,tech.token,{status:'completed',revision:started.revision,requestId:crypto.randomUUID(),outcome:'repaired',repairNote:previousNote},'PATCH');
  const reason='返修新表现：使用半小时后再次蓝屏';
  const followup=await api(`/api/appointments/${parent.id}/repair-followups`,parent.accessToken,{reason,requestId:crypto.randomUUID()},'POST',true);
  const pending=(await api('/api/repair-followups?status=pending',office.token)).items.find(row=>row.followup.id===followup.id).followup;
  const scheduled=await api(`/api/repair-followups/${followup.id}/decision`,office.token,{action:'schedule',date:'2026-10-15',timeSlot:'19:30–20:00',revision:pending.revision,requestId:crypto.randomUUID()});
  const first=await receive(await create('20307282'));
  let child=await receive(await api(`/api/field/appointments/${scheduled.appointmentId}`,office.token));
  const guest=await browser.newPage({baseURL:process.env.E2E_BASE_URL,viewport:{width:390,height:900}});
  const worker=await browser.newPage({baseURL:process.env.E2E_BASE_URL,viewport:{width:390,height:900}});
  try {
    await guest.goto('/#'+new URLSearchParams({appointment:parent.id,access:parent.accessToken}));
    await expect(guest.locator('#detail-queue')).toContainText('返修现场排队');
    await expect(guest.locator('#detail-summary')).toContainText('当前返修 · 第 2 轮');
    await expect(guest.locator('#detail-summary')).toContainText('排队中');
    await expect(guest.locator('#detail-summary')).toContainText('19:30–20:00');
    await expect(guest.locator('#detail-summary')).not.toContainText('本次维修已结束');
    await guest.screenshot({animations:'disabled',path:out+'/parent-queued-390.png'});
    await guest.locator('#back-to-appointments').click();
    await expect(guest.locator('.record-group').first()).toContainText('排队中');
    await expect(guest.locator('.record-group').first()).toContainText(reason);
    await guest.screenshot({animations:'disabled',path:out+'/parent-list-390.png'});
    await guest.locator('.student-record').click();
    await guest.getByRole('button',{name:'显示返修维修码',exact:true}).click();
    const qr=guest.locator('.followup-qr-container img');
    await expect(qr).toHaveAttribute('src',/^blob:/);
    const originalQr=await qr.elementHandle();
    const qrSrc=await qr.getAttribute('src');
    await guest.locator('.repair-history-details > summary').click();
    await guest.getByRole('button',{name:'显示返修维修码',exact:true}).focus();
    await api(`/api/appointments/${first.id}/reception`,office.token,{action:'leave',revision:first.revision,reason:'客户临时离开',requestId:crypto.randomUUID()});
    await guest.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await expect(guest.locator('#detail-queue .customer-queue > div').nth(1).locator('strong')).toHaveText('1 位');
    await expect(qr).toHaveAttribute('src',qrSrc);
    await expect(guest.locator('.repair-history-details')).toHaveAttribute('open','');
    expect(await originalQr.evaluate(node=>node.isConnected)).toBe(true);
    await expect(guest.getByRole('button',{name:'显示返修维修码',exact:true})).toBeFocused();
    await login(page,'20261001');
    await page.setViewportSize({width:390,height:900});
    await expect(page.locator('.field-order').filter({hasText:child.id})).toBeVisible();
    await expect(page.locator('.field-order').filter({hasText:child.id})).toContainText('返修');
    await page.screenshot({animations:'disabled',path:out+'/desk-390.png'});
    await page.locator('.field-order').filter({hasText:child.id}).click();
    const panel=page.getByRole('dialog');
    await expect(panel.getByRole('heading',{name:'选择空闲维修人员',exact:true})).toBeVisible();
    const officeText=await panel.innerText();
    expect(officeText).toContain(reason);
    expect(officeText).toContain(previousNote);
    await page.screenshot({animations:'disabled',path:out+'/followup-staff-detail-390.png'});
    await panel.locator('input[type=radio][value="20261002"]').check();
    await panel.getByRole('button',{name:'确认分派，等待接手',exact:true}).click();
    await expect(panel.getByText('已分派给 陈宇 · 待接手',{exact:true})).toBeVisible();
    await guest.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await expect(guest.locator('#detail-summary')).toContainText('已分派 · 待现场核对');
    await expect(qr).toHaveAttribute('src',qrSrc);
    expect(await originalQr.evaluate(node=>node.isConnected)).toBe(true);
    await expect(guest.locator('.repair-history-details')).toHaveAttribute('open','');
    await expect(guest.getByRole('button',{name:'显示返修维修码',exact:true})).toBeFocused();
    await login(worker,'20261002');
    await worker.getByRole('button',{name:'核对设备并接手',exact:true}).click();
    const accept=worker.getByRole('dialog');
    await expect(accept).toContainText(reason);
    await expect(accept).toContainText(previousNote);
    await expect(accept.getByRole('button',{name:'确认接手，开始维修',exact:true})).toBeInViewport();
    await expect(accept.locator('.repair-stages [aria-current=step]')).toHaveText('待接手');
    await worker.screenshot({animations:'disabled',path:out+'/accept-initial-390.png'});
    await accept.getByText('更正核验信息',{exact:true}).click();
    await expect(accept.getByLabel('型号',{exact:true})).toHaveValue(verification.model);
    await expect(accept.locator('.field-accept-check')).toContainText(verification.model);
    await expect(accept.locator('.field-ticket h3')).toContainText(verification.model);
    await expect(accept.locator('.field-intake-photos img')).toHaveCount(2);
    await expect(accept.getByRole('img',{name:'设备正面照片',exact:true})).toHaveAttribute('src',/^blob:/);
    await expect(accept.getByRole('img',{name:'设备背面照片',exact:true})).toHaveAttribute('src',/^blob:/);
    await expect.poll(()=>accept.locator('.field-intake-photos img').evaluateAll(images=>images.every(img=>img.complete && img.naturalWidth>0))).toBe(true);
    await accept.getByRole('button',{name:'查看设备正面照片',exact:true}).click();
    const photoDialog=worker.getByRole('dialog',{name:'设备正面照片',exact:true});
    await expect(photoDialog.getByRole('img')).toBeVisible();
    await worker.keyboard.press('Escape');
    await expect(photoDialog).toBeHidden();
    await expect(accept.getByRole('button',{name:'查看设备正面照片',exact:true})).toBeFocused();
    await expect(accept.locator('.repair-original')).toContainText('客户原填型号 T480');
    await accept.getByRole('checkbox',{name:/我已当面核对/}).check();
    await accept.getByLabel('型号',{exact:true}).fill('维修复核型号 T14 Gen 2');
    await expect(accept.getByRole('checkbox',{name:/我已当面核对/})).not.toBeChecked();
    await expect(accept.getByRole('button',{name:'确认接手，开始维修',exact:true})).toBeDisabled();
    await expect(accept.locator('.field-accept-check')).toContainText('维修复核型号 T14 Gen 2');
    for(const width of [320,390,768,1440]) {
      await worker.setViewportSize({width,height:900});
      await accept.locator('.field-intake-photos').scrollIntoViewIfNeeded();
      expect(await accept.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
      await expect(accept.getByRole('button',{name:'确认接手，开始维修',exact:true})).toBeInViewport();
      await worker.screenshot({animations:'disabled',path:out+`/handoff-${width}.png`});
      await guest.setViewportSize({width,height:900});
      await guest.evaluate(()=>window.scrollTo(0,0));
      expect(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await guest.screenshot({animations:'disabled',path:out+`/current-followup-${width}.png`});
    }
    await worker.setViewportSize({width:390,height:900});
    await guest.setViewportSize({width:390,height:900});
    await accept.locator('.field-accept-check').scrollIntoViewIfNeeded();
    await worker.screenshot({animations:'disabled',path:out+'/accept-verified-mismatch-390.png'});
    await accept.getByRole('checkbox',{name:/我已当面核对/}).check();
    await accept.getByLabel('设备正面照片',{exact:true}).setInputFiles({name:'replacement-front.png',mimeType:'image/png',buffer:Buffer.from(photo,'base64')});
    await expect(accept.getByRole('checkbox',{name:/我已当面核对/})).not.toBeChecked();
    await accept.getByRole('checkbox',{name:/我已当面核对/}).check();
    await accept.getByRole('button',{name:'确认接手，开始维修',exact:true}).click();
    await expect(accept.getByLabel('维修说明',{exact:true})).toBeVisible();
    await expect(accept.locator('.repair-stages [aria-current=step]')).toHaveText('维修中');
    await guest.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await expect(guest.locator('.repair-round-time').last()).toContainText('维修中');
    await expect(guest.locator('#detail-queue')).toBeHidden();
    await expect(guest.locator('#detail-summary')).toContainText('维修中');
    await expect(guest.locator('#detail-summary')).not.toContainText('已完成');
    await guest.evaluate(()=>window.scrollTo(0,0));
    await guest.screenshot({animations:'disabled',path:out+'/parent-in-progress-390.png'});
    const details=await api(`/api/field/appointments/${child.id}`,tech.token);
    expect(details.frontPhotoId).not.toBe(child.frontPhotoId);
    expect(details.backPhotoId).toBe(child.backPhotoId);
    expect(details.intake.model).toBe('维修复核型号 T14 Gen 2');
    expect(details.repairHistory.items.find(row=>row.id===parent.id).repairNote).toBe(previousNote);
    expect(details.repairHistory.followups[0].reason).toBe(reason);
    await api(`/api/appointments/${child.id}/status`,tech.token,{status:'completed',revision:details.revision,requestId:crypto.randomUUID(),outcome:'repaired',repairNote:'返修完成'},'PATCH');

  } finally {
    await guest.close();await worker.close();
    // Release only this test's work, including when a UI assertion fails midway.
    for (const id of [first.id,child.id]) {
      const current=await api(`/api/field/appointments/${id}`,office.token);
      if(current.status==='booked' && ['queued','assigned'].includes(current.reception?.state))
        await api(`/api/appointments/${id}/reception`,office.token,{action:'leave',revision:current.revision,reason:'浏览器验收结束',requestId:crypto.randomUUID()});
      if(current.status==='in_progress')
        await api(`/api/appointments/${id}/status`,tech.token,{status:'completed',revision:current.revision,requestId:crypto.randomUUID(),outcome:'repaired',repairNote:'浏览器验收结束'},'PATCH');
    }
  }
});
