import { test,expect } from '@playwright/test';
import { setupStudent,chooseTime,fillDevice,goReview,submitStudent,NOW } from './support/student.mjs';
import { TIME_SLOTS } from '../../shared/constants.js';

test('campus has no default; server dates open progressively without selecting a slot or skipping a step',async({page})=>{
  await setupStudent(page);await expect(page.locator('[name=campus]')).toHaveValue('');await expect(page.locator('#booking-calendar')).toBeHidden();
  await page.locator('#step-one-next').click();await expect(page.locator('[data-step="2"]')).toBeHidden();
  await page.locator('[data-campus=南湖]').click();await expect(page.locator('#booking-days button')).toHaveCount(4);await expect(page.locator('[name=date]')).toHaveValue('2026-10-12');
  await expect(page.locator('[name=timeSlot]')).toHaveValue('');await expect(page.locator('#booking-slots button')).toHaveCount(4);
  await page.locator('[data-slot="19:30–20:00"]').click();await expect(page.locator('[data-step="1"]')).toBeVisible();await expect(page.locator('[data-step="2"]')).toBeHidden();
  await expect(page.locator('#booking-location')).toContainText('南湖校区测试维修室');
  await page.locator('[data-campus=浑南]').click();await expect(page.locator('[name=timeSlot]')).toHaveValue('');await expect(page.locator('[name=date]')).toHaveValue('2026-10-12');await expect(page.locator('#booking-location')).toContainText('浑南校区测试维修室');
});

test('resizing switches the picker between columns and stacked panels without losing the selected time',async({page})=>{
  await setupStudent(page);await page.locator('[data-campus=南湖]').click();await page.locator('[data-slot="20:00–20:30"]').click();
  for(const width of [1440,900,899,768,375,320,1440]){
    await page.setViewportSize({width,height:900});
    await expect.poll(async()=>{
      const date=await page.locator('.booking-date-panel').boundingBox(),time=await page.locator('.booking-time-panel').boundingBox();
      return width>=900 ? Math.abs(date.y-time.y)<1 && time.x>=date.x+date.width : time.y>=date.y+date.height;
    }).toBe(true);
    await expect(page.locator('[name=date]')).toHaveValue('2026-10-12');await expect(page.locator('[name=timeSlot]')).toHaveValue('20:00–20:30');await expect(page.locator('[data-step="2"]')).toBeHidden();
    expect(await page.evaluate(()=>Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)<=innerWidth)).toBe(true);
  }
});

for(const [now,count] of [['2026-10-15T10:00:00+08:00',1],['2026-10-14T10:00:00+08:00',2],['2026-10-13T10:00:00+08:00',3],['2026-10-12T10:00:00+08:00',4]]) {
  test(`${count} service dates and four vertical slots fit a 320px phone`,async({page})=>{
    let release;
    const responseReady=new Promise(resolve=>release=resolve);
    await page.setViewportSize({width:320,height:568});await setupStudent(page,{now,availability:async(result,route)=>{await responseReady;await route.fulfill({json:result});}});
    await page.locator('[data-campus=南湖]').click();
    const slots=page.locator('#booking-slots button');
    try{
      await expect(page.locator('#booking-days button')).toHaveCount(count);
      await expect(page.locator('#booking-picker')).toHaveAttribute('aria-busy','true');
      await expect(slots.first()).toBeHidden();
    }finally{release();}
    await expect(page.locator('#booking-picker')).toHaveAttribute('aria-busy','false');
    await expect(slots).toHaveCount(4);await expect(slots.first()).toBeVisible();await expect(slots.first()).toBeEnabled();
    // The panel translates into place after loading. Measure its final hit area,
    // not an interpolated DOMRect whose coordinates can lose floating precision.
    await page.locator('#booking-picker').evaluate(async picker=>{
      await Promise.all(picker.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})));
    });
    const positions=await slots.evaluateAll(buttons=>buttons.map(button=>({top:button.getBoundingClientRect().top,height:button.getBoundingClientRect().height})));
    for(const [index,box] of positions.entries()){
      expect(box.height).toBeGreaterThanOrEqual(44);
      if(index)expect(box.top).toBeGreaterThan(positions[index-1].top);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}

