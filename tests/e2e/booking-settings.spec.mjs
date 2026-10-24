import { test, expect } from '@playwright/test';
import { setupStudent, fillDevice, goReview, sign } from './support/student.mjs';
import { mockStaff, loginStaff, staffPage } from './support/staff.mjs';
import { TIME_SLOTS } from '../../shared/constants.js';

test('actual capacity aligns date controls and slot columns with permission-scoped roster links', async({page})=>{
  await mockStaff(page,{permissions:{'settings.manage':true,'roster.repair.manage':true,'roster.office.manage':true}});
  await page.route('**/api/slot-capacities',route=>route.fulfill({json:{items:['南湖','浑南'].flatMap(campus=>[1,2,3,4].flatMap(weekday=>TIME_SLOTS.map(timeSlot=>({campus,weekday,timeSlot,capacity:5,revision:0}))))}}));
  await page.route('**/api/slot-capacities/actual?*',route=>{
    const query=new URL(route.request().url()).searchParams;
    return route.fulfill({json:{campus:query.get('campus'),date:query.get('date'),source:'template',staffing:{repair:7,office:1},items:TIME_SLOTS.map((timeSlot,index)=>({timeSlot,capacity:15,occupied:index,remaining:15-index}))}});
  });
  await loginStaff(page);await staffPage(page,'预约配置');await page.getByRole('button',{name:'日期实际容量',exact:true}).click();
  const panel=page.locator('.capacity-actual');
  await expect(panel.getByRole('table',{name:'各时段预约名额'})).toBeVisible();
  await expect(panel.locator('tbody tr')).toHaveCount(4);
  for(const width of [320,390,768,1440,1876]){
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const buttons=await panel.getByRole('group',{name:'快捷查看日期'}).getByRole('button').all();
    const boxes=await Promise.all(buttons.map(button=>button.boundingBox()));
    expect(new Set(boxes.map(box=>Math.round(box.y))).size).toBe(1);
    for(const box of boxes){expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);}
    const input=await panel.getByLabel('查看日期',{exact:true}).boundingBox();
    if(width>=1440)expect(Math.abs(input.y+input.height-boxes[0].y-boxes[0].height)).toBeLessThanOrEqual(1);
    else expect(input.y+input.height).toBeLessThanOrEqual(boxes[0].y);
    const table=panel.getByRole('table',{name:'各时段预约名额'});
    expect(await table.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
    const edge=await table.boundingBox();
    for(const cell of await table.getByRole('columnheader').all()){
      const box=await cell.boundingBox();expect(box.x+box.width).toBeLessThanOrEqual(edge.x+edge.width+1);
      expect(await cell.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
    }
    await page.setViewportSize({width,height:1800});
    await panel.screenshot({path:`output/issue64/actual-capacity-${width}.png`});
  }
  await panel.getByLabel('查看日期',{exact:true}).fill('2026-10-22');
  await expect(panel.getByLabel('查看日期',{exact:true})).toHaveValue('2026-10-22');
  await panel.getByRole('button',{name:'查看维修排班',exact:true}).click();
  await expect(page.getByRole('heading',{name:'维修排班管理',exact:true})).toBeVisible();
  await staffPage(page,'预约配置');
  await panel.getByRole('button',{name:'查看办公排班',exact:true}).click();
  await expect(page.getByRole('heading',{name:'办公排班管理',exact:true})).toBeVisible();
  // The API omits roster counts outside the viewer's grant; capacity remains visible.
  await staffPage(page,'预约配置');
  await page.route('**/api/slot-capacities/actual?*',route=>route.fulfill({json:{campus:'南湖',date:'2026-10-22',source:'template',staffing:null,items:[]}}));
  await panel.getByRole('button',{name:'更新实际数据',exact:true}).click();
  await expect(panel.locator('.capacity-staffing')).toContainText('人员安排请在有权限的排班管理页查看');
  await expect(panel.getByRole('button',{name:/查看.*排班/})).toHaveCount(0);
});

test('students use server release time and acknowledge the latest important notice without losing their form',async({page})=>{
  let revision=0;
  const state=await setupStudent(page,{availability:async(result,route)=>{
    result.bookingSettings={releaseTime:'11:00',notices:[{id:'notice-testing',revision,title:'到场须知',content:'请先备份资料。<script>不得执行</script>',important:true}]};
    result.items=result.items.filter(item=>item.date<='2026-10-14');
    await route.fulfill({json:result});
  }});
  await page.locator('[data-campus=南湖]').click();
  await page.locator('[data-slot="19:00–19:30"]').click();
  await expect(page.locator('#booking-days button')).toHaveCount(3);
  await expect(page.locator('#booking-release-hint')).toContainText('11:00');
  await expect(page.locator('#booking-notices')).toContainText('<script>不得执行</script>');
  await expect(page.locator('#booking-notices script')).toHaveCount(0);
  const read=page.getByRole('button',{name:'我已阅读并确认此公告',exact:true});
  await page.locator('#step-one-next').click();await expect(page.locator('[data-step="2"]')).toBeHidden();await expect(read).toBeFocused();
  await expect(page.locator('#booking-notice-error')).toBeVisible();
  await read.click();await page.locator('#step-one-next').click();
  await expect(page.locator('#booking-notices')).toBeHidden();
  await fillDevice(page);await goReview(page);await page.locator('[name=agreement]').check();await sign(page);
  revision++;
  await page.locator('#booking-submit').click();await expect(read).toHaveAttribute('aria-pressed','false');expect(state.calls).toHaveLength(0);
  await expect(page.locator('[data-step="1"]')).toBeVisible();await expect(read).toBeFocused();
  await expect(page.locator('[name=name]')).toHaveValue('预约测试同学');
  await read.click();await page.locator('#step-one-next').click();await goReview(page);
  await page.locator('#booking-submit').click();await expect(page.locator('#success-panel')).toBeVisible();
  expect(state.calls[0].body.acceptedNotices).toEqual([{id:'notice-testing',revision:1}]);
});

test('booking notices and release guidance fit narrow phones through desktops',async({page})=>{
  await setupStudent(page,{availability:async(result,route)=>{
    result.bookingSettings={releaseTime:'10:00',notices:[{id:'notice-testing',revision:0,title:'维修服务安排说明',content:'到场前请先备份重要资料。请携带电源适配器。',important:true}]};await route.fulfill({json:result});
  }});
  await page.locator('[data-campus=南湖]').click();await expect(page.locator('#booking-notices')).toBeVisible();
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:960});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const box=await page.locator('.booking-notice-read').boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);
    if([390,1440].includes(width))await page.screenshot({path:`output/issue64/student-${width}.png`,fullPage:true});
  }
});

