import { test,expect } from '@playwright/test';
import { setupStudent,chooseTime,fillDevice,goReview,submitStudent,sign,PHOTO } from './support/student.mjs';

test('signature and agreement are independent, and cancelling a new signature preserves the confirmed one',async({page})=>{
  await setupStudent(page);await chooseTime(page);await fillDevice(page);await goReview(page);
  await page.locator('[name=agreement]').check();await expect(page.locator('#signature-modal')).toBeHidden();await page.locator('#booking-submit').click();await expect(page.locator('[data-error-for=signature]')).toBeVisible();
  await sign(page);const original=await page.locator('#confirmed-signature').evaluate(canvas=>canvas.toDataURL());await page.locator('#open-signature').click();await page.locator('#clear-signature').click();await page.locator('#cancel-signature').click();expect(await page.locator('#confirmed-signature').evaluate(canvas=>canvas.toDataURL())).toBe(original);
  await page.locator('[data-edit-step="2"]').last().click();await page.locator('[name=name]').fill('修改后的姓名');await goReview(page);await expect(page.locator('#signature-status')).toContainText('已完成');
  await page.locator('[name=agreement]').uncheck();await page.locator('#booking-submit').click();await expect(page.locator('[data-error-for=agreement]')).toBeVisible();await expect(page.locator('#signature-status')).toContainText('已完成');
});

test('success shows real location and QR and sends distinct actions to the current detail and list',async({page})=>{
  const state=await setupStudent(page);await chooseTime(page);await fillDevice(page);await goReview(page);await submitStudent(page);
  await expect(page.locator('#success-title')).toHaveText('预约成功');await expect(page.locator('#success-summary')).toContainText('南湖校区测试维修室');await expect(page.locator('#success-repair-qr img')).toBeVisible();await expect(page.locator('#copy-code')).toHaveText('复制私人查询链接');
  const id=state.calls.length ? [...state.appointments.keys()][0] : '';await page.locator('#view-created-appointment').click();await expect(page.locator('#appointment-detail')).toContainText(id);await expect(page.locator('#lookup-list')).toBeHidden();
  await page.locator('[data-view-link=lookup]').first().click();await expect(page.locator('#lookup-list')).toBeVisible();await expect(page.locator('.student-record')).toHaveCount(1);await expect(page.locator('.student-record button')).toHaveCount(0);await expect(page.locator('[data-cancel-open]')).toBeHidden();
});

test('batch and incremental photo choices prepare locally, reject overflow, and upload only after creation',async({page})=>{
  const state=await setupStudent(page);let uploads=0;page.on('request',request=>{if(request.method()==='POST' && request.url().endsWith('/attachments'))uploads++;});
  await chooseTime(page);await fillDevice(page);const input=page.locator('#appointment-attachments');await expect(input).not.toHaveAttribute('capture');
  await input.setInputFiles([1,2].map(index=>({name:index+'.png',mimeType:'image/png',buffer:PHOTO})));await expect(page.locator('.photo-card')).toHaveCount(2);await expect(page.locator('#booking-photos')).toContainText('照片已准备好');expect(uploads).toBe(0);
  await input.setInputFiles([3,4,5].map(index=>({name:index+'.png',mimeType:'image/png',buffer:PHOTO})));await expect(page.locator('#booking-photos')).toContainText('最多 4 张');await expect(page.locator('.photo-card')).toHaveCount(2);
  await input.setInputFiles({name:'3.png',mimeType:'image/png',buffer:PHOTO});await expect(page.locator('.photo-card')).toHaveCount(3);await expect(page.locator('#booking-photos')).toContainText('照片已准备好');await page.locator('[data-delete]').last().click();await expect(page.locator('.photo-card')).toHaveCount(2);
  await page.locator('[data-preview]').first().click();await expect(page.locator('#photo-modal')).toBeVisible();await page.locator('#close-photo').click();await goReview(page);await submitStudent(page);await expect(page.locator('#success-photo-message')).toHaveText('照片已全部上传。');expect(uploads).toBe(2);expect([...state.appointments.values()][0].attachments).toHaveLength(2);
});

