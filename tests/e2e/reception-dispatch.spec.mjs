import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

test.skip(process.env.E2E_FIELD!=='true','Uses the disposable field fixture');
test.use({extraHTTPHeaders:{'CF-Connecting-IP':'192.0.2.169'}});
async function api(request,path,token,body){
  const response=await request.fetch(path,{method:body?'POST':'GET',headers:token?{Authorization:`Bearer ${token}`}:{},...(body?{data:body}:{})});
  const value=await response.json();expect(response.ok(),JSON.stringify(value)).toBeTruthy();return value;
}
async function login(page,account){
  await page.goto('/staff/');
  await page.locator('#login-form').getByLabel('学号',{exact:true}).fill(account);
  await page.locator('#login-form').getByLabel('密码',{exact:true}).fill('StaffTest!2026');
  await page.getByRole('button',{name:'进入系统'}).click();
  await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();
}
test('reception and worker share a real queued, returned, accepted and completed order across screen sizes',async({page,request,browser})=>{
  test.setTimeout(120000);
  const office=await api(request,'/api/auth/login',null,{account:'20261001',password:'StaffTest!2026'});
  const tech=await api(request,'/api/auth/login',null,{account:'20261002',password:'StaffTest!2026'});
  const home=await api(request,'/api/field/home',office.token);
  const credential=await api(request,`/api/attendance/events/${home.event.id}/token`,office.token,{revision:home.event.revision});
  await api(request,'/api/attendance/check-ins',tech.token,{token:credential.token,requestId:crypto.randomUUID()});
  const order=await api(request,'/api/scan/onsite',office.token,{requestId:crypto.randomUUID(),registrationFlow:'frontdesk',campus:'南湖',name:'分派验收客户',studentId:'20306999',social:'reception-check',deviceType:'笔记本电脑',brand:'联想',deviceModel:'ThinkPad 分派验收',warranty:'否',faultType:'系统问题',signature:[Array.from({length:10},(_,i)=>[.1+i*.05,.2+i*.03])]});
  await login(page,'20261001');
  await page.getByRole('group',{name:'现场概览'}).getByRole('button',{name:/^未到场/}).click();
  await expect(page.locator('.field-order').filter({hasText:order.id})).toBeVisible();
  await page.getByRole('group',{name:'现场概览'}).getByRole('button',{name:/^排队中/}).click();
  await expect(page.locator('.field-order').filter({hasText:order.id})).toHaveCount(0);
  await page.getByRole('group',{name:'现场概览'}).getByRole('button',{name:/^未到场/}).click();
  await page.locator('.field-order').filter({hasText:order.id}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('heading',{name:'到场接待',exact:true})).toBeVisible();
  await dialog.getByLabel('厂商',{exact:true}).fill('联想');
  await dialog.getByLabel('型号',{exact:true}).fill('ThinkPad 已现场核对');
  await dialog.getByRole('combobox',{name:'保修情况',exact:true}).selectOption('expired');
  await dialog.getByRole('combobox',{name:'液金散热',exact:true}).selectOption('no');
  await expect(dialog.getByRole('button',{name:'完成接待，进入现场队列',exact:true})).toBeDisabled();
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Hf8AAAAASUVORK5CYII=','base64');
  for(const side of ['正面','背面'])await dialog.getByLabel(`设备${side}照片`,{exact:true}).setInputFiles({name:`${side}.png`,mimeType:'image/png',buffer:image});
  await dialog.getByRole('button',{name:'完成接待，进入现场队列',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'选择空闲维修人员',exact:true})).toBeVisible();
  await expect(dialog.locator('input[type=radio][value="20261002"]')).toBeVisible();
  await expect(dialog.locator('input[type=radio]:checked')).toHaveCount(0);
  await mkdir('output/reception-dispatch',{recursive:true});
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
    const box=await dialog.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width+1);
    await page.screenshot({path:`output/reception-dispatch/queue-${width}.png`});
  }
  await dialog.locator('input[type=radio][value="20261002"]').check();
  const dispatchBodies=[];let dropped=false;
  await page.route('**/api/appointments/*/reception',async route=>{
    if (route.request().postDataJSON()?.action!=='assign')return route.continue();
    dispatchBodies.push(route.request().postDataJSON());
    if (!dropped) {
      const response=await route.fetch();expect(response.ok()).toBeTruthy();
      dropped=true;return route.abort('connectionfailed');
    }
    return route.continue();
  });
  await dialog.getByRole('button',{name:'确认分派，等待接手',exact:true}).click();
  await expect(dialog.getByText('已分派给 陈宇 · 待接手',{exact:true})).toBeVisible();
  expect(dispatchBodies).toHaveLength(2);expect(dispatchBodies[0]).toEqual(dispatchBodies[1]);
  const workerContext=await browser.newContext({baseURL:process.env.E2E_BASE_URL,viewport:{width:390,height:844},extraHTTPHeaders:{'CF-Connecting-IP':'192.0.2.170'}});
  try {
    const worker=await workerContext.newPage();await login(worker,'20261002');
    await worker.getByRole('button',{name:'核对设备并接手',exact:true}).click();
    let panel=worker.getByRole('dialog');
    await expect(panel.getByRole('button',{name:'确认接手，开始维修',exact:true})).toBeVisible();
    await panel.locator('summary').filter({hasText:'退回现场队列'}).click();
    await panel.getByLabel('原因',{exact:true}).fill('请接待重新确认安排');
    await panel.getByRole('button',{name:'退回现场队列',exact:true}).click();
    await expect(panel.getByText('排队中 · 待分派',{exact:true})).toBeVisible();
    await page.reload();
    await page.getByRole('group',{name:'现场概览'}).getByRole('button',{name:/^排队中/}).click();
    await expect(page.locator('.field-order').filter({hasText:order.id})).toContainText('排队中');
    await page.locator('.field-order').filter({hasText:order.id}).click();
    await dialog.locator('input[type=radio][value="20261002"]').check();
    await dialog.getByRole('button',{name:'确认分派，等待接手',exact:true}).click();
    await expect(dialog.getByText('已分派给 陈宇 · 待接手',{exact:true})).toBeVisible();
    await worker.reload();
    await worker.getByRole('button',{name:'核对设备并接手',exact:true}).click();
    panel=worker.getByRole('dialog');
    await panel.getByText('更正核验信息',{exact:true}).click();
    await expect(panel.getByLabel('型号',{exact:true})).toHaveValue('ThinkPad 已现场核对');
    await panel.getByLabel('核验说明（选填）',{exact:true}).fill('维修人员复核完成');
    await worker.screenshot({path:'output/reception-dispatch/accept-390.png'});
    await expect(panel.getByRole('button',{name:'确认接手，开始维修',exact:true})).toBeDisabled();
    await panel.getByRole('checkbox',{name:/我已当面核对/}).check();
    await panel.getByRole('button',{name:'确认接手，开始维修',exact:true}).click();
    await expect(panel.getByLabel('维修说明',{exact:true})).toBeVisible();
    await panel.getByLabel('维修说明',{exact:true}).fill('完成修复及开机测试');
    await panel.getByLabel('修复成功',{exact:true}).check();
    await panel.getByRole('button',{name:'提交维修结果',exact:true}).click();
    await panel.getByRole('button',{name:'确认提交',exact:true}).click();
    await expect(panel.getByRole('heading',{name:'维修记录已提交',exact:true})).toBeVisible();
    await panel.getByText('接待与维修流转记录',{exact:true}).click();
    await expect(panel.locator('.reception-history')).toContainText('退回现场队列');
    await expect(panel.locator('.reception-history')).toContainText('完成维修');
    await page.reload();
    await expect(page.locator('.field-order').filter({hasText:order.id})).toContainText('已完成');
    const final=await api(request,`/api/field/appointments/${order.id}`,office.token);
    expect(final.status).toBe('completed');expect(final.reception.state).toBe('closed');
  } finally {await workerContext.close();}
});


