import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { createServer } from 'node:net';

test('read-only booking layout preview exercises the new four-slot UI at phone and desktop widths',async()=>{
  const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const server=spawn(process.execPath,['scripts/preview-booking-layout.mjs'],{env:{...process.env,BOOKING_LAYOUT_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let browser;
  try{
    await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});browser=await chromium.launch();
    for(const width of [320,375,768,1440])for(const days of [1,2,3,4]){
      const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(`http://127.0.0.1:${port}/scenario/${days}/4/`);await page.locator('[data-campus=南湖]').click();await page.locator('#booking-days button').first().waitFor({state:'visible'});
      await page.waitForFunction(()=>globalThis.document.querySelector('#booking-picker').getAttribute('aria-busy')==='false');
      assert.equal(await page.locator('#booking-days button').count(),days);assert.equal(await page.locator('#booking-slots button').count(),4);assert.equal(await page.locator('[name=timeSlot]').inputValue(),'');
      const dateRows=await page.locator('#booking-days button').evaluateAll(buttons=>buttons.map(button=>button.getBoundingClientRect().top));assert.equal(new Set(dateRows).size,1);
      await page.locator('[data-slot="19:00–19:30"]').click();assert.equal(await page.locator('[name=timeSlot]').inputValue(),'19:00–19:30');assert.equal(await page.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.innerWidth),true);assert.equal(await page.locator('#booking-submit').isDisabled(),true);assert.deepEqual(errors,[]);await page.close();
    }
  }finally{await browser?.close();server.kill();}
});
