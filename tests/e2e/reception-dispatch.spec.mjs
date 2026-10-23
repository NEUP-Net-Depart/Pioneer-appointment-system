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
  await page.locator('.field-order').filter({hasText:order.id}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('heading',{name:'到场接待',exact:true})).toBeVisible();
  await dialog.getByLabel('厂商',{exact:true}).fill('联想');
  await dialog.getByLabel('型号',{exact:true}).fill('ThinkPad 已现场核对');
  await dialog.getByRole('combobox',{name:'保修情况',exact:true}).selectOption('expired');
  await dialog.getByRole('combobox',{name:'液金散热',exact:true}).selectOption('no');
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
  await expect(dialog.getByRole('heading',{name:'已分派给 陈宇',exact:true})).toBeVisible();
  expect(dispatchBodies).toHaveLength(2);expect(dispatchBodies[0]).toEqual(dispatchBodies[1]);
  const workerContext=await browser.newContext({baseURL:process.env.E2E_BASE_URL,viewport:{width:390,height:844},extraHTTPHeaders:{'CF-Connecting-IP':'192.0.2.170'}});
  try {
    const worker=await workerContext.newPage();await login(worker,'20261002');
    await worker.getByRole('button',{name:'查看待接手工单',exact:true}).click();
    let panel=worker.getByRole('dialog');
    await expect(panel.getByRole('button',{name:'确认接手，开始维修',exact:true})).toBeVisible();
    await panel.getByText('无法接手？退回现场队列',{exact:true}).click();
    await panel.getByLabel('原因',{exact:true}).fill('请接待重新确认安排');
    await panel.getByRole('button',{name:'退回现场队列',exact:true}).click();
    await expect(panel.getByText('已进入现场队列，请等待接待人员安排。设备核验和照片已保留。',{exact:true})).toBeVisible();
    await page.reload();
    await page.locator('.field-order').filter({hasText:order.id}).click();
    await dialog.locator('input[type=radio][value="20261002"]').check();
    await dialog.getByRole('button',{name:'确认分派，等待接手',exact:true}).click();
    await expect(dialog.getByRole('heading',{name:'已分派给 陈宇',exact:true})).toBeVisible();
    await worker.reload();
    await worker.getByRole('button',{name:'查看待接手工单',exact:true}).click();
    panel=worker.getByRole('dialog');
    await panel.getByText('查看或更正设备核验',{exact:true}).click();
    await expect(panel.getByLabel('型号',{exact:true})).toHaveValue('ThinkPad 已现场核对');
    await panel.getByLabel('核验说明（选填）',{exact:true}).fill('维修人员复核完成');
    await worker.screenshot({path:'output/reception-dispatch/accept-390.png'});
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
