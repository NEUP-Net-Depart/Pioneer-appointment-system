import {test,expect} from '@playwright/test';
import {mockStaff,loginStaff,staffPage} from './support/staff.mjs';
async function fixture(page,{camera='denied',fallback=false}={}){
 await page.addInitScript(({camera,fallback})=>{
  window.cameraRequests=[];window.cameraStreams=[];
  if(!navigator.mediaDevices)Object.defineProperty(navigator,'mediaDevices',{value:{},configurable:true});
  navigator.mediaDevices.enumerateDevices=async()=>[];
  navigator.mediaDevices.getUserMedia=async constraints=>{
   window.cameraRequests.push(constraints);if(camera==='denied')throw new DOMException('Denied','NotAllowedError');
   if(fallback&&constraints.video.facingMode?.exact)throw new DOMException('Facing unavailable','OverconstrainedError');
   if(camera==='pending')await new Promise(resolve=>{window.allowCamera=resolve;});
   const canvas=document.createElement('canvas');canvas.width=canvas.height=64;canvas.getContext('2d').fillRect(0,0,64,64);const stream=canvas.captureStream(1);window.cameraStreams.push(stream);return stream;
  };
 },{camera,fallback});
 await mockStaff(page,{role:'technician',contexts:[{id:'repair',label:'维修工作台'}],permissions:{'repair.summary.read':true,'repair.start':true,'onsite.create':true}});await loginStaff(page);
}
for(const width of [320,375,390,430])test(`workbench keeps scanning, manual input and personal actions reachable at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:740});await fixture(page);await expect(page.getByRole('combobox',{name:'预约编号',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'临时维修登记',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'扫描维修码',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('摄像头未能开启');await expect(page.getByLabel('相册识别')).toBeAttached();await page.getByRole('button',{name:'关闭',exact:true}).click();
 await staffPage(page,'个人中心');await expect(page.getByRole('heading',{name:'个人中心',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`output/playwright/react-workbench-${width}.png`,fullPage:true});
});
for(const fallback of [false,true])test(`camera prefers the rear lens and switches when exact facing fallback is ${fallback}`,async({page})=>{
 await fixture(page,{camera:'running',fallback});await page.getByRole('button',{name:'扫描维修码',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.cameraStreams.length)).toBe(1);
 expect(await page.evaluate(()=>window.cameraRequests.map(x=>x.video.facingMode))).toEqual(fallback?[{exact:'environment'},{ideal:'environment'}]:[{exact:'environment'}]);
 await page.getByRole('button',{name:'切换镜头',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.cameraStreams.length)).toBe(2);expect(await page.evaluate(()=>window.cameraStreams[0].getTracks().every(t=>t.readyState==='ended'))).toBe(true);
 await page.getByRole('button',{name:'关闭',exact:true}).click();expect(await page.evaluate(()=>window.cameraStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
});
test('camera closes manually and releases tracks on background, pagehide and logout',async({page})=>{
 await fixture(page,{camera:'running'});await page.getByRole('button',{name:'扫描维修码',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.cameraStreams.length)).toBe(1);
 await page.getByRole('button',{name:'关闭摄像头',exact:true}).click();expect(await page.evaluate(()=>window.cameraStreams[0].getTracks()[0].readyState)).toBe('ended');
 await page.getByRole('button',{name:'开启摄像头',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.cameraStreams.length)).toBe(2);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});expect(await page.evaluate(()=>window.cameraStreams[1].getTracks()[0].readyState)).toBe('ended');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});await page.getByRole('button',{name:'开启摄像头',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.cameraStreams.length)).toBe(3);
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));expect(await page.evaluate(()=>window.cameraStreams[2].getTracks()[0].readyState)).toBe('ended');await page.getByRole('button',{name:'关闭',exact:true}).click();await page.locator('.field-sidebar').getByRole('button',{name:'退出登录',exact:true}).click();await expect(page.locator('#login-form')).toBeVisible();
});
test('late camera permission cannot reopen a closed camera',async({page})=>{
 await fixture(page,{camera:'pending'});await page.getByRole('button',{name:'扫描维修码',exact:true}).click();await expect.poll(()=>page.evaluate(()=>typeof window.allowCamera)).toBe('function');await page.getByRole('button',{name:'关闭',exact:true}).click();await page.evaluate(()=>window.allowCamera());await expect.poll(()=>page.evaluate(()=>window.cameraStreams[0]?.getTracks()[0].readyState)).toBe('ended');await expect(page.locator('video')).toHaveCount(0);
});

for (const width of [320,1440]) test(`React manual lookup waits for two digits and selects an exact candidate at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:900});await fixture(page);
  const id='reserve020261015-12', searches=[], resolved=[];
  await page.route('**/api/scan/search',route=>{searches.push(route.request().postDataJSON());return route.fulfill({json:{items:[{id,campus:'南湖',date:'2026-10-15',timeSlot:'19:00–19:30',status:'booked'}]}});});
  await page.route('**/api/scan/resolve',route=>{resolved.push(route.request().postDataJSON());return route.fulfill({json:{id,campus:'南湖',status:'booked',canReadDetails:true,canStart:false}});});
  await page.route('**/api/field/appointments/'+id,route=>route.fulfill({json:{id,campus:'南湖',status:'booked',canReadDetails:true,canStart:false}}));
  const input=page.getByRole('combobox',{name:'预约编号',exact:true});
  await input.fill('1');await expect(page.getByRole('button',{name:'查询',exact:true})).toBeDisabled();
  await expect(page.getByRole('listbox',{name:'匹配的预约'})).toHaveCount(0);expect(searches).toHaveLength(0);
  await input.fill('12');await expect(page.getByRole('listbox',{name:'匹配的预约'}).getByRole('option')).toContainText(id);
  expect(searches[0].q).toBe('12');await input.press('ArrowDown');await input.press('Enter');
  await expect.poll(()=>resolved.length).toBe(1);expect(resolved[0]).toEqual({id});
  await expect(page.getByRole('dialog')).toContainText(id);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('onsite registration retains signature data after returning to edit',async({page})=>{
 await fixture(page);const writes=[];await page.route('**/api/scan/onsite',route=>{writes.push(route.request().postDataJSON());return route.fulfill({json:{id:'reserve020261015-01'}});});
 await page.getByRole('button',{name:'临时维修登记',exact:true}).click();for(const [label,value]of [['姓名','机主同学'],['学号','20306001'],['QQ / 微信','qq123'],['设备厂商','联想'],['设备型号','ThinkPad']])await page.getByRole('dialog').getByLabel(label,{exact:true}).fill(value);
 await page.getByRole('button',{name:/下一步|确认信息/}).click();const canvas=page.getByLabel('机主签名',{exact:true}),box=await canvas.boundingBox();await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();for(let i=0;i<12;i++)await page.mouse.move(box.x+20+i*8,box.y+20+(i%3)*12);await page.mouse.up();
 await page.getByRole('button',{name:'返回修改',exact:true}).click();await page.getByRole('dialog').getByLabel('姓名',{exact:true}).fill('机主修改后');await page.getByRole('button',{name:/下一步|确认信息/}).click();await page.getByLabel('机主已阅读并同意协议，确认重要数据已备份').check();await page.getByRole('button',{name:'确认登记',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0].name).toBe('机主修改后');expect(writes[0].signature[0].length).toBeGreaterThanOrEqual(8);
});
test('the React workspace restores a session and personal logout clears it without a DOM host',async({page})=>{
 await fixture(page);await page.reload();await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();await staffPage(page,'个人中心');await page.locator('.workspace-page:visible').getByRole('button',{name:'退出登录',exact:true}).click();await expect(page.locator('#login-form')).toBeVisible();expect(await page.evaluate(()=>sessionStorage.getItem('pioneerToken'))).toBeNull();await expect(page.locator('#app-shell')).toHaveCount(0);
});