test('customer sees a live arrival ticket, keeps confirmation during rank updates, leaves and rejoins at the tail',async({page,request})=>{
  test.setTimeout(120000);
  const office=await api(request,'/api/auth/login',null,{account:'20261001',password:'StaffTest!2026'});
  const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Hf8AAAAASUVORK5CYII=';
  const checked={brand:'联想',model:'排队测试设备',warranty:'expired',liquidMetal:'no',note:'核对完成'};
  async function create(studentId){return api(request,'/api/scan/onsite',office.token,{requestId:crypto.randomUUID(),registrationFlow:'frontdesk',campus:'南湖',name:'排队客户',studentId,social:'queue-check',deviceType:'笔记本电脑',brand:'联想',deviceModel:'排队测试设备',warranty:'否',faultType:'系统问题',signature:[Array.from({length:10},(_,i)=>[.1+i*.05,.2+i*.03])]});}
  async function receive(item){
    const ids=[];
    for(const side of ['front','back'])ids.push((await api(request,`/api/appointments/${item.id}/attachments`,office.token,{filename:side+'.png',mimeType:'image/png',data:image,purpose:'intake_'+side})).id);
    return api(request,`/api/appointments/${item.id}/reception`,office.token,{action:'receive',revision:item.revision,requestId:crypto.randomUUID(),frontPhotoId:ids[0],backPhotoId:ids[1],verification:checked});
  }
  const first=await receive(await create('20306997'));
  const original=await create('20306998');let second=await receive(original);
  const link='/#'+new URLSearchParams({appointment:original.id,access:original.accessToken});
  await page.goto(link);
  const queue=page.locator('#detail-queue');
  await expect(queue).toContainText(String(second.reception.ticket.number).padStart(3,'0')+'号');
  await expect(queue.locator('.customer-queue > div').nth(1).locator('strong')).toHaveText('2 位');
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`output/reception-dispatch/customer-queue-${width}.png`});
  }
  await queue.getByRole('button',{name:'临时离开，退出排队',exact:true}).click();
  const confirmation=queue.locator('[data-queue-confirm]');await expect(confirmation).toBeVisible();
  await api(request,`/api/appointments/${first.id}/reception`,office.token,{action:'leave',revision:first.revision,reason:'客户暂时离开',requestId:crypto.randomUUID()});
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await expect(queue.locator('.customer-queue > div').nth(1).locator('strong')).toHaveText('1 位');
  await expect(confirmation).toBeVisible();
  await expect(queue.getByRole('button',{name:'确认退出排队',exact:true})).toBeFocused();
  const bodies=[];
  await page.route('**/api/appointments/*/queue-exit',async route=>{
    bodies.push(route.request().postDataJSON());
    if(bodies.length===1){const response=await route.fetch();expect(response.ok()).toBeTruthy();return route.abort('connectionfailed');}
    return route.continue();
  });
  await queue.getByRole('button',{name:'确认退出排队',exact:true}).click();
  await expect(queue.getByRole('heading',{name:'已退出现场排队',exact:true})).toBeVisible();
  expect(bodies).toHaveLength(2);expect(bodies[0]).toEqual(bodies[1]);
  await page.reload();await expect(queue).toContainText('预约已保留');
  second=await api(request,`/api/field/appointments/${second.id}`,office.token);
  const rejoined=await receive(second);expect(rejoined.reception.ticket.number).toBeGreaterThan(second.reception.ticket.number);
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await expect(queue).toContainText(String(rejoined.reception.ticket.number).padStart(3,'0')+'号');
  await expect(queue.getByRole('button',{name:'临时离开，退出排队',exact:true})).toBeVisible();
  await api(request,`/api/appointments/${rejoined.id}/reception`,office.token,{action:'leave',revision:rejoined.revision,reason:'浏览器验收结束',requestId:crypto.randomUUID()});
  // A different receiving staff member must see the fresh-photo requirement
  // before submitting, rather than silently reusing the previous arrival's IDs.
  await login(page,'20261004');
  await page.locator('.field-order').filter({hasText:original.id}).click();
  const panel=page.getByRole('dialog');
  await expect(panel).toContainText('重新到场 · 待核验');
  await expect(panel.getByRole('button',{name:'完成接待，进入现场队列',exact:true})).toBeDisabled();
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await expect(panel.getByLabel('设备正面照片',{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  const buffer=Buffer.from(image,'base64');
  await panel.getByLabel('设备正面照片',{exact:true}).setInputFiles({name:'new-front.png',mimeType:'image/png',buffer});
  await expect(panel.getByRole('button',{name:'完成接待，进入现场队列',exact:true})).toBeDisabled();
  await panel.getByLabel('设备背面照片',{exact:true}).setInputFiles({name:'new-back.png',mimeType:'image/png',buffer});
  await panel.getByRole('button',{name:'完成接待，进入现场队列',exact:true}).click();
  await expect(panel.getByRole('heading',{name:'选择空闲维修人员',exact:true})).toBeVisible();
  const final=await api(request,`/api/field/appointments/${original.id}`,office.token);
  expect(final.reception.ticket.number).toBeGreaterThan(rejoined.reception.ticket.number);
  await api(request,`/api/appointments/${final.id}/reception`,office.token,{action:'leave',revision:final.revision,reason:'浏览器验收结束',requestId:crypto.randomUUID()});
});
