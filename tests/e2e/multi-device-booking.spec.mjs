import { test,expect } from '@playwright/test';
import { setupStudent,chooseTime,fillDevice,goReview,submitStudent,PHOTO } from './support/student.mjs';
async function secondDevice(page){
  await page.locator('#device-tab-two').click();
  await page.locator('[name=second_deviceType]').selectOption('台式机');
  await page.locator('[name=second_brand]').selectOption('Apple');
  await page.locator('[name=second_deviceModel]').fill('第二台电脑');
  await page.locator('[name=second_warranty][value="否"]').check();
  await page.locator('[name=second_faultType][value="黑屏"]').check();
}
function multiCreate({route,body,key,make,receipts}){
  if(receipts.has(key))return route.fulfill({status:201,json:receipts.get(key)});
  if(!body.devices)return route.fulfill({status:201,json:make(body,key)});
  const pair=body.devices.map((device,index)=>({...make({...body,...device},key),accessToken:(index ? 'b' : 'a').repeat(43)}));
  const result={...pair[0],appointments:pair};receipts.set(key,result);return route.fulfill({status:201,json:result});
}

test('device title tabs preserve input and removing the first keeps the second photos and identity',async({page})=>{
  const state=await setupStudent(page);await chooseTime(page);await fillDevice(page);
  await page.locator('#add-booking-device').click();await secondDevice(page);
  await page.locator('#second-appointment-attachments').setInputFiles({name:'keep.png',mimeType:'image/png',buffer:PHOTO});
  await expect(page.locator('#second_booking-photos')).toContainText('照片已准备好');
  await page.locator('#device-tab-one').click();await expect(page.locator('[name=brand]')).toHaveValue('联想');
  await page.locator('#device-tab-one').press('ArrowRight');await expect(page.locator('#device-tab-two')).toBeFocused();await expect(page.locator('[name=second_brand]')).toHaveValue('Apple');
  await page.locator('#device-tab-one').click();await page.locator('#remove-booking-device').click();
  await expect(page.locator('[name=brand]')).toHaveValue('Apple');await expect(page.locator('#booking-photos')).toContainText('keep.png');
  await goReview(page);await submitStudent(page);expect(state.calls[0].body.brand).toBe('Apple');
  await expect.poll(()=>[...state.appointments.values()][0].attachments.length).toBe(1);
});

test('normal booking starts with one device and adding or removing preserves the first form',async({page})=>{
  await setupStudent(page);await expect(page.getByText('预约设备数量',{exact:true})).toHaveCount(0);
  await chooseTime(page);await fillDevice(page);await expect(page.locator('#second-device')).toBeHidden();
  await page.locator('#add-booking-device').click();await secondDevice(page);
  await page.locator('#remove-booking-device').click();await expect(page.locator('#second-device')).toBeHidden();
  await expect(page.locator('[name=brand]')).toHaveValue('联想');await goReview(page);await submitStudent(page);
  await expect(page.locator('#success-title')).toHaveText('预约成功');
});

test('a saved booking on the chosen day automatically enters supplemental booking',async({page})=>{
  const state=await setupStudent(page,{create:args=>{const item=args.make(args.body,args.key);item.canAddDevice=true;return args.route.fulfill({status:201,json:item});}});
  await chooseTime(page);await fillDevice(page);await goReview(page);await submitStudent(page);
  await page.reload();await chooseTime(page,'浑南');
  await expect(page.locator('[name=additionalFor]')).toHaveValue([...state.appointments.keys()][0]);
  await expect(page.locator('[name=campus]')).toHaveValue('南湖');
  await expect(page.locator('[name=studentId]')).toHaveValue('20269998');
  await expect(page.locator('#add-booking-device')).toBeHidden();
  await expect(page.locator('[name=deviceType]')).toHaveValue('');
});