test('failed compression blocks only the selected photo and can be resolved by removing it',async({page})=>{
  await setupStudent(page);await chooseTime(page);await fillDevice(page);await page.locator('#appointment-attachments').setInputFiles({name:'broken.jpg',mimeType:'image/jpeg',buffer:Buffer.from('not an image')});await expect(page.locator('#booking-photos .is-error')).toBeVisible();await page.locator('#step-two-next').click();await expect(page.locator('[data-step="2"]')).toBeVisible();await expect(page.locator('#booking-photos')).toContainText('替换或删除');await page.locator('[data-delete]').click();await goReview(page);
});

test('a photo upload failure leaves success intact and retries just the failed photo',async({page})=>{
  await setupStudent(page);let failed=true,requests=0;
  await page.route('**/api/appointments/*/attachments',route=>{requests++;if(failed && requests===1)return route.fulfill({status:503,json:{error:'照片暂时无法上传'}});return route.fulfill({status:201,json:{id:String(requests),purpose:'student_photo'}});});
  await chooseTime(page);await fillDevice(page);await page.locator('#appointment-attachments').setInputFiles([1,2].map(index=>({name:index+'.png',mimeType:'image/png',buffer:PHOTO})));await expect.poll(()=>page.locator('.photo-card').filter({hasText:'照片已准备好'}).count()).toBe(2);await goReview(page);await submitStudent(page);await expect(page.locator('#success-photo-message')).toContainText('预约已成功');await expect(page.locator('#success-title')).toHaveText('预约成功');
  failed=false;await page.locator('#success-photo-retry').click();await expect(page.locator('#success-photo-message')).toHaveText('照片已全部上传。');expect(requests).toBe(3);
});

test('session draft asks before restoring, expires after two hours, and excludes photos, signatures and consent',async({page})=>{
  await setupStudent(page);await chooseTime(page);await fillDevice(page);await goReview(page);await sign(page);await page.locator('[name=agreement]').check();const stored=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('pioneerStudentBookingDraft')));expect(JSON.stringify(stored)).not.toContain('signature');expect(JSON.stringify(stored)).not.toContain('agreement');
  await page.reload();await expect(page.locator('#draft-prompt')).toContainText('发现未完成的预约，是否继续填写？');await expect(page.locator('[name=name]')).toHaveValue('');await page.locator('#draft-restore').click();await expect(page.locator('[name=name]')).toHaveValue('预约测试同学');await expect(page.locator('[name=agreement]')).not.toBeChecked();await expect(page.locator('#confirmed-signature')).toBeHidden();await expect(page.locator('.photo-card')).toHaveCount(0);await expect(page.locator('#draft-notice')).toContainText('重新选择照片');
  await page.evaluate(()=>{const draft=JSON.parse(sessionStorage.getItem('pioneerStudentBookingDraft'));draft.savedAt=Date.now()-3*60*60*1000;sessionStorage.setItem('pioneerStudentBookingDraft',JSON.stringify(draft));});await page.reload();await expect(page.locator('#draft-prompt')).toBeHidden();await expect(page.locator('[name=name]')).toHaveValue('');
});

test('unavailable local storage retains a session credential, full private link and working detail',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(window,'localStorage',{value:{getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}}}));
  await setupStudent(page);await chooseTime(page);await fillDevice(page);await goReview(page);await submitStudent(page);await expect(page.locator('#credential-save-message')).toContainText('无法保存');await expect(page.locator('#success-link-fallback')).toBeVisible();expect(await page.locator('#success-link-fallback').inputValue()).toContain('#appointment=');await page.locator('#view-created-appointment').click();await expect(page.locator('#appointment-detail')).toContainText('预约测试同学');
});

