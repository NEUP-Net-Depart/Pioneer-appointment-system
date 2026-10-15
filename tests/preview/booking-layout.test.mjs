import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium,webkit } from '@playwright/test';
import { createServer } from 'node:net';
import { mkdir } from 'node:fs/promises';

test('booking picker adapts its date shapes and column layout across phone, tablet and desktop widths',async()=>{
  const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const server=spawn(process.execPath,['scripts/preview-booking-layout.mjs'],{env:{...process.env,BOOKING_LAYOUT_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let browser;
  try{
    await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
    await mkdir('output/playwright/responsive-picker',{recursive:true});
    for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
      browser=await type.launch();
      for(const width of [320,375,768,899,900,1024,1440])for(const days of [1,2,3,4]){
      const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'}),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(`http://127.0.0.1:${port}/scenario/${days}/4/`);await page.locator('[data-campus=南湖]').click();await page.locator('#booking-days button').first().waitFor({state:'visible'});
      await page.waitForFunction(()=>globalThis.document.querySelector('#booking-picker').getAttribute('aria-busy')==='false');
      assert.equal(await page.locator('#booking-days button').count(),days);assert.equal(await page.locator('#booking-slots button').count(),4);assert.equal(await page.locator('[name=timeSlot]').inputValue(),'');
      assert.equal(await page.locator('#booking-days').getAttribute('data-count'),String(days));
      for(const campus of await page.locator('#booking-campuses button').all()){
        const box=await campus.boundingBox(),label=await campus.locator('strong').boundingBox();
        assert.ok(Math.abs(box.y+box.height/2-label.y-label.height/2)<1,'Campus labels stay vertically centered');
        assert.ok(Math.abs(box.x+box.width/2-label.x-label.width/2)<1,'Campus labels stay horizontally centered');
      }
      const datePanel=await page.locator('.booking-date-panel').boundingBox(),timePanel=await page.locator('.booking-time-panel').boundingBox();
      if(width>=900){assert.ok(Math.abs(datePanel.y-timePanel.y)<1);assert.ok(timePanel.x>=datePanel.x+datePanel.width);assert.ok(Math.abs(datePanel.width-timePanel.width)<1);}
      else assert.ok(timePanel.y>=datePanel.y+datePanel.height);
      for(const button of await page.locator('#booking-days button').all()){
        const label=button.locator('strong');await label.scrollIntoViewIfNeeded();
        assert.equal(await label.evaluate(element=>{const rect=element.getBoundingClientRect();return element.closest('button').contains(globalThis.document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));}),true);
        assert.ok((await button.locator('small').boundingBox()).height<=20);
        await label.click();assert.equal(await page.locator('[name=date]').inputValue(),await button.getAttribute('data-date'));assert.equal(await page.locator('[name=timeSlot]').inputValue(),'');
      }
      const slotBoxes=await page.locator('#booking-slots button').evaluateAll(buttons=>buttons.map(button=>{const rect=button.getBoundingClientRect();return {top:rect.top,height:rect.height};}));
      assert.ok(slotBoxes.every((box,index)=>box.height>=44 && (!index || box.top>=slotBoxes[index-1].top+slotBoxes[index-1].height)));
      await page.locator('[data-slot="19:00–19:30"]').click();assert.equal(await page.locator('[name=timeSlot]').inputValue(),'19:00–19:30');assert.equal(await page.evaluate(()=>Math.max(globalThis.document.body.scrollWidth,globalThis.document.documentElement.scrollWidth)<=globalThis.innerWidth),true);assert.equal(await page.locator('#booking-submit').isDisabled(),true);assert.deepEqual(errors,[]);
      if(days===4 && [375,1440].includes(width))await page.screenshot({path:`output/playwright/responsive-picker/${engine}-${width}.png`,fullPage:true});
      if(days===4){
        await page.locator('#step-one-next').click();await page.locator('[data-step="2"]').waitFor({state:'visible'});
        const device=await page.locator('[name=deviceType]').boundingBox(),brand=await page.locator('[name=brand]').boundingBox();
        if(width>=900){assert.ok(Math.abs(device.y-brand.y)<1);assert.ok(brand.x>=device.x+device.width);}
        else assert.ok(brand.y>=device.y+device.height);
        assert.equal(await page.locator('.student-shell').evaluate(element=>element.scrollWidth<=element.clientWidth),true);
      }
      await page.close();
      }
      await browser.close();browser=null;
    }
  }finally{await browser?.close();server.kill();}
});