test('my appointment modification keeps edits after failure and saves the original device',async({page})=>{
  const state=await setupStudent(page,{create:args=>{const item=args.make(args.body,args.key);item.canEditDevice=true;item.canAddDevice=true;return args.route.fulfill({status:201,json:item});}});
  let saves=0;
  await page.route('**/api/appointments/*/device',route=>{if(++saves===1)return route.fulfill({status:503,json:{error:'暂时不可用'}});const id=new URL(route.request().url()).pathname.split('/').at(-2),item=state.appointments.get(id);Object.assign(item,route.request().postDataJSON());item.revision++;return route.fulfill({json:item});});
  await chooseTime(page);await fillDevice(page);await goReview(page);await submitStudent(page);
  await page.locator('#view-created-appointment').click();await page.locator('.appointment-edit > summary').click();await page.locator('[data-edit-device]').click();
  const form=page.locator('.device-edit-form');await form.locator('[name=deviceModel]').fill('更正后的设备');await form.getByRole('button',{name:'保存修改'}).click();
  await expect(form.locator('[data-edit-error]')).toContainText('输入已保留');await expect(form.locator('[name=deviceModel]')).toHaveValue('更正后的设备');
  await form.getByRole('button',{name:'保存修改'}).click();await expect(form).toHaveCount(0);await expect(page.locator('#detail-information')).toContainText('更正后的设备');expect(state.calls).toHaveLength(1);
});
test('two-device booking validates each device, uploads separately and switches credentials',async({page})=>{
  const state=await setupStudent(page,{create:multiCreate});
  await chooseTime(page);await page.locator('#add-booking-device').click();await fillDevice(page);
  await page.locator('#step-two-next').click();await expect(page.locator('[data-error-for=second_deviceType]')).toContainText('请选择');
  await secondDevice(page);
  await page.locator('#appointment-attachments').setInputFiles({name:'first.png',mimeType:'image/png',buffer:PHOTO});
  await page.locator('#second-appointment-attachments').setInputFiles({name:'second.png',mimeType:'image/png',buffer:PHOTO});
  await goReview(page);await expect(page.locator('#booking-review')).toContainText('第二台电脑');await submitStudent(page);
  expect(state.calls[0].body.devices).toHaveLength(2);expect(state.calls[0].body.devices[1].brand).toBe('Apple');
  expect(state.calls[0].body.second_brand).toBeUndefined();
  await expect(page.locator('#success-title')).toHaveText('两台设备预约成功');
  const first=await page.locator('#success-code').textContent();await page.locator('[data-device="1"]').click();
  await expect(page.locator('#success-code')).not.toHaveText(first);await expect(page.locator('#success-device-label')).toContainText('Apple');
  await expect.poll(()=>[...state.appointments.values()].every(item=>item.attachments.length===1)).toBe(true);
  const credentials=await page.evaluate(()=>JSON.parse(localStorage.getItem('pioneerAppointmentAccess')));expect(credentials).toHaveLength(2);
});
test('two devices cannot choose a time slot with only one place',async({page})=>{
  await setupStudent(page,{availability:async(result,route)=>{for(const item of result.items)item.slotCapacities['19:00–19:30']=1;await route.fulfill({json:result});}});
  await chooseTime(page);await page.locator('#add-booking-device').click();await page.locator('[data-step="2"] [data-edit-step="1"]').first().click();
  await expect(page.locator('[data-slot="19:00–19:30"]')).toBeDisabled();await expect(page.locator('[data-slot="19:00–19:30"]')).toContainText('不足 2');
  await page.locator('[data-slot="19:30–20:00"]').click();await page.locator('#step-one-next').click();await page.locator('#remove-booking-device').click();await page.locator('[data-step="2"] [data-edit-step="1"]').first().click();await expect(page.locator('[data-slot="19:00–19:30"]')).toBeEnabled();
});
test('second-device draft restores text and device count',async({page})=>{
  await setupStudent(page);await chooseTime(page);await page.locator('#add-booking-device').click();await fillDevice(page);await secondDevice(page);
  await page.reload();await page.locator('#draft-restore').click();await page.locator('#device-tab-two').click();await expect(page.locator('#second-device')).toBeVisible();
  await expect(page.locator('[name=second_deviceModel]')).toHaveValue('第二台电脑');await expect(page.locator('#booking-device-count')).toHaveValue('2');
});
test('existing credential opens supplemental booking with locked identity and arrival',async({page})=>{
  const state=await setupStudent(page,{create:args=>{const item=args.make(args.body,args.key);item.canAddDevice=true;return args.route.fulfill({status:201,json:item});}});
  await chooseTime(page);await fillDevice(page);await goReview(page);await submitStudent(page);
  await page.locator('#view-created-appointment').click();await page.locator('.appointment-edit > summary').click();await page.locator('[data-add-device]').click();
  await expect(page.locator('#additional-device-context')).toBeVisible();await expect(page.locator('#booking-device-count')).toBeDisabled();
  await expect(page.locator('[data-campus="南湖"]')).toBeDisabled();await page.locator('#step-one-next').click();
  await expect(page.locator('[name=studentId]')).toHaveAttribute('readonly','');
  await page.locator('[name=deviceType]').selectOption('台式机');await page.locator('[name=brand]').selectOption('Apple');
  await page.locator('[name=warranty][value="否"]').check();await page.locator('[name=faultType][value="黑屏"]').check();
  await goReview(page);await submitStudent(page);
  expect(state.calls[1].body.additionalFor).toBe(state.calls[0] && [...state.appointments.keys()][0]);
  expect(state.calls[1].body.studentId).toBe(state.calls[0].body.studentId);
});
for(const width of [320,390,768,1440])test(`two-device form fits ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});await setupStudent(page);await chooseTime(page);await page.locator('#add-booking-device').click();await fillDevice(page);await secondDevice(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`output/issue20-form-${width}.png`,fullPage:true});
});
test('recovering a pending batch keeps both original orders and does not upload newly chosen photos',async({page})=>{
  const state=await setupStudent(page,{create:async args=>{const pair=args.body.devices.map(device=>args.make({...args.body,...device},args.key));args.receipts.set(args.key,{...pair[0],appointments:pair});await args.route.abort('failed');}});
  let resolveCalls=0,uploads=0;
  await page.route('**/api/booking-attempts/resolve',route=>{const key=route.request().postDataJSON().requestKey;return route.fulfill({json:++resolveCalls===1 ? {found:false} : {found:true,appointment:state.receipts.get(key)}});});
  await page.route('**/api/appointments/*/attachments',route=>{uploads++;return route.fulfill({status:201,json:{id:'unexpected'}});});
  await chooseTime(page);await page.locator('#add-booking-device').click();await fillDevice(page);await secondDevice(page);await goReview(page);
  await page.locator('[name=agreement]').check();
  const {sign}=await import('./support/student.mjs');await sign(page);await page.locator('#booking-submit').click();
  await expect(page.locator('#booking-error')).toContainText('尚未确认');
  await page.locator('[data-step="3"] [data-edit-step="2"]').first().click();
  await page.locator('#second-appointment-attachments').setInputFiles({name:'changed-device.png',mimeType:'image/png',buffer:PHOTO});
  await goReview(page);await page.locator('#booking-submit').click();
  await expect(page.locator('#success-title')).toHaveText('两台设备预约成功');
  await expect(page.locator('#draft-notice')).toContainText('已恢复原预约结果');expect(state.calls).toHaveLength(1);expect(uploads).toBe(0);
});
for(const width of [390,1440])test(`polished device UI screenshots at ${width}px`,async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='chromium','Screenshots use Chromium; functional tests also cover WebKit.');
  await page.setViewportSize({width,height:width===390 ? 900 : 1100});await setupStudent(page,{create:multiCreate});
  await chooseTime(page);await page.locator('#add-booking-device').click();await fillDevice(page,{name:'林同学',studentId:'20261025'});
  await page.locator('[name=deviceModel]').fill('ThinkPad T14');await secondDevice(page);
  await page.locator('#device-tab-one').click();
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:`output/issue20-polished-form-${width}.png`,animations:'disabled'});
  await goReview(page);await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:`output/issue20-polished-review-${width}.png`,animations:'disabled',fullPage:true});
  await submitStudent(page);await expect(page.locator('#success-repair-qr img')).toHaveAttribute('src',/^blob:/);
  await page.screenshot({path:`output/issue20-polished-success-${width}.png`,animations:'disabled',fullPage:true});
});