test('empty list, failed record and inline import remain distinct and failed verification preserves the old credential',async({page})=>{
  const state=await setupStudent(page);await page.locator('[data-view-link=lookup]').first().click();await expect(page.locator('#lookup-results')).toContainText('这里空空如也哦，快去预约一个吧');await page.locator('[data-open-import]').click();await expect(page.locator('#import-form')).toBeVisible();await page.locator('#private-link-input').fill('20260001');await page.locator('#import-form [type=submit]').click();await expect(page.locator('#import-error')).toContainText('完整');
  await page.locator('[data-view-link=booking]').first().click();await chooseTime(page);await fillDevice(page);await goReview(page);await submitStudent(page);const id=[...state.appointments.keys()][0];await page.locator('[data-view-link=lookup]').first().click();await expect(page.locator('#import-appointment')).toBeVisible();if(await page.locator('#import-form').isHidden())await page.locator('#import-appointment').click();const link=page.url().split('#')[0]+'#appointment='+id+'&access='+'b'.repeat(43);
  await page.route('**/api/appointments/'+id,route=>route.fulfill({status:404,json:{error:'无权限'}}));await page.locator('#private-link-input').fill(link);await page.locator('#import-form [type=submit]').click();await expect(page.locator('#import-error')).toContainText('无权限');expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('pioneerAppointmentAccess'))[0].accessToken)).toBe('a'.repeat(43));await page.locator('#refresh-my-appointments').click();await expect(page.locator('#lookup-results')).not.toContainText('这里空空如也哦');await expect(page.locator('[data-retry-id]')).toBeVisible();await expect(page.locator('#lookup-results')).toContainText('私人凭证失效');
});

test('cancellation with a lost response rechecks the server and keeps the cancelled detail',async({page})=>{
  const state=await setupStudent(page);await chooseTime(page);await fillDevice(page);await goReview(page);await submitStudent(page);await page.locator('#view-created-appointment').click();const item=[...state.appointments.values()][0];
  await page.route('**/api/appointments/*/status',route=>{item.status='cancelled';item.completedAt='2026-10-12T02:10:00.000Z';item.revision++;return route.abort();});
  await page.locator('[data-cancel-open]').click();await expect(page.locator('.cancel-confirm')).toContainText('取消后本次预约将失效');await page.locator('[data-cancel-keep]').click();await expect(page.locator('.cancel-confirm')).toBeHidden();await page.locator('[data-cancel-open]').click();await page.locator('[data-cancel-confirm]').click();await expect(page.locator('#detail-summary')).toContainText('已取消');await expect(page.locator('[data-cancel-open]')).toHaveCount(0);await page.locator('#back-to-appointments').click();await expect(page.locator('.record-group').last().locator('.student-record')).toHaveCount(1);
});

test('completed legacy results, missing times and rebooking preserve history while clearing only an explicitly discarded draft',async({page})=>{
  const state=await setupStudent(page),item={id:'reserve020261012-80',accessToken:'a'.repeat(43),revision:0,status:'completed',outcome:'legacy_unknown',date:'2026-10-12',timeSlot:'19:00–20:00',campus:'南湖',deviceType:'显示器',brand:'旧品牌',name:'历史机主',studentId:'20260080',note:'历史备注',serial:'LEGACY',attachments:[]};state.appointments.set(item.id,item);
  await page.evaluate(entry=>localStorage.setItem('pioneerAppointmentAccess',JSON.stringify([{id:entry.id,accessToken:entry.accessToken}])),item);
  await chooseTime(page);await fillDevice(page,{name:'当前草稿机主'});await page.locator('[data-view-link=lookup]').first().click();await page.locator(`[data-detail-id="${item.id}"]`).click();await expect(page.locator('#appointment-detail')).toContainText('历史未分类');await expect(page.locator('#appointment-detail')).not.toContainText('修复成功');await expect(page.locator('#appointment-detail')).toContainText('未记录');await expect(page.locator('#appointment-detail')).toContainText('LEGACY');
  await page.locator('[data-rebook]').click();await expect(page.locator('#rebook-confirm')).toBeVisible();await page.locator('[data-rebook-keep]').click();await page.locator('[data-view-link=booking]').first().click();await expect(page.locator('[name=name]')).toHaveValue('当前草稿机主');
  await page.locator('[data-view-link=lookup]').first().click();await page.locator(`[data-detail-id="${item.id}"]`).click();await page.locator('[data-rebook]').click();await page.locator('[data-rebook-confirm]').click();await expect(page.locator('[data-step="1"]')).toBeVisible();await expect(page.locator('[name=campus]')).toHaveValue('');await expect(page.locator('[name=name]')).toHaveValue('');await expect(page.locator('[name=deviceType]')).toHaveValue('');expect(state.appointments.get(item.id).status).toBe('completed');
});

