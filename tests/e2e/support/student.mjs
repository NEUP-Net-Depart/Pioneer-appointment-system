import { expect } from '@playwright/test';
import { bookingDates } from '../../../shared/booking-slots.js';
import { TIME_SLOTS } from '../../../shared/constants.js';
export const NOW='2026-10-12T10:00:00+08:00';
export const PHOTO=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
export async function setupStudent(page,{now=NOW,availability,create}={}) {
  await page.clock.install({time:new Date(now)});
  const appointments=new Map(),receipts=new Map(),calls=[];
  const summary=(campus,date)=>({campus,date,location:campus+'校区测试维修室',locationRevision:1,serverNow:now,timeSlots:TIME_SLOTS,slotCapacities:Object.fromEntries(TIME_SLOTS.map(slot=>[slot,5])),slots:Object.fromEntries(TIME_SLOTS.map(slot=>[slot,0]))});
  await page.route('**/api/booking-availability?*',async route=>{
    const query=new URL(route.request().url()).searchParams,campus=query.get('campus');
    const result={serverNow:now,items:bookingDates(new Date(now)).map(date=>summary(campus,date))};
    if(availability)await availability(result,route);else await route.fulfill({json:result});
  });
  const make=(body,key)=>{const item={...body,id:`reserve0${body.date.replaceAll('-','')}-${String(appointments.size+1).padStart(2,'0')}`,accessToken:'a'.repeat(43),status:'booked',revision:0,location:body.campus+'校区测试维修室',locationSnapshot:body.campus+'校区测试维修室',attachments:[],createdAt:new Date(now).toISOString(),expiresAt:body.date+'T13:30:00.000Z'};appointments.set(item.id,item);receipts.set(key,item);return item;};
  await page.route('**/api/booking-attempts/resolve',route=>{const key=route.request().postDataJSON().requestKey;return route.fulfill({json:receipts.has(key) ? {found:true,appointment:receipts.get(key)} : {found:false}});});
  await page.route('**/api/appointments',async route=>{const body=route.request().postDataJSON(),key=route.request().headers()['idempotency-key'];calls.push({body,key});if(create)return create({route,body,key,make,appointments,receipts});return route.fulfill({status:201,json:receipts.get(key) || make(body,key)});});
  await page.route('**/api/appointments/*',route=>{const id=new URL(route.request().url()).pathname.split('/').at(-1);const item=appointments.get(id);return route.fulfill({status:item ? 200 : 404,json:item || {error:'预约或附件不存在'}});});
  await page.route('**/api/appointments/*/scan-code',route=>{const id=new URL(route.request().url()).pathname.split('/').at(-2);return route.fulfill({json:{id,code:id+'.123456789abc'}});});
  await page.route('**/api/appointments/*/attachments',route=>{const id=new URL(route.request().url()).pathname.split('/').at(-2),item=appointments.get(id),body=route.request().postDataJSON();const attachment={id:crypto.randomUUID(),filename:body.filename,mimeType:body.mimeType,purpose:body.purpose,size:Buffer.from(body.data,'base64').length};item.attachments.push(attachment);return route.fulfill({status:201,json:attachment});});
  await page.route('**/api/appointments/*/status',route=>{const id=new URL(route.request().url()).pathname.split('/').at(-2),item=appointments.get(id);item.status='cancelled';item.revision++;return route.fulfill({json:item});});
  await page.goto('/');return {appointments,receipts,calls};
}
export async function chooseTime(page,campus='南湖') {
  await page.locator(`[data-campus="${campus}"]`).click();await expect(page.locator('#booking-days button').first()).toBeEnabled();
  await page.locator('[data-slot="19:00–19:30"]').click();await page.locator('#step-one-next').click();await expect(page.locator('[data-step="2"]')).toBeVisible();
}
export async function fillDevice(page,{studentId='20269998',name='预约测试同学'}={}) {
  await page.locator('[name=deviceType]').selectOption('笔记本');await page.locator('[name=brand]').selectOption('联想');
  await page.locator('[name=liquidMetal][value="不清楚"]').check();await page.locator('[name=warranty][value="否"]').check();await page.locator('[name=faultType][value="蓝屏"]').check();
  await page.locator('[name=name]').fill(name);await page.locator('[name=studentId]').fill(studentId);await page.locator('[name=college]').selectOption('计算机科学与工程学院');
  await page.locator('[name=contactType][value=qq]').check();await page.locator('[name=qqAccount]').fill('123456789');
}
export async function goReview(page){await page.locator('#step-two-next').click();await expect(page.locator('[data-step="3"]')).toBeVisible();}
export async function sign(page){await page.locator('#open-signature').click();await expect(page.locator('#signature-modal')).toBeVisible();const box=await page.locator('#signature-canvas').boundingBox();
  await page.mouse.move(box.x+box.width*.1,box.y+box.height*.2);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.45,{steps:15});await page.mouse.move(box.x+box.width*.3,box.y+box.height*.7,{steps:15});await page.mouse.up();await page.locator('#confirm-signature').click();await expect(page.locator('#signature-modal')).toBeHidden();
}
export async function submitStudent(page){await page.locator('[name=agreement]').check();await sign(page);await page.locator('#booking-submit').click();await expect(page.locator('#success-panel')).toBeVisible();}