test('popup notices stay on the booking home, require explicit reading and do not reopen on refresh',async({page})=>{
  let revision=0;
  await setupStudent(page,{availability:async(result,route)=>{
    result.bookingSettings={releaseTime:'10:00',notices:[
      {id:'popup-required',revision,title:'到场前必读',content:'请备份资料。<img src=x onerror=alert(1)>',important:true,displayMode:'modal'},
      {id:'popup-optional',revision:0,title:'普通通知',content:'本周照常服务。',important:false,displayMode:'modal'}
    ]};await route.fulfill({json:result});
  }});
  await page.locator('[data-campus=南湖]').click();
  const modal=page.getByRole('dialog',{name:'校区预约公告',exact:true});
  await expect(modal).toBeVisible();await expect(modal).toContainText('<img src=x onerror=alert(1)>');await expect(modal.locator('img')).toHaveCount(0);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:800});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const button=await modal.getByRole('button',{name:'我已阅读并确认此公告',exact:true}).boundingBox();expect(button.height).toBeGreaterThanOrEqual(44);
    await modal.screenshot({path:`output/issue64/notice-modal-${width}.png`,animations:'disabled'});
  }
  await page.keyboard.press('Shift+Tab');await expect(modal.getByRole('button',{name:'返回预约'})).toBeFocused();
  await page.keyboard.press('Tab');await expect(modal.getByRole('button',{name:'我已阅读并确认此公告',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(modal).toBeHidden();
  await page.locator('[data-slot="19:00–19:30"]').click();await page.locator('#step-one-next').click();
  await expect(modal).toBeVisible();const read=modal.getByRole('button',{name:'我已阅读并确认此公告',exact:true});await expect(read).toBeFocused();
  await read.click();await modal.getByRole('button',{name:'返回预约'}).click();await page.locator('#step-one-next').click();
  await expect(page.locator('[data-step="2"]')).toBeVisible();await expect(page.locator('#booking-notices')).toBeHidden();await expect(modal).toBeHidden();
  revision++;
  await fillDevice(page);await goReview(page);await expect(modal).toBeHidden();
  await page.locator('[name=agreement]').check();await sign(page);await page.locator('#booking-submit').click();
  await expect(page.locator('[data-step="1"]')).toBeVisible();await expect(modal).toBeVisible();await expect(read).toHaveAttribute('aria-pressed','false');
  await read.click();await modal.getByRole('button',{name:'返回预约'}).click();
  await page.locator('[data-campus=南湖]').click();await expect(page.locator('#booking-picker')).toHaveAttribute('aria-busy','false');await expect(modal).toBeHidden();
  await page.getByRole('button',{name:'我的预约',exact:true}).first().click();await expect(modal).toBeHidden();
});

test('each campus requires its own reading confirmations, optional announcements never block the next step',async({page})=>{
  let required=true;
  await setupStudent(page,{availability:async(result,route)=>{
    result.bookingSettings={notices:['first','second'].map(id=>({id,revision:0,title:`通知 ${id}`,content:'到场说明',important:required,displayMode:'inline'}))};
    await route.fulfill({json:result});
  }});
  await page.locator('[data-campus=南湖]').click();await page.locator('[data-slot="19:00–19:30"]').click();
  const readers=page.locator('#booking-notices [data-read-notice]');
  await readers.first().click();await page.locator('#step-one-next').click();
  await expect(readers.last()).toBeFocused();await expect(page.locator('[data-step="2"]')).toBeHidden();
  await readers.last().click();await page.locator('[data-campus=浑南]').click();
  await expect(readers.first()).toHaveAttribute('aria-pressed','false');
  await page.locator('[data-slot="19:00–19:30"]').click();await page.locator('#step-one-next').click();await expect(readers.first()).toBeFocused();
  required=false;await page.locator('#step-one-next').click();
  await expect(page.locator('[data-step="2"]')).toBeVisible();await expect(page.locator('#booking-notices')).toBeHidden();
  await page.getByRole('button',{name:'修改到场时间',exact:true}).click();
  await expect(page.locator('#booking-notices')).toBeVisible();await expect(readers).toHaveCount(0);
});

test('administrators configure release and announcements with guarded navigation and responsive controls',async({page})=>{
  await mockStaff(page);
  const writes=[];let settings={campus:'南湖',releaseTime:'10:00',revision:0},notices=[],reads=0;
  await page.route('**/api/slot-capacities',route=>route.fulfill({json:{items:['南湖','浑南'].flatMap(campus=>[1,2,3,4].flatMap(weekday=>TIME_SLOTS.map(timeSlot=>({campus,weekday,timeSlot,capacity:5,revision:0}))))}}));
  await page.route('**/api/booking-settings/manage?*',route=>{reads++;return route.fulfill({json:{settings,notices}});});
  await page.route('**/api/booking-settings',route=>{const value=route.request().postDataJSON();writes.push(value);settings={...value,revision:value.revision+1};return route.fulfill({json:settings});});
  await page.route('**/api/booking-notices',route=>{const value=route.request().postDataJSON();writes.push(value);const saved={...value,revision:value.revision+1};notices=[saved];return route.fulfill({json:saved});});
  await loginStaff(page);await staffPage(page,'预约配置');
  await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,value:true}));
  await page.getByRole('button',{name:'放号时间',exact:true}).click();
  // Static fields render immediately; hidden documents must not fetch or edit unknown data.
  await expect(page.getByLabel('放号时间（北京时间）')).toBeVisible();
  await expect(page.getByLabel('放号时间（北京时间）')).toBeDisabled();
  expect(reads).toBe(0);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  const input=page.getByLabel('放号时间（北京时间）');await expect(input).toHaveValue('10:00');await input.fill('11:30');
  await page.getByRole('button',{name:'每周模板',exact:true}).click();await expect(page.getByRole('dialog',{name:'有尚未保存的修改'})).toBeVisible();
  await page.getByRole('button',{name:'取消切换',exact:true}).click();await expect(input).toHaveValue('11:30');
  await page.getByRole('button',{name:'保存放号时间',exact:true}).click();await expect(page.getByRole('button',{name:'保存放号时间',exact:true})).toBeDisabled();expect(writes[0].releaseTime).toBe('11:30');
  await expect(page.getByRole('button',{name:'新增公告',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'校区公告',exact:true}).click();
  await expect(input).toBeHidden();
  await page.getByRole('button',{name:'新增公告',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'新增校区公告',exact:true});
  await dialog.getByLabel('公告标题').fill('维修到场须知');await dialog.getByLabel('公告内容').fill('请携带电源适配器，提前备份资料。');await dialog.getByLabel('必读公告，进入下一步前需点击阅读确认').check();
  await expect(dialog.getByLabel('展示方式')).toHaveValue('inline');await dialog.getByLabel('展示方式').selectOption('modal');
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if([390,1440].includes(width))await page.screenshot({path:`output/issue64/admin-dialog-${width}.png`,fullPage:true});
  }
  await dialog.getByRole('button',{name:'保存公告',exact:true}).click();await expect(dialog).toBeHidden();await expect(page.locator('.booking-notice-list')).toContainText('维修到场须知');
  expect(writes[1].important).toBe(true);expect(writes[1].displayMode).toBe('modal');expect(writes[1].startsAt).toMatch(/Z$/);
  let releaseRead,readStarted;
  const pendingRead=new Promise(resolve=>{releaseRead=resolve;}),startedRead=new Promise(resolve=>{readStarted=resolve;});
  await page.route('**/api/booking-settings/manage?*',async route=>{readStarted();await pendingRead;await route.fulfill({json:{settings,notices}});});
  await page.getByRole('button',{name:'放号时间',exact:true}).click();
  await startedRead;await input.fill('12:00');
  const refreshed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/booking-settings/manage');
  releaseRead();await refreshed;await expect(page.locator('.booking-settings-editor:visible')).toHaveAttribute('aria-busy','false');
  await expect(page.getByRole('button',{name:'读取最新规则',exact:true})).toBeDisabled();
  await expect(input).toHaveValue('12:00');
  await page.getByRole('button',{name:'浑南校区',exact:true}).click();await page.getByRole('button',{name:'丢弃并切换',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'有尚未保存的修改'})).toBeHidden();
});