test('status and location polling retain confirmed data on failure, pause while hidden, and update on return',async({page})=>{
  const state=await setupStudent(page);await chooseTime(page);await fillDevice(page);await goReview(page);await submitStudent(page);const item=[...state.appointments.values()][0];await page.locator('#view-created-appointment').click();
  let reads=0,fail=false;await page.route('**/api/appointments/'+item.id,route=>{reads++;return fail ? route.abort() : route.fulfill({json:item});});
  item.location='临时新地点';item.locationSnapshot='南湖校区测试维修室';item.locationChanged=true;await page.clock.fastForward(30000);await expect(page.locator('#detail-summary')).toContainText('维修地点已调整');await expect(page.locator('#detail-summary')).toContainText('临时新地点');
  fail=true;await page.clock.fastForward(30000);await expect(page.locator('#detail-notice')).toContainText('暂时无法更新');await expect(page.locator('#detail-summary')).toContainText('临时新地点');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});const before=reads;await page.clock.fastForward(60000);expect(reads).toBe(before);
  fail=false;item.status='in_progress';item.startedAt='2026-10-12T11:10:00.000Z';item.revision++;await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await expect(page.locator('#detail-summary')).toContainText('维修中');await expect(page.locator('[data-cancel-open]')).toHaveCount(0);
});

test('a delayed old detail response never replaces a more recently selected appointment',async({page})=>{
  const state=await setupStudent(page);const items=[1,2].map(number=>({id:`reserve020261012-${String(number).padStart(2,'0')}`,accessToken:'a'.repeat(43),revision:0,status:'booked',date:'2026-10-12',timeSlot:'19:00–19:30',campus:'南湖',deviceType:'其他',brand:'设备 '+number,name:'机主 '+number,attachments:[]}));items.forEach(item=>state.appointments.set(item.id,item));
  await page.evaluate(items=>localStorage.setItem('pioneerAppointmentAccess',JSON.stringify(items.map(item=>({id:item.id,accessToken:item.accessToken})))),items);await page.locator('[data-view-link=lookup]').first().click();await expect(page.locator('.student-record')).toHaveCount(2);
  let release;const gate=new Promise(resolve=>release=resolve);await page.route('**/api/appointments/'+items[0].id,async route=>{await gate;await route.fulfill({json:items[0]});});
  await page.locator(`[data-detail-id="${items[0].id}"]`).click();await page.locator('[data-view-link=lookup]').first().click();await page.locator(`[data-detail-id="${items[1].id}"]`).click();await expect(page.locator('#appointment-detail')).toContainText('机主 2');release();await expect(page.locator('#appointment-detail')).not.toContainText('机主 1');await expect(page.locator('#appointment-detail')).toContainText(items[1].id);
});

test('replacing a photo during compression ignores a later failure from the old selection',async({page})=>{
  await setupStudent(page);await chooseTime(page);await fillDevice(page);
  await page.evaluate(()=>{const original=window.loadImage;window.loadImage=(file,callback,options)=>{if(file.name==='old.png'){window.failOldPhoto=()=>callback({type:'error'},{});return {};}return original(file,callback,options);};window.loadImage.scale=original.scale;});
  await page.locator('#appointment-attachments').setInputFiles({name:'old.png',mimeType:'image/png',buffer:PHOTO});await page.waitForFunction(()=>typeof window.failOldPhoto==='function');
  const chooser=page.waitForEvent('filechooser');await page.locator('[data-replace]').click();await (await chooser).setFiles({name:'new.png',mimeType:'image/png',buffer:PHOTO});await expect(page.locator('.photo-card')).toContainText('new.png');await expect(page.locator('.photo-card')).toContainText('照片已准备好');
  await page.evaluate(()=>window.failOldPhoto());await expect(page.locator('.photo-card .is-error')).toHaveCount(0);await expect(page.locator('.photo-card')).toContainText('new.png');await goReview(page);
});