test('server location, full, paused and ended states disable the actual choices',async({page})=>{
  await setupStudent(page,{now:'2026-10-12T19:30:00+08:00',availability:async(result,route)=>{
    result.items[0].slots[TIME_SLOTS[1]]=5;result.items[0].slotCapacities[TIME_SLOTS[2]]=0;result.items[1].location='';await route.fulfill({json:result});
  }});
  await page.locator('[data-campus=南湖]').click();await expect(page.locator('[data-slot="19:00–19:30"]')).toBeDisabled();await expect(page.locator('[data-slot="19:00–19:30"]')).toContainText('时段已结束');
  await expect(page.locator('[data-slot="19:30–20:00"]')).toContainText('预约已满');await expect(page.locator('[data-slot="20:00–20:30"]')).toContainText('暂停预约');await expect(page.locator('[data-date="2026-10-13"]')).toBeDisabled();await expect(page.locator('[data-date="2026-10-13"]')).toContainText('地点未配置');
});

test('empty availability and a network error have different feedback and a retry',async({page})=>{
  let unavailable=false;
  await setupStudent(page,{availability:async(result,route)=>{if(unavailable)return route.abort();result.items.forEach(item=>item.location='');await route.fulfill({json:result});}});
  await page.locator('[data-campus=南湖]').click();await expect(page.locator('#booking-empty')).toContainText('当前预约范围内无可用日期');await expect(page.locator('#booking-retry')).toBeVisible();
  unavailable=true;await page.locator('#booking-retry').click();await expect(page.locator('#booking-selection')).toContainText('暂时无法更新');await expect(page.locator('#booking-empty')).toBeHidden();
});

test('a submission conflict returns to time selection, retaining inputs, agreement and the valid signature',async({page})=>{
  let reject=true;
  const state=await setupStudent(page,{create:async({route,body,key,make})=>{if(reject){reject=false;return route.fulfill({status:409,json:{error:'该校区该时段已满',code:'SLOT_FULL'}});}return route.fulfill({status:201,json:make(body,key)});}});
  await chooseTime(page);await fillDevice(page);await goReview(page);await page.locator('[name=agreement]').check();
  const {sign}=await import('./support/student.mjs');await sign(page);await page.locator('#booking-submit').click();await expect(page.locator('[data-step="1"]')).toBeVisible();await expect(page.locator('#booking-error')).toContainText('已满');
  await expect(page.locator('[name=timeSlot]')).toHaveValue('');await expect(page.locator('[name=name]')).toHaveValue('预约测试同学');await page.locator('[data-slot="20:00–20:30"]').click();await page.locator('#step-one-next').click();await goReview(page);await expect(page.locator('#signature-status')).toContainText('已完成');await expect(page.locator('[name=agreement]')).toBeChecked();await page.locator('#booking-submit').click();await expect(page.locator('#success-panel')).toBeVisible();expect(state.calls[1].body.signature).toEqual(state.calls[0].body.signature);
});

test('lost creation responses are verified with the stable request key and display one success',async({page})=>{
  const state=await setupStudent(page,{create:async({route,body,key,make})=>{make(body,key);await route.abort();}});
  await chooseTime(page);await fillDevice(page);await goReview(page);await submitStudent(page);expect(state.appointments.size).toBe(1);expect(state.calls[0].key).toMatch(/^[A-Za-z0-9_-]{43}$/);await expect(page.locator('#success-code')).toContainText('reserve020261012-01');
});

test('server time determines Shanghai dates when the device clock is wrong',async({page})=>{
  await setupStudent(page);await page.clock.setSystemTime(new Date('2026-10-17T12:00:00+08:00'));await page.locator('[data-campus=南湖]').click();await expect(page.locator('[name=date]')).toHaveValue('2026-10-12');await expect(page.locator('#booking-days button')).toHaveCount(4);expect(NOW).toContain('2026-10-12');
});