test('selecting a suspended date explains the whole-day pause and hides unavailable slots without duplicating announcements',async({page})=>{
  let paused=true;
  await setupStudent(page,{availability:async(result,route)=>{
    result.items[1].paused=paused;result.items[1].pauseReason='校区维护 <script>不可执行</script>';
    result.bookingSettings={releaseTime:'10:00',notices:paused?[{id:'suspension-test',type:'suspension',businessDate:result.items[1].date,revision:0,title:'暂停维修',content:result.items[1].pauseReason,important:false}]:[]};
    await route.fulfill({json:result});
  }});
  await page.locator('[data-campus=南湖]').click();
  const day=page.locator('[data-date="2026-10-13"]');await expect(day).toBeEnabled();await day.click();
  await expect(page.locator('#booking-paused')).toContainText('当日暂停维修');
  await expect(page.locator('#booking-paused')).toContainText('2026-10-13');
  await expect(page.locator('#booking-paused-reason')).toHaveText('校区维护 <script>不可执行</script>');
  await expect(page.locator('#booking-paused script')).toHaveCount(0);
  await expect(page.locator('#booking-notices')).toBeHidden();
  await expect(page.locator('#booking-slot-panel')).toBeHidden();await expect(page.locator('#booking-location')).toBeHidden();
  await expect(page.locator('#step-one-next')).toBeDisabled();
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:1200});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`output/issue64/paused-student-${width}.png`,fullPage:true,animations:'disabled'});
    const bounds=await page.locator('#booking-picker').boundingBox(),action=await page.getByRole('button',{name:'选择其他日期',exact:true}).boundingBox();
    expect(action.y+action.height).toBeLessThanOrEqual(bounds.y+bounds.height);
  }
  await page.getByRole('button',{name:'选择其他日期',exact:true}).click();await expect(page.locator('#booking-paused')).toBeHidden();await expect(page.locator('#booking-slot-panel')).toBeVisible();
  await day.click();await expect(page.locator('#booking-paused')).toBeVisible();paused=false;
  await page.locator('[data-campus=南湖]').click();await expect(page.locator('#booking-paused')).toBeHidden();await expect(page.locator('#booking-slot-panel')).toBeVisible();
  await expect(page.locator('#step-one-next')).toBeEnabled();
  await expect(day).toHaveAttribute('aria-pressed','true');
});