test('leaving a detail with an upload in flight prevents the old failure from changing another detail',async({page})=>{
  const state=await setupStudent(page);await chooseTime(page);await fillDevice(page);await goReview(page);await submitStudent(page);const first=[...state.appointments.values()][0],second={...first,id:'reserve020261012-90',name:'第二条预约机主',attachments:[]};state.appointments.set(second.id,second);
  await page.evaluate(item=>{const entries=JSON.parse(localStorage.getItem('pioneerAppointmentAccess'));entries.push({id:item.id,accessToken:item.accessToken});localStorage.setItem('pioneerAppointmentAccess',JSON.stringify(entries));},second);
  await page.locator('#view-created-appointment').click();let release;const gate=new Promise(resolve=>release=resolve);let started=false;
  await page.route('**/api/appointments/*/attachments',async route=>{started=true;await gate;await route.fulfill({status:503,json:{error:'旧预约照片上传失败'}});});
  await page.locator('#detail-photos input[type=file]').first().setInputFiles({name:'late.png',mimeType:'image/png',buffer:PHOTO});await expect(page.locator('#detail-photos')).toContainText('照片已准备好');await page.locator('#detail-upload').click();await expect.poll(()=>started).toBe(true);
  await page.locator('[data-view-link=lookup]').first().click();await page.locator(`[data-detail-id="${second.id}"]`).click();await expect(page.locator('#appointment-detail')).toContainText('第二条预约机主');release();await expect(page.locator('#detail-upload-message')).toHaveText('');await expect(page.locator('#detail-upload')).toBeEnabled();await expect(page.locator('#appointment-detail')).not.toContainText('旧预约照片上传失败');
});

test('saved historical aliases are verified and canonicalized without an endless loading placeholder',async({page})=>{
  const state=await setupStudent(page),item={id:'reverse020261012-70',accessToken:'a'.repeat(43),revision:0,status:'completed',outcome:'legacy_unknown',date:'2026-10-12',timeSlot:'19:00–20:00',campus:'南湖',brand:'历史设备',deviceType:'显示器',attachments:[]},alias='020261012-71';state.appointments.set(item.id,item);
  await page.route('**/api/appointments/'+alias,route=>route.fulfill({json:item}));await page.evaluate(entry=>localStorage.setItem('pioneerAppointmentAccess',JSON.stringify([entry])),{id:alias,accessToken:item.accessToken});await page.locator('[data-view-link=lookup]').first().click();await expect(page.locator('.student-record')).toHaveCount(1);await expect(page.locator('[aria-busy=true]')).toHaveCount(0);await expect(page.locator('#lookup-results')).not.toContainText('正在读取');expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('pioneerAppointmentAccess'))[0].id)).toBe(item.id);
});

test('a network error in a zero-service-day window is not presented as confirmed empty availability',async({page})=>{
  await setupStudent(page,{now:'2026-10-15T21:00:00+08:00',availability:(_,route)=>route.abort()});await page.locator('[data-campus=南湖]').click();await expect(page.locator('#booking-selection')).toContainText('暂时无法更新');await expect(page.locator('#booking-empty')).toBeHidden();await expect(page.locator('#booking-retry')).toBeVisible();
});

test('refresh and retry preserve expanded descriptions and selected replacement photos',async({page})=>{
  const state=await setupStudent(page);await chooseTime(page);await fillDevice(page);await page.locator('[name=issue]').fill('这是一段较长的故障说明。'.repeat(40));await goReview(page);await submitStudent(page);await page.locator('#view-created-appointment').click();const item=[...state.appointments.values()][0];
  const description=page.locator('#detail-information details');await description.locator('summary').click();await page.locator('#detail-photos input[type=file]').first().setInputFiles({name:'kept.png',mimeType:'image/png',buffer:PHOTO});await expect(page.locator('#detail-photos')).toContainText('照片已准备好');await page.clock.fastForward(30000);await expect(description).toHaveJSProperty('open',true);await expect(page.locator('#detail-photos .photo-card')).toHaveCount(1);
  let failure=true;await page.route('**/api/appointments/'+item.id,route=>failure ? route.abort() : route.fulfill({json:item}));await page.clock.fastForward(30000);await expect(page.locator('#detail-notice')).toContainText('暂时无法更新');failure=false;await page.locator('[data-detail-retry]').click();await expect(page.locator('#detail-notice')).toBeHidden();await expect(page.locator('#detail-photos .photo-card')).toHaveCount(1);await expect(description).toHaveJSProperty('open',true);
});

