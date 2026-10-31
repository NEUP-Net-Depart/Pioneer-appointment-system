import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

test.skip(process.env.E2E_FIELD!=='true','Uses disposable staff fixtures');
test.use({extraHTTPHeaders:{'CF-Connecting-IP':'192.0.2.206'}});
async function login(page,account){
  await page.goto('/staff/');await page.locator('#login-id').fill(account);
  await page.locator('#login-password').fill(account==='root001'?process.env.E2E_ROOT_PASSWORD:'StaffTest!2026');
  await page.getByRole('button',{name:'进入系统'}).click();await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();
}
async function command(request,path,token,body){
  const response=await request.fetch(path,{method:body?'POST':'GET',headers:token?{Authorization:`Bearer ${token}`}:{},...(body?{data:body}:{})});
  const result=await response.json();expect(response.ok(),JSON.stringify(result)).toBe(true);return result;
}
async function open(page,group,name){
  await page.setViewportSize({width:1440,height:1000});const sidebar=page.locator('.field-sidebar'),toggle=sidebar.getByRole('button',{name:group,exact:true});
  if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();await sidebar.getByRole('button',{name,exact:true}).click();
}
async function checkSizes(page,name){
  await mkdir('output/field-workflow/duty-updates',{recursive:true});
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    const body=dialog.locator('.workspace-dialog-body');await body.evaluate(el=>{el.scrollTop=0;});
    // A full-document capture includes the inert page below a fixed dialog's
    // viewport, making the screenshot look as if content leaks out of the modal.
    await page.screenshot({path:`output/field-workflow/duty-updates/${name}-${width}.png`});
    if(await body.evaluate(el=>el.scrollHeight>el.clientHeight+1)){
      await body.evaluate(el=>{el.scrollTop=el.scrollHeight;});
      const last=body.getByRole('button').last();await expect(last).toBeInViewport();
      await page.screenshot({path:`output/field-workflow/duty-updates/${name}-${width}-actions.png`});
    }
  }
}

test('unscheduled leader signs in directly and sees an accessible result without opening a camera',async({page,request})=>{
  const root=await command(request,'/api/auth/login','',{account:'root001',password:process.env.E2E_ROOT_PASSWORD});
  // A separate member keeps this scenario independent of earlier completed repairs and check-ins.
  const account='20309988',name='自行签到负责人';
  const importInput={csv:`studentId,name,homeCampusId,departmentId,workProfiles,roleCodes,authorizedCampuses,effectiveFrom\n${account},${name},campus-nanhu,dept-hardware,repair,repair_lead,campus-nanhu,2026-01-01`};
  const preview=await command(request,'/api/members/import',root.token,importInput);
  await command(request,'/api/members/import',root.token,{...importInput,confirm:true,previewToken:preview.previewToken});
  const activation=await command(request,'/api/activation','',{studentId:account,name,homeCampus:'南湖',password:'StaffTest!2026'});
  await command(request,'/api/activation-requests/review',root.token,{ids:[activation.id],status:'approved',identityVerified:true});
  await page.addInitScript(()=>{window.cameraRequests=0;navigator.mediaDevices.getUserMedia=async()=>{window.cameraRequests++;throw new Error('Camera must not be used for self check-in');};});
  await login(page,account);await page.getByRole('button',{name:'本人到岗签到',exact:true}).click();
  const result=page.getByRole('dialog',{name:'到岗签到成功',exact:true});await expect(result).toContainText(name);await expect(result).toContainText('维修负责人');await expect(result).toContainText('非排班到场参与工作');
  expect(await page.evaluate(()=>window.cameraRequests)).toBe(0);await checkSizes(page,'check-in-success');
  await result.getByRole('button',{name:'返回工作台',exact:true}).click();await expect(result).toHaveCount(0);await page.reload();await expect(page.getByRole('button',{name:'本人到岗签到',exact:true})).toHaveCount(0);
});

test('date suspension has explicit confirmation and weekly accounting keeps export options off until selected',async({page,request})=>{
  await login(page,'root001');await open(page,'业务管理','预约配置');await page.getByRole('button',{name:'暂停日期',exact:true}).click();
  const dates=page.locator('.service-day-grid');await expect(dates.getByRole('button')).toHaveCount(8);
  await dates.getByRole('button',{name:/2026-10-20/}).click();await dates.getByRole('button',{name:/2026-10-21/}).click();
  await page.getByLabel('暂停说明（同步为公告，可选）',{exact:true}).fill('校区维护，暂停两天');await page.getByRole('button',{name:'暂停所选日期',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'确认暂停维修',exact:true})).toContainText('已有预约不会取消');await checkSizes(page,'pause-confirmation');
  await page.getByRole('button',{name:'确认暂停',exact:true}).click();await expect(page.getByRole('button',{name:'恢复所选日期',exact:true})).toBeEnabled();
  const availability=await request.get('/api/booking-availability?campus=南湖&date=2026-10-20');expect((await availability.json()).paused).toBe(true);
  const another=await request.get('/api/booking-availability?campus=南湖&date=2026-10-21');expect((await another.json()).paused).toBe(true);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:1400});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await dates.evaluateAll(nodes=>nodes.every(node=>node.scrollWidth<=node.clientWidth))).toBe(true);
    await page.screenshot({path:`output/field-workflow/duty-updates/multi-day-pause-${width}.png`,fullPage:true});
  }
  await page.getByRole('button',{name:'校区公告',exact:true}).click();await expect(page.locator('.booking-notice-list article')).toContainText(['2026-10-20','2026-10-21']);
  await expect(page.locator('.booking-notice-list article')).toContainText(['校区维护，暂停两天','校区维护，暂停两天']);
  await page.getByRole('button',{name:'管理暂停日期',exact:true}).click();
  await page.getByRole('button',{name:'恢复所选日期',exact:true}).click();await page.getByRole('button',{name:'确认恢复',exact:true}).click();
  await open(page,'值班管理','考勤核查');await page.getByRole('button',{name:'按周核算导出',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'按周核算并导出考勤',exact:true}),flags=dialog.locator('input[type=checkbox]');
  for(const flag of await flags.all())await expect(flag).not.toBeChecked();
  await dialog.getByLabel('开始工作周',{exact:true}).selectOption('2026-10-12');await dialog.getByLabel('结束工作周',{exact:true}).selectOption('2026-10-12');
  await flags.nth(1).check();const preview=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/attendance/weekly-summary');
  await dialog.getByRole('button',{name:'预览核算结果',exact:true}).click();const summary=await(await preview).json();
  expect(summary.definition.firstOnly).toBe(false);expect(summary.definition.leadersOnce).toBe(true);expect(summary.rows.length).toBeGreaterThan(0);
  expect(new Set(summary.rows.map(row=>`${row.weekStart}:${row.memberId}`)).size).toBe(summary.rows.length);
  await expect(dialog.locator('tbody tr')).toHaveCount(summary.rows.length);await expect(dialog.locator('tbody')).toContainText('许晨');
  await checkSizes(page,'weekly-attendance');
  const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'导出本次周汇总',exact:true}).click();expect((await download).suggestedFilename()).toBe('周考勤-2026-10-12-2026-10-12.csv');
});