test('signature canvas adapts from portrait to landscape and keeps all actions usable',async({page})=>{
  await setupStudent(page);await page.setViewportSize({width:375,height:812});await chooseTime(page);await fillDevice(page);await goReview(page);await page.locator('#open-signature').click();
  await expect(page.locator('#signature-canvas')).toBeVisible();const portrait=await page.locator('#signature-canvas').boundingBox();expect(portrait.height).toBeGreaterThan(180);await page.setViewportSize({width:812,height:375});await expect.poll(async()=>{const box=await page.locator('#signature-canvas').boundingBox();return box.width/box.height;}).toBeGreaterThan(2);
  await page.locator('#clear-signature').click();await page.locator('#confirm-signature').click();await expect(page.locator('#signature-error')).toContainText('完整手写');expect(await page.locator('#signature-modal .modal').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);await page.locator('#cancel-signature').click();await expect(page.locator('#signature-modal')).toBeHidden();
});

test('a small byte-size image with large pixel dimensions still obeys the 2560px student limit',async({page})=>{
  await setupStudent(page);
  const result=await page.evaluate(async()=>{const {compressImage}=await import('/shared/image-compress.js');const source=document.createElement('canvas');source.width=6000;source.height=4000;const context=source.getContext('2d');context.fillStyle='white';context.fillRect(0,0,6000,4000);const blob=await new Promise(resolve=>source.toBlob(resolve,'image/png'));const prepared=await compressImage(new File([blob],'large-small.png',{type:'image/png'}),{strict:true});const image=new Image(),url=URL.createObjectURL(prepared.file);await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});const dimensions={width:image.naturalWidth,height:image.naturalHeight,size:prepared.file.size};URL.revokeObjectURL(url);source.width=source.height=0;return dimensions;});
  expect(Math.max(result.width,result.height)).toBeLessThanOrEqual(2560);expect(result.size).toBeLessThanOrEqual(2*1024*1024);
});

for(const width of [320,1440])test(`long links and manual brand names stay readable inside cards at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:812});await page.emulateMedia({reducedMotion:'reduce'});await setupStudent(page);await chooseTime(page);await fillDevice(page);
  await page.locator('[name=brand]').selectOption('other');await page.locator('[name=brandOther]').fill('B'.repeat(80));await page.locator('[name=issue]').fill('补充说明\nhttps://example.com/'+'a'.repeat(600));await goReview(page);
  const contained=async locator=>expect(await locator.evaluateAll(elements=>elements.every(element=>element.scrollWidth<=element.clientWidth))).toBe(true);
  await contained(page.locator('#booking-review .record-note'));await page.locator('#booking-review details summary').click();await contained(page.locator('#booking-review .record-note'));
  await submitStudent(page);await page.locator('#view-created-appointment').click();await page.locator('#detail-information details summary').click();await contained(page.locator('#detail-information .record-note'));
  await page.locator('#back-to-appointments').click();await expect(page.locator('.student-record')).toHaveCount(1);await contained(page.locator('.student-record'));
  expect(await page.evaluate(()=>Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)<=innerWidth)).toBe(true);
});

test('finishing QR generation preserves the position of success actions and never blocks detail navigation',async({page})=>{
  await page.setViewportSize({width:320,height:812});await page.emulateMedia({reducedMotion:'reduce'});await setupStudent(page);
  let release;const gate=new Promise(resolve=>release=resolve);await page.route('**/api/appointments/*/scan-code',async route=>{await gate;const id=new URL(route.request().url()).pathname.split('/').at(-2);await route.fulfill({json:{id,code:id+'.123456789abc'}});});
  await chooseTime(page);await fillDevice(page);await goReview(page);await submitStudent(page);const action=page.locator('#view-created-appointment');
  const position=()=>action.evaluate(element=>element.getBoundingClientRect().top+scrollY);const before=await position();release();await expect(page.locator('#success-repair-qr .repair-qr-status')).toHaveText('');await expect.poll(async()=>page.locator('#success-repair-qr img').evaluate(image=>image.complete && image.naturalWidth>0)).toBe(true);
  expect(Math.abs(await position()-before)).toBeLessThan(1);await action.click();await expect(page.locator('#lookup-detail')).toBeVisible();
});
